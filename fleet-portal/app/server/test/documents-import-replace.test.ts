import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import ExcelJS from "exceljs";
import type { PrismaClient } from "@prisma/client";
import documentsRoutes from "../src/modules/documents/routes.js";

async function buildUploadPayload(rows: [Date, string, string, number, number, number][]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Sheet1");
  sheet.addRow(["День рейса", "Адрес получателя", "Гос номер", "Маршрут расстояние, км.", "Общая масса груза", "Стоимость доставки"]);
  for (const row of rows) sheet.addRow(row);
  const boundary = "test-replace-boundary";
  return {
    boundary,
    payload: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="new.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`),
      Buffer.from(await workbook.xlsx.writeBuffer()),
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  };
}

function buildApp(prismaOverrides: Record<string, unknown>) {
  const app = Fastify();
  app.decorate("prisma", prismaOverrides as unknown as PrismaClient);
  app.decorate("authenticate", async () => {});
  app.decorate("requireRole", () => async () => {});
  return app;
}

describe("замена файла импорта (POST /api/documents/imports/:id/replace)", () => {
  it("удаляет старые рейсы этого импорта, сохраняет новые под тем же id и не отдаёт fileData наружу", async () => {
    const deliveryDeleteMany = vi.fn(async () => ({ count: 3 }));
    const deliveryCreateMany = vi.fn(async () => ({ count: 1 }));
    const importBatchUpdate = vi.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => ({
      id: where.id,
      createdBy: 1,
      createdAt: new Date("2026-07-01"),
      updatedAt: new Date("2026-09-15"),
      ...data,
    }));
    const tx = { delivery: { deleteMany: deliveryDeleteMany, createMany: deliveryCreateMany }, importBatch: { update: importBatchUpdate } };
    const transaction = vi.fn(async (cb: (tx: unknown) => unknown) => cb(tx));
    const deliveryFindFirst = vi.fn(async () => null);
    const importBatchFindUnique = vi.fn(async () => ({
      id: 1,
      periodFrom: new Date("2026-07-01"),
      periodTo: new Date("2026-07-01"),
      sourceFileName: "old.xlsx",
      rowCount: 1,
      totalMassKg: 100,
      totalCost: 495,
      createdBy: 1,
      createdAt: new Date("2026-07-01"),
      updatedAt: new Date("2026-07-01"),
      fileData: Buffer.from("old file bytes"),
    }));
    const addressFindMany = vi.fn(async () => [{ id: 1, code: "82/15", fullAddress: "82/15 Новый адрес", city: "Севастополь", isActive: true }]);
    const addressRateFindMany = vi.fn(async () => [{ id: 1, addressId: 1, pricePerKg: 4.95, effectiveFrom: new Date("2026-01-01") }]);

    const app = buildApp({
      importBatch: { findUnique: importBatchFindUnique },
      delivery: { findFirst: deliveryFindFirst },
      address: { findMany: addressFindMany },
      addressRate: { findMany: addressRateFindMany },
      $transaction: transaction,
    });
    await app.register(multipart);
    await app.register(documentsRoutes);

    try {
      const { boundary, payload } = await buildUploadPayload([[new Date("2026-07-01"), "82/15 Новый адрес", "А002ВВ", 12, 100, 495]]);
      const response = await app.inject({
        method: "POST",
        url: "/api/documents/imports/1/replace",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });

      expect(response.statusCode).toBe(200);
      const result = response.json();
      expect(result.accepted).toBe(true);
      expect(result.batch.id).toBe(1);
      expect(result.batch.sourceFileName).toBe("new.xlsx");
      expect(result.batch.rowCount).toBe(1);
      expect(result.batch.hasFile).toBe(true);
      expect(result.batch.fileData).toBeUndefined();

      // Старые рейсы этого (и только этого) импорта удалены до вставки новых.
      expect(deliveryDeleteMany).toHaveBeenCalledWith({ where: { importBatchId: 1 } });
      expect(deliveryCreateMany).toHaveBeenCalledTimes(1);
      const createdRows = deliveryCreateMany.mock.calls[0][0].data;
      expect(createdRows).toHaveLength(1);
      expect(createdRows[0]).toMatchObject({ importBatchId: 1, truckPlate: "А002ВВ", addressId: 1, ratePerKg: 4.95, cost: 495 });

      // Проверка пересечения периода не должна спотыкаться о собственные же старые рейсы.
      expect(deliveryFindFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ importBatchId: { not: 1 } }) }),
      );
    } finally {
      await app.close();
    }
  });

  it("отказывает с 409 и ничего не меняет, если период пересекается с ДРУГИМ импортом", async () => {
    const transaction = vi.fn();
    const deliveryFindFirst = vi.fn(async () => ({ id: 99, importBatchId: 2 }));
    const importBatchFindUnique = vi.fn(async () => ({
      id: 1,
      periodFrom: new Date("2026-07-01"),
      periodTo: new Date("2026-07-01"),
      sourceFileName: "old.xlsx",
      rowCount: 1,
      totalMassKg: 100,
      totalCost: 495,
      createdBy: 1,
      createdAt: new Date("2026-07-01"),
      updatedAt: new Date("2026-07-01"),
      fileData: null,
    }));
    const addressFindMany = vi.fn(async () => [{ id: 1, code: "82/15", fullAddress: "82/15 Новый адрес", city: "Севастополь", isActive: true }]);
    const addressRateFindMany = vi.fn(async () => [{ id: 1, addressId: 1, pricePerKg: 4.95, effectiveFrom: new Date("2026-01-01") }]);

    const app = buildApp({
      importBatch: { findUnique: importBatchFindUnique },
      delivery: { findFirst: deliveryFindFirst },
      address: { findMany: addressFindMany },
      addressRate: { findMany: addressRateFindMany },
      $transaction: transaction,
    });
    await app.register(multipart);
    await app.register(documentsRoutes);

    try {
      const { boundary, payload } = await buildUploadPayload([[new Date("2026-07-01"), "82/15 Новый адрес", "А002ВВ", 12, 100, 495]]);
      const response = await app.inject({
        method: "POST",
        url: "/api/documents/imports/1/replace",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toBe("period_already_imported");
      expect(transaction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it("отвечает 404, если такого импорта не существует", async () => {
    const importBatchFindUnique = vi.fn(async () => null);
    const app = buildApp({ importBatch: { findUnique: importBatchFindUnique } });
    await app.register(multipart);
    await app.register(documentsRoutes);

    try {
      const { boundary, payload } = await buildUploadPayload([[new Date("2026-07-01"), "82/15 Новый адрес", "А002ВВ", 12, 100, 495]]);
      const response = await app.inject({
        method: "POST",
        url: "/api/documents/imports/999/replace",
        headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });
      expect(response.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
