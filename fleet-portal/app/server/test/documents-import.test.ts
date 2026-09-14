import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import documentsRoutes from "../src/modules/documents/routes.js";

describe("импорт расшифровки: период листа", () => {
  it("отклоняет весь файл до обращения к тарифам и базе при датах вне периода", async () => {
    const app = Fastify();
    const databaseAccess = vi.fn(() => {
      throw new Error("При неверном периоде база не должна использоваться");
    });
    app.decorate("prisma", {
      address: { findMany: databaseAccess },
      addressRate: { findMany: databaseAccess },
      delivery: { findFirst: databaseAccess },
      $transaction: databaseAccess,
    } as unknown as PrismaClient);
    app.decorate("authenticate", async () => {});
    app.decorate("requireRole", () => async () => {});
    await app.register(multipart);
    await app.register(documentsRoutes);

    try {
      const workbook = new ExcelJS.Workbook();
      const sheetName = "июль 01.07-10.07";
      const sheet = workbook.addWorksheet(sheetName);
      sheet.addRow(["День рейса", "Адрес получателя", "Гос номер", "Маршрут расстояние, км.", "Общая масса груза", "Стоимость доставки"]);
      // Корректная строка не должна сохраняться частично вместе с ошибочными.
      sheet.addRow([new Date("2026-07-01"), "82/15 Адрес", "А001АА", 10, 100, 495]);
      sheet.addRow([new Date("2026-08-08"), "82/15 Адрес", "А001АА", 10, 100, 495]);
      sheet.addRow([new Date("2026-06-08"), "82/15 Адрес", "А001АА", 10, 100, 495]);
      const boundary = "test-period-boundary";
      const payload = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sheetName"\r\n\r\n${sheetName}\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="july.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
        Buffer.from(await workbook.xlsx.writeBuffer()),
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);
      const response = await app.inject({
        method: "POST",
        url: "/api/documents/imports",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.accepted).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.map((error: { rowNumber: number }) => error.rowNumber)).toEqual([3, 4]);
      expect(result.errors[0].message).toContain('Файл "july.xlsx"');
      expect(result.errors[0].message).toContain(sheetName);
      expect(result.errors[0].message).toContain("2026-08-08");
      expect(result.errors[0].message).toContain("2026-07-01 — 2026-07-10");
      expect(result.errors[0].message).toContain("загрузите верный файл повторно");
      expect(databaseAccess).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
