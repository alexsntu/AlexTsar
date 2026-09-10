import fp from "fastify-plugin";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../env.js";
import type { Role } from "../types.js";

const COOKIE_NAME = "fleet_token";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 дней (по умолчанию, без "запомнить меня")
const REMEMBER_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 год (с "запомнить меня")

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

export function signAuthToken(user: AuthUser, remember: boolean): string {
  return jwt.sign(user, env.jwtSecret, { expiresIn: remember ? REMEMBER_TTL_SECONDS : TOKEN_TTL_SECONDS });
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
    try {
      const payload = jwt.verify(token, env.jwtSecret) as AuthUser;
      request.user = payload;
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  fastify.decorate("requireRole", function (roles: Role[]) {
    return async function (request: FastifyRequest, reply: FastifyReply) {
      if (!request.user || !roles.includes(request.user.role)) {
        return reply.code(403).send({ error: "forbidden" });
      }
    };
  });
});
