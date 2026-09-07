import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { env } from "./env.js";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.user.findUnique({ where: { email: env.adminEmail } });
  if (existing) {
    console.log(`Админ ${env.adminEmail} уже существует, пропускаю сидирование`);
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
