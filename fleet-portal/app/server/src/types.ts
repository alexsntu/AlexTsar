// SQLite не поддерживает нативные enum в Prisma — роли и статусы рейсов
// хранятся как String в БД, а допустимые значения и типы описаны здесь.

export const ROLES = ["ADMIN", "DISPATCHER", "DRIVER"] as const;
export type Role = (typeof ROLES)[number];

export const TRIP_STATUSES = ["ASSIGNED", "IN_PROGRESS", "DONE", "CANCELLED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
