import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { round2 } from "../../lib/money.js";
import { mskDayStart, mskDayEnd } from "../../lib/date.js";

const periodQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export default async function fuelReportsRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };

  // ---------- Текущий остаток топлива по видам ----------
  fastify.get("/api/fuel/reports/balance", guard, async () => {
    const lots = await fastify.prisma.fuelLot.findMany({
      where: { litersRemaining: { gt: 0 } },
      include: { fuelType: true },
    });

    const byFuelType = new Map<number, { fuelTypeId: number; fuelTypeName: string; liters: number; value: number }>();
    for (const lot of lots) {
      const entry = byFuelType.get(lot.fuelTypeId) ?? {
        fuelTypeId: lot.fuelTypeId,
        fuelTypeName: lot.fuelType.name,
        liters: 0,
        value: 0,
      };
      entry.liters += lot.litersRemaining;
      // Единый источник стоимости остатка — valueRemaining, а не
      // litersRemaining*pricePerLiter (после частичных списаний эти два
      // расходятся, т.к. цена за литр округлена один раз при приходе — см.
      // computeFifoConsumption в lib/fifo.ts).
      entry.value += lot.valueRemaining;
      byFuelType.set(lot.fuelTypeId, entry);
    }

    return Array.from(byFuelType.values()).map((entry) => ({
      ...entry,
      liters: round2(entry.liters),
      value: round2(entry.value),
    }));
  });

  // ---------- Приход за период (по видам топлива) ----------
  fastify.get("/api/fuel/reports/inflow", guard, async (request, reply) => {
    const query = periodQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    const lots = await fastify.prisma.fuelLot.findMany({
      where: { date: { gte: mskDayStart(query.data.from), lt: mskDayEnd(query.data.to) } },
      include: { fuelType: true },
    });

    type Bucket = { fuelTypeId: number; fuelTypeName: string; liters: number; cost: number; count: number };
    const buckets = new Map<number, Bucket>();
    for (const lot of lots) {
      const bucket = buckets.get(lot.fuelTypeId) ?? {
        fuelTypeId: lot.fuelTypeId,
        fuelTypeName: lot.fuelType.name,
        liters: 0,
        cost: 0,
        count: 0,
      };
      bucket.liters += lot.litersIn;
      bucket.cost += lot.totalAmount;
      bucket.count += 1;
      buckets.set(lot.fuelTypeId, bucket);
    }

    const rows = Array.from(buckets.values()).map((b) => ({ ...b, liters: round2(b.liters), cost: round2(b.cost) }));
    const totals = rows.reduce((acc, r) => ({ liters: acc.liters + r.liters, cost: acc.cost + r.cost }), { liters: 0, cost: 0 });

    return { rows, totals: { liters: round2(totals.liters), cost: round2(totals.cost) } };
  });

  // ---------- Расход за период (бизнес vs личное) ----------
  fastify.get("/api/fuel/reports/consumption", guard, async (request, reply) => {
    const query = periodQuerySchema
      .extend({ groupBy: z.enum(["fuelType", "truck"]).default("fuelType") })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    const withdrawals = await fastify.prisma.fuelWithdrawal.findMany({
      where: { date: { gte: mskDayStart(query.data.from), lt: mskDayEnd(query.data.to) } },
      include: { fuelType: true, truck: true },
    });

    type Bucket = {
      key: number | "personal";
      label: string;
      companyLiters: number;
      companyCost: number;
      personalLiters: number;
      personalCost: number;
      count: number;
    };
    const buckets = new Map<string, Bucket>();

    for (const w of withdrawals) {
      const groupKey = query.data.groupBy === "truck" ? (w.truckId ?? "personal") : w.fuelTypeId;
      const label =
        query.data.groupBy === "truck"
          ? (w.truck ? `${w.truck.name} (${w.truck.plateNumber})` : "Личное авто")
          : w.fuelType.name;
      const mapKey = String(groupKey);

      const bucket = buckets.get(mapKey) ?? {
        key: groupKey,
        label,
        companyLiters: 0,
        companyCost: 0,
        personalLiters: 0,
        personalCost: 0,
        count: 0,
      };

      if (w.isPersonal) {
        bucket.personalLiters += w.liters;
        bucket.personalCost += w.totalCost;
      } else {
        bucket.companyLiters += w.liters;
        bucket.companyCost += w.totalCost;
      }
      bucket.count += 1;
      buckets.set(mapKey, bucket);
    }

    const rows = Array.from(buckets.values()).map((b) => ({
      ...b,
      companyLiters: round2(b.companyLiters),
      companyCost: round2(b.companyCost),
      personalLiters: round2(b.personalLiters),
      personalCost: round2(b.personalCost),
    }));

    const totals = rows.reduce(
      (acc, r) => ({
        companyLiters: acc.companyLiters + r.companyLiters,
        companyCost: acc.companyCost + r.companyCost,
        personalLiters: acc.personalLiters + r.personalLiters,
        personalCost: acc.personalCost + r.personalCost,
      }),
      { companyLiters: 0, companyCost: 0, personalLiters: 0, personalCost: 0 },
    );

    return {
      rows,
      totals: {
        companyLiters: round2(totals.companyLiters),
        companyCost: round2(totals.companyCost),
        personalLiters: round2(totals.personalLiters),
        personalCost: round2(totals.personalCost),
      },
    };
  });

  // ---------- Расход на 100 км по машине ----------
  fastify.get("/api/fuel/reports/per-100km", guard, async (request, reply) => {
    const query = periodQuerySchema
      .extend({ truckId: z.coerce.number().int().positive() })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    const [withdrawals, truck] = await Promise.all([
      fastify.prisma.fuelWithdrawal.findMany({
        where: {
          truckId: query.data.truckId,
          isPersonal: false,
          date: { gte: mskDayStart(query.data.from), lt: mskDayEnd(query.data.to) },
        },
        orderBy: { date: "asc" },
      }),
      fastify.prisma.truck.findUnique({ where: { id: query.data.truckId } }),
    ]);

    const norm = { min: truck?.normConsumptionMin ?? null, max: truck?.normConsumptionMax ?? null };
    const totalLiters = round2(withdrawals.reduce((sum, w) => sum + w.liters, 0));
    const odometerReadings = withdrawals
      .map((w) => w.odometer)
      .filter((value): value is number => value !== null && value !== undefined);

    if (odometerReadings.length < 2) {
      return { insufficientData: true, totalLiters, odometerReadingsCount: odometerReadings.length, norm };
    }

    const distance = Math.max(...odometerReadings) - Math.min(...odometerReadings);
    if (distance <= 0) {
      return { insufficientData: true, totalLiters, odometerReadingsCount: odometerReadings.length, norm };
    }

    return {
      insufficientData: false,
      totalLiters,
      distanceKm: distance,
      litersPer100Km: round2((totalLiters / distance) * 100),
      norm,
    };
  });
}
