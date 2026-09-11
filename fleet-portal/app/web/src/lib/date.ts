/**
 * "YYYY-MM-DD" по ЛОКАЛЬНОМУ календарю (для <input type="date"> и фильтров по дате).
 * Не использовать toISOString().slice(0, 10) для этого — он переводит в UTC и
 * в Москве (+3) может съехать на соседний день у полуночи/при вычислении границ месяца.
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayLocalDateString(): string {
  return toLocalDateString(new Date());
}

const SHORT_MONTHS = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сент", "окт", "ноя", "дек"];

/**
 * Короткая дата вида "11 сент 26" из строки "YYYY-MM-DD" (или ISO с временем — используются
 * только первые 10 символов). Разбираем строку вручную, а не через `new Date(str)`, чтобы не
 * словить сдвиг из-за UTC (см. toLocalDateString).
 */
export function formatShortDate(dateStr: string): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  return `${Number(day)} ${SHORT_MONTHS[Number(month) - 1]} ${year.slice(2)}`;
}
