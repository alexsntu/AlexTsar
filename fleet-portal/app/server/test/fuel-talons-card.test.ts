import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import fuelRoutes from "../src/modules/fuel/routes.js";
import fuelReportsRoutes from "../src/modules/fuel/reports.js";

// Талоны и топливная карта проверяются на настоящей SQLite-базе с боевыми
// миграциями: суть этих операций — согласованность остатков партий, расходов
// и отчётов между собой, на моках её не проверить.
let dir: string;
let prisma: PrismaClient;
let app: FastifyInstance;
let dieselId: number;
let truckId: number;
let otherTruckId: number;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "fleet-fuel-test-"));
  const url = `file:${path.join(dir, "test.db")}`;
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  prisma = new PrismaClient({ datasources: { db: { url } } });

  app = Fastify();
  app.decorate("prisma", prisma);
  app.decorateRequest("user", null);
  app.decorate("authenticate", async (request: { user: unknown }) => {
    request.user = { id: 1, role: "ADMIN", driverId: null };
  });
  app.decorate("requireRole", () => async () => {});
  await app.register(fuelRoutes);
  await app.register(fuelReportsRoutes);
}, 120_000);

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await prisma.fuelTalonUsage.deleteMany();
  await prisma.fuelWithdrawalLotUsage.deleteMany();
  await prisma.fuelWithdrawal.deleteMany();
  await prisma.fuelTalonLot.deleteMany();
  await prisma.fuelLot.deleteMany();
  await prisma.truck.deleteMany();
  await prisma.fuelType.deleteMany();
  dieselId = (await prisma.fuelType.create({ data: { name: "Дизель" } })).id;
  truckId = (await prisma.truck.create({ data: { name: "Газель", plateNumber: "А001АА" } })).id;
  otherTruckId = (await prisma.truck.create({ data: { name: "Валдай", plateNumber: "В002ВВ" } })).id;
});

const post = (url: string, payload: unknown) => app.inject({ method: "POST", url, payload: payload as object });
const get = async (url: string) => (await app.inject({ method: "GET", url })).json();

function addTalons(date: string, nominalLiters: number, count: number, price: { pricePerTalon?: number; totalAmount?: number }) {
  return post("/api/fuel/talon-lots", { fuelTypeId: dieselId, date, nominalLiters, count, ...price });
}

function issue(date: string, nominalLiters: number, count: number, extra: Record<string, unknown> = {}) {
  return post("/api/fuel/talon-issues", { fuelTypeId: dieselId, date, nominalLiters, count, truckId, ...extra });
}

