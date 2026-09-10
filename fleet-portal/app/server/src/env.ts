function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Отсутствует обязательная переменная окружения ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 3000),
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET"),
  adminEmail: process.env.ADMIN_EMAIL ?? "admin@fleet.local",
  // Без дефолта: свежая база с известным паролем "changeme" — уязвимость,
  // а не просто неудобство. Пароль администратора обязателен явно.
  adminPassword: required("ADMIN_PASSWORD"),
  nodeEnv: process.env.NODE_ENV ?? "development",
};
