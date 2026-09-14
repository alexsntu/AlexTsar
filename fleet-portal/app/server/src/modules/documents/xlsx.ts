import ExcelJS from "exceljs";
import type { OrgProfile } from "@prisma/client";
import { round2 } from "../../lib/money.js";
import { rublesInWords } from "./sumInWords.js";
import type { DayAct, MonthSummaryLine } from "./queries.js";

import { createDocumentSheet } from "./layout.js";

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

function setRowValues(sheet: ExcelJS.Worksheet, row: number, values: ExcelJS.CellValue[]) {
  values.forEach((value, index) => { sheet.getRow(row).getCell(index + 1).value = value; });
}

/** Reference layout is applied first; these builders only supply current values. */
export function addDayActSheet(workbook: ExcelJS.Workbook, dayAct: DayAct, ctx: OrgContext, sheetName?: string): ExcelJS.Worksheet {
  const ws = createDocumentSheet(workbook, sheetName ?? `Акт ${dayAct.actNumber}`, "day", dayAct.lines.length, dayAct.actNumber);
  ws.getCell("A1").value = { richText: [
    { text: "                               " },
    { font: { name: "Calibri", size: 16, bold: true, family: 2, charset: 204, scheme: "minor", color: { theme: 1 } }, text: ` Акт выполненных работ №${dayAct.actNumber} от ${formatDateLong(parseDateKey(dayAct.date))} года` },
  ] };
  ws.getCell("A3").value = "Исполнитель:";
  ws.getCell("C3").value = supplierBlockText(ctx.supplier, false);
  ws.getCell("A7").value = "Заказчик:";
  ws.getCell("C7").value = buyerBlockText(ctx.buyer);
  ws.getCell("A12").value = "Основание:";
  ws.getCell("C12").value = contractNumberLine(ctx.supplier);
  ws.getCell("C13").value = ctx.supplier?.contractIgk ? `Идентификатор государственного контракта (ИГК) -${ctx.supplier.contractIgk}` : "";
  setRowValues(ws, 14, ["№", "Наименование услуг", "Точка отправки, наименование и № подразделения", " Точка доставки, наименование и № подразделения", "Марка., гос. рег. знак ТС", "Стоимость услуги за 1кг. руб.", "Количество кг.", "Сумма"]);
  dayAct.lines.forEach((line, index) => {
    setRowValues(ws, 15 + index, [line.index, line.service, line.dispatchPoint, line.deliveryAddress, line.truckPlate, line.ratePerKg, line.massKg, line.cost]);
  });
  const last = 14 + Math.max(1, dayAct.lines.length);
  ws.getCell(`F${last + 2}`).value = "ИТОГО:";
  ws.getCell(`G${last + 2}`).value = dayAct.totalCost;
  ws.getCell(`F${last + 4}`).value = "Без налога (НДС)";
  ws.getCell(`B${last + 6}`).value = `Всего оказано услуг ${dayAct.lines.length}, на сумму ${dayAct.totalCost.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} руб.`;
  ws.getCell(`B${last + 7}`).value = rublesInWords(dayAct.totalCost);
  ws.getCell(`B${last + 9}`).value = SERVICES_COMPLETE;
  ws.getCell(`C${last + 13}`).value = "ИСПОЛНИТЕЛЬ";
  ws.getCell(`F${last + 13}`).value = "ЗАКАЗЧИК";
  ws.getCell(`C${last + 14}`).value = ctx.supplier?.shortName || ctx.supplier?.name || "";
  ws.getCell(`F${last + 14}`).value = ctx.buyer?.name ?? "";
  ws.getCell(`C${last + 18}`).value = "___________________";
  ws.getCell(`F${last + 18}`).value = "______________________";
  return ws;
}

const SERVICES_COMPLETE = "Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.";

export function buildDayActWorkbook(dayAct: DayAct, ctx: OrgContext): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  addDayActSheet(workbook, dayAct, ctx);
  return workbook;
}

export function buildMonthActsWorkbook(dayActs: DayAct[], ctx: OrgContext): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  for (const act of dayActs) addDayActSheet(workbook, act, ctx, `Акт №${act.actNumber} ${act.date}`.slice(0, 31));
  return workbook;
}

