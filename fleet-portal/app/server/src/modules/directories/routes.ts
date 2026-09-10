import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";

const truckSchema = z.object({
  name: z.string().min(1),
  plateNumber: z.string().min(1),
  capacityTons: z.number().positive().optional(),
  normConsumptionMin: z.number().positive().optional(),
  normConsumptionMax: z.number().positive().optional(),
  serviceIntervalKm: z.number().positive().optional(),
  serviceIntervalDays: z.number().int().positive().optional(),
  lastServiceDate: z.coerce.date().optional(),
  lastServiceOdometer: z.number().nonnegative().optional(),
  insuranceExpiryDate: z.coerce.date().optional(),
  inspectionExpiryDate: z.coerce.date().optional(),
});

const driverSchema = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
});

const credentialsSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(6),
});

const fuelTypeSchema = z.object({
  name: z.string().min(1),
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
    const parsed = truckSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.truck.update({ where: { id: Number(request.params.id) }, data: parsed.data });
  });

  fastify.delete<{ Params: { id: string } }>("/api/trucks/:id", writeGuard, async (request) => {
    return fastify.prisma.truck.update({ where: { id: Number(request.params.id) }, data: { isActive: false } });
  });

  // ---------- Водители ----------
  fastify.get("/api/drivers", readGuard, async () => {
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
    return fastify.prisma.driver.update({ where: { id: Number(request.params.id) }, data: { isActive: false } });
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
        await fastify.prisma.user.update({
          where: { id: existing.id },
          data: { email: parsed.data.email, passwordHash, isActive: true },
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
