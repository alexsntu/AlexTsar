import { ApiError } from "./client";

const MESSAGES: Record<string, string> = {
  invalid_body: "Проверьте правильность заполнения формы",
  invalid_credentials: "Неверный логин или пароль",
  unauthorized: "Нужно войти в систему",
  forbidden: "Недостаточно прав",
  not_your_truck: "Эта машина не назначена вам текущим рейсом",
  not_your_trip: "Это не ваш рейс",
  drivers_cannot_log_personal: "Водитель не может списывать топливо на личное авто",
  trip_not_active: "Рейс уже завершён или отменён",
  not_found: "Не найдено",
  email_taken: "Этот логин уже занят другим пользователем",
  tank_withdrawal_not_cancellable: "Заправку со склада отменить нельзя — только выдачу талонов и заправку по карте",
  idempotency_conflict: "Эта форма уже была отправлена с другими данными — обновите страницу и повторите",
};

export function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409 && error.body && typeof error.body === "object" && "error" in error.body && (error.body as { error: string }).error === "insufficient_fuel") {
      const body = error.body as unknown as { available: number; requested: number };
      return `Недостаточно топлива: запрошено ${body.requested} л, в наличии ${body.available} л`;
    }
    if (error.status === 409 && error.body && typeof error.body === "object" && "error" in error.body && (error.body as { error: string }).error === "insufficient_talons") {
      const body = error.body as unknown as { nominalLiters: number; available: number; requested: number };
      return `Недостаточно талонов по ${body.nominalLiters} л: запрошено ${body.requested} шт., в наличии ${body.available} шт.`;
    }
    const code = typeof error.body === "object" && error.body !== null && "error" in error.body ? String((error.body as { error: unknown }).error) : undefined;
    if (code && MESSAGES[code]) return MESSAGES[code];
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return "Неизвестная ошибка";
}
