import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { writeDocumentWorkbook } from "../src/modules/documents/layout.js";
import { buildDayActWorkbook, buildFinalActWorkbook, buildInvoiceWorkbook, buildRegistryWorkbook } from "../src/modules/documents/xlsx.js";
import type { DayAct, MonthSummaryLine } from "../src/modules/documents/queries.js";

const context = { supplier: null, buyer: null };
const date = new Date("2026-07-31T00:00:00Z");
const info = { yearMonth: "2026-07", invoiceNumber: "7", invoiceDate: date, finalActNumber: 25, finalActDate: date };
const makeLines = (count: number): MonthSummaryLine[] => Array.from({ length: count }, (_, i) => ({
  ratePerKg: i + 1, massKg: 1234.567, cost: 1234.57 * (i + 1), minDate: "2026-07-01", maxDate: "2026-07-31",
}));
const makeAct = (count: number, actNumber = 1): DayAct => ({
  date: "2026-07-01", actNumber, totalCost: count * 1234.57, totalMassKg: count * 1234.567,
  lines: Array.from({ length: count }, (_, i) => ({ index: i + 1, service: "Перевозка груза", dispatchPoint: "Пункт отправки", deliveryAddress: "Адрес доставки", truckPlate: "А001АА", ratePerKg: 1, massKg: 1234.567, cost: 1234.57 })),
});
async function reopen(workbook: ExcelJS.Workbook) {
  const saved = new ExcelJS.Workbook();
  await saved.xlsx.load(await writeDocumentWorkbook(workbook));
  return saved.worksheets[0];
}

describe("оформление документов после сохранения XLSX", () => {
  it("сохраняет базовый шрифт реестра, от которого зависит ширина колонок при печати", async () => {
    const zip = await JSZip.loadAsync(await writeDocumentWorkbook(buildRegistryWorkbook([makeAct(1)], context, info)));
    const xml = await zip.file("xl/styles.xml")!.async("string");
    const normalFont = xml.match(/<font>.*?<\/font>/)![0];
    expect(normalFont).toContain('<sz val="12"');
    expect(normalFont).toContain('<name val="Calibri"');
  });
  it("сохраняет автоматическую высоту строк исходного Excel, а не только её числовое значение", async () => {
    const zip = await JSZip.loadAsync(await writeDocumentWorkbook(buildDayActWorkbook(makeAct(9), context)));
    const xml = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    const row15 = xml.match(/<row\b[^>]*\br="15"[^>]*>/)![0];
    expect(row15).toContain('ht="45"');
    expect(row15).not.toContain("customHeight");
    const row14 = xml.match(/<row\b[^>]*\br="14"[^>]*>/)![0];
    expect(row14).toContain('customHeight="1"');
  });
  it("сохраняет шрифты, рамки и числовые форматы после подстановки строк дневного акта", async () => {
    const sheet = await reopen(buildDayActWorkbook(makeAct(9), context));
    expect(sheet.getCell("A14").font).toMatchObject({ name: "Arial", size: 11, bold: true });
    expect(sheet.getCell("D15").font.name).toBe("Calibri");
    expect(sheet.getCell("D15").alignment.wrapText).toBe(true);
    expect(sheet.getCell("D15").border.bottom?.style).toBe("thin");
    expect(sheet.getCell("G15").numFmt).toBe("0.000");
    expect(sheet.getCell("H15").numFmt).toBe("0.00");
    expect(sheet.getColumn(3).width).toBe(20.7109375);
    expect(sheet.pageSetup.printArea).toBe("A1:I42");
  });

  it.each([1, 2, 3, 8])("сдвигает футер и рамку итогового акта при %i строках", async count => {
    const sheet = await reopen(buildFinalActWorkbook(makeLines(count), context, info));
    const last = 11 + count;
    expect(sheet.getCell(`H${last + 2}`).value).toBeGreaterThan(0);
    expect(sheet.getCell(`A${last + 10}`).value).toBe("ИСПОЛНИТЕЛЬ");
    expect(sheet.getCell(`F${last + 12}`).border.bottom?.style).toBe("thin");
    expect(sheet.getCell(`H${last}`).border.bottom?.style).toBe("medium");
    expect(sheet.getCell(`B${last}`).master.address).toBe(`B${last}`);
    expect(sheet.getCell(`D${last}`).master.address).toBe(`B${last}`);
    expect(sheet.pageSetup.printArea).toBe(`A1:H${last + 15}`);
    // The reference conceals the duplicate total using white text, not a hidden row.
    expect(sheet.getCell(`H${last + 3}`).font.color).toEqual({ theme: 0 });
    expect(sheet.pageSetup.scale).toBe(76);
  });

  it.each([1, 3, 8])("сохраняет печатный вид счёта «39 коп» при %i строках", async count => {
    const sheet = await reopen(buildInvoiceWorkbook(makeLines(count), context, info));
    const last = 20 + count;
    expect(sheet.getColumn(9).hidden).toBe(true);
    expect(sheet.getColumn(8).width).toBe(15);
    expect(sheet.pageSetup.printArea).toBe(`A1:H${last + 19}`);
    expect(sheet.pageSetup.scale).toBe(82);
    expect(sheet.getRow(last + 2).height).toBe(41.1);
    expect(sheet.getCell(`H${last + 13}`).border.bottom?.style).toBe("thin");
    expect(sheet.getCell("F4").font.name).toBe("Calibri");
    expect(sheet.getCell("H7").master.address).toBe("F4");
  });

  it.each([1, 24, 31])("сохраняет таблицу реестра и итоговую строку при %i актах", async count => {
    const sheet = await reopen(buildRegistryWorkbook(Array.from({ length: count }, (_, i) => makeAct(1, i + 1)), context, info));
    const totalRow = 14 + count;
    expect(sheet.getCell("A13").border?.left).toBeUndefined();
    expect(sheet.getCell("B13").font).toMatchObject({ name: "Calibri", size: 18, bold: true });
    expect(sheet.getCell("F14").numFmt).toBe("#,##0.00000");
    expect(sheet.getCell(`G${totalRow}`).border.bottom?.style).toBe("medium");
    expect(sheet.getCell(`F${totalRow}`).master.address).toBe(`C${totalRow}`);
    expect(sheet.getCell(`B${totalRow + 5}`).value).toContain("Индивидуальный предприниматель");
  });

  it("сохраняет индивидуальные размеры дневных образцов и не меняет шаблон при следующей выгрузке", async () => {
    const first = buildDayActWorkbook(makeAct(6, 3), context);
    expect(first.worksheets[0].getRow(18).height).toBe(60);
    first.worksheets[0].getCell("D15").font.name = "Changed";
    const next = await reopen(buildDayActWorkbook(makeAct(6, 3), context));
    expect(next.getCell("D15").font.name).toBe("Calibri");
    expect(next.getRow(18).height).toBe(60);
    expect(next.pageSetup.printArea).toBe("A1:I39");
  });
});
