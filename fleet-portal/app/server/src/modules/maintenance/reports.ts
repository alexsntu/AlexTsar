import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { round2 } from "../../lib/money.js";

const querySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  groupBy: z.enum(["truck", "type"]).default("truck"),
});

export default async function maintenanceReportsRoutes(fastify: FastifyInstance) {
  const guard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };

  fastify.get("/api/maintenance/reports/costs", guard, async (request, reply) => {
    const query = querySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    const records = await fastify.prisma.maintenanceRecord.findMany({
      where: { date: { gte: query.data.from, lte: query.data.to } },
      include: { truck: true },
    });

    type Bucket = { key: string; label: string; serviceCost: number; repairCost: number; count: number };
    const buckets = new Map<string, Bucket>();

    for (const record of records) {
      const key =
        query.data.groupBy === "truck" ? `truck-${record.truckId}` : `type-${record.type}`;
      const label =
        query.data.groupBy === "truck"
          ? `${record.truck.name} (${record.truck.plateNumber})`
          : record.type === "SERVICE"
            ? "ТО"
            : "Внеплановый ремонт";

      const bucket = buckets.get(key) ?? { key, label, serviceCost: 0, repairCost: 0, count: 0 };
      if (record.type === "SERVICE") bucket.serviceCost += record.totalCost;
      else bucket.repairCost += record.totalCost;
      bucket.count += 1;
      buckets.set(key, bucket);
    }

    const rows = Array.from(buckets.values()).map((b) => ({
      ...b,
      serviceCost: round2(b.serviceCost),
      repairCost: round2(b.repairCost),
      totalCost: round2(b.serviceCost + b.repairCost),
    }));

    const totals = rows.reduce(
      (acc, r) => ({
        serviceCost: acc.serviceCost + r.serviceCost,
        repairCost: acc.repairCost + r.repairCost,
        totalCost: acc.totalCost + r.totalCost,
      }),
      { serviceCost: 0, repairCost: 0, totalCost: 0 },
    );

    return {
      rows: rows.sort((a, b) => b.totalCost - a.totalCost),
      totals: {
        serviceCost: round2(totals.serviceCost),
        repairCost: round2(totals.repairCost),
        totalCost: round2(totals.totalCost),
      },
    };
  });
}