describe("талоны на топливо", () => {
  it("выдача списывает сначала старые талоны (контрольный пример: 10×1300 + 2×1400 = 15 800)", async () => {
    expect((await addTalons("2026-10-01", 20, 10, { pricePerTalon: 1300 })).statusCode).toBe(200);
    expect((await addTalons("2026-10-05", 20, 10, { pricePerTalon: 1400 })).statusCode).toBe(200);

    const res = await issue("2026-10-06", 20, 12);
    expect(res.statusCode).toBe(200);
    const withdrawal = res.json();
    expect(withdrawal).toMatchObject({ source: "TALON", liters: 240, talonNominal: 20, talonCount: 12, totalCost: 15800, truckId });

    expect(await get("/api/fuel/reports/talon-balance")).toEqual([
      { fuelTypeId: dieselId, fuelTypeName: "Дизель", nominalLiters: 20, count: 8, liters: 160, value: 11200 },
    ]);
  });

  it("номиналы учитываются раздельно", async () => {
    await addTalons("2026-10-01", 10, 5, { pricePerTalon: 650 });
    await addTalons("2026-10-01", 50, 2, { pricePerTalon: 3300 });

    // Талонов по 20 л нет вовсе — талоны других номиналов их не заменяют.
    const missing = await issue("2026-10-02", 20, 1);
    expect(missing.statusCode).toBe(409);
    expect(missing.json()).toEqual({ error: "insufficient_talons", nominalLiters: 20, available: 0, requested: 1 });

    expect((await issue("2026-10-02", 50, 1)).json()).toMatchObject({ liters: 50, totalCost: 3300 });
    const balance = await get("/api/fuel/reports/talon-balance");
    expect(balance.map((r: { nominalLiters: number; count: number }) => [r.nominalLiters, r.count])).toEqual([
      [10, 5],
      [50, 1],
    ]);
  });

  it("при нехватке талонов ничего не списывает", async () => {
    await addTalons("2026-10-01", 20, 3, { pricePerTalon: 1300 });
    const res = await issue("2026-10-02", 20, 4);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "insufficient_talons", available: 3, requested: 4 });
    expect(await prisma.fuelWithdrawal.count()).toBe(0);
    expect((await prisma.fuelTalonLot.findFirstOrThrow()).countRemaining).toBe(3);
  });

  it("нельзя выдать талоны раньше даты их прихода, но в день прихода — можно", async () => {
    await addTalons("2026-10-05", 20, 3, { pricePerTalon: 1300 });
    expect((await issue("2026-10-04", 20, 1)).statusCode).toBe(409);
    expect((await issue("2026-10-05", 20, 1)).statusCode).toBe(200);
  });

  it("сумма не делится на количество: выдачи в сумме дают ровно сумму прихода", async () => {
    // 3 талона за 10 000 ₽ — по 3333,33 ₽ с копейкой в остатке.
    await addTalons("2026-10-01", 50, 3, { totalAmount: 10000 });
    const costs: number[] = [];
    for (let i = 0; i < 3; i++) costs.push((await issue("2026-10-02", 50, 1)).json().totalCost);
    expect(costs.every((c) => c > 0)).toBe(true);
    expect(Math.round(costs.reduce((a, b) => a + b, 0) * 100)).toBe(1_000_000);
    const lot = await prisma.fuelTalonLot.findFirstOrThrow();
    expect(lot).toMatchObject({ countRemaining: 0, valueRemaining: 0 });
  });

  it("отмена выдачи возвращает талоны и их стоимость в те же партии", async () => {
    await addTalons("2026-10-01", 20, 10, { pricePerTalon: 1300 });
    await addTalons("2026-10-05", 20, 10, { pricePerTalon: 1400 });
    const before = await get("/api/fuel/reports/talon-balance");

    const issued = (await issue("2026-10-06", 20, 12)).json();
    const cancel = await app.inject({ method: "DELETE", url: `/api/fuel/withdrawals/${issued.id}` });
    expect(cancel.statusCode).toBe(200);

    expect(await get("/api/fuel/reports/talon-balance")).toEqual(before);
    expect(await prisma.fuelWithdrawal.count()).toBe(0);
    expect(await prisma.fuelTalonUsage.count()).toBe(0);
    // После возврата та же выдача стоит столько же — очередь партий не сбилась.
    expect((await issue("2026-10-06", 20, 12)).json().totalCost).toBe(15800);
  });

  it("отмена после частичных выдач с неделимой суммой не теряет копейки", async () => {
    await addTalons("2026-10-01", 50, 3, { totalAmount: 10000 });
    const first = (await issue("2026-10-02", 50, 1)).json();
    await issue("2026-10-02", 50, 1);
    await app.inject({ method: "DELETE", url: `/api/fuel/withdrawals/${first.id}` });
    await issue("2026-10-03", 50, 2);
    const total = (await prisma.fuelWithdrawal.findMany()).reduce((sum, w) => sum + w.totalCost, 0);
    expect(Math.round(total * 100)).toBe(1_000_000);
    expect(await prisma.fuelTalonLot.findFirstOrThrow()).toMatchObject({ countRemaining: 0, valueRemaining: 0 });
  });

  it("отклоняет номинал не из списка, дробное количество и расходящиеся цену с суммой", async () => {
    expect((await addTalons("2026-10-01", 15, 1, { pricePerTalon: 1000 })).statusCode).toBe(400);
    expect((await addTalons("2026-10-01", 20, 1.5, { pricePerTalon: 1000 })).statusCode).toBe(400);
    expect((await addTalons("2026-10-01", 20, 2, { pricePerTalon: 1000, totalAmount: 2500 })).statusCode).toBe(400);
    expect((await addTalons("2026-10-01", 20, 2, {})).statusCode).toBe(400);
    expect(await prisma.fuelTalonLot.count()).toBe(0);
  });

  it("повторная отправка с тем же ключом не выдаёт талоны второй раз", async () => {
    await addTalons("2026-10-01", 20, 10, { pricePerTalon: 1300 });
    const key = "talon-key-0000000001";
    const first = (await issue("2026-10-02", 20, 2, { idempotencyKey: key })).json();
    const second = (await issue("2026-10-02", 20, 2, { idempotencyKey: key })).json();
    expect(second.id).toBe(first.id);
    expect((await prisma.fuelTalonLot.findFirstOrThrow()).countRemaining).toBe(8);
    // Тот же ключ с другим количеством — не «тот же повтор».
    expect((await issue("2026-10-02", 20, 3, { idempotencyKey: key })).statusCode).toBe(409);
  });
});

