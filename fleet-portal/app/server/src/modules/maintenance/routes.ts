import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { computeUpcomingService, createMaintenanceRecord, updateMaintenanceRecord, deleteMaintenanceRecord } from "./service.js";
import { mskDayStart, mskDayEnd } from "../../lib/date.js";

const partSchema = z.object({
  name: z.string().min(1),
  cost: z.number().nonnegative(),
});

const recordSchema = z.object({
  truckId: z.number().int().positive(),
  type: z.enum(["SERVICE", "REPAIR"]),
  date: z.coerce.date(),
  odometer: z.number().nonnegative(),
  description: z.string().optional(),
  parts: z.array(partSchema).default([]),
});

const listQuerySchema = z.object({
  truckId: z.coerce.number().int().positive().optional(),
  type: z.enum(["SERVICE", "REPAIR"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export default async function maintenanceRoutes(fastify: FastifyInstance) {
  const writeGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };

  fastify.post("/api/maintenance/records", writeGuard, async (request, reply) => {
    const parsed = recordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    return createMaintenanceRecord(fastify.prisma, {
      truckId: data.truckId,
      type: data.type,
      date: data.date,
      odometer: data.odometer,
      description: data.description ?? null,
      parts: data.parts,
      createdBy: request.user!.id,
    });
  });

  fastify.patch<{ Params: { id: string } }>("/api/maintenance/records/:id", writeGuard, async (request, reply) => {
    const parsed = recordSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    const record = await updateMaintenanceRecord(fastify.prisma, Number(request.params.id), {
      truckId: data.truckId,
      type: data.type,
      date: data.date,
      odometer: data.odometer,
      description: data.description ?? null,
      parts: data.parts,
    });
    if (!record) return reply.code(404).send({ error: "not_found" });
    return record;
  });

  fastify.delete<{ Params: { id: string } }>("/api/maintenance/records/:id", writeGuard, async (request, reply) => {
    const record = await deleteMaintenanceRecord(fastify.prisma, Number(request.params.id));
    if (!record) return reply.code(404).send({ error: "not_found" });
    return { ok: true };
  });

  fastify.get("/api/maintenance/records", writeGuard, async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    return fastify.prisma.maintenanceRecord.findMany({
      where: {
        truckId: query.data.truckId,
        type: query.data.type,
        date: { gte: mskDayStart(query.data.from), lt: mskDayEnd(query.data.to) },
      },
      include: { truck: true, parts: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  fastify.get("/api/maintenance/upcoming", writeGuard, async () => {
    const trucks = await fastify.prisma.truck.findMany({ where: { isActive: true } });
    const results = await Promise.all(trucks.map((truck) => computeUpcomingService(fastify.prisma, truck)));
    return results
      .filter((r): r is NonNullable<typeof r> => r !== null)
      .sort((a, b) => a.urgencyRatio - b.urgencyRatio)
      .map(({ urgencyRatio: _urgencyRatio, ...rest }) => rest);
  });
}
