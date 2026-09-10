import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";

// z.null() ДО z.coerce.date() в union: иначе coerce молча превращает null в
// 1970-01-01 (new Date(null) валиден) вместо того, чтобы дать понять
// "очистить поле". undefined (поле не пришло) — "не менялось", null (пришло
// явно) — "очистить", как и должно различаться в PATCH.
const clearableDate = z.union([z.null(), z.coerce.date()]).optional();

// Отдельно от .refine() ниже — ZodEffects (результат refine) не поддерживает
// .partial(), а PATCH-схема (truckSchema.partial()) нужна как объект.
const truckObjectSchema = z.object({
  name: z.string().min(1).max(200),
  plateNumber: z.string().min(1).max(20),
  capacityTons: z.number().positive().max(1000).optional(),
  normConsumptionMin: z.number().positive().max(1000).optional(),
  normConsumptionMax: z.number().positive().max(1000).optional(),
  serviceIntervalKm: z.union([z.null(), z.number().positive().max(1_000_000)]).optional(),
  serviceIntervalDays: z.union([z.null(), z.number().int().positive().max(3650)]).optional(),
  lastServiceDate: clearableDate,
  lastServiceOdometer: z.union([z.null(), z.number().nonnegative().max(10_000_000)]).optional(),
  insuranceExpiryDate: clearableDate,
  inspectionExpiryDate: clearableDate,
});

const NORM_RANGE_MESSAGE = { message: "Норма расхода: минимум не может быть больше максимума", path: ["normConsumptionMin"] };

const truckSchema = truckObjectSchema.refine(
  (data) => data.normConsumptionMin === undefined || data.normConsumptionMax === undefined || data.normConsumptionMin <= data.normConsumptionMax,
  NORM_RANGE_MESSAGE,
);
// Без .refine() здесь: PATCH шлёт только изменённые поля, и сравнивать
// нужно с ИТОГОВЫМ состоянием (текущая запись + патч), а не только с тем,
// что пришло в этом запросе — иначе PATCH одного только normConsumptionMin
// молча испортит уже сохранённый normConsumptionMax (см. ревью). Итоговую
// проверку делает сам роут в directoriesRoutes, где известна текущая запись.
const truckPatchSchema = truckObjectSchema.partial();

const driverSchema = z.object({
  fullName: z.string().min(1).max(200),
  phone: z.string().max(30).optional(),
});

const credentialsSchema = z.object({
  email: z.string().min(1).max(200),
  password: z.string().min(6).max(200),
});

const fuelTypeSchema = z.object({
  name: z.string().min(1).max(100),
});

export default async function directoriesRoutes(fastify: FastifyInstance) {
  const writeGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };
  const readGuard = { preHandler: [fastify.authenticate] };

  // ---------- Тягачи ----------
  fastify.get("/api/trucks", readGuard, async () => {
    return fastify.prisma.truck.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  });

  fastify.post("/api/trucks", writeGuard, async (request, reply) => {
    const parsed = truckSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.truck.create({ data: parsed.data });
  });

  fastify.patch<{ Params: { id: string } }>("/api/trucks/:id", writeGuard, async (request, reply) => {
    const parsed = truckPatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const truckId = Number(request.params.id);
    const current = await fastify.prisma.truck.findUnique({ where: { id: truckId } });
    if (!current) return reply.code(404).send({ error: "not_found" });

    // Сравниваем ИТОГОВОЕ состояние (текущая запись + патч), а не только
    // поля из этого запроса — иначе PATCH одного normConsumptionMin молча
    // портит уже сохранённый normConsumptionMax (см. ревью).
    const nextMin = parsed.data.normConsumptionMin !== undefined ? parsed.data.normConsumptionMin : current.normConsumptionMin;
    const nextMax = parsed.data.normConsumptionMax !== undefined ? parsed.data.normConsumptionMax : current.normConsumptionMax;
    if (nextMin != null && nextMax != null && nextMin > nextMax) {
      return reply.code(400).send({ error: "invalid_norm_range" });
    }

    return fastify.prisma.truck.update({ where: { id: truckId }, data: parsed.data });
  });

  fastify.delete<{ Params: { id: string } }>("/api/trucks/:id", writeGuard, async (request) => {
    return fastify.prisma.truck.update({ where: { id: Number(request.params.id) }, data: { isActive: false } });
  });

  // ---------- Водители ----------
  // Только ADMIN/DISPATCHER — тут телефоны и логины всех водителей, обычному
  // водителю (после входа в свой кабинет) это видеть не нужно.
  fastify.get("/api/drivers", writeGuard, async () => {
    const drivers = await fastify.prisma.driver.findMany({
      where: { isActive: true },
      include: { user: true },
      orderBy: { fullName: "asc" },
    });
    return drivers.map(({ user, ...driver }) => ({ ...driver, loginEmail: user?.email ?? null }));
  });

  fastify.post("/api/drivers", writeGuard, async (request, reply) => {
    const parsed = driverSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.driver.create({ data: parsed.data });
  });

  fastify.patch<{ Params: { id: string } }>("/api/drivers/:id", writeGuard, async (request, reply) => {
    const parsed = driverSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.driver.update({ where: { id: Number(request.params.id) }, data: parsed.data });
  });

  fastify.delete<{ Params: { id: string } }>("/api/drivers/:id", writeGuard, async (request) => {
    const driverId = Number(request.params.id);
    // Архивируем водителя и в той же транзакции закрываем его логин (если он есть) —
    // иначе он сохраняет доступ в свой кабинет по старому паролю после увольнения.
    return fastify.prisma.$transaction(async (tx) => {
      const driver = await tx.driver.update({ where: { id: driverId }, data: { isActive: false } });
      await tx.user.updateMany({
        where: { driverId },
        data: { isActive: false, tokenVersion: { increment: 1 } },
      });
      return driver;
    });
  });

  // Завести логин водителю (или сбросить пароль существующему) — без этого
  // водитель не сможет войти в свой кабинет на телефоне.
  fastify.put<{ Params: { id: string } }>("/api/drivers/:id/credentials", writeGuard, async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const driverId = Number(request.params.id);
    const passwordHash = await bcrypt.hash(parsed.data.password, 10);

    try {
      const existing = await fastify.prisma.user.findUnique({ where: { driverId } });
      if (existing) {
        // Смена пароля отзывает все ранее выданные сессии этого логина.
        await fastify.prisma.user.update({
          where: { id: existing.id },
          data: { email: parsed.data.email, passwordHash, isActive: true, tokenVersion: { increment: 1 } },
        });
      } else {
        await fastify.prisma.user.create({
          data: { email: parsed.data.email, passwordHash, role: "DRIVER", driverId },
        });
      }
      return { ok: true };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        return reply.code(409).send({ error: "email_taken" });
      }
      throw error;
    }
  });

  // ---------- Виды топлива ----------
  fastify.get("/api/fuel-types", readGuard, async () => {
    return fastify.prisma.fuelType.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  });

  fastify.post("/api/fuel-types", writeGuard, async (request, reply) => {
    const parsed = fuelTypeSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.fuelType.create({ data: parsed.data });
  });

  fastify.patch<{ Params: { id: string } }>("/api/fuel-types/:id", writeGuard, async (request, reply) => {
    const parsed = fuelTypeSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.fuelType.update({ where: { id: Number(request.params.id) }, data: parsed.data });
  });

  fastify.delete<{ Params: { id: string } }>("/api/fuel-types/:id", writeGuard, async (request) => {
    return fastify.prisma.fuelType.update({ where: { id: Number(request.params.id) }, data: { isActive: false } });
  });
}
