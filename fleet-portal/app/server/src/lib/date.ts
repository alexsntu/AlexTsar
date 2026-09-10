const DAY_MS = 24 * 60 * 60 * 1000;
// Россия не переходит на летнее/зимнее время — фиксированный сдвиг UTC+3,
// без него границы "дня" в запросах молча съезжают на 3 часа (повторное
// ревью поймало: запись 00:30 МСК терялась, а запись 01:00 МСК следующего
// дня — нет).
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Нижняя граница периода "с X" из query-параметра типа "2026-09-30"
 * (z.coerce.date() превращает его в 2026-09-30T00:00:00.000Z — полночь UTC,
 * а не полночь Москвы). Возвращает настоящую московскую полночь этого дня
 * в UTC — использовать с Prisma-фильтром `gte`.
 */
export function mskDayStart(from: Date | undefined): Date | undefined {
  if (!from) return undefined;
  return new Date(from.getTime() - MSK_OFFSET_MS);
}

/**
 * Верхняя граница периода "по X" — начало СЛЕДУЮЩЕГО московского дня.
 * Использовать с Prisma-фильтром `lt` вместо `lte: to` — иначе записи
 * этого дня со временем (не полночь) выпадают из диапазона.
 */
export function mskDayEnd(to: Date | undefined): Date | undefined {
  if (!to) return undefined;
  return new Date(to.getTime() - MSK_OFFSET_MS + DAY_MS);
}