export function buildRegistryWorkbook(dayActs: DayAct[], ctx: OrgContext, info: { yearMonth: string; invoiceNumber: string; invoiceDate: Date }): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = createDocumentSheet(workbook, "Реестр", "registry", dayActs.length);
  const [year, month] = info.yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const font = { name: "Calibri (Основной текст)", charset: 204, color: { theme: 1 } };
  ws.getCell("A1").value = { richText: [
    { font: { ...font, size: 14, bold: true }, text: "                                                                 " },
    { font: { ...font, size: 20, bold: true }, text: " РЕЕСТР ДОКУМЕНТОВ" },
    { font: { name: "Calibri", size: 20, family: 2, charset: 204, scheme: "minor", color: { theme: 1 } }, text: ": 1" },
    { font: { ...font, size: 20 }, text: `-${lastDay} ${RU_MONTHS_GENITIVE[month - 1].toLowerCase()} ${year} года` },
    { font: { ...font, size: 12 }, text: "\n            " },
    { font: { ...font, size: 14 }, text:
      `Наименование контрагента: ${ctx.supplier?.name ? expandIp(ctx.supplier.name) : ""}\n` +
      `            ИНН контрагента: ${ctx.supplier?.inn ?? ""}\n` +
      `            Договор на поставку товара/оказание услуг: Договор №${ctx.supplier?.contractNumber ?? ""} на оказание услуг по перевозке груза от ${ctx.supplier?.contractDate ? formatDateLong(ctx.supplier.contractDate).toLowerCase() : ""} года\n` +
      `            Наименование товара/услуг: транспортные услуги с 1.${pad2(month)}.${year} по ${lastDay}.${pad2(month)}.${year}\n` +
      `           Реестр документов реализации товаров/услуг за период с 1.${pad2(month)}.${year} по ${lastDay}.${pad2(month)}.${year}\n` +
      `           По договору № ${ctx.supplier?.contractNumber ?? ""} от ${ctx.supplier?.contractDate ? formatDatePadded(ctx.supplier.contractDate) : ""} года заключённому между ${ctx.supplier?.shortName || ctx.supplier?.name || ""} и ${ctx.buyer?.name ?? ""}\n` +
      `           Счёт на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate).toLowerCase()} года ` },
    { font: { name: "Calibri", size: 12, family: 2, charset: 204, scheme: "minor", color: { theme: 1 } }, text: " " },
    { font: { ...font, size: 14, bold: true }, text: ctx.supplier?.contractIgk ? `ИГК-${ctx.supplier.contractIgk}` : "" },
  ] };
  setRowValues(ws, 13, [null, "№", "Наименование документа", "Дата документа", "Номер документа", "Сумма документа", "Сумма документа (НДС не облагается) в денежном эквиваленте"]);
  dayActs.forEach((act, index) => {
    setRowValues(ws, 14 + index, [null, act.actNumber, "                         АКТ", parseDateKey(act.date), act.actNumber, act.totalCost, round2(act.totalCost)]);
  });
  const last = 13 + Math.max(1, dayActs.length);
  const total = round2(dayActs.reduce((sum, a) => sum + a.totalCost, 0));
  ws.getCell(`B${last + 1}`).value = "ИТОГО:";
  ws.getCell(`C${last + 1}`).value = total;
  ws.getCell(`G${last + 1}`).value = total;
  ws.getCell(`B${last + 6}`).value = `Индивидуальный предприниматель: ${(ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "")} ____________________`;
  return workbook;
}

export function buildFinalActWorkbook(lines: MonthSummaryLine[], ctx: OrgContext, info: { finalActNumber: number; finalActDate: Date }): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = createDocumentSheet(workbook, "Акт", "final", lines.length);
  ws.getCell("A2").value = `Акт № ${info.finalActNumber} от ${formatDateLong(info.finalActDate)} г.`;
  ws.getCell("A5").value = "Исполнитель:";
  ws.getCell("C5").value = supplierBlockText(ctx.supplier, true);
  ws.getCell("A6").value = "Заказчик:";
  ws.getCell("C6").value = buyerBlockText(ctx.buyer);
  ws.getCell("A8").value = "Основание:";
  ws.getCell("C8").value = [contractNumberLine(ctx.supplier), contractIgkLine(ctx.supplier)].filter(Boolean).join("\n");
  for (const [column, value] of Object.entries({ A: "№", B: "Наименование работ, услуг", E: "Кол-во", F: "Ед.", G: "Цена", H: "Сумма" })) ws.getCell(`${column}11`).value = value;
  lines.forEach((line, i) => {
    const row = 12 + i;
    for (const [column, value] of Object.entries({ A: i + 1, B: "Перевозка грузов автомобильным транспортом", E: line.massKg, F: "кг", G: line.ratePerKg, H: line.cost })) ws.getCell(`${column}${row}`).value = value;
  });
  const last = 11 + Math.max(1, lines.length);
  const total = round2(lines.reduce((sum, line) => sum + line.cost, 0));
  ws.getCell(`G${last + 2}`).value = "Итого:";
  ws.getCell(`H${last + 2}`).value = total;
  ws.getCell(`G${last + 3}`).value = "Итого в денежном эквиваленте:";
  ws.getCell(`H${last + 3}`).value = total;
  ws.getCell(`F${last + 4}`).value = "Без налога (НДС)";
  ws.getCell(`H${last + 4}`).value = "-";
  ws.getCell(`A${last + 5}`).value = `Всего наименований ${lines.length}, на сумму `;
  ws.getCell(`D${last + 5}`).value = total;
  ws.getCell(`A${last + 6}`).value = rublesInWords(total);
  ws.getCell(`A${last + 8}`).value = SERVICES_COMPLETE;
  ws.getCell(`A${last + 10}`).value = "ИСПОЛНИТЕЛЬ";
  ws.getCell(`F${last + 10}`).value = "ЗАКАЗЧИК";
  ws.getCell(`A${last + 11}`).value = ctx.supplier?.shortName || ctx.supplier?.name || "";
  ws.getCell(`F${last + 11}`).value = ctx.buyer?.name ?? "";
  ws.getCell(`A${last + 13}`).value = (ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "");
  return workbook;
}

