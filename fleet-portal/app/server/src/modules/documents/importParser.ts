import ExcelJS from "exceljs";
import type { ParsedDeliveryRow } from "./types.js";

// Заголовки в присланном заказчиком файле — ищем строку с этими подписями
// (не хардкодим номер строки: в разных присылках шапка съезжает на строку
// 3, данные — то с 4-й, то с 7-й строки).
const HEADERS = {
  date: "День рейса",
  address: "Адрес получателя",
  truck: "Гос номер",
  distance: "Маршрут расстояние, км.",
  mass: "Общая масса груза",
  cost: "Стоимость доставки",
} as const;

type ColumnMap = Record<keyof typeof HEADERS, number>;

export class ImportParseError extends Error {}

// В "Адрес получателя" часть строк — формула на вкладку "адреса столовых"
// (канонический текст), а часть — вольный текст с тем же кодом "82/N", но
// другой формулировкой (например "82/12, Джанкой, ВЧ_46453" вместо
// канонического "82/12 г.Джанкой ул.Московская д.283" — сверено с реальным
// присланным файлом). Сверять по полному тексту адреса поэтому нельзя —
// только по коду "82/N" в начале строки, который стабилен в обоих случаях.
const CODE_PATTERN = /^82\/[\w-]+/;

export function extractAddressCode(addressText: string): string | null {
  const match = addressText.trim().match(CODE_PATTERN);
  return match ? match[0] : null;
}

// Имя листа вида "июль 01.07-10.07" называет заявленный период рейсов —
// используем его как sanity-check дат: в реальном присланном файле
// встречались строки с испорченной датой (похоже на артефакт протягивания
// даты в Excel — вместо "8 июля" стояли "2026-01-08, 2026-02-08, ...,
// 2026-08-08" подряд), которые иначе тихо ломают группировку по дням.
const SHEET_PERIOD_PATTERN = /(\d{1,2})\.(\d{1,2})\s*-\s*(\d{1,2})\.(\d{1,2})/;

export function inferPeriodFromSheetName(sheetName: string, referenceYear: number): { start: Date; end: Date } | null {
  const match = sheetName.match(SHEET_PERIOD_PATTERN);
  if (!match) return null;
  const [, d1, m1, d2, m2] = match;
  const start = new Date(Date.UTC(referenceYear, Number(m1) - 1, Number(d1)));
  const end = new Date(Date.UTC(referenceYear, Number(m2) - 1, Number(d2)));
  return { start, end };
}

/** Многие ячейки в исходнике — формулы (ссылка на вкладку "адреса столовых",
 * произведение J*M и т.п.), ExcelJS отдаёт их как {formula, result} — нужен
 * именно result, а не сама формула. */
function cellValue(cell: ExcelJS.Cell): unknown {
  const raw = cell.value;
  if (raw && typeof raw === "object" && "result" in raw) {
    return (raw as { result: unknown }).result;
  }
  return raw;
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cellValue(cell);
  if (value == null) return "";
  if (typeof value === "object" && "text" in (value as Record<string, unknown>)) {
    return String((value as { text: unknown }).text ?? "").trim();
  }
  return String(value).trim();
}

function cellNumber(cell: ExcelJS.Cell): number | null {
  const value = cellValue(cell);
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return null;
}

function cellDate(cell: ExcelJS.Cell): Date | null {
  const value = cellValue(cell);
  if (value instanceof Date) return value;
  return null;
}

function findHeaderRow(ws: ExcelJS.Worksheet): number | null {
  const maxScan = Math.min(ws.rowCount, 20);
  for (let r = 1; r <= maxScan; r++) {
    const row = ws.getRow(r);
    let found = false;
    row.eachCell((cell) => {
      if (cellText(cell) === HEADERS.address) found = true;
    });
    if (found) return r;
  }
  return null;
}

function findColumns(headerRow: ExcelJS.Row): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  headerRow.eachCell((cell, colNumber) => {
    const text = cellText(cell);
    for (const [key, label] of Object.entries(HEADERS)) {
      if (text === label) map[key as keyof typeof HEADERS] = colNumber;
    }
  });
  const keys = Object.keys(HEADERS) as (keyof typeof HEADERS)[];
  if (keys.some((k) => map[k] === undefined)) return null;
  return map as ColumnMap;
}

/** Список листов файла — чтобы предложить пользователю выбрать нужный,
 * когда авто-подбор по имени листа неоднозначен. */
export async function listSheetNames(buffer: Buffer): Promise<string[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return workbook.worksheets.map((ws) => ws.name);
}

/** Разбирает один лист с рейсами. Бросает ImportParseError, если на листе
 * не нашлась ожидаемая шапка таблицы (не тот лист выбран). */
export async function parseSheet(buffer: Buffer, sheetName: string): Promise<ParsedDeliveryRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const ws = workbook.getWorksheet(sheetName);
  if (!ws) throw new ImportParseError(`Лист "${sheetName}" не найден в файле`);

  const headerRowNumber = findHeaderRow(ws);
  if (headerRowNumber === null) {
    throw new ImportParseError(`На листе "${sheetName}" не найдена шапка таблицы (колонка "Адрес получателя")`);
  }
  const columns = findColumns(ws.getRow(headerRowNumber));
  if (!columns) {
    throw new ImportParseError(`На листе "${sheetName}" не хватает одной из обязательных колонок`);
  }

  const rows: ParsedDeliveryRow[] = [];
  for (let r = headerRowNumber + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const addressText = cellText(row.getCell(columns.address));
    const date = cellDate(row.getCell(columns.date));
    // Просто пропускаем строки без даты/адреса — НЕ прерываем цикл на первой
    // же пустой строке: в части присланных файлов между шапкой и первой
    // строкой данных есть пустой отступ (замечено на реальном файле — шапка
    // в строке 3, данные с 7-й, строки 4-6 пустые), а не только "хвост"
    // после последней строки данных.
    if (!date || !addressText) continue;

    const truckPlate = cellText(row.getCell(columns.truck));
    const distanceKm = cellNumber(row.getCell(columns.distance));
    const massKg = cellNumber(row.getCell(columns.mass));
    const fileCost = cellNumber(row.getCell(columns.cost));
    if (distanceKm === null || massKg === null || fileCost === null) continue;

    rows.push({ rowNumber: r, date, addressText, truckPlate, distanceKm, massKg, fileCost });
  }
  return rows;
}
