import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { InsufficientFuelError } from "../../lib/fifo.js";
import { withdrawFuel } from "../fuel/service.js";
import { TRIP_STATUSES } from "../../types.js";

const tripSchema = z.object({
  date: z.coerce.date(),
  driverId: z.number().int().positive(),
  truckId: z.number().int().positive(),
  routeFrom: z.string().min(1),
  routeTo: z.string().min(1),
  cargoDescription: z.string().optional(),
  notes: z.string().optional(),
});

const listTripsQuerySchema = z.object({
  date: z.coerce.date().optional(),
  driverId: z.coerce.number().int().positive().optional(),
  status: z.enum(TRIP_STATUSES).optional(),
});

const statusSchema = z.object({ status: z.enum(TRIP_STATUSES) });

const tripFuelSchema = z.object({
  fuelTypeId: z.number().int().positive(),
  date: z.coerce.date(),
  liters: z.number().positive(),
  odometer: z.number().positive().optional(),
});

export default async function tripsRoutes(fastify: FastifyInstance) {
  const dispatchGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };
  const authGuard = { preHandler: [fastify.authenticate] };

  // ---------- Доска диспетчера ----------
  fastify.get("/api/trips", dispatchGuard, async (request, reply) => {
    const query = listTripsQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    return fastify.prisma.trip.findMany({
      where: { date: query.data.date, driverId: query.data.driverId, status: query.data.status },
      include: { driver: true, truck: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  fastify.post("/api/trips", dispatchGuard, async (request, reply) => {
    const parsed = tripSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    return fastify.prisma.trip.create({ data: { ...parsed.data, createdBy: request.user!.id } });
  });

  fastify.patch<{ Params: { id: string } }>("/api/trips/:id", dispatchGuard, async (request, reply) => {
    const parsed = tripSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    return fastify.prisma.trip.update({ where: { id: Number(request.params.id) }, data: parsed.data });
  });

  // ---------- Кабинет водителя ----------
  fastify.get("/api/trips/my", authGuard, async (request, reply) => {
    const user = request.user!;
    if (user.role !== "DRIVER" || !user.driverId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return fastify.prisma.trip.findMany({
      where: { driverId: user.driverId },
      include: { truck: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  // ---------- Смена статуса ----------
  fastify.patch<{ Params: { id: string } }>("/api/trips/:id/status", authGuard, async (request, reply) => {
    const parsed = statusSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const tripId = Number(request.params.id);
    const trip = await fastify.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return reply.code(404).send({ error: "not_found" });

    const user = request.user!;
    if (user.role === "DRIVER" && trip.driverId !== user.driverId) {
      return reply.code(403).send({ error: "not_your_trip" });
    }

    return fastify.prisma.trip.update({ where: { id: tripId }, data: { status: parsed.data.status } });
  });

  // ---------- Заправка прямо из рейса (короткий путь для водителя) ----------
  fastify.post<{ Params: { id: string } }>("/api/trips/:id/fuel", authGuard, async (request, reply) => {
    const parsed = tripFuelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });

    const tripId = Number(request.params.id);
    const trip = await fastify.prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return reply.code(404).send({ error: "not_found" });

    const user = request.user!;
    if (user.role === "DRIVER" && trip.driverId !== user.driverId) {
      return reply.code(403).send({ error: "not_your_trip" });
    }
    if (trip.status !== "ASSIGNED" && trip.status !== "IN_PROGRESS") {
      return reply.code(409).send({ error: "trip_not_active" });
    }

    try {
      return await withdrawFuel(fastify.prisma, {
        fuelTypeId: parsed.data.fuelTypeId,
        date: parsed.data.date,
        liters: parsed.data.liters,
        isPersonal: false,
        truckId: trip.truckId,
        odometer: parsed.data.odometer ?? null,
        personalComment: null,
        createdBy: user.id,
        tripId: trip.id,
      });
    } catch (error) {
      if (error instanceof InsufficientFuelError) {
        return reply.code(409).send({ error: "insufficient_fuel", available: error.available, requested: error.requested });
      }
      throw error;
    }
  });
}
