import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { round2 } from "../../lib/money.js";
import { mskDayStart, mskDayEnd } from "../../lib/date.js";
import { InsufficientFuelError } from "../../lib/fifo.js";
import {
  cancelWithdrawal,
  driverOwnsTruck,
  issueTalons,
  logCardRefuel,
  withdrawFuel,
  IdempotencyConflictError,
  InsufficientTalonsError,
  TALON_NOMINALS,
  WithdrawalNotCancellableError,
} from "./service.js";

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
  })
  .refine(
    (data) => {
      // Если указаны и цена, и сумма — они не должны противоречить друг другу
      // (иначе в остатках партии будет "неверная" сумма — см. ревью).
      if (data.pricePerLiter === undefined || data.totalAmount === undefined) return true;
      const expected = round2(data.liters * data.pricePerLiter);
      return Math.abs(expected - round2(data.totalAmount)) <= 0.01;
    },
    { message: "Цена за литр и общая сумма не сходятся между собой (литры × цена ≠ сумма)" },
  );

const withdrawalSchema = z
  .object({
    fuelTypeId: z.number().int().positive(),
    date: z.coerce.date(),
    liters: z.number().positive(),
    isPersonal: z.boolean(),
    truckId: z.number().int().positive().optional(),
    odometer: z.number().positive().optional(),
    personalComment: z.string().optional(),
    // Защита от двойного списания при повторной отправке формы (двойной клик, ретрай).
    idempotencyKey: z.string().min(10).max(100).optional(),
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

const talonNominalSchema = z
  .number()
  .int()
  .refine((value) => (TALON_NOMINALS as readonly number[]).includes(value), {
    message: `Номинал талона должен быть одним из: ${TALON_NOMINALS.join(", ")} л`,
  });

const talonLotSchema = z
  .object({
    fuelTypeId: z.number().int().positive(),
    date: z.coerce.date(),
    nominalLiters: talonNominalSchema,
    count: z.number().int().positive(),
    pricePerTalon: z.number().positive().optional(),
    totalAmount: z.number().positive().optional(),
    supplier: z.string().optional(),
    comment: z.string().optional(),
  })
  .refine((data) => data.pricePerTalon !== undefined || data.totalAmount !== undefined, {
    message: "Нужно указать цену за талон или общую сумму",
  })
  .refine(
    (data) => {
      if (data.pricePerTalon === undefined || data.totalAmount === undefined) return true;
      const expected = round2(data.count * data.pricePerTalon);
      return Math.abs(expected - round2(data.totalAmount)) <= 0.01;
    },
    { message: "Цена за талон и общая сумма не сходятся между собой (количество × цена ≠ сумма)" },
  );

const talonIssueSchema = z.object({
  fuelTypeId: z.number().int().positive(),
  date: z.coerce.date(),
  nominalLiters: talonNominalSchema,
  count: z.number().int().positive(),
  truckId: z.number().int().positive(),
  odometer: z.number().positive().optional(),
  idempotencyKey: z.string().min(10).max(100).optional(),
});

const cardRefuelSchema = z
  .object({
    fuelTypeId: z.number().int().positive(),
    date: z.coerce.date(),
    liters: z.number().positive(),
    pricePerLiter: z.number().positive().optional(),
    totalAmount: z.number().positive().optional(),
    truckId: z.number().int().positive(),
    odometer: z.number().positive().optional(),
    idempotencyKey: z.string().min(10).max(100).optional(),
  })
  .refine((data) => data.pricePerLiter !== undefined || data.totalAmount !== undefined, {
    message: "Нужно указать цену за литр или общую сумму",
  })
  .refine(
    (data) => {
      if (data.pricePerLiter === undefined || data.totalAmount === undefined) return true;
      const expected = round2(data.liters * data.pricePerLiter);
      return Math.abs(expected - round2(data.totalAmount)) <= 0.01;
    },
    { message: "Цена за литр и общая сумма не сходятся между собой (литры × цена ≠ сумма)" },
  );

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
        valueRemaining: totalAmount,
        supplier: data.supplier,
        comment: data.comment,
        createdBy: request.user!.id,
      },
    });
  });

  fastify.get("/api/fuel/lots", writeGuard, async (request, reply) => {
    const query = z
      .object({
        fuelTypeId: z.coerce.number().int().positive().optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
      })
      .safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });
    return fastify.prisma.fuelLot.findMany({
      where: {
        fuelTypeId: query.data.fuelTypeId,
        date: { gte: mskDayStart(query.data.from), lt: mskDayEnd(query.data.to) },
      },
      include: { fuelType: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  // ---------- Приход талонов ----------
  fastify.post("/api/fuel/talon-lots", writeGuard, async (request, reply) => {
    const parsed = talonLotSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    const pricePerTalon = data.pricePerTalon ?? round2(data.totalAmount! / data.count);
    const totalAmount = round2(data.totalAmount ?? data.count * data.pricePerTalon!);

    return fastify.prisma.fuelTalonLot.create({
      data: {
        fuelTypeId: data.fuelTypeId,
        date: data.date,
        nominalLiters: data.nominalLiters,
        countIn: data.count,
        countRemaining: data.count,
        pricePerTalon,
        totalAmount,
        valueRemaining: totalAmount,
        supplier: data.supplier,
        comment: data.comment,
        createdBy: request.user!.id,
      },
    });
  });

  fastify.get("/api/fuel/talon-lots", writeGuard, async () => {
    return fastify.prisma.fuelTalonLot.findMany({
      include: { fuelType: true },
      orderBy: [{ date: "desc" }, { id: "desc" }],
    });
  });

  // ---------- Выдача талонов на машину (сразу расход) ----------
  fastify.post("/api/fuel/talon-issues", writeGuard, async (request, reply) => {
    const parsed = talonIssueSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    try {
      return await issueTalons(fastify.prisma, {
        fuelTypeId: data.fuelTypeId,
        date: data.date,
        nominalLiters: data.nominalLiters,
        count: data.count,
        truckId: data.truckId,
        odometer: data.odometer ?? null,
        createdBy: request.user!.id,
        idempotencyKey: data.idempotencyKey ?? null,
      });
    } catch (error) {
      if (error instanceof InsufficientTalonsError) {
        return reply.code(409).send({
          error: "insufficient_talons",
          nominalLiters: error.nominalLiters,
          available: error.available,
          requested: error.requested,
        });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: "idempotency_conflict" });
      }
      throw error;
    }
  });

  // ---------- Заправка по топливной карте ----------
  fastify.post("/api/fuel/card-refuels", writeGuard, async (request, reply) => {
    const parsed = cardRefuelSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body", details: parsed.error.flatten() });
    const data = parsed.data;

    const pricePerLiter = data.pricePerLiter ?? round2(data.totalAmount! / data.liters);
    const totalCost = round2(data.totalAmount ?? data.liters * data.pricePerLiter!);

    try {
      return await logCardRefuel(fastify.prisma, {
        fuelTypeId: data.fuelTypeId,
        date: data.date,
        liters: data.liters,
        pricePerLiter,
        totalCost,
        truckId: data.truckId,
        odometer: data.odometer ?? null,
        createdBy: request.user!.id,
        idempotencyKey: data.idempotencyKey ?? null,
      });
    } catch (error) {
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: "idempotency_conflict" });
      }
      throw error;
    }
  });

  // ---------- Отмена выдачи талонов / заправки по карте ----------
  fastify.delete<{ Params: { id: string } }>("/api/fuel/withdrawals/:id", writeGuard, async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: "invalid_id" });
    try {
      const cancelled = await cancelWithdrawal(fastify.prisma, id);
      if (!cancelled) return reply.code(404).send({ error: "not_found" });
      return { ok: true };
    } catch (error) {
      if (error instanceof WithdrawalNotCancellableError) {
        return reply.code(409).send({ error: "tank_withdrawal_not_cancellable" });
      }
      throw error;
    }
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
        idempotencyKey: data.idempotencyKey ?? null,
      });
      return withdrawal;
    } catch (error) {
      if (error instanceof InsufficientFuelError) {
        return reply.code(409).send({ error: "insufficient_fuel", available: error.available, requested: error.requested });
      }
      if (error instanceof IdempotencyConflictError) {
        return reply.code(409).send({ error: "idempotency_conflict" });
      }
      throw error;
    }
  });

  fastify.get("/api/fuel/withdrawals", writeGuard, async (request) => {
    const query = listWithdrawalsQuerySchema.parse(request.query);
    return fastify.prisma.fuelWithdrawal.findMany({
      where: {
        date: { gte: mskDayStart(query.from), lt: mskDayEnd(query.to) },
        fuelTypeId: query.fuelTypeId,
        truckId: query.truckId,
        isPersonal: query.isPersonal,
      },
      include: { fuelType: true, truck: true },
      // Для журнала заправок удобнее хронологический порядок (раньше — выше).
      orderBy: [{ date: "asc" }, { id: "asc" }],
    });
  });
}
