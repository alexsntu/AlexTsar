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
