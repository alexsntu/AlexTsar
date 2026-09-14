import type ExcelJS from "exceljs";
import JSZip from "jszip";
import { referenceLayouts } from "./referenceLayouts.js";

export type DocumentLayout = "day" | "final" | "registry" | "invoice";

interface LayoutRow {
  height: number;
  hidden: boolean;
  styles: number[];
  attributes: Record<string, string>;
}

export interface LayoutCatalog {
  styles: Partial<ExcelJS.Style>[];
  // Preserve the individual layouts of the 24 supplied day-act sheets.
  // Later act numbers use the first layout; there are no dates/data in these variants.
  dayVariants: {
    dataEnd: number;
    rows: LayoutRow[];
    merges: string[];
    pageSetup: Partial<ExcelJS.PageSetup>;
    pageAttributes: Record<string, string>;
  }[];
  layouts: Record<DocumentLayout, {
    dataStart: number;
    dataEnd: number;
    properties: Partial<ExcelJS.WorksheetProperties>;
    columns: { width?: number; hidden: boolean; style: number }[];
    rows: LayoutRow[];
    merges: string[];
    pageSetup: Partial<ExcelJS.PageSetup>;
    views: Partial<ExcelJS.WorksheetView>[];
    sheetFormat: Record<string, string>;
    normalFont: string;
    pageAttributes: Record<string, string>;
    bestFitColumns: number[];
  }>;
}

const nativeFormats = new WeakMap<ExcelJS.Worksheet, {
  normalFont: string;
  sheetFormat: Record<string, string>;
  pageAttributes: Record<string, string>;
  bestFitColumns: number[];
  rows: Record<string, string>[];
}>();

/** Apply reference geometry before writing values. Footer rows and their
 * merges/print area move together when the number of document lines changes.
 * Styles are cloned per cell: ExcelJS mutates styles during merges/export. */
export function createDocumentSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  kind: DocumentLayout,
  lineCount: number,
  actNumber?: number,
): ExcelJS.Worksheet {
  const variant = kind === "day" ? referenceLayouts.dayVariants[(actNumber ?? 1) - 1] : undefined;
  const layout = { ...referenceLayouts.layouts[kind], ...variant };
  const count = Math.max(1, lineCount);
  const delta = count - (layout.dataEnd - layout.dataStart + 1);
  const sheet = workbook.addWorksheet(name, {
    properties: structuredClone(layout.properties),
    views: structuredClone(layout.views),
  });
  sheet.columns = layout.columns.map(column => ({
    width: column.width,
    hidden: column.hidden,
    style: structuredClone(referenceLayouts.styles[column.style]),
  }));

  const sourceRows: number[] = [];
  for (let row = 1; row <= layout.rows.length + delta; row++) {
    let source: number;
    if (delta === 0 || row < layout.dataStart) source = row;
    else if (row >= layout.dataStart + count) source = row - delta;
    else if (row === layout.dataStart + count - 1) source = layout.dataEnd;
    else if (row === layout.dataStart) source = layout.dataStart;
    else source = Math.min(layout.dataStart + 1, layout.dataEnd);
    sourceRows.push(source);
  }

  const shiftFooter = (row: number) => row > layout.dataEnd ? row + delta : row;
  for (const range of layout.merges) {
    const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range)!;
    const [, left, topText, right, bottomText] = match;
    const top = Number(topText), bottom = Number(bottomText);
    if (top >= layout.dataStart && bottom <= layout.dataEnd) {
      sourceRows.forEach((source, index) => {
        if (source === top) sheet.mergeCellsWithoutStyle(`${left}${index + 1}:${right}${index + 1}`);
      });
    } else {
      sheet.mergeCellsWithoutStyle(`${left}${shiftFooter(top)}:${right}${shiftFooter(bottom)}`);
    }
  }

  sourceRows.forEach((source, index) => {
    const spec = layout.rows[source - 1];
    const row = sheet.getRow(index + 1);
    row.height = spec.height;
    row.hidden = spec.hidden;
    spec.styles.forEach((style, column) => {
      row.getCell(column + 1).style = structuredClone(referenceLayouts.styles[style]);
    });
  });
  sheet.pageSetup = structuredClone(layout.pageSetup);
  if (sheet.pageSetup.printArea) {
    sheet.pageSetup.printArea = sheet.pageSetup.printArea.replace(/([A-Z]+)(\d+)/g,
      (_, column, row) => `${column}${shiftFooter(Number(row))}`);
  }
  nativeFormats.set(sheet, {
    normalFont: layout.normalFont,
    sheetFormat: layout.sheetFormat,
    pageAttributes: layout.pageAttributes,
    bestFitColumns: layout.bestFitColumns,
    rows: sourceRows.map(source => layout.rows[source - 1].attributes),
  });
  return sheet;
}

/** ExcelJS always writes customHeight=1 for rows with a stored height and
 * drops baseColWidth. Restore the original layout flags, otherwise Calc/Excel
 * use fixed heights where the reference asks them to fit the row to its text.
 * No values, formulas or computed totals are modified here. */
export async function writeDocumentWorkbook(workbook: ExcelJS.Workbook): Promise<Buffer> {
  const zip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const attributes = (values: Record<string, string>) => Object.entries(values)
    .map(([key, value]) => `${key}="${value.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}"`).join(" ");
  // Excel column widths are measured in the workbook's Normal font. The
  // registry uses 12pt, not ExcelJS's default 11pt; this also affects print scaling.
  const normalFont = nativeFormats.get(workbook.worksheets[0])?.normalFont;
  if (normalFont) {
    const styles = await zip.file("xl/styles.xml")!.async("string");
    zip.file("xl/styles.xml", styles.replace(/<font>.*?<\/font>/s, normalFont));
  }
  for (const sheet of workbook.worksheets) {
    const format = nativeFormats.get(sheet);
    if (!format) continue;
    const path = `xl/worksheets/sheet${sheet.id}.xml`;
    const entry = zip.file(path);
    if (!entry) throw new Error(`Worksheet XML missing: ${sheet.id}`);
    let xml = await entry.async("string");
    xml = xml.replace(/<sheetFormatPr\b[^>]*\/>/, `<sheetFormatPr ${attributes(format.sheetFormat)}/>`);
    xml = xml.replace(/<pageSetup\b[^>]*\/>/, `<pageSetup ${attributes(format.pageAttributes)}/>`);
    xml = xml.replace(/<col\b[^>]*\/>/g, tag => {
      const first = Number(/\bmin="(\d+)"/.exec(tag)?.[1]);
      return format.bestFitColumns.includes(first) ? tag.replace("/>", ' bestFit="1"/>') : tag;
    });
    xml = xml.replace(/<row\b[^>]*>/g, tag => {
      const number = Number(/\br="(\d+)"/.exec(tag)?.[1]);
      const rowAttributes = format.rows[number - 1];
      if (!rowAttributes) return tag;
      const clean = tag.replace(/\s(?:ht|customHeight|hidden|thickTop|thickBot|x14ac:dyDescent)="[^"]*"/g, "");
      const ending = clean.endsWith("/>") ? "/>" : ">";
      return clean.slice(0, -ending.length) + " " + attributes(rowAttributes) + ending;
    });
    zip.file(path, xml);
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}