describe("заправка по топливной карте", () => {
  const refuel = (payload: Record<string, unknown>) =>
    post("/api/fuel/card-refuels", { fuelTypeId: dieselId, date: "2026-10-03", truckId, ...payload });

  it("считает сумму из литров и цены", async () => {
    const res = await refuel({ liters: 100, pricePerLiter: 72.5, odometer: 150000 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ source: "CARD", liters: 100, pricePerLiter: 72.5, totalCost: 7250, odometer: 150000, isPersonal: false });
  });

  it("считает цену из литров и суммы; сумма сохраняется как введена", async () => {
    const res = await refuel({ liters: 70, totalAmount: 5000 });
    expect(res.json()).toMatchObject({ pricePerLiter: 71.43, totalCost: 5000 });
  });

  it("отклоняет расходящиеся цену с суммой и заправку без цены", async () => {
    expect((await refuel({ liters: 100, pricePerLiter: 70, totalAmount: 7500 })).statusCode).toBe(400);
    expect((await refuel({ liters: 100 })).statusCode).toBe(400);
    expect((await refuel({ liters: 0, pricePerLiter: 70 })).statusCode).toBe(400);
  });

  it("не трогает склад и талоны", async () => {
    await post("/api/fuel/lots", { fuelTypeId: dieselId, date: "2026-10-01", liters: 500, pricePerLiter: 60 });
    await addTalons("2026-10-01", 20, 5, { pricePerTalon: 1300 });
    await refuel({ liters: 100, pricePerLiter: 72.5 });
    expect(await get("/api/fuel/reports/balance")).toEqual([{ fuelTypeId: dieselId, fuelTypeName: "Дизель", liters: 500, value: 30000 }]);
    expect((await get("/api/fuel/reports/talon-balance"))[0].count).toBe(5);
  });

  it("заправку по карте можно отменить, складскую — нельзя", async () => {
    await post("/api/fuel/lots", { fuelTypeId: dieselId, date: "2026-10-01", liters: 500, pricePerLiter: 60 });
    const card = (await refuel({ liters: 100, pricePerLiter: 72.5 })).json();
    const tank = (
      await post("/api/fuel/withdrawals", { fuelTypeId: dieselId, date: "2026-10-03", liters: 50, isPersonal: false, truckId })
    ).json();

    expect((await app.inject({ method: "DELETE", url: `/api/fuel/withdrawals/${card.id}` })).statusCode).toBe(200);
    const denied = await app.inject({ method: "DELETE", url: `/api/fuel/withdrawals/${tank.id}` });
    expect(denied.statusCode).toBe(409);
    expect(denied.json()).toEqual({ error: "tank_withdrawal_not_cancellable" });
    expect((await app.inject({ method: "DELETE", url: "/api/fuel/withdrawals/999999" })).statusCode).toBe(404);

    const left = await prisma.fuelWithdrawal.findMany();
    expect(left.map((w) => w.id)).toEqual([tank.id]);
  });
});

describe("отчёты с тремя источниками топлива", () => {
  beforeEach(async () => {
    await post("/api/fuel/lots", { fuelTypeId: dieselId, date: "2026-10-01", liters: 500, pricePerLiter: 60 });
    await addTalons("2026-10-01", 20, 10, { pricePerTalon: 1300 });
    // Склад: 50 л × 60 = 3000; талоны: 2 × 20 л = 40 л, 2600; карта: 100 л, 7250.
    await post("/api/fuel/withdrawals", { fuelTypeId: dieselId, date: "2026-10-03", liters: 50, isPersonal: false, truckId, odometer: 1000 });
    await issue("2026-10-10", 20, 2, { odometer: 1400 });
    await post("/api/fuel/card-refuels", { fuelTypeId: dieselId, date: "2026-10-20", truckId: otherTruckId, liters: 100, pricePerLiter: 72.5 });
  });

  it("расход по машинам включает склад, талоны и карту", async () => {
    const report = await get("/api/fuel/reports/consumption?groupBy=truck&from=2026-10-01&to=2026-10-31");
    const byTruck = Object.fromEntries(report.rows.map((r: { key: number; companyLiters: number; companyCost: number }) => [r.key, r]));
    expect(byTruck[truckId]).toMatchObject({ companyLiters: 90, companyCost: 5600, count: 2 });
    expect(byTruck[otherTruckId]).toMatchObject({ companyLiters: 100, companyCost: 7250, count: 1 });
    expect(report.totals).toMatchObject({ companyLiters: 190, companyCost: 12850 });
  });

  it("source=TANK оставляет только движение по складу", async () => {
    const report = await get("/api/fuel/reports/consumption?groupBy=fuelType&source=TANK&from=2026-10-01&to=2026-10-31");
    expect(report.totals).toMatchObject({ companyLiters: 50, companyCost: 3000 });
  });

  it("границы периода: талоны и карта попадают в свой день и не попадают в соседний", async () => {
    const day = async (d: string) => (await get(`/api/fuel/reports/consumption?groupBy=truck&from=${d}&to=${d}`)).totals.companyCost;
    expect(await day("2026-10-09")).toBe(0);
    expect(await day("2026-10-10")).toBe(2600);
    expect(await day("2026-10-11")).toBe(0);
    expect(await day("2026-10-20")).toBe(7250);
  });

  it("расход на 100 км учитывает литры по талонам и их одометр", async () => {
    const report = await get(`/api/fuel/reports/per-100km?truckId=${truckId}&from=2026-10-01&to=2026-10-31`);
    expect(report).toMatchObject({ insufficientData: false, totalLiters: 90, distanceKm: 400, litersPer100Km: 22.5 });
  });

  it("журнал заправок отдаёт источник каждой записи", async () => {
    const list = await get("/api/fuel/withdrawals?from=2026-10-01&to=2026-10-31");
    expect(list.map((w: { source: string }) => w.source)).toEqual(["TANK", "TALON", "CARD"]);
  });
});
