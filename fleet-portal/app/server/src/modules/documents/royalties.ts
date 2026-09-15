import type { Address, Delivery, PrismaClient, Royalty, RoyaltyCondition } from "@prisma/client";
import { round2 } from "../../lib/money.js";

function parseTrucks(json: string): string[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export interface RoyaltyConditionConfig {
  id: number;
  percent: number;
  order: number;
  trucks: string[];
}

export interface RoyaltyConfig {
  id: number;
  name: string;
  order: number;
  conditions: RoyaltyConditionConfig[];
}

export function toRoyaltyConditionConfig(row: RoyaltyCondition): RoyaltyConditionConfig {
  return { id: row.id, percent: row.percent, order: row.order, trucks: parseTrucks(row.trucksJson) };
}

type RoyaltyWithConditions = Royalty & { conditions: RoyaltyCondition[] };

export function toRoyaltyConfig(row: RoyaltyWithConditions): RoyaltyConfig {
  return { id: row.id, name: row.name, order: row.order, conditions: row.conditions.map(toRoyaltyConditionConfig) };
}

export async function listRoyalties(prisma: PrismaClient): Promise<RoyaltyConfig[]> {
  const rows = await prisma.royalty.findMany({
    orderBy: [{ order: "asc" }, { id: "asc" }],
    include: { conditions: { orderBy: [{ order: "asc" }, { id: "asc" }] } },
  });
  return rows.map(toRoyaltyConfig);
}

/** Все госномера, когда-либо встретившиеся в загруженных доставках — источник
 * чек-листа при настройке условий роялти (чтобы не вписывать госномер руками
 * и не разойтись с точным написанием в файле заказчика). */
export async function listKnownTruckPlates(prisma: PrismaClient): Promise<string[]> {
  const rows = await prisma.delivery.findMany({
    distinct: ["truckPlate"],
    select: { truckPlate: true },
    orderBy: { truckPlate: "asc" },
  });
  return rows.map((r) => r.truckPlate);
}

export interface RoyaltyTripLine {
  date: string;
  addressText: string;
  massKg: number;
  cost: number;
}

export interface RoyaltyTruckBreakdown {
  truckPlate: string;
  totalCost: number;
  trips: RoyaltyTripLine[];
}

export interface RoyaltyConditionResult {
  conditionId: number;
  percent: number;
  trucks: string[];
  totalCost: number;
  amount: number;
  byTruck: RoyaltyTruckBreakdown[];
}

export interface RoyaltyResult {
  royaltyId: number;
  name: string;
  order: number;
  conditions: RoyaltyConditionResult[];
  totalAmount: number;
}

export interface RoyaltySummary {
  royalties: RoyaltyResult[];
  grandTotal: number;
  // Машины с доставками за месяц, не входящие ни в одно условие ни одного
  // роялти — чтобы было видно, что часть сумм за месяц осознанно никому не начислена.
  unassignedTrucks: { truckPlate: string; totalCost: number }[];
}

type DeliveryWithAddress = Delivery & { address: Address };

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildTruckBreakdown(deliveries: DeliveryWithAddress[], trucks: string[]): RoyaltyTruckBreakdown[] {
  const plateSet = new Set(trucks);
  const byTruck = new Map<string, RoyaltyTruckBreakdown>();
  for (const plate of trucks) byTruck.set(plate, { truckPlate: plate, totalCost: 0, trips: [] });

  for (const d of deliveries) {
    if (!plateSet.has(d.truckPlate)) continue;
    const entry = byTruck.get(d.truckPlate)!;
    entry.totalCost += d.cost;
    entry.trips.push({ date: dateKey(d.date), addressText: d.address.fullAddress, massKg: d.massKg, cost: d.cost });
  }

  return [...byTruck.values()].map((t) => ({ ...t, totalCost: round2(t.totalCost) })).sort((a, b) => a.truckPlate.localeCompare(b.truckPlate, "ru"));
}

/** Строит роялти за месяц из уже загруженных Delivery и настроенных роялти.
 * Ничего не хранит — как и остальные производные документы, пересчитывается
 * заново на каждый запрос из текущих Delivery (см. queries.ts). */
export function buildRoyaltySummary(deliveries: DeliveryWithAddress[], royalties: RoyaltyConfig[]): RoyaltySummary {
  const assignedPlates = new Set(royalties.flatMap((r) => r.conditions.flatMap((c) => c.trucks)));

  const royaltyResults: RoyaltyResult[] = royalties.map((r) => {
    const conditionResults: RoyaltyConditionResult[] = r.conditions.map((c) => {
      const byTruck = buildTruckBreakdown(deliveries, c.trucks);
      // Сумма из уже округлённых построчных cost по машинам — тем же приёмом,
      // что и totalCost в queries.ts (итог условия всегда сходится с суммой
      // построчных сумм по машинам).
      const totalCost = round2(byTruck.reduce((sum, t) => sum + t.totalCost, 0));
      const amount = round2(totalCost * (c.percent / 100));
      return { conditionId: c.id, percent: c.percent, trucks: c.trucks, totalCost, amount, byTruck };
    });
    const totalAmount = round2(conditionResults.reduce((sum, c) => sum + c.amount, 0));
    return { royaltyId: r.id, name: r.name, order: r.order, conditions: conditionResults, totalAmount };
  });

  const grandTotal = round2(royaltyResults.reduce((sum, r) => sum + r.totalAmount, 0));

  const unassignedByTruck = new Map<string, number>();
  for (const d of deliveries) {
    if (assignedPlates.has(d.truckPlate)) continue;
    unassignedByTruck.set(d.truckPlate, (unassignedByTruck.get(d.truckPlate) ?? 0) + d.cost);
  }
  const unassignedTrucks = [...unassignedByTruck.entries()]
    .map(([truckPlate, cost]) => ({ truckPlate, totalCost: round2(cost) }))
    .sort((a, b) => a.truckPlate.localeCompare(b.truckPlate, "ru"));

  return { royalties: royaltyResults, grandTotal, unassignedTrucks };
}
