import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import type { Role } from "../types.js";

const COOKIE_NAME = "fleet_token";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 дней (по умолчанию, без "запомнить меня")
const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 год (с "запомнить меня")

// Токен несёт только id и версию сессии — роль, активность и driverId сервер
// каждый раз перечитывает из базы (см. authenticate ниже), а не доверяет им из JWT.
// Так блокировка пользователя/водителя и смена пароля (см. tokenVersion) реально
// обрывают ранее выданные сессии, а не только curent /api/auth/me.
export interface AuthTokenPayload {
  id: number;
  tokenVersion: number;
}

export interface AuthUser {
  id: number;
  role: Role;
  driverId: number | null;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (roles: Role[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export function signAuthToken(payload: AuthTokenPayload, remember: boolean): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: remember ? REMEMBER_TTL_SECONDS : TOKEN_TTL_SECONDS });
}

export function setAuthCookie(reply: FastifyReply, token: string, remember: boolean) {
  reply.setCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.nodeEnv === "production",
    path: "/",
    maxAge: remember ? REMEMBER_TTL_SECONDS : TOKEN_TTL_SECONDS,
  });
}

export function clearAuthCookie(reply: FastifyReply) {
  reply.clearCookie(COOKIE_NAME, { path: "/" });
}

export default fp(async function authPlugin(fastify: FastifyInstance) {
  fastify.decorate("authenticate", async function (request: FastifyRequest, reply: FastifyReply) {
    const token = request.cookies[COOKIE_NAME];
    if (!token) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    let payload: AuthTokenPayload;
    try {
      payload = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const user = await fastify.prisma.user.findUnique({ where: { id: payload.id } });
    if (!user || !user.isActive || user.tokenVersion !== payload.tokenVersion) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    // Для водителя дополнительно проверяем, что сам водитель ещё активен
    // (архивный водитель не должен сохранять доступ через старый логин).
    if (user.driverId !== null) {
      const driver = await fastify.prisma.driver.findUnique({ where: { id: user.driverId } });
      if (!driver || !driver.isActive) {
        return reply.code(401).send({ error: "unauthorized" });
      }
    }

    request.user = { id: user.id, role: user.role as Role, driverId: user.driverId };
  });

  fastify.decorate("requireRole", function (roles: Role[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.user || !roles.includes(request.user.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }
    };
  });
});