export function buildInvoiceWorkbook(lines: MonthSummaryLine[], ctx: OrgContext, info: { invoiceNumber: string; invoiceDate: Date }): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const ws = createDocumentSheet(workbook, "Счёт", "invoice", lines.length);
  const header: Record<string, string> = {
    A1: ctx.supplier?.bankName ?? "", E1: "БИК", F1: ctx.supplier?.bik ?? "",
    A2: "Банк получателя", E2: "Сч. №", F2: ctx.supplier?.corrAccount ?? "",
    A4: "ИНН", B4: ctx.supplier?.inn ?? "", C4: "КПП", E4: "Сч. №", F4: ctx.supplier?.bankAccount ?? "",
    A5: ctx.supplier?.name ? expandIp(ctx.supplier.name) : "", A7: "Получатель",
    A9: `Счет на оплату №${info.invoiceNumber} от ${formatDateLong(info.invoiceDate)} г.`,
    A13: "Поставщик                    (Исполнитель):", C13: ctx.supplier?.invoiceSupplierLine || supplierBlockText(ctx.supplier),
    A14: "Покупатель                    (Заказчик):", C14: buyerBlockText(ctx.buyer) + "\n",
    A17: "Основание:", C17: [contractNumberLine(ctx.supplier), contractIgkLine(ctx.supplier)].filter(Boolean).join(" "),
    A20: "№", B20: "Товары (работы, услуги)", E20: "Кол-во", F20: "Ед.", G20: "Цена", H20: "Сумма", I20: "Денежный эквивалент",
  };
  for (const [cell, value] of Object.entries(header)) ws.getCell(cell).value = value;
  lines.forEach((line, i) => {
    const row = 21 + i;
    const service = `Перевозка груза с ${formatDateShort(parseDateKey(line.minDate))} по ${formatDateShort(parseDateKey(line.maxDate))}`;
    for (const [column, value] of Object.entries({ A: i + 1, B: service, E: line.massKg, F: "кг", G: line.ratePerKg, H: line.cost, I: line.cost })) ws.getCell(`${column}${row}`).value = value;
  });
  const last = 20 + Math.max(1, lines.length);
  const total = round2(lines.reduce((sum, line) => sum + line.cost, 0));
  for (const [offset, label, value] of [[2, "Итого:", total], [3, "Без налога (НДС)", "-"], [4, "Всего к оплате:", total]] as const) {
    ws.getCell(`G${last + offset}`).value = label;
    ws.getCell(`H${last + offset}`).value = value;
    ws.getCell(`I${last + offset}`).value = value;
  }
  ws.getCell(`A${last + 5}`).value = `Всего наименований ${lines.length}, на сумму `;
  ws.getCell(`D${last + 5}`).value = `${total.toFixed(2).replace(".", ",")} руб.`;
  ws.getCell(`E${last + 5}`).value = total;
  ws.getCell(`A${last + 6}`).value = rublesInWords(total);
  const payBy = new Date(info.invoiceDate.getTime() + 6 * 24 * 60 * 60 * 1000);
  ws.getCell(`A${last + 8}`).value = `Оплатить не позднее ${formatDatePadded(payBy)}`;
  ws.getCell(`A${last + 9}`).value = "Оплата данного счета означает согласие с условиями поставки товара.";
  ws.getCell(`A${last + 10}`).value = "Уведомление об оплате обязательно, в противном случае не гарантируется наличие товара на складе.";
  ws.getCell(`A${last + 11}`).value = "Товар отпускается по факту прихода денег на р/с Поставщика, самовывозом, при наличии доверенности и паспорта";
  ws.getCell(`A${last + 13}`).value = "Предприниматель";
  ws.getCell(`I${last + 13}`).value = (ctx.supplier?.shortName || ctx.supplier?.name || "").replace(/^ИП\s+/, "");
  return workbook;
}
