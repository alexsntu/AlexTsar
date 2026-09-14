import ExcelJS from "exceljs";
import type { OrgProfile } from "@prisma/client";
import { round2 } from "../../lib/money.js";
import { rublesInWords } from "./sumInWords.js";
import type { DayAct, MonthSummaryLine } from "./queries.js";

// Точные координаты (объединения ячеек, размеры шрифта, форматы чисел) сняты
// построчно с реальных файлов клиента: "Акт за Июль.xlsx" (24 листа — сверено,
// что футер сдвигается по формуле "последняя строка позиций + N" одинаково и
// на листе с 2 позициями, и на листе с 23), "Акт об оказании услуг №22
// Июль.xlsx", "Счёт за Июль.xlsx", "Реестр Июль.xlsx". Здесь оставлена только
// СТРУКТУРА — реальные тексты (ФИО, ИНН, суммы) всегда подставляются заново.

const RU_MONTHS_GENITIVE = [
  "Января", "Февраля", "Марта", "Апреля", "Мая", "Июня",
  "Июля", "Августа", "Сентября", "Октября", "Ноября", "Декабря",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "31 Июля 2026" — заголовки актов ("Акт №N от 31 Июля 2026 г."). */
function formatDateLong(date: Date): string {
  return `${date.getUTCDate()} ${RU_MONTHS_GENITIVE[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** "1.07.2026" — диапазоны дат в позициях счёта (день без ведущего нуля —
 * так в примерах отформатированы даты рейсов, в отличие от дат договора). */
function formatDateShort(date: Date): string {
  return `${date.getUTCDate()}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** "01.04.2026" — дата договора и срок оплаты (день с ведущим нулём). */
function formatDatePadded(date: Date): string {
  return `${pad2(date.getUTCDate())}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

/** "ИП Иванов И. И." -> "Индивидуальный предприниматель Иванов И. И." — так
 * называется получатель в банковском блоке счёта (в отличие от остальных
 * мест документа, где используется сокращение "ИП"). */
function expandIp(name: string): string {
  return name.replace(/^ИП\s+/, "Индивидуальный предприниматель ");
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const THIN_BOX: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  bottom: { style: "thin" },
  left: { style: "thin" },
  right: { style: "thin" },
};

/** Полная рамка (как в таблицах позиций всех примеров — "нет обводки" было
 * главной жалобой) на диапазон колонок [fromCol..toCol] строки. */
function boxBorders(row: ExcelJS.Row, fromCol: number, toCol: number) {
  for (let c = fromCol; c <= toCol; c++) {
    row.getCell(c).border = THIN_BOX;
  }
}

/** Печать на одну страницу A4 (портрет), с масштабом "по ширине" — как во
 * всех примерах (иначе последние колонки таблицы обрезаются при печати/
 * экспорте в PDF). */
function setPrintSetup(ws: ExcelJS.Worksheet, printArea: string) {
  ws.pageSetup = {
    paperSize: 9,
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
    printArea,
  };
}

/** Ячейка без явного имени шрифта наследует в Excel гарнитуру темы
 * (Calibri у всех примеров), но LibreOffice подставляет свой дефолт с
 * засечками — из-за этого весь документ визуально "не тот" шрифт. Дозаполняем
 * имя явно везде, где оно не задано, не трогая осознанные переопределения
 * (например Arial в шапке таблицы дневного акта). */
function backfillDefaultFont(ws: ExcelJS.Worksheet, defaultName = "Calibri") {
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (!cell.font?.name) cell.font = { ...cell.font, name: defaultName };
    });
  });
}

function colLetterToNumber(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Тонкая рамка на все ячейки диапазона (напр. "A1:D3") — для сетки
 * банковских реквизитов в шапке счёта. */
function borderRange(ws: ExcelJS.Worksheet, range: string) {
  const [start, end] = range.split(":");
  const parse = (addr: string) => {
    const m = addr.match(/^([A-Z]+)(\d+)$/)!;
    return { col: colLetterToNumber(m[1]), row: Number(m[2]) };
  };
  const s = parse(start);
  const e = parse(end ?? start);
  for (let r = s.row; r <= e.row; r++) {
    for (let c = s.col; c <= e.col; c++) {
      ws.getRow(r).getCell(c).border = THIN_BOX;
    }
  }
}

/** Блок реквизитов "Исполнитель:"/"Поставщик:". Телефон в нём есть только в
 * итоговом акте — в дневном акте и в счёте (проверено по реальным примерам)
 * его нет, поэтому `includePhone` по умолчанию выключен. */
function supplierBlockText(supplier: OrgProfile | null, includePhone = false): string {
  if (!supplier) return "";
  const bank = [supplier.bankAccount && `р/с ${supplier.bankAccount}`, supplier.bankName && `в банке ${supplier.bankName}`, supplier.bik && `БИК ${supplier.bik}`, supplier.corrAccount && `к/с ${supplier.corrAccount}`]
    .filter(Boolean)
    .join(", ");
  return [
    `${supplier.shortName || supplier.name}, ИНН ${supplier.inn}`,
    supplier.legalAddress,
    includePhone && supplier.phone && `тел.: ${supplier.phone}`,
    bank,
  ]
    .filter(Boolean)
    .join(", ");
}

function buyerBlockText(buyer: OrgProfile | null): string {
  if (!buyer) return "";
  return [`${buyer.name} Юридический адрес: ${buyer.legalAddress}`, buyer.kpp && `ИНН/КПП ${buyer.inn}/${buyer.kpp}`, !buyer.kpp && `ИНН ${buyer.inn}`]
    .filter(Boolean)
    .join(". ");
}

function contractNumberLine(supplier: OrgProfile | null): string {
  if (!supplier?.contractNumber) return "";
  const dateStr = supplier.contractDate ? formatDatePadded(supplier.contractDate) : "";
  return `Договор № ${supplier.contractNumber}${dateStr ? ` от ${dateStr} г.` : ""}`;
}

function contractIgkLine(supplier: OrgProfile | null): string {
  if (!supplier?.contractIgk) return "";
  return `Идентификатор государственного контракта (ИГК) – ${supplier.contractIgk}`;
}

export interface OrgContext {
  supplier: OrgProfile | null;
  buyer: OrgProfile | null;
}

/**
 * Дневной акт (по рейсам) — как "Акт выполненных работ №N от [дата]".
 *
 * Структура 1:1 повторяет "Акт за Июль.xlsx": шапка (заголовок + Исполнитель/
 * Заказчик/Основание) всегда занимает строки 1-14, таблица начинается с
 * 15-й, а весь футер (ИТОГО и ниже) привязан не к абсолютной строке, а к
 * "последняя строка таблицы + N" — именно так футер съезжает вниз в
 * оригинале при разном числе рейсов в день (сверено на всех 24 листах).
 */
export function addDayActSheet(workbook: ExcelJS.Workbook, dayAct: DayAct, ctx: OrgContext, sheetName?: string): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName ?? `Акт ${dayAct.actNumber}`);
  ws.columns = [
    { width: 4.5 }, { width: 17 }, { width: 21 }, { width: 21 },
    { width: 14 }, { width: 12.5 }, { width: 13.5 }, { width: 12.5 },
  ];

  ws.mergeCells("A1:H1");
  ws.getCell("A1").value = `Акт выполненных работ №${dayAct.actNumber} от ${formatDateLong(parseDateKey(dayAct.date))} года`;
  ws.getCell("A1").font = { bold: true, size: 16 };
  ws.getCell("A1").alignment = { wrapText: true, vertical: "middle", horizontal: "center" };
  ws.getRow(1).height = 30;

  ws.mergeCells("A3:B3");
  ws.getCell("A3").value = "Исполнитель:";
  ws.getCell("A3").font = { size: 11 };
  ws.getCell("A3").alignment = { vertical: "middle" };
  ws.mergeCells("C3:I5");
  ws.getCell("C3").value = supplierBlockText(ctx.supplier);
  ws.getCell("C3").font = { bold: true, size: 11 };
  ws.getCell("C3").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(3).height = 15;

  ws.mergeCells("A7:B7");
  ws.getCell("A7").value = "Заказчик:";
  ws.getCell("A7").font = { size: 11 };
  ws.getCell("A7").alignment = { vertical: "middle" };
  ws.mergeCells("C7:I10");
  ws.getCell("C7").value = buyerBlockText(ctx.buyer);
  ws.getCell("C7").font = { bold: true, size: 11 };
  ws.getCell("C7").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(7).height = 15;

  ws.mergeCells("A12:B12");
  ws.getCell("A12").value = "Основание:";
  ws.getCell("A12").font = { size: 11 };
  ws.getCell("A12").alignment = { vertical: "middle" };
  ws.getCell("C12").value = contractNumberLine(ctx.supplier);
  ws.getCell("C12").font = { bold: true, size: 11 };
  ws.getCell("C12").alignment = { vertical: "middle" };
  ws.getCell("C13").value = ctx.supplier?.contractIgk
    ? `Идентификатор государственного контракта (ИГК) -${ctx.supplier.contractIgk}`
    : "";
  ws.getCell("C13").font = { bold: true, size: 12 };
  ws.getCell("C13").alignment = { vertical: "middle" };
  ws.getRow(13).height = 15.75;

  const headerRow = ws.getRow(14);
  headerRow.values = [
    "№", "Наименование услуг", "Точка отправки, наименование и № подразделения",
    "Точка доставки, наименование и № подразделения", "Марка., гос. рег. знак ТС",
    "Стоимость услуги за 1кг. руб.", "Количество кг.", "Сумма",
  ];
  headerRow.font = { bold: true, size: 11, name: "Arial" };
  headerRow.eachCell((c) => (c.alignment = { wrapText: true, vertical: "middle" }));
  headerRow.getCell(1).alignment = { vertical: "middle" };
  headerRow.getCell(8).alignment = { vertical: "middle" };
  boxBorders(headerRow, 1, 8);
  headerRow.height = 61.5;

  let row = 15;
  for (const line of dayAct.lines) {
    const r = ws.getRow(row);
    r.values = [line.index, line.service, line.dispatchPoint, line.deliveryAddress, line.truckPlate, line.ratePerKg, line.massKg, line.cost];
    r.font = { size: 11 };
    r.eachCell((cell) => (cell.alignment = { vertical: "middle" }));
    r.getCell(3).alignment = { wrapText: true, vertical: "middle" };
    r.getCell(4).alignment = { wrapText: true, vertical: "middle" };
    r.getCell(5).alignment = { wrapText: true, vertical: "middle" };
    r.getCell(7).numFmt = "0.000";
    r.getCell(8).numFmt = "0.00";
    boxBorders(r, 1, 8);
    r.height = 45;
    row += 1;
  }

  const lastData = row - 1;
  ws.getCell(`F${lastData + 2}`).value = "ИТОГО:";
  ws.getCell(`F${lastData + 2}`).font = { bold: true, size: 11 };
  ws.getCell(`F${lastData + 2}`).alignment = { vertical: "middle" };
  ws.getCell(`G${lastData + 2}`).value = dayAct.totalCost;
  ws.getCell(`G${lastData + 2}`).numFmt = "0.00";
  ws.getCell(`G${lastData + 2}`).font = { size: 11 };
  ws.getCell(`G${lastData + 2}`).alignment = { vertical: "middle" };

  ws.mergeCells(`F${lastData + 4}:G${lastData + 4}`);
  ws.getCell(`F${lastData + 4}`).value = "Без налога (НДС)";
  ws.getCell(`F${lastData + 4}`).font = { bold: true, size: 11 };
  ws.getCell(`F${lastData + 4}`).alignment = { vertical: "middle" };

  ws.mergeCells(`B${lastData + 6}:E${lastData + 6}`);
  ws.getCell(`B${lastData + 6}`).value = `Всего оказано услуг ${dayAct.lines.length}, на сумму ${dayAct.totalCost.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб.`;
  ws.getCell(`B${lastData + 6}`).font = { bold: true, size: 11 };
  ws.getCell(`B${lastData + 6}`).alignment = { vertical: "middle" };
  ws.getRow(lastData + 6).height = 43.5;

  ws.mergeCells(`B${lastData + 7}:H${lastData + 8}`);
  ws.getCell(`B${lastData + 7}`).value = rublesInWords(dayAct.totalCost);
  ws.getCell(`B${lastData + 7}`).font = { bold: true, size: 11 };
  ws.getCell(`B${lastData + 7}`).alignment = { wrapText: true, vertical: "top" };

  ws.mergeCells(`B${lastData + 9}:F${lastData + 11}`);
  ws.getCell(`B${lastData + 9}`).value =
    "Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.";
  ws.getCell(`B${lastData + 9}`).font = { bold: true, size: 11 };
  ws.getCell(`B${lastData + 9}`).alignment = { wrapText: true, vertical: "middle" };

  ws.getCell(`C${lastData + 13}`).value = "ИСПОЛНИТЕЛЬ";
  ws.getCell(`C${lastData + 13}`).font = { bold: true, size: 11 };
  ws.getCell(`C${lastData + 13}`).alignment = { vertical: "middle" };
  ws.getCell(`F${lastData + 13}`).value = "ЗАКАЗЧИК";
  ws.getCell(`F${lastData + 13}`).font = { bold: true, size: 11 };
  ws.getCell(`F${lastData + 13}`).alignment = { vertical: "middle" };

  ws.getCell(`C${lastData + 14}`).value = ctx.supplier?.shortName || ctx.supplier?.name || "";
  ws.getCell(`C${lastData + 14}`).font = { size: 11 };
  ws.getCell(`C${lastData + 14}`).alignment = { vertical: "middle" };
  ws.mergeCells(`F${lastData + 14}:G${lastData + 14}`);
  ws.getCell(`F${lastData + 14}`).value = ctx.buyer?.name ?? "";
  ws.getCell(`F${lastData + 14}`).font = { size: 11 };
  ws.getCell(`F${lastData + 14}`).alignment = { vertical: "middle" };

  ws.getCell(`C${lastData + 18}`).value = "___________________";
  ws.getCell(`C${lastData + 18}`).font = { size: 11 };
  ws.getCell(`C${lastData + 18}`).alignment = { vertical: "middle" };
  ws.mergeCells(`F${lastData + 18}:G${lastData + 18}`);
  ws.getCell(`F${lastData + 18}`).value = "______________________";
  ws.getCell(`F${lastData + 18}`).font = { size: 11 };
  ws.getCell(`F${lastData + 18}`).alignment = { vertical: "middle" };

  backfillDefaultFont(ws);
  setPrintSetup(ws, `A1:I${lastData + 18}`);
  return ws;
}

export function buildDayActWorkbook(dayAct: DayAct, ctx: OrgContext): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  addDayActSheet(workbook, dayAct, ctx);
  return workbook;
}

/** Один файл, вкладка на каждый день месяца — как "Акт за Июль.xlsx". */
export function buildMonthActsWorkbook(dayActs: DayAct[], ctx: OrgContext): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const dayAct of dayActs) {
    // Имя листа ограничено 31 символом и не терпит некоторые спецсимволы.
    const sheetName = `Акт №${dayAct.actNumber} ${dayAct.date}`.slice(0, 31);
    addDayActSheet(workbook, dayAct, ctx, sheetName);
  }
  return workbook;
}

/** Реестр документов за месяц — по одной строке на дневной акт (как "Реестр Июль.xlsx"). */
export function buildRegistryWorkbook(
  dayActs: DayAct[],
  ctx: OrgContext,
  info: { yearMonth: string; invoiceNumber: string; invoiceDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Реестр");
  ws.columns = [
    { width: 7 }, { width: 8.5 }, { width: 21.5 }, { width: 20 },
    { width: 19.5 }, { width: 28 }, { width: 54.5 },
  ];

  const [year, month] = info.yearMonth.split("-").map(Number);
  const monthName = RU_MONTHS_GENITIVE[month - 1];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  ws.mergeCells("A1:G11");
  ws.getCell("A1").value =
    `РЕЕСТР ДОКУМЕНТОВ: 1-${lastDay} ${monthName.toLowerCase()} ${year} года\n` +
    `Наименование контрагента: ${ctx.supplier?.name ? expandIp(ctx.supplier.name) : ""}\n` +
    `ИНН контрагента: ${ctx.supplier?.inn ?? ""}\n` +
    `Договор на поставку товара/оказание услуг: Договор №${ctx.supplier?.contractNumber ?? ""} на оказание услуг по перевозке груза от ${
      ctx.supplier?.contractDate ? formatDateLong(ctx.supplier.contractDate).toLowerCase() : ""
    } года\n` +
    `Наименование товара/услуг: транспортные услуги с 1.${pad2(month)}.${year} по ${lastDay}.${pad2(month)}.${year}\n` +
    `Реестр документов реализации товаров/услуг за период с 1.${pad2(month)}.${year} по ${lastDay}.${pad2(month)}.${year}\n` +
    `По договору № ${ctx.supplier?.contractNumber ?? ""} от ${ctx.supplier?.contractDate ? formatDatePadded(ctx.supplier.contractDate) : ""} года заключённому между ${
      ctx.supplier?.shortName || ctx.supplier?.name || ""
    } и ${ctx.buyer?.name ?? ""}\n` +
    `Счёт на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate)} года` +
    (ctx.supplier?.contractIgk ? `  ИГК-${ctx.supplier.contractIgk}` : "");
  ws.getCell("A1").font = { size: 12 };
  ws.getCell("A1").alignment = { wrapText: true, vertical: "top" };

  const headerRow = ws.getRow(13);
  headerRow.values = ["", "№", "Наименование документа", "Дата документа", "Номер документа", "Сумма документа", "Сумма документа (НДС не облагается) в денежном эквиваленте"];
  headerRow.font = { bold: true, size: 18 };
  headerRow.eachCell((c) => (c.alignment = { wrapText: true, vertical: "middle" }));
  boxBorders(headerRow, 1, 7);
  for (let c = 1; c <= 7; c++) headerRow.getCell(c).border = { ...headerRow.getCell(c).border, top: { style: "medium" } };
  headerRow.getCell(1).border = { ...headerRow.getCell(1).border, left: { style: "medium" } };
  headerRow.getCell(7).border = { ...headerRow.getCell(7).border, right: { style: "medium" } };
  headerRow.height = 52;

  let row = 14;
  for (const act of dayActs) {
    const r = ws.getRow(row);
    r.values = ["", act.actNumber, "АКТ", parseDateKey(act.date), act.actNumber, act.totalCost, round2(act.totalCost)];
    r.font = { size: 16 };
    r.eachCell((cell) => (cell.alignment = { vertical: "middle" }));
    r.getCell(3).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(4).numFmt = "dd.mm.yyyy";
    r.getCell(4).alignment = { wrapText: true, vertical: "middle" };
    r.getCell(6).numFmt = "#,##0.00000";
    r.getCell(7).numFmt = "#,##0.00";
    boxBorders(r, 1, 7);
    r.getCell(1).border = { ...r.getCell(1).border, left: { style: "medium" } };
    r.getCell(7).border = { ...r.getCell(7).border, right: { style: "medium" } };
    r.height = 22;
    row += 1;
  }

  const lastData = row - 1;
  const grandTotal = round2(dayActs.reduce((sum, a) => sum + a.totalCost, 0));
  ws.getCell(`B${lastData + 1}`).value = "ИТОГО:";
  ws.getCell(`B${lastData + 1}`).font = { size: 16 };
  ws.getCell(`B${lastData + 1}`).alignment = { vertical: "middle" };
  ws.mergeCells(`C${lastData + 1}:F${lastData + 1}`);
  ws.getCell(`C${lastData + 1}`).value = grandTotal;
  ws.getCell(`C${lastData + 1}`).numFmt = "#,##0.00000";
  ws.getCell(`C${lastData + 1}`).font = { size: 16 };
  ws.getCell(`C${lastData + 1}`).alignment = { vertical: "middle" };
  ws.getCell(`G${lastData + 1}`).value = grandTotal;
  ws.getCell(`G${lastData + 1}`).numFmt = "#,##0.00";
  ws.getCell(`G${lastData + 1}`).font = { bold: true, size: 16 };
  ws.getCell(`G${lastData + 1}`).alignment = { vertical: "middle" };

  ws.mergeCells(`B${lastData + 6}:F${lastData + 6}`);
  ws.getCell(`B${lastData + 6}`).value = `Индивидуальный предприниматель: ${(ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "")} ____________________`;

  backfillDefaultFont(ws);
  setPrintSetup(ws, `A1:G${lastData + 6}`);
  return workbook;
}

/** Итоговый акт за месяц — сгруппирован по тарифу (как "Акт об оказании услуг №22 Июль.xlsx"). */
export function buildFinalActWorkbook(
  lines: MonthSummaryLine[],
  ctx: OrgContext,
  info: { finalActNumber: number; finalActDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Акт");
  ws.columns = [
    { width: 7.5 }, { width: 8 }, { width: 13 }, { width: 24.5 },
    { width: 11.5 }, { width: 9.5 }, { width: 8 }, { width: 16.5 },
  ];

  ws.mergeCells("A2:F3");
  ws.getCell("A2").value = `Акт № ${info.finalActNumber} от ${formatDateLong(info.finalActDate)} г.`;
  ws.getCell("A2").font = { bold: true, size: 16 };
  ws.getCell("A2").alignment = { wrapText: true };
  // Линия-"подчёркивание" под заголовком — в оригинале это верхняя рамка
  // строки под ним, а не подчёркивание шрифта.
  for (let c = 1; c <= 8; c++) ws.getRow(4).getCell(c).border = { top: { style: "medium" } };

  ws.mergeCells("A5:B5");
  ws.getCell("A5").value = "Исполнитель:";
  ws.getCell("A5").font = { size: 9 };
  ws.getCell("A5").alignment = { wrapText: true, vertical: "middle" };
  ws.mergeCells("C5:H5");
  ws.getCell("C5").value = supplierBlockText(ctx.supplier, true);
  ws.getCell("C5").font = { bold: true, size: 11 };
  ws.getCell("C5").alignment = { wrapText: true, vertical: "middle" };
  ws.getRow(5).height = 47.25;

  ws.mergeCells("A6:B7");
  ws.getCell("A6").value = "Заказчик:";
  ws.getCell("A6").font = { size: 9 };
  ws.getCell("A6").alignment = { wrapText: true, vertical: "middle" };
  ws.mergeCells("C6:H7");
  ws.getCell("C6").value = buyerBlockText(ctx.buyer);
  ws.getCell("C6").font = { bold: true, size: 11 };
  ws.getCell("C6").alignment = { wrapText: true, vertical: "middle" };

  ws.mergeCells("A8:B9");
  ws.getCell("A8").value = "Основание:";
  ws.getCell("A8").font = { size: 9 };
  ws.getCell("A8").alignment = { vertical: "middle" };
  ws.mergeCells("C8:H9");
  ws.getCell("C8").value = [contractNumberLine(ctx.supplier), contractIgkLine(ctx.supplier)].filter(Boolean).join("\n");
  ws.getCell("C8").font = { bold: true, size: 11 };
  ws.getCell("C8").alignment = { wrapText: true, vertical: "middle" };

  const headerRow = ws.getRow(11);
  headerRow.getCell(1).value = "№";
  headerRow.getCell(2).value = "Наименование работ, услуг";
  headerRow.getCell(5).value = "Кол-во";
  headerRow.getCell(6).value = "Ед.";
  headerRow.getCell(7).value = "Цена";
  headerRow.getCell(8).value = "Сумма";
  headerRow.font = { bold: true, size: 11 };
  headerRow.eachCell((c) => (c.alignment = { horizontal: "center", vertical: "middle" }));
  ws.mergeCells("B11:D11");
  boxBorders(headerRow, 1, 8);
  headerRow.getCell(1).border = { ...headerRow.getCell(1).border, left: { style: "medium" }, top: { style: "medium" } };
  headerRow.getCell(8).border = { ...headerRow.getCell(8).border, right: { style: "medium" }, top: { style: "medium" } };
  for (let c = 2; c <= 7; c++) headerRow.getCell(c).border = { ...headerRow.getCell(c).border, top: { style: "medium" } };

  let row = 12;
  for (const [i, line] of lines.entries()) {
    const r = ws.getRow(row);
    r.getCell(1).value = i + 1;
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(2).value = "Перевозка грузов автомобильным транспортом";
    r.getCell(2).alignment = { vertical: "middle" };
    ws.mergeCells(`B${row}:D${row}`);
    r.getCell(5).value = line.massKg;
    r.getCell(5).numFmt = "#,##0.000";
    r.getCell(5).font = { size: 9 };
    r.getCell(5).alignment = { horizontal: "right", wrapText: true, vertical: "middle" };
    r.getCell(6).value = "кг";
    r.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(7).value = line.ratePerKg;
    r.getCell(7).alignment = { vertical: "middle" };
    r.getCell(8).value = line.cost;
    r.getCell(8).numFmt = "#,##0.00";
    r.getCell(8).alignment = { vertical: "middle" };
    r.font = { size: 10 };
    boxBorders(r, 1, 8);
    // Внешняя рамка таблицы толще (medium), как в оригинале.
    r.getCell(1).border = { ...r.getCell(1).border, left: { style: "medium" } };
    r.getCell(8).border = { ...r.getCell(8).border, right: { style: "medium" } };
    if (i === lines.length - 1) {
      for (let c = 1; c <= 8; c++) r.getCell(c).border = { ...r.getCell(c).border, bottom: { style: "medium" } };
    }
    row += 1;
  }

  const lastData = row - 1;
  const total = round2(lines.reduce((sum, l) => sum + l.cost, 0));

  ws.getCell(`G${lastData + 2}`).value = "Итого:";
  ws.getCell(`G${lastData + 2}`).font = { bold: true, size: 10 };
  ws.getCell(`G${lastData + 2}`).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(`H${lastData + 2}`).value = total;
  ws.getCell(`H${lastData + 2}`).numFmt = "#,##0.00";
  ws.getCell(`H${lastData + 2}`).font = { size: 10 };
  ws.getCell(`H${lastData + 2}`).alignment = { vertical: "middle" };

  ws.getCell(`G${lastData + 3}`).value = "Итого в денежном эквиваленте:";
  ws.getCell(`G${lastData + 3}`).font = { bold: true, size: 10 };
  ws.getCell(`G${lastData + 3}`).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(`H${lastData + 3}`).value = total;
  ws.getCell(`H${lastData + 3}`).numFmt = "#,##0.00";
  ws.getCell(`H${lastData + 3}`).font = { size: 10 };
  ws.getCell(`H${lastData + 3}`).alignment = { vertical: "middle" };

  ws.mergeCells(`F${lastData + 4}:G${lastData + 4}`);
  ws.getCell(`F${lastData + 4}`).value = "Без налога (НДС)";
  ws.getCell(`F${lastData + 4}`).font = { bold: true, size: 10 };
  ws.getCell(`F${lastData + 4}`).alignment = { horizontal: "right", vertical: "middle" };
  ws.getCell(`H${lastData + 4}`).value = "-";
  ws.getCell(`H${lastData + 4}`).font = { size: 10 };
  ws.getCell(`H${lastData + 4}`).alignment = { horizontal: "right", vertical: "middle" };

  ws.mergeCells(`A${lastData + 5}:C${lastData + 5}`);
  ws.getCell(`A${lastData + 5}`).value = `Всего наименований ${lines.length}, на сумму `;
  ws.getCell(`A${lastData + 5}`).font = { size: 10 };
  ws.getCell(`A${lastData + 5}`).alignment = { vertical: "middle" };
  ws.getCell(`D${lastData + 5}`).value = total;
  ws.getCell(`D${lastData + 5}`).numFmt = `#,##0.00" руб."`;
  ws.getCell(`D${lastData + 5}`).font = { size: 10 };
  ws.getCell(`D${lastData + 5}`).alignment = { vertical: "middle" };

  ws.getCell(`A${lastData + 6}`).value = rublesInWords(total);
  ws.getCell(`A${lastData + 6}`).font = { bold: true, size: 10 };
  ws.getCell(`A${lastData + 6}`).alignment = { vertical: "middle" };

  ws.mergeCells(`A${lastData + 8}:H${lastData + 8}`);
  ws.getCell(`A${lastData + 8}`).value =
    "Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.";
  ws.getCell(`A${lastData + 8}`).font = { size: 10 };
  ws.getCell(`A${lastData + 8}`).alignment = { wrapText: true, vertical: "middle" };
  for (let c = 1; c <= 8; c++) ws.getRow(lastData + 9).getCell(c).border = { top: { style: "medium" } };

  ws.mergeCells(`A${lastData + 10}:C${lastData + 10}`);
  ws.getCell(`A${lastData + 10}`).value = "ИСПОЛНИТЕЛЬ";
  ws.getCell(`A${lastData + 10}`).font = { bold: true, size: 12 };
  ws.getCell(`A${lastData + 10}`).alignment = { vertical: "middle" };
  ws.mergeCells(`F${lastData + 10}:H${lastData + 10}`);
  ws.getCell(`F${lastData + 10}`).value = "ЗАКАЗЧИК";
  ws.getCell(`F${lastData + 10}`).font = { bold: true, size: 12 };
  ws.getCell(`F${lastData + 10}`).alignment = { vertical: "middle" };

  ws.mergeCells(`A${lastData + 11}:C${lastData + 11}`);
  ws.getCell(`A${lastData + 11}`).value = ctx.supplier?.shortName || ctx.supplier?.name || "";
  ws.getCell(`A${lastData + 11}`).font = { size: 11 };
  ws.getCell(`A${lastData + 11}`).alignment = { vertical: "top" };
  ws.mergeCells(`F${lastData + 11}:G${lastData + 11}`);
  ws.getCell(`F${lastData + 11}`).value = ctx.buyer?.name ?? "";
  ws.getCell(`F${lastData + 11}`).font = { size: 11 };
  ws.getCell(`F${lastData + 11}`).alignment = { vertical: "top" };

  // Линии для подписи — под обеими сторонами; подписанное имя проставлено
  // только у исполнителя (заказчик расписывается сам, поле пустое).
  for (let c = 1; c <= 4; c++) ws.getRow(lastData + 12).getCell(c).border = { bottom: { style: "thin" } };
  for (let c = 6; c <= 8; c++) ws.getRow(lastData + 12).getCell(c).border = { bottom: { style: "thin" } };

  ws.mergeCells(`A${lastData + 13}:D${lastData + 13}`);
  ws.getCell(`A${lastData + 13}`).value = (ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "");
  ws.getCell(`A${lastData + 13}`).font = { size: 8 };
  ws.getCell(`A${lastData + 13}`).alignment = { horizontal: "center", vertical: "top" };

  backfillDefaultFont(ws);
  setPrintSetup(ws, `A1:H${lastData + 13}`);
  return workbook;
}

/** Счёт за месяц — те же строки по тарифу, что в итоговом акте, плюс
 * банковские реквизиты и срок оплаты (как "Счёт за Июль.xlsx"). */
export function buildInvoiceWorkbook(
  lines: MonthSummaryLine[],
  ctx: OrgContext,
  info: { invoiceNumber: string; invoiceDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Счёт");
  ws.columns = [
    { width: 7.5 }, { width: 15.3 }, { width: 7.5 }, { width: 24.5 },
    { width: 13.5 }, { width: 9.3 }, { width: 13.7 }, { width: 16 }, { width: 14.5 },
  ];

  ws.mergeCells("A1:D1");
  ws.getCell("A1").value = ctx.supplier?.bankName ?? "";
  ws.getCell("A1").font = { size: 9 };
  ws.getCell("E1").value = "БИК";
  ws.getCell("E1").font = { size: 9 };
  ws.mergeCells("F1:H1");
  ws.getCell("F1").value = ctx.supplier?.bik ?? "";
  ws.getCell("F1").font = { size: 9 };

  ws.mergeCells("A2:D3");
  ws.getCell("A2").value = "Банк получателя";
  ws.getCell("A2").font = { size: 8 };
  ws.getCell("A2").alignment = { wrapText: true };
  ws.mergeCells("E2:E3");
  ws.getCell("E2").value = "Сч. №";
  ws.getCell("E2").font = { size: 9 };
  ws.mergeCells("F2:H3");
  ws.getCell("F2").value = ctx.supplier?.corrAccount ?? "";
  ws.getCell("F2").font = { size: 9 };

  ws.getCell("A4").value = "ИНН";
  ws.getCell("A4").font = { size: 9 };
  ws.getCell("B4").value = ctx.supplier?.inn ?? "";
  ws.getCell("B4").font = { size: 9 };
  ws.mergeCells("C4:D4");
  ws.getCell("C4").value = "КПП";
  ws.getCell("C4").font = { size: 9 };
  ws.mergeCells("E4:E7");
  ws.getCell("E4").value = "Сч. №";
  ws.getCell("E4").font = { size: 9 };
  ws.mergeCells("F4:H7");
  ws.getCell("F4").value = ctx.supplier?.bankAccount ?? "";
  ws.getCell("F4").font = { size: 9 };

  ws.mergeCells("A5:D6");
  ws.getCell("A5").value = ctx.supplier?.name ? expandIp(ctx.supplier.name) : "";
  ws.getCell("A5").font = { size: 9 };
  ws.mergeCells("A7:D7");
  ws.getCell("A7").value = "Получатель";
  ws.getCell("A7").font = { size: 8 };

  // Сетка тонких рамок вокруг банковских реквизитов — как в оригинале.
  for (const range of ["A1:D1", "E1:E1", "F1:H1", "A2:D3", "E2:E3", "F2:H3", "A4:A4", "B4:B4", "C4:D4", "E4:E7", "F4:H7", "A5:D6", "A7:D7"]) {
    borderRange(ws, range);
  }
  ws.getRow(3).height = 5.25;

  ws.mergeCells("A9:F10");
  ws.getCell("A9").value = `Счет на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate)} г.`;
  ws.getCell("A9").font = { bold: true, size: 14 };
  ws.getCell("A9").alignment = { wrapText: true };
  // Линия-разделитель под шапкой (банк + заголовок) — как в оригинале.
  for (let c = 1; c <= 8; c++) ws.getRow(11).getCell(c).border = { bottom: { style: "thin" } };
  ws.getRow(11).height = 6;

  ws.mergeCells("A13:B13");
  ws.getCell("A13").value = "Поставщик                    (Исполнитель):";
  ws.getCell("A13").font = { size: 9 };
  ws.getCell("A13").alignment = { wrapText: true };
  ws.mergeCells("C13:H13");
  ws.getCell("C13").value = ctx.supplier?.invoiceSupplierLine || supplierBlockText(ctx.supplier);
  ws.getCell("C13").font = { bold: true, size: 9 };
  ws.getCell("C13").alignment = { wrapText: true };
  ws.getRow(13).height = 33;

  ws.mergeCells("A14:B15");
  ws.getCell("A14").value = "Покупатель                    (Заказчик):";
  ws.getCell("A14").font = { size: 9 };
  ws.getCell("A14").alignment = { wrapText: true };
  ws.mergeCells("C14:H15");
  ws.getCell("C14").value = buyerBlockText(ctx.buyer);
  ws.getCell("C14").font = { bold: true, size: 9 };
  ws.getCell("C14").alignment = { wrapText: true };
  ws.getRow(15).height = 26.25;

  ws.mergeCells("A17:B17");
  ws.getCell("A17").value = "Основание:";
  ws.getCell("A17").font = { size: 9 };
  ws.mergeCells("C17:H18");
  ws.getCell("C17").value = [contractNumberLine(ctx.supplier), contractIgkLine(ctx.supplier)].filter(Boolean).join(" ");
  ws.getCell("C17").font = { bold: true, size: 9 };
  ws.getCell("C17").alignment = { wrapText: true };
  ws.getRow(18).height = 11.25;

  const headerRow = ws.getRow(20);
  headerRow.getCell(1).value = "№";
  headerRow.getCell(2).value = "Товары (работы, услуги)";
  headerRow.getCell(5).value = "Кол-во";
  headerRow.getCell(6).value = "Ед.";
  headerRow.getCell(7).value = "Цена";
  headerRow.getCell(8).value = "Сумма";
  headerRow.getCell(9).value = "Денежный эквивалент";
  headerRow.font = { bold: true, size: 9 };
  headerRow.eachCell((c) => (c.alignment = { wrapText: true, horizontal: "center" }));
  ws.mergeCells("B20:D20");
  boxBorders(headerRow, 1, 9);
  headerRow.height = 29.1;

  let row = 21;
  for (const [i, line] of lines.entries()) {
    const r = ws.getRow(row);
    const service = `Перевозка груза с ${formatDateShort(parseDateKey(line.minDate))} по ${formatDateShort(parseDateKey(line.maxDate))}`;
    r.getCell(1).value = i + 1;
    r.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(2).value = service;
    r.getCell(2).alignment = { vertical: "middle" };
    ws.mergeCells(`B${row}:D${row}`);
    r.getCell(5).value = line.massKg;
    r.getCell(5).numFmt = "#,##0.000";
    r.getCell(5).alignment = { vertical: "middle" };
    r.getCell(6).value = "кг";
    r.getCell(6).alignment = { horizontal: "center", vertical: "middle" };
    r.getCell(7).value = line.ratePerKg;
    r.getCell(7).alignment = { vertical: "middle" };
    r.getCell(8).value = line.cost;
    r.getCell(8).numFmt = "#,##0.00";
    r.getCell(8).alignment = { vertical: "middle" };
    r.getCell(9).value = line.cost;
    r.getCell(9).numFmt = "#,##0.00";
    r.getCell(9).alignment = { vertical: "middle" };
    r.font = { size: 9 };
    boxBorders(r, 1, 9);
    r.getCell(9).border = { ...r.getCell(9).border, right: { style: "medium" } };
    row += 1;
  }

  const lastData = row - 1;
  const total = round2(lines.reduce((sum, l) => sum + l.cost, 0));

  ws.getCell(`G${lastData + 2}`).value = "Итого:";
  ws.getCell(`G${lastData + 2}`).font = { bold: true, size: 9 };
  ws.getCell(`G${lastData + 2}`).alignment = { horizontal: "right" };
  ws.getRow(lastData + 2).height = 41.1;
  ws.getCell(`H${lastData + 2}`).value = total;
  ws.getCell(`H${lastData + 2}`).numFmt = "#,##0.00";
  ws.getCell(`H${lastData + 2}`).font = { bold: true, size: 9 };
  ws.getCell(`I${lastData + 2}`).value = total;
  ws.getCell(`I${lastData + 2}`).numFmt = "#,##0.00";
  ws.getCell(`I${lastData + 2}`).font = { size: 9 };

  ws.getCell(`G${lastData + 3}`).value = "Без налога (НДС)";
  ws.getCell(`G${lastData + 3}`).font = { bold: true, size: 9 };
  ws.getCell(`G${lastData + 3}`).alignment = { horizontal: "right" };
  ws.getCell(`H${lastData + 3}`).value = "-";
  ws.getCell(`H${lastData + 3}`).font = { bold: true, size: 9 };
  ws.getCell(`I${lastData + 3}`).value = "-";
  ws.getCell(`I${lastData + 3}`).font = { size: 9 };

  ws.getCell(`G${lastData + 4}`).value = "Всего к оплате:";
  ws.getCell(`G${lastData + 4}`).font = { bold: true, size: 9 };
  ws.getCell(`G${lastData + 4}`).alignment = { horizontal: "right" };
  ws.getCell(`H${lastData + 4}`).value = total;
  ws.getCell(`H${lastData + 4}`).numFmt = "#,##0.00";
  ws.getCell(`H${lastData + 4}`).font = { bold: true, size: 9 };
  ws.getCell(`I${lastData + 4}`).value = total;
  ws.getCell(`I${lastData + 4}`).numFmt = "#,##0.00";
  ws.getCell(`I${lastData + 4}`).font = { size: 9 };

  ws.mergeCells(`A${lastData + 5}:C${lastData + 5}`);
  ws.getCell(`A${lastData + 5}`).value = `Всего наименований ${lines.length}, на сумму `;
  ws.getCell(`A${lastData + 5}`).font = { size: 9 };
  ws.getCell(`D${lastData + 5}`).value = `${total.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб.`;
  ws.getCell(`D${lastData + 5}`).font = { bold: true, size: 11 };
  ws.getCell(`E${lastData + 5}`).value = total;
  ws.getCell(`E${lastData + 5}`).numFmt = "#,##0.00";
  ws.getCell(`E${lastData + 5}`).font = { size: 11, color: { argb: "FFFFFFFF" } };

  ws.getCell(`A${lastData + 6}`).value = rublesInWords(total);
  ws.getCell(`A${lastData + 6}`).font = { bold: true, size: 9 };

  const payBy = new Date(info.invoiceDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  ws.mergeCells(`A${lastData + 8}:H${lastData + 8}`);
  ws.getCell(`A${lastData + 8}`).value = `Оплатить не позднее ${formatDatePadded(payBy)}`;
  ws.getCell(`A${lastData + 8}`).font = { size: 9, name: "Arial" };
  ws.getCell(`A${lastData + 8}`).alignment = { wrapText: true, vertical: "middle" };

  ws.mergeCells(`A${lastData + 9}:H${lastData + 9}`);
  ws.getCell(`A${lastData + 9}`).value = "Оплата данного счета означает согласие с условиями поставки товара.";
  ws.getCell(`A${lastData + 9}`).font = { size: 9, name: "Arial" };
  ws.getCell(`A${lastData + 9}`).alignment = { wrapText: true, vertical: "top" };

  ws.mergeCells(`A${lastData + 10}:H${lastData + 10}`);
  ws.getCell(`A${lastData + 10}`).value = "Уведомление об оплате обязательно, в противном случае не гарантируется наличие товара на складе.";
  ws.getCell(`A${lastData + 10}`).font = { size: 9, name: "Arial" };
  ws.getCell(`A${lastData + 10}`).alignment = { wrapText: true, vertical: "top" };

  ws.mergeCells(`A${lastData + 11}:H${lastData + 11}`);
  ws.getCell(`A${lastData + 11}`).value = "Товар отпускается по факту прихода денег на р/с Поставщика, самовывозом, при наличии доверенности и паспорта";
  ws.getCell(`A${lastData + 11}`).font = { size: 9 };
  ws.getCell(`A${lastData + 11}`).alignment = { wrapText: true, vertical: "top" };

  ws.mergeCells(`A${lastData + 13}:B${lastData + 13}`);
  ws.getCell(`A${lastData + 13}`).value = "Предприниматель";
  ws.getCell(`A${lastData + 13}`).font = { bold: true, size: 9 };
  ws.getCell(`A${lastData + 13}`).alignment = { vertical: "top" };
  ws.getCell(`A${lastData + 13}`).border = { top: { style: "thin" } };
  ws.getCell(`I${lastData + 13}`).value = (ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "");
  ws.getCell(`I${lastData + 13}`).font = { size: 11 };
  ws.getCell(`I${lastData + 13}`).border = { top: { style: "thin" }, bottom: { style: "thin" } };

  backfillDefaultFont(ws);
  setPrintSetup(ws, `A1:I${lastData + 13}`);
  return workbook;
}
