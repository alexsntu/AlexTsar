import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const prisma = new PrismaClient();

async function main() {
  // Ищем ЛЮБОГО администратора, а не только с текущим ADMIN_EMAIL — иначе
  // смена ADMIN_EMAIL в .env и перезапуск создаст второго админа вместо
  // переименования первого (которое так и так не задача сидирования).
  const existing = await prisma.user.findFirst({ where: { role: "ADMIN" } });
  if (existing) {
    console.log(`Администратор уже существует (${existing.email}), пропускаю сидирование`);
    return;
  }

  const passwordHash = await bcrypt.hash(env.adminPassword, 10);
  await prisma.user.create({
    data: {
      email: env.adminEmail,
      passwordHash,
      role: "ADMIN",
    },
  });
  console.log(`Создан администратор ${env.adminEmail}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
