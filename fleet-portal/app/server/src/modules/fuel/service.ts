import type { PrismaClient } from "@prisma/client";
import { computeFifoConsumption, InsufficientFuelError } from "../../lib/fifo.js";
import { round2 } from "../../lib/money.js";

export interface WithdrawFuelParams {
  fuelTypeId: number;
  date: Date;
  liters: number;
  isPersonal: boolean;
  truckId: number | null;
  odometer: number | null;
  personalComment: string | null;
  createdBy: number;
  tripId: number | null;
  /** Повторный вызов с тем же ключом возвращает уже созданную запись вместо нового списания. */
  idempotencyKey: string | null;
}

/** Ключ идемпотентности принадлежит другому пользователю или его параметры
 *  не совпадают с текущим запросом — значит ключ не про "тот же самый"
 *  повтор, и отдавать чужую/несовпадающую запись как успех нельзя. */
export class IdempotencyConflictError extends Error {
  constructor() {
    super("Ключ идемпотентности уже использован с другими параметрами");
    this.name = "IdempotencyConflictError";
  }
}

/** Откуда топливо у заправки — см. комментарий к FuelWithdrawal.source в schema.prisma. */
export type FuelSource = "TANK" | "TALON" | "CARD";

/** Номиналы талонов, которые есть в обороте (литры дизеля на один талон). */
export const TALON_NOMINALS = [10, 20, 50] as const;

type IdempotencyFields = {
  source: FuelSource;
  fuelTypeId: number;
  liters: number;
  isPersonal: boolean;
  truckId: number | null;
  tripId: number | null;
  createdBy: number;
};

function matchesRequest(
  existing: { source: string; fuelTypeId: number; liters: number; isPersonal: boolean; truckId: number | null; tripId: number | null; createdBy: number },
  params: IdempotencyFields,
): boolean {
  return (
    existing.source === params.source &&
    existing.fuelTypeId === params.fuelTypeId &&
    existing.liters === params.liters &&
    existing.isPersonal === params.isPersonal &&
    existing.truckId === params.truckId &&
    existing.tripId === params.tripId &&
    existing.createdBy === params.createdBy
  );
}

async function findMatchingByKey(prisma: PrismaClient, idempotencyKey: string, params: IdempotencyFields) {
  const existing = await prisma.fuelWithdrawal.findUnique({
    where: { idempotencyKey },
    include: { lotUsages: true },
  });
  if (!existing) return null;
  // Ключ есть в базе, но принадлежит другому пользователю/операции — не
  // "тот же самый" повтор (иначе можно чужим известным ключом получить
  // доступ к чужой записи вместо честной 409).
  if (!matchesRequest(existing, params)) {
    throw new IdempotencyConflictError();
  }
  return existing;
}

/**
 * Списывает топливо по FIFO внутри одной транзакции: читает партии с
 * остатком, распределяет запрошенные литры по самым старым партиям, пишет
 * обновлённые остатки и создаёт FuelWithdrawal + FuelWithdrawalLotUsage.
 * Транзакция гарантирует, что чтение остатка и его уменьшение атомарны —
 * при параллельных списаниях второй запрос увидит уже обновлённый остаток.
 */
export async function withdrawFuel(prisma: PrismaClient, params: WithdrawFuelParams) {
  return withIdempotency(prisma, params.idempotencyKey, { ...params, source: "TANK" }, () => performWithdrawal(prisma, params));
}

async function withIdempotency<T>(
  prisma: PrismaClient,
  idempotencyKey: string | null,
  fields: IdempotencyFields,
  perform: () => Promise<T>,
) {
  if (idempotencyKey) {
    const existing = await findMatchingByKey(prisma, idempotencyKey, fields);
    if (existing) return existing;
  }

  try {
    return await perform();
  } catch (error) {
    // Конкурентный повтор с тем же ключом мог: (а) выиграть гонку на
    // уникальном индексе (P2002), либо (б) успеть списать топливо первым,
    // из-за чего НАШ пересчёт остатка упал с InsufficientFuelError раньше,
    // чем дошёл до индекса. В обоих случаях сначала проверяем, не появилась
    // ли за это время подходящая запись с тем же ключом, и только если нет —
    // отдаём исходную ошибку как настоящую.
    if (idempotencyKey) {
      const existing = await findMatchingByKey(prisma, idempotencyKey, fields);
      if (existing) return existing;
    }
    throw error;
  }
}

