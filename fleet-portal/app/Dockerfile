# syntax=docker/dockerfile:1

# ---------- Сборка PWA-фронтенда ----------
FROM node:24-alpine AS web-build
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---------- Сборка backend (с dev-зависимостями, для tsc и prisma generate) ----------
FROM node:24-alpine AS server-build
RUN apk add --no-cache openssl
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci
COPY server/ ./
RUN npm run build

# ---------- Только продакшн-зависимости backend ----------
FROM node:24-alpine AS server-prod-deps
RUN apk add --no-cache openssl
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci --omit=dev

# ---------- Итоговый лёгкий образ ----------
FROM node:24-alpine AS runtime
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S fleet && adduser -S fleet -G fleet

COPY --from=server-prod-deps /app/server/node_modules ./node_modules
# node_modules/.prisma (сгенерированный клиент с engine-бинарником) кладём поверх —
# @prisma/client создаёт его через postinstall, для которого в prod-deps нет CLI prisma,
# поэтому берём уже сгенерированный в server-build (там CLI есть).
COPY --from=server-build /app/server/node_modules/.prisma ./node_modules/.prisma
COPY --from=server-prod-deps /app/server/package.json ./package.json
COPY --from=server-build /app/server/dist ./dist
COPY --from=server-build /app/server/prisma ./prisma
COPY --from=web-build /app/web/dist ./public

RUN mkdir -p /data && chown -R fleet:fleet /data /app
USER fleet

EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/seed.js && node dist/index.js"]
