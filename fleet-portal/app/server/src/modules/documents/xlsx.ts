import ExcelJS from "exceljs";
import type { OrgProfile } from "@prisma/client";
import { round2 } from "../../lib/money.js";
import { rublesInWords } from "./sumInWords.js";
import type { DayAct, MonthSummaryLine } from "./queries.js";

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

/** "1.07.2026" — диапазоны дат в позициях счёта. */
function formatDateShort(date: Date): string {
  return `${date.getUTCDate()}.${pad2(date.getUTCMonth() + 1)}.${date.getUTCFullYear()}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

const MONEY_FORMAT = "#,##0.00";
const MASS_FORMAT = "#,##0.###";

function styleTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "thin" } };
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
}

function styleDataRow(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.border = { bottom: { style: "hair" } };
  });
}

function supplierBlockText(supplier: OrgProfile | null): string {
  if (!supplier) return "";
  const bank = [supplier.bankAccount && `р/с ${supplier.bankAccount}`, supplier.bankName && `в банке ${supplier.bankName}`, supplier.bik && `БИК ${supplier.bik}`, supplier.corrAccount && `к/с ${supplier.corrAccount}`]
    .filter(Boolean)
    .join(", ");
  return [
    `${supplier.name}, ИНН ${supplier.inn}`,
    supplier.legalAddress,
    supplier.phone && `тел.: ${supplier.phone}`,
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

function contractBasisText(supplier: OrgProfile | null): string {
  if (!supplier?.contractNumber) return "";
  const dateStr = supplier.contractDate ? formatDateShort(supplier.contractDate) : "";
  const lines = [`Договор № ${supplier.contractNumber}${dateStr ? ` от ${dateStr} г.` : ""}`];
  if (supplier.contractIgk) lines.push(`Идентификатор государственного контракта (ИГК) – ${supplier.contractIgk}`);
  return lines.join("\n");
}

export interface OrgContext {
  supplier: OrgProfile | null;
  buyer: OrgProfile | null;
}

/** Общая шапка акта (Исполнитель/Заказчик/Основание) — используется и для
 * дневного акта, и для итогового акта за месяц. Возвращает номер строки, с
 * которой можно начинать таблицу позиций. */
function writeActHeader(ws: ExcelJS.Worksheet, title: string, ctx: OrgContext): number {
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { bold: true, size: 13 };

  ws.getCell("A3").value = "Исполнитель:";
  ws.getCell("C3").value = supplierBlockText(ctx.supplier);
  ws.getCell("C3").alignment = { wrapText: true };

  ws.getCell("A5").value = "Заказчик:";
  ws.getCell("C5").value = buyerBlockText(ctx.buyer);
  ws.getCell("C5").alignment = { wrapText: true };

  const basis = contractBasisText(ctx.supplier);
  if (basis) {
    ws.getCell("A7").value = "Основание:";
    ws.getCell("C7").value = basis;
    ws.getCell("C7").alignment = { wrapText: true };
  }

  return 10;
}

function writeActFooter(ws: ExcelJS.Worksheet, row: number, count: number, total: number, ctx: OrgContext, moneyColumn: "G" | "H" = "H") {
  ws.getCell(`F${row}`).value = "ИТОГО:";
  ws.getCell(`F${row}`).font = { bold: true };
  ws.getCell(`${moneyColumn}${row}`).value = total;
  ws.getCell(`${moneyColumn}${row}`).numFmt = MONEY_FORMAT;
  ws.getCell(`${moneyColumn}${row}`).font = { bold: true };

  ws.getCell(`F${row + 2}`).value = "Без налога (НДС)";
  ws.getCell(`${moneyColumn}${row + 2}`).value = "-";

  ws.getCell(`B${row + 4}`).value = `Всего оказано услуг ${count}, на сумму ${total.toLocaleString("ru-RU", { minimumFractionDigits: 2 })} руб.`;
  ws.getCell(`B${row + 5}`).value = rublesInWords(total);

  ws.getCell(`B${row + 7}`).value =
    "Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.";

  ws.getCell(`C${row + 11}`).value = "ИСПОЛНИТЕЛЬ";
  ws.getCell(`F${row + 11}`).value = "ЗАКАЗЧИК";
  ws.getCell(`C${row + 12}`).value = ctx.supplier?.name ?? "";
  ws.getCell(`F${row + 12}`).value = ctx.buyer?.name ?? "";
}

/** Дневной акт (по рейсам) — как "Акт выполненных работ №N от [дата]". */
export function addDayActSheet(workbook: ExcelJS.Workbook, dayAct: DayAct, ctx: OrgContext, sheetName?: string): ExcelJS.Worksheet {
  const ws = workbook.addWorksheet(sheetName ?? `Акт ${dayAct.actNumber}`);
  ws.columns = [
    { width: 5 }, { width: 22 }, { width: 26 }, { width: 30 },
    { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 },
  ];

  const title = `Акт выполненных работ №${dayAct.actNumber} от ${formatDateLong(parseDateKey(dayAct.date))} года`;
  const startRow = writeActHeader(ws, title, ctx);

  const headerRow = ws.getRow(startRow);
  headerRow.values = [
    "№", "Наименование услуг", "Точка отправки, наименование и № подразделения",
    "Точка доставки, наименование и № подразделения", "Марка., гос. рег. знак ТС",
    "Стоимость услуги за 1кг. руб.", "Количество кг.", "Сумма",
  ];
  styleTableHeader(headerRow);

  let row = startRow + 1;
  for (const line of dayAct.lines) {
    const r = ws.getRow(row);
    r.values = [line.index, line.service, line.dispatchPoint, line.deliveryAddress, line.truckPlate, line.ratePerKg, line.massKg, line.cost];
    r.getCell(6).numFmt = MONEY_FORMAT;
    r.getCell(7).numFmt = MASS_FORMAT;
    r.getCell(8).numFmt = MONEY_FORMAT;
    styleDataRow(r);
    row += 1;
  }

  writeActFooter(ws, row + 1, dayAct.lines.length, dayAct.totalCost, ctx);
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

/** Реестр документов за месяц — по одной строке на дневной акт. */
export function buildRegistryWorkbook(
  dayActs: DayAct[],
  ctx: OrgContext,
  info: { yearMonth: string; invoiceNumber: string; invoiceDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Реестр");
  ws.columns = [{ width: 4 }, { width: 4 }, { width: 22 }, { width: 14 }, { width: 12 }, { width: 16 }, { width: 22 }];

  const [year, month] = info.yearMonth.split("-").map(Number);
  const monthName = RU_MONTHS_GENITIVE[month - 1];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  ws.getCell("A1").value =
    `РЕЕСТР ДОКУМЕНТОВ: 1-${lastDay} ${monthName.toLowerCase()} ${year} года\n` +
    `Наименование контрагента: ${ctx.supplier?.name ?? ""}\n` +
    `ИНН контрагента: ${ctx.supplier?.inn ?? ""}\n` +
    `Договор на поставку товара/оказание услуг: Договор №${ctx.supplier?.contractNumber ?? ""} на оказание услуг по перевозке груза от ${
      ctx.supplier?.contractDate ? formatDateShort(ctx.supplier.contractDate) : ""
    } года\n` +
    `Реестр документов реализации товаров/услуг за период с 1.${pad2(month)}.${year} по ${lastDay}.${pad2(month)}.${year}\n` +
    `По договору № ${ctx.supplier?.contractNumber ?? ""} от ${ctx.supplier?.contractDate ? formatDateShort(ctx.supplier.contractDate) : ""} года заключённому между ${
      ctx.supplier?.name ?? ""
    } и ${ctx.buyer?.name ?? ""}\n` +
    `Счёт на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate)} года`;
  ws.getCell("A1").alignment = { wrapText: true };
  ws.getRow(1).height = 140;

  const headerRow = ws.getRow(13);
  headerRow.values = ["", "№", "Наименование документа", "Дата документа", "Номер документа", "Сумма документа", "Сумма документа (НДС не облагается) в денежном эквиваленте"];
  styleTableHeader(headerRow);

  let row = 14;
  for (const act of dayActs) {
    const r = ws.getRow(row);
    r.values = ["", act.actNumber, "АКТ", parseDateKey(act.date), act.actNumber, act.totalCost, round2(act.totalCost)];
    r.getCell(4).numFmt = "dd.mm.yyyy";
    r.getCell(6).numFmt = MONEY_FORMAT;
    r.getCell(7).numFmt = MONEY_FORMAT;
    styleDataRow(r);
    row += 1;
  }

  const grandTotal = round2(dayActs.reduce((sum, a) => sum + a.totalCost, 0));
  const totalRow = ws.getRow(row);
  totalRow.getCell(2).value = "ИТОГО:";
  totalRow.getCell(2).font = { bold: true };
  totalRow.getCell(3).value = grandTotal;
  totalRow.getCell(3).numFmt = MONEY_FORMAT;
  totalRow.getCell(7).value = grandTotal;
  totalRow.getCell(7).numFmt = MONEY_FORMAT;

  ws.getCell(`B${row + 5}`).value = `${ctx.supplier?.name ?? ""} ____________________`;

  return workbook;
}

/** Итоговый акт за месяц — сгруппирован по тарифу (как "Акт об оказании услуг №N"). */
export function buildFinalActWorkbook(
  lines: MonthSummaryLine[],
  ctx: OrgContext,
  info: { finalActNumber: number; finalActDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Акт");
  ws.columns = [{ width: 5 }, { width: 40 }, { width: 4 }, { width: 14 }, { width: 4 }, { width: 12 }, { width: 14 }];

  const title = `Акт № ${info.finalActNumber} от ${formatDateLong(info.finalActDate)} г.`;
  const startRow = writeActHeader(ws, title, ctx);

  const headerRow = ws.getRow(startRow);
  headerRow.values = ["№", "Наименование работ, услуг", "", "Кол-во", "Ед.", "Цена", "Сумма"];
  styleTableHeader(headerRow);

  let row = startRow + 1;
  for (const [i, line] of lines.entries()) {
    const r = ws.getRow(row);
    r.values = [i + 1, "Перевозка грузов автомобильным транспортом", "", line.massKg, "кг", line.ratePerKg, line.cost];
    r.getCell(4).numFmt = MASS_FORMAT;
    r.getCell(6).numFmt = MONEY_FORMAT;
    r.getCell(7).numFmt = MONEY_FORMAT;
    styleDataRow(r);
    row += 1;
  }

  const total = round2(lines.reduce((sum, l) => sum + l.cost, 0));
  writeActFooter(ws, row + 1, lines.length, total, ctx, "G");
  return workbook;
}

/** Счёт за месяц — те же строки по тарифу, что в итоговом акте, плюс
 * банковские реквизиты и срок оплаты. */
export function buildInvoiceWorkbook(
  lines: MonthSummaryLine[],
  ctx: OrgContext,
  info: { invoiceNumber: string; invoiceDate: Date },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Счёт");
  ws.columns = [{ width: 5 }, { width: 40 }, { width: 4 }, { width: 14 }, { width: 4 }, { width: 12 }, { width: 14 }, { width: 16 }];

  ws.getCell("A1").value = ctx.supplier?.bankName ?? "";
  ws.getCell("E1").value = "БИК";
  ws.getCell("F1").value = ctx.supplier?.bik ?? "";
  ws.getCell("E2").value = "Сч. №";
  ws.getCell("F2").value = ctx.supplier?.corrAccount ?? "";
  ws.getCell("A4").value = "ИНН";
  ws.getCell("B4").value = ctx.supplier?.inn ?? "";
  ws.getCell("E4").value = "Сч. №";
  ws.getCell("F4").value = ctx.supplier?.bankAccount ?? "";
  ws.getCell("A5").value = ctx.supplier?.name ?? "";
  ws.getCell("A7").value = "Получатель";

  ws.getCell("A9").value = `Счет на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate)} г.`;
  ws.getCell("A9").font = { bold: true, size: 13 };

  ws.getCell("A13").value = "Поставщик (Исполнитель):";
  ws.getCell("C13").value = supplierBlockText(ctx.supplier);
  ws.getCell("C13").alignment = { wrapText: true };
  ws.getCell("A14").value = "Покупатель (Заказчик):";
  ws.getCell("C14").value = buyerBlockText(ctx.buyer);
  ws.getCell("C14").alignment = { wrapText: true };
  const basis = contractBasisText(ctx.supplier);
  if (basis) {
    ws.getCell("A17").value = "Основание:";
    ws.getCell("C17").value = basis;
    ws.getCell("C17").alignment = { wrapText: true };
  }

  const headerRow = ws.getRow(20);
  headerRow.values = ["№", "Товары (работы, услуги)", "", "Кол-во", "Ед.", "Цена", "Сумма", "Денежный эквивалент"];
  styleTableHeader(headerRow);

  let row = 21;
  for (const [i, line] of lines.entries()) {
    const r = ws.getRow(row);
    const service = `Перевозка груза с ${formatDateShort(parseDateKey(line.minDate))} по ${formatDateShort(parseDateKey(line.maxDate))}`;
    r.values = [i + 1, service, "", line.massKg, "кг", line.ratePerKg, line.cost, line.cost];
    r.getCell(4).numFmt = MASS_FORMAT;
    r.getCell(6).numFmt = MONEY_FORMAT;
    r.getCell(7).numFmt = MONEY_FORMAT;
    r.getCell(8).numFmt = MONEY_FORMAT;
    styleDataRow(r);
    row += 1;
  }

  const total = round2(lines.reduce((sum, l) => sum + l.cost, 0));
  const totalRow = row + 1;
  ws.getCell(`F${totalRow}`).value = "Итого:";
  ws.getCell(`F${totalRow}`).font = { bold: true };
  ws.getCell(`G${totalRow}`).value = total;
  ws.getCell(`G${totalRow}`).numFmt = MONEY_FORMAT;
  ws.getCell(`G${totalRow}`).font = { bold: true };
  ws.getCell(`H${totalRow}`).value = total;
  ws.getCell(`H${totalRow}`).numFmt = MONEY_FORMAT;

  ws.getCell(`G${totalRow + 1}`).value = "Без налога (НДС)";
  ws.getCell(`H${totalRow + 1}`).value = "-";
  ws.getCell(`G${totalRow + 2}`).value = "Всего к оплате:";
  ws.getCell(`H${totalRow + 2}`).value = total;
  ws.getCell(`H${totalRow + 2}`).numFmt = MONEY_FORMAT;

  ws.getCell(`A${totalRow + 3}`).value = `Всего наименований ${lines.length}, на сумму `;
  ws.getCell(`E${totalRow + 3}`).value = total;
  ws.getCell(`E${totalRow + 3}`).numFmt = MONEY_FORMAT;
  ws.getCell(`A${totalRow + 4}`).value = rublesInWords(total);

  const payBy = new Date(info.invoiceDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  ws.getCell(`A${totalRow + 6}`).value = `Оплатить не позднее ${formatDateShort(payBy)}`;
  ws.getCell(`A${totalRow + 7}`).value = "Оплата данного счета означает согласие с условиями поставки товара.";

  ws.getCell(`I${totalRow + 10}`).value = ctx.supplier?.name ?? "";

  return workbook;
}
