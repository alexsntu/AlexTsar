import type { FastifyInstance } from "fastify";
import type { OrgProfile } from "@prisma/client";
import { z } from "zod";
import { round2 } from "../../lib/money.js";
import { listSheetNames, parseSheet, ImportParseError, inferPeriodFromSheetName } from "./importParser.js";
import { validateRows } from "./validate.js";
import { buildDayActs, buildMonthSummary, buildRouteSummary, getMonthDeliveries } from "./queries.js";
import { buildDayActWorkbook, buildFinalActWorkbook, buildInvoiceWorkbook, buildMonthActsWorkbook, buildRegistryWorkbook, type OrgContext } from "./xlsx.js";

const addressSchema = z.object({
  code: z.string().max(20).optional(),
  fullAddress: z.string().min(1).max(500),
  city: z.string().min(1).max(200),
});

const addressRateSchema = z.object({
  pricePerKg: z.number().positive().max(100_000),
  effectiveFrom: z.coerce.date(),
});

const orgProfileSchema = z.object({
  name: z.string().min(1).max(300),
  inn: z.string().min(1).max(20),
  kpp: z.string().max(20).optional(),
  legalAddress: z.string().min(1).max(500),
  phone: z.string().max(50).optional(),
  bankName: z.string().max(300).optional(),
  bankAccount: z.string().max(50).optional(),
  bik: z.string().max(20).optional(),
  corrAccount: z.string().max(50).optional(),
  dispatchPoint: z.string().max(300).optional(),
  contractNumber: z.string().max(100).optional(),
  contractDate: z.coerce.date().optional(),
  contractIgk: z.string().max(100).optional(),
});

const monthClosingSchema = z.object({
  yearMonth: z.string().regex(/^\d{4}-\d{2}$/),
  invoiceNumber: z.string().min(1).max(50),
  invoiceDate: z.coerce.date(),
});

const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Пытаемся сами найти нужный лист по диапазону дат в исходных строках
 * (шапка листа вида "июль 01.07-10.07"). Если ни один лист не содержит
 * обе даты периода в имени — возвращаем null, пусть пользователь выберет сам. */
function guessSheetName(sheetNames: string[], minDate: Date, maxDate: Date): string | null {
  const fromLabel = `${pad2(minDate.getUTCDate())}.${pad2(minDate.getUTCMonth() + 1)}`;
  const toLabel = `${pad2(maxDate.getUTCDate())}.${pad2(maxDate.getUTCMonth() + 1)}`;
  const matches = sheetNames.filter((name) => name.includes(fromLabel) && name.includes(toLabel));
  return matches.length === 1 ? matches[0] : null;
}

async function getOrgContext(fastify: FastifyInstance): Promise<OrgContext> {
  const profiles = await fastify.prisma.orgProfile.findMany();
  const byRole = new Map(profiles.map((p: OrgProfile) => [p.role, p]));
  return { supplier: byRole.get("SUPPLIER") ?? null, buyer: byRole.get("BUYER") ?? null };
}

