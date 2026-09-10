import type { PrismaClient } from "@prisma/client";
import { computeFifoConsumption } from "../../lib/fifo.js";
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

function matchesRequest(
  existing: { fuelTypeId: number; liters: number; isPersonal: boolean; truckId: number | null; tripId: number | null; createdBy: number },
  params: WithdrawFuelParams,
): boolean {
  return (
    existing.fuelTypeId === params.fuelTypeId &&
    existing.liters === params.liters &&
    existing.isPersonal === params.isPersonal &&
    existing.truckId === params.truckId &&
    existing.tripId === params.tripId &&
    existing.createdBy === params.createdBy
  );
}

async function findMatchingByKey(prisma: PrismaClient, idempotencyKey: string, params: WithdrawFuelParams) {
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
  if (params.idempotencyKey) {
    const existing = await findMatchingByKey(prisma, params.idempotencyKey, params);
    if (existing) return existing;
  }

  try {
    return await performWithdrawal(prisma, params);
  } catch (error) {
    // Конкурентный повтор с тем же ключом мог: (а) выиграть гонку на
    // уникальном индексе (P2002), либо (б) успеть списать топливо первым,
    // из-за чего НАШ пересчёт остатка упал с InsufficientFuelError раньше,
    // чем дошёл до индекса. В обоих случаях сначала проверяем, не появилась
    // ли за это время подходящая запись с тем же ключом, и только если нет —
    // отдаём исходную ошибку как настоящую.
    if (params.idempotencyKey) {
      const existing = await findMatchingByKey(prisma, params.idempotencyKey, params);
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

/** Проверяет, что данная машина сейчас назначена этому водителю активным рейсом. */
export async function driverOwnsTruck(prisma: PrismaClient, driverId: number, truckId: number): Promise<boolean> {
  const trip = await prisma.trip.findFirst({
    where: { driverId, truckId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
  });
  return trip !== null;
}
