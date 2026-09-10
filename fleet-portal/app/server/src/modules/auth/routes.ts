import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { clearAuthCookie, setAuthCookie, signAuthToken } from "../../plugins/auth.js";
import type { Role } from "../../types.js";

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
  remember: z.boolean().optional().default(true),
});

export default async function authRoutes(fastify: FastifyInstance) {
  fastify.post(
    "/api/auth/login",
    {
      // Защита от подбора пароля: не больше 10 попыток в минуту с одного IP.
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: "invalid_body" });
      }
      const { email, password, remember } = parsed.data;

      const user = await fastify.prisma.user.findUnique({ where: { email } });
      if (!user || !user.isActive) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const passwordOk = await bcrypt.compare(password, user.passwordHash);
      if (!passwordOk) {
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const token = signAuthToken({ id: user.id, role: user.role as Role, driverId: user.driverId }, remember);
      setAuthCookie(reply, token, remember);

      return { id: user.id, email: user.email, role: user.role, driverId: user.driverId };
    },
  );

  fastify.post("/api/auth/logout", async (_request, reply) => {
    clearAuthCookie(reply);
    return { ok: true };
  });

  fastify.get(
    "/api/auth/me",
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const user = await fastify.prisma.user.findUnique({
        where: { id: request.user!.id },
        include: { driver: true },
      });
      if (!user || !user.isActive) {
        return reply.code(401).send({ error: "unauthorized" });
      }
      return {
        id: user.id,
        email: user.email,
        role: user.role,
        driverId: user.driverId,
        driverName: user.driver?.fullName ?? null,
      };
    },
  );
}