export default async function documentsRoutes(fastify: FastifyInstance) {
  const writeGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };
  const readGuard = { preHandler: [fastify.authenticate, fastify.requireRole(["ADMIN", "DISPATCHER"])] };

  // ---------- Справочник адресов и тарифов ----------
  fastify.get("/api/documents/addresses", readGuard, async () => {
    return fastify.prisma.address.findMany({
      where: { isActive: true },
      include: { rates: { orderBy: { effectiveFrom: "desc" } } },
      orderBy: [{ city: "asc" }, { fullAddress: "asc" }],
    });
  });

  fastify.post("/api/documents/addresses", writeGuard, async (request, reply) => {
    const parsed = addressSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.address.create({ data: parsed.data });
  });

  fastify.patch<{ Params: { id: string } }>("/api/documents/addresses/:id", writeGuard, async (request, reply) => {
    const parsed = addressSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.address.update({ where: { id: Number(request.params.id) }, data: parsed.data });
  });

  fastify.delete<{ Params: { id: string } }>("/api/documents/addresses/:id", writeGuard, async (request) => {
    return fastify.prisma.address.update({ where: { id: Number(request.params.id) }, data: { isActive: false } });
  });

  fastify.post<{ Params: { id: string } }>("/api/documents/addresses/:id/rates", writeGuard, async (request, reply) => {
    const parsed = addressRateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    return fastify.prisma.addressRate.create({ data: { ...parsed.data, addressId: Number(request.params.id) } });
  });

  fastify.delete<{ Params: { id: string } }>("/api/documents/rates/:id", writeGuard, async (request) => {
    return fastify.prisma.addressRate.delete({ where: { id: Number(request.params.id) } });
  });

  // ---------- Реквизиты сторон ----------
  fastify.get("/api/documents/org-profiles", readGuard, async () => {
    return fastify.prisma.orgProfile.findMany();
  });

  fastify.patch<{ Params: { role: string } }>("/api/documents/org-profiles/:role", writeGuard, async (request, reply) => {
    const parsed = orgProfileSchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const role = request.params.role.toUpperCase();
    return fastify.prisma.orgProfile.upsert({
      where: { role },
      create: { role, name: "", inn: "", legalAddress: "", ...parsed.data },
      update: parsed.data,
    });
  });

  // ---------- Импорт присланного файла-расшифровки ----------
  fastify.post("/api/documents/imports", writeGuard, async (request, reply) => {
    let fileBuffer: Buffer | null = null;
    let sourceFileName = "";
    let sheetName: string | undefined;

    for await (const part of request.parts()) {
      if (part.type === "file") {
        fileBuffer = await part.toBuffer();
        sourceFileName = part.filename;
      } else if (part.fieldname === "sheetName" && typeof part.value === "string") {
        sheetName = part.value;
      }
    }
    if (!fileBuffer) return reply.code(400).send({ error: "file_required" });

    const sheetNames = await listSheetNames(fileBuffer);

    if (!sheetName) {
      // Без выбранного листа пробуем разобрать каждый лист по очереди —
      // "настоящий" лист с рейсами узнаётся по тому, что на нём вообще
      // находится ожидаемая шапка таблицы и есть хотя бы одна строка данных
      // (служебные вкладки вроде "адреса столовых"/"март" её не имеют).
      // Если такой лист ровно один — используем его сразу, иначе просим
      // пользователя выбрать вручную (с подсказкой по совпадению дат в имени).
      const candidates: string[] = [];
      let probeRows: Awaited<ReturnType<typeof parseSheet>> = [];
      for (const name of sheetNames) {
        try {
          const rows = await parseSheet(fileBuffer, name);
          if (rows.length > 0) {
            candidates.push(name);
            probeRows = rows;
          }
        } catch {
          continue;
        }
      }
      if (candidates.length === 0) {
        return reply.code(400).send({ error: "no_data_sheet", sheets: sheetNames });
      }
      if (candidates.length === 1) {
        sheetName = candidates[0];
      } else {
        const dates = probeRows.map((r) => r.date.getTime());
        const guessed = guessSheetName(candidates, new Date(Math.min(...dates)), new Date(Math.max(...dates)));
        return reply.send({ needsSheetSelection: true, sheets: candidates, suggested: guessed ?? candidates[0] });
      }
    }

    let rows;
    try {
      rows = await parseSheet(fileBuffer, sheetName);
    } catch (error) {
      if (error instanceof ImportParseError) {
        return reply.code(400).send({ error: "parse_error", message: error.message, sheets: sheetNames });
      }
      throw error;
    }
    if (rows.length === 0) {
      return reply.code(400).send({ error: "empty_sheet", sheets: sheetNames });
    }

    // Санити-проверка дат по заявленному в имени листа периоду — ловит
    // испорченные даты в исходнике (см. комментарий у inferPeriodFromSheetName),
    // которые иначе тихо ломают группировку по дням в дальнейшем.
    const referenceYear = rows[0].date.getUTCFullYear();
    const declaredPeriod = inferPeriodFromSheetName(sheetName, referenceYear);
    const dateErrors = declaredPeriod
      ? rows
          .filter((r) => r.date.getTime() < declaredPeriod.start.getTime() || r.date.getTime() > declaredPeriod.end.getTime())
          .map((r) => ({
            rowNumber: r.rowNumber,
            date: r.date.toISOString().slice(0, 10),
            addressText: r.addressText,
            message: `Дата в строке ${r.rowNumber} (${r.date.toISOString().slice(0, 10)}) вне заявленного периода листа "${sheetName}" — похоже на испорченную дату в исходном файле. Проверьте вводные данные.`,
          }))
      : [];

    const [addresses, rates] = await Promise.all([fastify.prisma.address.findMany(), fastify.prisma.addressRate.findMany()]);
    const result = validateRows(rows, addresses, rates);
    const allErrors = [...dateErrors, ...result.errors];
    if (allErrors.length > 0) {
      // Отклонённый импорт — ожидаемый бизнес-исход (плохие вводные), не
      // сбой сервера, но след в логе нужен: потом вместе с пользователем
      // разобрать, что именно и почему не прошло по конкретному файлу.
      request.log.warn({ sourceFileName, sheetName, errorCount: allErrors.length }, "documents_import_rejected");
      return reply.send({ accepted: false, errors: allErrors });
    }

    const dates = result.validated.map((r) => r.date.getTime());
    const periodFrom = new Date(Math.min(...dates));
    const periodTo = new Date(Math.max(...dates));

    const overlap = await fastify.prisma.delivery.findFirst({ where: { date: { gte: periodFrom, lte: periodTo } } });
    if (overlap) {
      return reply.code(409).send({
        error: "period_already_imported",
        message: "За этот период уже загружены рейсы — сначала удалите старый импорт (вкладка «Импорт»), если нужно перезагрузить.",
      });
    }

    const totalMassKg = result.validated.reduce((sum, r) => sum + r.massKg, 0);
    const totalCost = round2(result.validated.reduce((sum, r) => sum + r.expectedCost, 0));

    const batch = await fastify.prisma.$transaction(async (tx) => {
      const created = await tx.importBatch.create({
        data: {
          periodFrom,
          periodTo,
          sourceFileName,
          rowCount: result.validated.length,
          totalMassKg,
          totalCost,
          createdBy: request.user!.id,
        },
      });
      await tx.delivery.createMany({
        data: result.validated.map((r) => ({
          importBatchId: created.id,
          date: r.date,
          addressId: r.addressId,
          truckPlate: r.truckPlate,
          distanceKm: r.distanceKm,
          massKg: r.massKg,
          ratePerKg: r.ratePerKg,
          cost: r.expectedCost,
        })),
      });
      return created;
    });

    request.log.info({ batchId: batch.id, sourceFileName, sheetName, rowCount: batch.rowCount }, "documents_import_accepted");
    return reply.send({ accepted: true, batch });
  });

  fastify.get("/api/documents/imports", readGuard, async () => {
    return fastify.prisma.importBatch.findMany({ orderBy: { periodFrom: "desc" } });
  });

  fastify.delete<{ Params: { id: string } }>("/api/documents/imports/:id", writeGuard, async (request) => {
    const id = Number(request.params.id);
    return fastify.prisma.$transaction(async (tx) => {
      await tx.delivery.deleteMany({ where: { importBatchId: id } });
      return tx.importBatch.delete({ where: { id } });
    });
  });

  // ---------- Производные данные (используются и для превью, и для генерации) ----------
  fastify.get("/api/documents/route-summary", readGuard, async (request, reply) => {
    const parsed = monthQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const deliveries = await getMonthDeliveries(fastify.prisma, parsed.data.month);
    return buildRouteSummary(deliveries);
  });

  fastify.get("/api/documents/day-acts", readGuard, async (request, reply) => {
    const parsed = monthQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, parsed.data.month);
    return buildDayActs(deliveries, ctx.supplier?.dispatchPoint ?? "");
  });

  fastify.get("/api/documents/month-summary", readGuard, async (request, reply) => {
    const parsed = monthQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const deliveries = await getMonthDeliveries(fastify.prisma, parsed.data.month);
    return buildMonthSummary(deliveries);
  });

  // ---------- Закрытие месяца ----------
  fastify.get<{ Params: { yearMonth: string } }>("/api/documents/month-closings/:yearMonth", readGuard, async (request) => {
    return fastify.prisma.monthClosing.findUnique({ where: { yearMonth: request.params.yearMonth } });
  });

  fastify.post("/api/documents/month-closings", writeGuard, async (request, reply) => {
    const parsed = monthClosingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, parsed.data.yearMonth);
    if (deliveries.length === 0) return reply.code(400).send({ error: "no_deliveries_for_month" });

    const dayActs = buildDayActs(deliveries, ctx.supplier?.dispatchPoint ?? "");
    const finalActNumber = dayActs.length + 1;
    const finalActDate = deliveries.reduce((max, d) => (d.date > max ? d.date : max), deliveries[0].date);

    const closing = await fastify.prisma.monthClosing.upsert({
      where: { yearMonth: parsed.data.yearMonth },
      create: {
        yearMonth: parsed.data.yearMonth,
        invoiceNumber: parsed.data.invoiceNumber,
        invoiceDate: parsed.data.invoiceDate,
        finalActNumber,
        finalActDate,
        createdBy: request.user!.id,
      },
      update: { invoiceNumber: parsed.data.invoiceNumber, invoiceDate: parsed.data.invoiceDate, finalActNumber, finalActDate },
    });
    return reply.send(closing);
  });

  // ---------- Скачивание .xlsx (генерируются на лету, ничего не хранится) ----------
  async function sendWorkbook(reply: import("fastify").FastifyReply, workbook: import("exceljs").Workbook, filename: string) {
    const buffer = await workbook.xlsx.writeBuffer();
    reply
      .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`)
      .send(Buffer.from(buffer));
  }

  fastify.get<{ Params: { date: string } }>("/api/documents/day-acts/:date/download", readGuard, async (request, reply) => {
    const yearMonth = request.params.date.slice(0, 7);
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, yearMonth);
    const dayActs = buildDayActs(deliveries, ctx.supplier?.dispatchPoint ?? "");
    const dayAct = dayActs.find((a) => a.date === request.params.date);
    if (!dayAct) return reply.code(404).send({ error: "not_found" });
    const workbook = buildDayActWorkbook(dayAct, ctx);
    return sendWorkbook(reply, workbook, `Акт №${dayAct.actNumber} от ${dayAct.date}.xlsx`);
  });

  fastify.get<{ Params: { yearMonth: string } }>("/api/documents/day-acts/month/:yearMonth/download", readGuard, async (request, reply) => {
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, request.params.yearMonth);
    const dayActs = buildDayActs(deliveries, ctx.supplier?.dispatchPoint ?? "");
    const workbook = buildMonthActsWorkbook(dayActs, ctx);
    return sendWorkbook(reply, workbook, `Акты за ${request.params.yearMonth}.xlsx`);
  });

  fastify.get<{ Params: { yearMonth: string } }>("/api/documents/registry/:yearMonth/download", readGuard, async (request, reply) => {
    const closing = await fastify.prisma.monthClosing.findUnique({ where: { yearMonth: request.params.yearMonth } });
    if (!closing) return reply.code(400).send({ error: "month_not_closed" });
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, request.params.yearMonth);
    const dayActs = buildDayActs(deliveries, ctx.supplier?.dispatchPoint ?? "");
    const workbook = buildRegistryWorkbook(dayActs, ctx, {
      yearMonth: request.params.yearMonth,
      invoiceNumber: closing.invoiceNumber,
      invoiceDate: closing.invoiceDate,
    });
    return sendWorkbook(reply, workbook, `Реестр ${request.params.yearMonth}.xlsx`);
  });

  fastify.get<{ Params: { yearMonth: string } }>("/api/documents/final-act/:yearMonth/download", readGuard, async (request, reply) => {
    const closing = await fastify.prisma.monthClosing.findUnique({ where: { yearMonth: request.params.yearMonth } });
    if (!closing) return reply.code(400).send({ error: "month_not_closed" });
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, request.params.yearMonth);
    const summary = buildMonthSummary(deliveries);
    const workbook = buildFinalActWorkbook(summary, ctx, { finalActNumber: closing.finalActNumber, finalActDate: closing.finalActDate });
    return sendWorkbook(reply, workbook, `Акт №${closing.finalActNumber} ${request.params.yearMonth}.xlsx`);
  });

  fastify.get<{ Params: { yearMonth: string } }>("/api/documents/invoice/:yearMonth/download", readGuard, async (request, reply) => {
    const closing = await fastify.prisma.monthClosing.findUnique({ where: { yearMonth: request.params.yearMonth } });
    if (!closing) return reply.code(400).send({ error: "month_not_closed" });
    const ctx = await getOrgContext(fastify);
    const deliveries = await getMonthDeliveries(fastify.prisma, request.params.yearMonth);
    const summary = buildMonthSummary(deliveries);
    const workbook = buildInvoiceWorkbook(summary, ctx, { invoiceNumber: closing.invoiceNumber, invoiceDate: closing.invoiceDate });
    return sendWorkbook(reply, workbook, `Счёт №${closing.invoiceNumber} ${request.params.yearMonth}.xlsx`);
  });
}
