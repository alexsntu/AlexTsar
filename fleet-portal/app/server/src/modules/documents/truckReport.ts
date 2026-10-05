import type { Address, Delivery, PrismaClient } from "@prisma/client";
import { round2 } from "../../lib/money.js";
import { mskMonthRange } from "./profit.js";
import { getMonthDeliveries } from "./queries.js";

type DeliveryWithAddress = Delivery & { address: Address };

export interface TruckTripLine {
  date: string; // "YYYY-MM-DD"
  city: string;
  addressText: string;
  distanceKm: number;
  massKg: number;
  ratePerKg: number;
  cost: number;
}

export interface TruckDirectionRow {
  city: string;
  trips: number;
  massKg: number;
  distanceKm: number;
  cost: number;
}

export interface TruckFuelLine {
  date: string;
  fuelTypeName: string;
  liters: number;
  cost: number;
  odometer: number | null;
}

export interface TruckMaintenanceLine {
  date: string;
  type: string; // "SERVICE" | "REPAIR"
  description: string | null;
  cost: number;
}

export interface TruckReport {
  yearMonth: string;
  truckPlate: string;
  // Машина из справочника с тем же госномером. null — в справочнике такой
  // нет, поэтому топливо и ТО/ремонты привязать не к чему (они ведутся по
  // машине из справочника, а рейсы — по тексту госномера из файла заказчика).
  truck: { id: number; name: string } | null;
  trips: TruckTripLine[];
  directions: TruckDirectionRow[];
  totals: { trips: number; days: number; massKg: number; distanceKm: number; cost: number };
  fuel: { liters: number; cost: number; lines: TruckFuelLine[] };
  maintenance: { serviceCost: number; repairCost: number; totalCost: number; lines: TruckMaintenanceLine[] };
}

/** Госномер в файле заказчика и в справочнике вводят разные люди — регистр
 * и пробелы при сопоставлении не учитываем. */
export function normalizePlate(plate: string): string {
  return plate.replace(/\s+/g, "").toUpperCase();
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Заправки и ТО хранятся реальными метками времени — день берём по Москве
// (UTC+3, см. lib/date.ts), иначе запись 00:30 МСК уедет на вчерашнее число.
function mskDateKey(d: Date): string {
  return new Date(d.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export interface TruckReportInput {
  yearMonth: string;
  truckPlate: string;
  truck: { id: number; name: string } | null;
  /** Доставки месяца — уже только этой машины. */
  deliveries: DeliveryWithAddress[];
  fuel: TruckFuelLine[];
  maintenance: TruckMaintenanceLine[];
}

export function buildTruckReport(input: TruckReportInput): TruckReport {
  const trips: TruckTripLine[] = input.deliveries.map((d) => ({
    date: dateKey(d.date),
    city: d.address.city,
    addressText: d.address.fullAddress,
    distanceKm: d.distanceKm,
    massKg: d.massKg,
    ratePerKg: d.ratePerKg,
    cost: d.cost,
  }));

  const byCity = new Map<string, TruckDirectionRow>();
  for (const t of trips) {
    const row = byCity.get(t.city) ?? { city: t.city, trips: 0, massKg: 0, distanceKm: 0, cost: 0 };
    row.trips += 1;
    row.massKg += t.massKg;
    row.distanceKm += t.distanceKm;
    row.cost += t.cost;
    byCity.set(t.city, row);
  }
  const directions = [...byCity.values()]
    .map((r) => ({ ...r, cost: round2(r.cost) }))
    .sort((a, b) => b.cost - a.cost || a.city.localeCompare(b.city, "ru"));

  const serviceCost = round2(input.maintenance.filter((m) => m.type === "SERVICE").reduce((s, m) => s + m.cost, 0));
  const repairCost = round2(input.maintenance.filter((m) => m.type !== "SERVICE").reduce((s, m) => s + m.cost, 0));

  return {
    yearMonth: input.yearMonth,
    truckPlate: input.truckPlate,
    truck: input.truck,
    trips,
    directions,
    totals: {
      trips: trips.length,
      days: new Set(trips.map((t) => t.date)).size,
      massKg: trips.reduce((s, t) => s + t.massKg, 0),
      distanceKm: trips.reduce((s, t) => s + t.distanceKm, 0),
      // Итог — из уже округлённых сумм по направлениям, чтобы он сходился с
      // таблицей направлений, которую видит пользователь.
      cost: round2(directions.reduce((s, r) => s + r.cost, 0)),
    },
    fuel: {
      liters: round2(input.fuel.reduce((s, f) => s + f.liters, 0)),
      cost: round2(input.fuel.reduce((s, f) => s + f.cost, 0)),
      lines: input.fuel,
    },
    maintenance: { serviceCost, repairCost, totalCost: round2(serviceCost + repairCost), lines: input.maintenance },
  };
}

export async function getTruckReport(prisma: PrismaClient, yearMonth: string, truckPlate: string): Promise<TruckReport> {
  const wanted = normalizePlate(truckPlate);
  const [monthDeliveries, trucks] = await Promise.all([
    getMonthDeliveries(prisma, yearMonth),
    // Включая скрытые из активных списков — у убранной машины за прошлые
    // месяцы всё равно есть заправки и ремонты.
    prisma.truck.findMany({ select: { id: true, name: true, plateNumber: true, isActive: true } }),
  ]);
  const deliveries = monthDeliveries.filter((d) => normalizePlate(d.truckPlate) === wanted);
  const matching = trucks.filter((t) => normalizePlate(t.plateNumber) === wanted);
  const truck = matching.find((t) => t.isActive) ?? matching[0] ?? null;

  let fuel: TruckFuelLine[] = [];
  let maintenance: TruckMaintenanceLine[] = [];
  if (truck) {
    const { start, end } = mskMonthRange(yearMonth);
    const [withdrawals, records] = await Promise.all([
      prisma.fuelWithdrawal.findMany({
        where: { truckId: truck.id, isPersonal: false, date: { gte: start, lt: end } },
        include: { fuelType: true },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
      prisma.maintenanceRecord.findMany({
        where: { truckId: truck.id, date: { gte: start, lt: end } },
        orderBy: [{ date: "asc" }, { id: "asc" }],
      }),
    ]);
    fuel = withdrawals.map((w) => ({ date: mskDateKey(w.date), fuelTypeName: w.fuelType.name, liters: w.liters, cost: w.totalCost, odometer: w.odometer }));
    maintenance = records.map((r) => ({ date: mskDateKey(r.date), type: r.type, description: r.description, cost: r.totalCost }));
  }

  return buildTruckReport({
    yearMonth,
    truckPlate,
    truck: truck ? { id: truck.id, name: truck.name } : null,
    deliveries,
    fuel,
    maintenance,
  });
}
