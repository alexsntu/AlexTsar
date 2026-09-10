import "dotenv/config";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { env } from "./env.js";
import prismaPlugin from "./plugins/prisma.js";
import authPlugin from "./plugins/auth.js";
import authRoutes from "./modules/auth/routes.js";
import directoriesRoutes from "./modules/directories/routes.js";
import fuelRoutes from "./modules/fuel/routes.js";
import fuelReportsRoutes from "./modules/fuel/reports.js";
import tripsRoutes from "./modules/trips/routes.js";
import maintenanceRoutes from "./modules/maintenance/routes.js";
import maintenanceReportsRoutes from "./modules/maintenance/reports.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

// Единый обработчик ошибок: клиенту — чистые 400/404/409 без деталей
// реализации (пути в файловой системе, текст Prisma/Zod-ошибок), в лог —
// всё как есть с requestId, чтобы можно было найти причину по логам.
function registerErrorHandler(fastify: FastifyInstance) {
  fastify.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "invalid_request", details: error.flatten() });
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        return reply.code(404).send({ error: "not_found" });
      }
      if (error.code === "P2002") {
        return reply.code(409).send({ error: "conflict" });
      }
      if (error.code === "P2003") {
        // Ссылка на несуществующую запись (fuelTypeId/truckId/driverId и т.п.)
        return reply.code(400).send({ error: "invalid_reference" });
      }
    }

    // Например :id в URL, который не приводится к числу (Number("abc") = NaN) —
    // Prisma отклоняет NaN как некорректный тип, это ошибка входных данных,
    // а не сервера.
    if (error instanceof Prisma.PrismaClientValidationError) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    // Fastify сам валидирует params/query по JSON-схеме (если задана) —
    // такие ошибки тоже про вход пользователя, а не сбой сервера.
    if (error && typeof error === "object" && "validation" in error && error.validation) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    // Штатные ошибки самого Fastify и его плагинов (rate-limit → 429 с
    // Retry-After, слишком большое тело → 413, битый JSON → 400 и т.п.) уже
    // несут безопасный statusCode и сообщение без внутренних деталей — их
    // нужно ПРОПУСТИТЬ как есть, а не свести всё, что не Zod/Prisma, к 500
    // (повторное ревью поймало именно это: 11-й неверный вход отдавал 500
    // вместо 429, с потерей заголовка Retry-After).
    if (
      error &&
      typeof error === "object" &&
      "statusCode" in error &&
      typeof (error as { statusCode?: unknown }).statusCode === "number"
    ) {
      const fastifyError = error as { statusCode: number; message?: string; headers?: Record<string, string | number | string[]> };
      if (fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
        if (fastifyError.headers) {
          for (const [key, value] of Object.entries(fastifyError.headers)) {
            reply.header(key, value);
          }
        }
        return reply.code(fastifyError.statusCode).send({ error: "bad_request", message: fastifyError.message });
      }
    }

    const requestId = crypto.randomUUID();
    request.log.error({ err: error, requestId }, "unhandled_error");
    return reply.code(500).send({ error: "internal_error", requestId });
  });
}

async function main() {
  // trustProxy: за Traefik — единственным входом извне (80/443 наружу,
  // сам fleet-app наружу не торчит, см. docker-compose.vps.yml) — доверяем
  // X-Forwarded-For от него. Без этого request.ip = внутренний IP Traefik
  // для ВСЕХ пользователей разом, и rate-limit на /api/auth/login по IP
  // (10/мин) фактически делится на всех, а не защищает конкретный аккаунт.
  const fastify = Fastify({ logger: true, trustProxy: true });

  // Регистрируем ДО остальных плагинов/маршрутов — иначе дочерние
  // энкапсуляции, созданные более ранними register(), не наследуют
  // обработчик, и клиент видит сырые 500 от Fastify по умолчанию.
  registerErrorHandler(fastify);

  await fastify.register(cookie);
  await fastify.register(cors, { origin: env.nodeEnv === "development", credentials: true });

  const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
  // Доп. слой защиты от CSRF поверх SameSite=Lax на cookie (основная защита).
  // Если браузер прислал Origin — он обязан совпадать с хостом самого
  // запроса. Origin отсутствует у части легитимных не-браузерных клиентов,
  // поэтому его отсутствие не блокируем — это не замена SameSite, а надстройка.
  // В development пропускаем: Vite-прокси (changeOrigin) переписывает Host
  // в 127.0.0.1:3000, а браузерный Origin остаётся localhost:5173 — легитимный
  // локальный запрос иначе всегда бы блокировался.
  if (env.nodeEnv !== "development") {
    fastify.addHook("onRequest", async (request, reply) => {
      if (!MUTATING_METHODS.has(request.method)) return;
      const origin = request.headers.origin;
      if (!origin) return;
      try {
        if (new URL(origin).hostname !== request.hostname) {
          return reply.code(403).send({ error: "origin_mismatch" });
        }
      } catch {
        return reply.code(403).send({ error: "origin_mismatch" });
      }
    });
  }
  // По умолчанию лимит не применяется — включаем точечно на /api/auth/login
  // (config.rateLimit), чтобы не мешать обычной работе с API.
  await fastify.register(rateLimit, { global: false });
  await fastify.register(prismaPlugin);
  await fastify.register(authPlugin);

  await fastify.register(authRoutes);
  await fastify.register(directoriesRoutes);
  await fastify.register(fuelRoutes);
  await fastify.register(fuelReportsRoutes);
  await fastify.register(tripsRoutes);
  await fastify.register(maintenanceRoutes);
  await fastify.register(maintenanceReportsRoutes);

  // Раздача собранного PWA-фронтенда (см. app/Dockerfile) + SPA-fallback на index.html
  await fastify.register(fastifyStatic, {
    root: publicDir,
    wildcard: false,
  });

  fastify.setNotFoundHandler((request, reply) => {
    if (request.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "not_found" });
    }
    return reply.sendFile("index.html");
  });

  await fastify.listen({ host: "0.0.0.0", port: env.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
