import type { Address, Delivery, PrismaClient } from "@prisma/client";
import { round2 } from "../../lib/money.js";

export interface DayActLine {
  index: number;
  service: string;
  dispatchPoint: string;
  deliveryAddress: string;
  truckPlate: string;
  ratePerKg: number;
  massKg: number;
  cost: number;
}

export interface DayAct {
  actNumber: number;
  date: string; // "YYYY-MM-DD"
  lines: DayActLine[];
  totalMassKg: number;
  totalCost: number;
}

export interface RouteSummaryRow {
  truckPlate: string;
  totalMassKg: number;
  totalDistanceKm: number;
  deliveryDates: string[];
}

export interface MonthSummaryLine {
  ratePerKg: number;
  massKg: number;
  cost: number;
  /** Диапазон дат рейсов ПО ЭТОМУ тарифу внутри месяца — тариф на адрес
   * может смениться в середине месяца, поэтому у разных строк счёта/акта
   * (разных тарифов) диапазон обычно разный, а не весь месяц целиком. */
  minDate: string;
  maxDate: string;
}

type DeliveryWithAddress = Delivery & { address: Address };

/**
 * Даты в Delivery — чистые календарные даты (ExcelJS отдаёт ячейки-даты как
 * UTC-полночь того же числа, без часового пояса), поэтому границы месяца
 * здесь тоже в UTC — это НЕ то же самое, что mskDayStart/mskDayEnd в
 * lib/date.ts (те нужны для реальных event-меток времени в других модулях).
 */
export function monthRange(yearMonth: string): { start: Date; end: Date } {
  const [year, month] = yearMonth.split("-").map(Number);
  return { start: new Date(Date.UTC(year, month - 1, 1)), end: new Date(Date.UTC(year, month, 1)) };
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function getMonthDeliveries(prisma: PrismaClient, yearMonth: string): Promise<DeliveryWithAddress[]> {
  const { start, end } = monthRange(yearMonth);
  return prisma.delivery.findMany({
    where: { date: { gte: start, lt: end } },
    include: { address: true },
    orderBy: [{ date: "asc" }, { id: "asc" }],
  });
}

/** Строит дневные акты — номер акта = порядковый номер даты среди дат
 * месяца с рейсами (см. Context плана: акт №1 = первая дата, №24 = последняя). */
export function buildDayActs(deliveries: DeliveryWithAddress[], dispatchPoint: string): DayAct[] {
  const byDate = new Map<string, DeliveryWithAddress[]>();
  for (const d of deliveries) {
    const key = dateKey(d.date);
    const list = byDate.get(key) ?? [];
    list.push(d);
    byDate.set(key, list);
  }
  const dates = [...byDate.keys()].sort();
  return dates.map((date, idx) => {
    const list = byDate.get(date)!;
    const lines: DayActLine[] = list.map((d, i) => ({
      index: i + 1,
      service: "Перевозка груза",
      dispatchPoint,
      deliveryAddress: d.address.fullAddress,
      truckPlate: d.truckPlate,
      ratePerKg: d.ratePerKg,
      massKg: d.massKg,
      cost: d.cost,
    }));
    // Сумма — из уже округлённых построчных cost (см. validate.ts), а не
    // пересчитана заново из суммарной массы: так итог day-акта, реестра,
    // итогового акта и счёта всегда сходятся (см. "39 коп" в Context плана).
    const totalCost = round2(lines.reduce((sum, l) => sum + l.cost, 0));
    const totalMassKg = lines.reduce((sum, l) => sum + l.massKg, 0);
    return { actNumber: idx + 1, date, lines, totalMassKg, totalCost };
  });
}

export function buildRouteSummary(deliveries: DeliveryWithAddress[]): RouteSummaryRow[] {
  const byTruck = new Map<string, { massKg: number; distanceKm: number; dates: Set<string> }>();
  for (const d of deliveries) {
    const entry = byTruck.get(d.truckPlate) ?? { massKg: 0, distanceKm: 0, dates: new Set<string>() };
    entry.massKg += d.massKg;
    entry.distanceKm += d.distanceKm;
    entry.dates.add(dateKey(d.date));
    byTruck.set(d.truckPlate, entry);
  }
  return [...byTruck.entries()]
    .map(([truckPlate, e]) => ({
      truckPlate,
      totalMassKg: e.massKg,
      totalDistanceKm: e.distanceKm,
      deliveryDates: [...e.dates].sort(),
    }))
    .sort((a, b) => a.truckPlate.localeCompare(b.truckPlate, "ru"));
}

/** Группировка по тарифу — основа итогового акта и счёта за месяц. */
export function buildMonthSummary(deliveries: DeliveryWithAddress[]): MonthSummaryLine[] {
  const byRate = new Map<number, { massKg: number; cost: number; minDate: string; maxDate: string }>();
  for (const d of deliveries) {
    const key = dateKey(d.date);
    const entry = byRate.get(d.ratePerKg) ?? { massKg: 0, cost: 0, minDate: key, maxDate: key };
    entry.massKg += d.massKg;
    entry.cost += d.cost;
    if (key < entry.minDate) entry.minDate = key;
    if (key > entry.maxDate) entry.maxDate = key;
    byRate.set(d.ratePerKg, entry);
  }
  return [...byRate.entries()]
    .map(([ratePerKg, e]) => ({ ratePerKg, massKg: e.massKg, cost: round2(e.cost), minDate: e.minDate, maxDate: e.maxDate }))
    .sort((a, b) => a.ratePerKg - b.ratePerKg);
}

export function totalCost(lines: { cost: number }[]): number {
  return round2(lines.reduce((sum, l) => sum + l.cost, 0));
}
