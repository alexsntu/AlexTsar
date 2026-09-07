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
}

/**
 * Списывает топливо по FIFO внутри одной транзакции: читает партии с
 * остатком, распределяет запрошенные литры по самым старым партиям, пишет
 * обновлённые остатки и создаёт FuelWithdrawal + FuelWithdrawalLotUsage.
 * Транзакция гарантирует, что чтение остатка и его уменьшение атомарны —
 * при параллельных списаниях второй запрос увидит уже обновлённый остаток.
 */
export async function withdrawFuel(prisma: PrismaClient, params: WithdrawFuelParams) {
  return prisma.$transaction(async (tx) => {
    const lots = await tx.fuelLot.findMany({
      where: { fuelTypeId: params.fuelTypeId, litersRemaining: { gt: 0 } },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });

    const plan = computeFifoConsumption(
      lots.map((lot) => ({ id: lot.id, litersRemaining: lot.litersRemaining, pricePerLiter: lot.pricePerLiter })),
      params.liters,
    );

    for (const updated of plan.updatedLots) {
      await tx.fuelLot.update({ where: { id: updated.id }, data: { litersRemaining: updated.litersRemaining } });
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
