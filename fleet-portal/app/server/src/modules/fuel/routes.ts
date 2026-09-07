import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { round2 } from "../../lib/money.js";
import { InsufficientFuelError } from "../../lib/fifo.js";
import { driverOwnsTruck, withdrawFuel } from "./service.js";

const lotSchema = z
  .object({
    fuelTypeId: z.number().int().positive(),
    date: z.coerce.date(),
    liters: z.number().positive(),
    pricePerLiter: z.number().positive().optional(),
    totalAmount: z.number().positive().optional(),
    supplier: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((data) => data.pricePerLiter !== undefined || data.totalAmount !== undefined, {
    message: "Нужно указать цену за литр или общую сумму",
  });

const withdrawalSchema = z
  .object({
    fuelTypeId: z.number().int().positive(),
    date: z.coerce.date(),
    liters: z.number().positive(),
    isPersonal: z.boolean(),
    truckId: z.number().int().positive().optional(),
    odometer: z.number().positive().optional(),
    personalComment: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.isPersonal) {
      if (!data.personalComment || data.personalComment.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для личного авто обязателен комментарий (чьё авто)" });
      }
      if (data.truckId !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для личного авто нельзя указывать машину" });
      }
    } else if (data.truckId === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для служебной заправки нужно выбрать машину" });
    }
  });

const listWithdrawalsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  fuelTypeId: z.coerce.number().int().positive().optional(),
  truckId: z.coerce.number().int().positive().optional(),
  isPersonal: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});

export default async function fuelRoutes(fastify: FastifyInstance) {
  const writeGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };
  const authGuard = { preHandler: [fastify.authenticate] };

  // ---------- Приход топлива (партии) ----------
  fastify.post("/api/fuel/lots", writeGuard, async (request, reply) => {
    const parsed = lotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    const pricePerLiter = data.pricePerLiter ?? round2(data.totalAmount! / data.liters);
    const totalAmount = data.totalAmount ?? round2(data.liters * data.pricePerLiter!);

    return fastify.prisma.fuelLot.create({
      data: {
        fuelTypeId: data.fuelTypeId,
        date: data.date,
        litersIn: data.liters,
        litersRemaining: data.liters,
        pricePerLiter,
        totalAmount,
        supplier: data.supplier,
        comment: data.comment,
        createdBy: request.user!.id,
      },
    });
  });

  fastify.get("/api/fuel/lots", writeGuard, async (request) => {
    const query = z.object({ fuelTypeId: z.coerce.number().int().positive().optional() }).parse(request.query);
    return fastify.prisma.fuelLot.findMany({
      where: query.fuelTypeId ? { fuelTypeId: query.fuelTypeId } : undefined,
      include: { fuelType: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  // ---------- Заправка / списание ----------
  fastify.post("/api/fuel/withdrawals", authGuard, async (request, reply) => {
    const parsed = withdrawalSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;
    const user = request.user!;

    if (user.role === "DRIVER") {
      if (data.isPersonal) {
        return reply.code(403).send({ error: "drivers_cannot_log_personal" });
      }
      if (!user.driverId || !(await driverOwnsTruck(fastify.prisma, user.driverId, data.truckId!))) {
        return reply.code(403).send({ error: "not_your_truck" });
      }
    }

    try {
      const withdrawal = await withdrawFuel(fastify.prisma, {
        fuelTypeId: data.fuelTypeId,
        date: data.date,
        liters: data.liters,
        isPersonal: data.isPersonal,
        truckId: data.isPersonal ? null : data.truckId!,
        odometer: data.odometer ?? null,
        personalComment: data.isPersonal ? data.personalComment! : null,
        createdBy: user.id,
        tripId: null,
      });
      return withdrawal;
    } catch (error) {
      if (error instanceof InsufficientFuelError) {
        return reply.code(409).send({ error: "insufficient_fuel", available: error.available, requested: error.requested });
      }
      throw error;
    }
  });

  fastify.get("/api/fuel/withdrawals", writeGuard, async (request) => {
    const query = listWithdrawalsQuerySchema.parse(request.query);
    return fastify.prisma.fuelWithdrawal.findMany({
      where: {
        date: { gte: query.from, lte: query.to },
        fuelTypeId: query.fuelTypeId,
        truckId: query.truckId,
        isPersonal: query.isPersonal,
      },
      include: { fuelType: true, truck: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });
}
