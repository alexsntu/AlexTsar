import type { Prisma, PrismaClient, Truck } from "@prisma/client";
import { round2 } from "../../lib/money.js";

export interface MaintenancePartInput {
  name: string;
  cost: number;
}

export interface CreateMaintenanceRecordParams {
  truckId: number;
  type: "SERVICE" | "REPAIR";
  date: Date;
  odometer: number;
  description: string | null;
  parts: MaintenancePartInput[];
  createdBy: number;
}

export async function createMaintenanceRecord(prisma: PrismaClient, params: CreateMaintenanceRecordParams) {
  return prisma.$transaction(async (tx) => {
    const totalCost = round2(params.parts.reduce((sum, part) => sum + part.cost, 0));

    const record = await tx.maintenanceRecord.create({
      data: {
        truckId: params.truckId,
        type: params.type,
        date: params.date,
        odometer: params.odometer,
        description: params.description,
        totalCost,
        createdBy: params.createdBy,
        parts: { create: params.parts.map((part) => ({ name: part.name, cost: part.cost })) },
      },
      include: { parts: true },
    });

    if (params.type === "SERVICE") {
      const truck = await tx.truck.findUnique({ where: { id: params.truckId } });
      // Обновляем базу для расчёта следующего ТО, только если это ТО не "задним числом" раньше уже известного
      if (!truck?.lastServiceDate || params.date >= truck.lastServiceDate) {
        await tx.truck.update({
          where: { id: params.truckId },
          data: { lastServiceDate: params.date, lastServiceOdometer: params.odometer },
        });
      }
    }

    return record;
  });
}

export interface UpdateMaintenanceRecordParams {
  truckId: number;
  type: "SERVICE" | "REPAIR";
  date: Date;
  odometer: number;
  description: string | null;
  parts: MaintenancePartInput[];
}

/**
 * Пересчитывает базу для расчёта следующего ТО (lastServiceDate/Odometer) из
 * самой свежей оставшейся записи type=SERVICE этой машины. Если записей
 * SERVICE не осталось совсем — базу НЕ трогаем: она могла быть выставлена
 * вручную (кнопка "Настроить"), без привязки к конкретной записи в журнале,
 * и стирать её только из-за того, что журнал опустел, не нужно.
 */
async function recomputeLastService(tx: Prisma.TransactionClient, truckId: number) {
  const latestService = await tx.maintenanceRecord.findFirst({
    where: { truckId, type: "SERVICE" },
    orderBy: [{ date: "desc" }, { id: "desc" }],
  });
  if (latestService) {
    await tx.truck.update({
      where: { id: truckId },
      data: { lastServiceDate: latestService.date, lastServiceOdometer: latestService.odometer },
    });
  }
}

export async function updateMaintenanceRecord(prisma: PrismaClient, recordId: number, params: UpdateMaintenanceRecordParams) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id: recordId } });
    if (!existing) return null;

    const totalCost = round2(params.parts.reduce((sum, part) => sum + part.cost, 0));

    // Полная замена списка запчастей — проще и надёжнее, чем сверять построчные diff'ы.
    await tx.maintenancePart.deleteMany({ where: { recordId } });
    const record = await tx.maintenanceRecord.update({
      where: { id: recordId },
      data: {
        truckId: params.truckId,
        type: params.type,
        date: params.date,
        odometer: params.odometer,
        description: params.description,
        totalCost,
        parts: { create: params.parts.map((part) => ({ name: part.name, cost: part.cost })) },
      },
      include: { parts: true },
    });

    // Пересчитываем базу и для новой машины записи, и (если машину сменили) для старой —
    // у обеих могла измениться самая свежая запись SERVICE.
    await recomputeLastService(tx, params.truckId);
    if (existing.truckId !== params.truckId) {
      await recomputeLastService(tx, existing.truckId);
    }

    return record;
  });
}

export async function deleteMaintenanceRecord(prisma: PrismaClient, recordId: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRecord.findUnique({ where: { id: recordId } });
    if (!existing) return null;

    await tx.maintenancePart.deleteMany({ where: { recordId } });
    await tx.maintenanceRecord.delete({ where: { id: recordId } });
    await recomputeLastService(tx, existing.truckId);

    return existing;
  });
}

/** Лучшая известная нам текущая наработка машины — максимум одометра из заправок и ТО/ремонтов. */
export async function getCurrentOdometer(prisma: PrismaClient, truckId: number): Promise<number | null> {
  const [fuelMax, maintenanceMax] = await Promise.all([
    prisma.fuelWithdrawal.aggregate({ where: { truckId, odometer: { not: null } }, _max: { odometer: true } }),
    prisma.maintenanceRecord.aggregate({ where: { truckId }, _max: { odometer: true } }),
  ]);
  const candidates = [fuelMax._max.odometer, maintenanceMax._max.odometer].filter(
    (value): value is number => value !== null && value !== undefined,
  );
  if (candidates.length === 0) return null;
  return Math.max(...candidates);
}

export interface UpcomingService {
  truckId: number;
  truckName: string;
  plateNumber: string;
  currentOdometer: number | null;
  lastServiceDate: Date | null;
  lastServiceOdometer: number | null;
  dueOdometer: number | null;
  remainingKm: number | null;
  dueDate: Date | null;
  remainingDays: number | null;
  overdue: boolean;
  /** Доля интервала, что осталась (меньше — срочнее); используется только для сортировки. */
  urgencyRatio: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function computeUpcomingService(prisma: PrismaClient, truck: Truck): Promise<UpcomingService | null> {
  if (!truck.serviceIntervalKm && !truck.serviceIntervalDays) return null;

  const currentOdometer = await getCurrentOdometer(prisma, truck.id);

  let dueOdometer: number | null = null;
  let remainingKm: number | null = null;
  if (truck.serviceIntervalKm && truck.lastServiceOdometer !== null) {
    dueOdometer = truck.lastServiceOdometer + truck.serviceIntervalKm;
    remainingKm = currentOdometer !== null ? round2(dueOdometer - currentOdometer) : null;
  }

  let dueDate: Date | null = null;
  let remainingDays: number | null = null;
  if (truck.serviceIntervalDays && truck.lastServiceDate) {
    dueDate = new Date(truck.lastServiceDate.getTime() + truck.serviceIntervalDays * DAY_MS);
    remainingDays = Math.ceil((dueDate.getTime() - Date.now()) / DAY_MS);
  }

  const overdue = (remainingKm !== null && remainingKm <= 0) || (remainingDays !== null && remainingDays <= 0);

  const ratios: number[] = [];
  if (remainingKm !== null && truck.serviceIntervalKm) ratios.push(remainingKm / truck.serviceIntervalKm);
  if (remainingDays !== null && truck.serviceIntervalDays) ratios.push(remainingDays / truck.serviceIntervalDays);
  const urgencyRatio = ratios.length > 0 ? Math.min(...ratios) : Infinity;

  return {
    truckId: truck.id,
    truckName: truck.name,
    plateNumber: truck.plateNumber,
    currentOdometer,
    lastServiceDate: truck.lastServiceDate,
    lastServiceOdometer: truck.lastServiceOdometer,
    dueOdometer,
    remainingKm,
    dueDate,
    remainingDays,
    overdue,
    urgencyRatio,
  };
}