async function performWithdrawal(prisma: PrismaClient, params: WithdrawFuelParams) {
  return prisma.$transaction(async (tx) => {
    // Партии, поступившие позже даты этого расхода, не должны участвовать —
    // иначе список "задним числом" может списать топливо, которого на складе
    // на эту дату ещё не было (нарушает хронологию учёта).
    const lots = await tx.fuelLot.findMany({
      where: { fuelTypeId: params.fuelTypeId, litersRemaining: { gt: 0 }, date: { lte: params.date } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    const plan = computeFifoConsumption(
      lots.map((lot) => ({
        id: lot.id,
        litersRemaining: lot.litersRemaining,
        pricePerLiter: lot.pricePerLiter,
        valueRemaining: lot.valueRemaining,
      })),
      params.liters,
    );

    for (const updated of plan.updatedLots) {
      await tx.fuelLot.update({
        where: { id: updated.id },
        data: { litersRemaining: updated.litersRemaining, valueRemaining: updated.valueRemaining },
      });
    }

    return tx.fuelWithdrawal.create({
      data: {
        fuelTypeId: params.fuelTypeId,
        date: params.date,
        liters: params.liters,
        isPersonal: params.isPersonal,
        truckId: params.truckId,
        odometer: params.odometer,
        personalComment: params.personalComment,
        idempotencyKey: params.idempotencyKey,
        totalCost: round2(plan.totalCost),
        createdBy: params.createdBy,
        tripId: params.tripId,
        lotUsages: {
          create: plan.usages.map((usage) => ({
            lotId: usage.lotId,
            litersUsed: usage.litersUsed,
            pricePerLiterAtUse: usage.pricePerLiterAtUse,
          })),
        },
      },
      include: { lotUsages: true },
    });
  });
}

export class InsufficientTalonsError extends Error {
  readonly available: number;
  readonly requested: number;
  readonly nominalLiters: number;

  constructor(nominalLiters: number, available: number, requested: number) {
    super(`Недостаточно талонов по ${nominalLiters} л: запрошено ${requested} шт., в наличии ${available} шт.`);
    this.name = "InsufficientTalonsError";
    this.nominalLiters = nominalLiters;
    this.available = available;
    this.requested = requested;
  }
}

export interface IssueTalonsParams {
  fuelTypeId: number;
  date: Date;
  nominalLiters: number;
  count: number;
  truckId: number;
  odometer: number | null;
  createdBy: number;
  idempotencyKey: string | null;
}

/**
 * Выдаёт талоны на машину: списывает их по FIFO с самых старых партий этого
 * номинала и сразу признаёт расход топлива (FuelWithdrawal с source = TALON,
 * литры = номинал × количество). Считается тем же computeFifoConsumption,
 * что и склад, — только единица не литр, а талон.
 */
export async function issueTalons(prisma: PrismaClient, params: IssueTalonsParams) {
  const liters = params.nominalLiters * params.count;
  const fields: IdempotencyFields = {
    source: "TALON",
    fuelTypeId: params.fuelTypeId,
    liters,
    isPersonal: false,
    truckId: params.truckId,
    tripId: null,
    createdBy: params.createdBy,
  };

  return withIdempotency(prisma, params.idempotencyKey, fields, () =>
    prisma.$transaction(async (tx) => {
      // Как и со складом: талоны, купленные позже даты выдачи, не участвуют.
      const lots = await tx.fuelTalonLot.findMany({
        where: {
          fuelTypeId: params.fuelTypeId,
          nominalLiters: params.nominalLiters,
          countRemaining: { gt: 0 },
          date: { lte: params.date },
        },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      });

      let plan;
      try {
        plan = computeFifoConsumption(
          lots.map((lot) => ({
            id: lot.id,
            litersRemaining: lot.countRemaining,
            pricePerLiter: lot.pricePerTalon,
            valueRemaining: lot.valueRemaining,
          })),
          params.count,
        );
      } catch (error) {
        if (error instanceof InsufficientFuelError) {
          throw new InsufficientTalonsError(params.nominalLiters, error.available, error.requested);
        }
        throw error;
      }

      for (const updated of plan.updatedLots) {
        await tx.fuelTalonLot.update({
          where: { id: updated.id },
          data: { countRemaining: updated.litersRemaining, valueRemaining: updated.valueRemaining },
        });
      }

      return tx.fuelWithdrawal.create({
        data: {
          source: "TALON",
          fuelTypeId: params.fuelTypeId,
          date: params.date,
          liters,
          talonNominal: params.nominalLiters,
          talonCount: params.count,
          isPersonal: false,
          truckId: params.truckId,
          odometer: params.odometer,
          idempotencyKey: params.idempotencyKey,
          totalCost: round2(plan.totalCost),
          createdBy: params.createdBy,
          talonUsages: {
            create: plan.usages.map((usage) => ({
              lotId: usage.lotId,
              countUsed: usage.litersUsed,
              pricePerTalonAtUse: usage.pricePerLiterAtUse,
              cost: usage.cost,
            })),
          },
        },
        include: { talonUsages: true },
      });
    }),
  );
}

export interface CardRefuelParams {
  fuelTypeId: number;
  date: Date;
  liters: number;
  pricePerLiter: number;
  totalCost: number;
  truckId: number;
  odometer: number | null;
  createdBy: number;
  idempotencyKey: string | null;
}

/** Заправка по топливной карте: склада нет, расход — ровно сумма с АЗС. */
export async function logCardRefuel(prisma: PrismaClient, params: CardRefuelParams) {
  const fields: IdempotencyFields = {
    source: "CARD",
    fuelTypeId: params.fuelTypeId,
    liters: params.liters,
    isPersonal: false,
    truckId: params.truckId,
    tripId: null,
    createdBy: params.createdBy,
  };

  return withIdempotency(prisma, params.idempotencyKey, fields, () =>
    prisma.fuelWithdrawal.create({
      data: {
        source: "CARD",
        fuelTypeId: params.fuelTypeId,
        date: params.date,
        liters: params.liters,
        pricePerLiter: params.pricePerLiter,
        isPersonal: false,
        truckId: params.truckId,
        odometer: params.odometer,
        idempotencyKey: params.idempotencyKey,
        totalCost: params.totalCost,
        createdBy: params.createdBy,
      },
    }),
  );
}

/** Отменять можно только выдачу талонов и заправку по карте — у складских
 *  заправок отмены не было и раньше. */
export class WithdrawalNotCancellableError extends Error {
  constructor() {
    super("Складскую заправку отменить нельзя");
    this.name = "WithdrawalNotCancellableError";
  }
}

/**
 * Отменяет выдачу талонов (водитель вернул неиспользованные, или запись
 * внесена по ошибке) либо заправку по карте. Талоны возвращаются в те же
 * партии, откуда были взяты, вместе с ровно той суммой, что была списана.
 * Возвращает false, если такой записи нет.
 */
export async function cancelWithdrawal(prisma: PrismaClient, id: number): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const withdrawal = await tx.fuelWithdrawal.findUnique({ where: { id }, include: { talonUsages: true } });
    if (!withdrawal) return false;
    if (withdrawal.source !== "TALON" && withdrawal.source !== "CARD") {
      throw new WithdrawalNotCancellableError();
    }

    for (const usage of withdrawal.talonUsages) {
      const lot = await tx.fuelTalonLot.findUniqueOrThrow({ where: { id: usage.lotId } });
      await tx.fuelTalonLot.update({
        where: { id: lot.id },
        data: {
          countRemaining: lot.countRemaining + usage.countUsed,
          valueRemaining: round2(lot.valueRemaining + usage.cost),
        },
      });
    }
    await tx.fuelTalonUsage.deleteMany({ where: { withdrawalId: id } });
    await tx.fuelWithdrawal.delete({ where: { id } });
    return true;
  });
}

/** Подпись источника для отчётов: у складских заправок её нет. */
export function fuelSourceSuffix(source: string): string {
  if (source === "TALON") return " (талоны)";
  if (source === "CARD") return " (карта)";
  return "";
}

/** Проверяет, что данная машина сейчас назначена этому водителю активным рейсом. */
export async function driverOwnsTruck(prisma: PrismaClient, driverId: number, truckId: number): Promise<boolean> {
  const trip = await prisma.trip.findFirst({
    where: { driverId, truckId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
  });
  return trip !== null;
}
