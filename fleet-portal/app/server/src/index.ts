import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import rateLimit from "@fastify/rate-limit";
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

async function main() {
  const fastify = Fastify({ logger: true });

  await fastify.register(cookie);
  await fastify.register(cors, { origin: env.nodeEnv === "development", credentials: true });
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
