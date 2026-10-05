import { describe, expect, it } from "vitest";
import { buildTruckReport, normalizePlate } from "../src/modules/documents/truckReport.js";

function delivery(date: string, city: string, fullAddress: string, distanceKm: number, massKg: number, ratePerKg: number) {
  return {
    id: 0,
    importBatchId: 1,
    date: new Date(`${date}T00:00:00.000Z`),
    addressId: 1,
    truckPlate: "В589КН92",
    distanceKm,
    massKg,
    ratePerKg,
    cost: massKg * ratePerKg,
    createdAt: new Date(),
    address: { id: 1, code: null, fullAddress, city, isActive: true, createdAt: new Date() },
  };
}

const base = { yearMonth: "2026-09", truckPlate: "В589КН92", truck: { id: 1, name: "Isuzu" } };

describe("buildTruckReport", () => {
  it("собирает рейсы, итоги по направлениям и общий итог", () => {
    const r = buildTruckReport({
      ...base,
      deliveries: [
        delivery("2026-09-01", "Керчь", "Керчь, ул. А", 200, 1000, 9.76),
        delivery("2026-09-01", "Феодосия", "Феодосия, ул. Б", 120, 500, 9.76),
        delivery("2026-09-03", "Керчь", "Керчь, ул. В", 210, 2000, 9.76),
      ],
      fuel: [],
      maintenance: [],
    });
    expect(r.trips).toHaveLength(3);
    expect(r.directions).toEqual([
      { city: "Керчь", trips: 2, massKg: 3000, distanceKm: 410, cost: 29280 },
      { city: "Феодосия", trips: 1, massKg: 500, distanceKm: 120, cost: 4880 },
    ]);
    expect(r.totals).toEqual({ trips: 3, days: 2, massKg: 3500, distanceKm: 530, cost: 34160 });
  });

  it("общий итог сходится с суммой направлений на некруглых суммах", () => {
    const r = buildTruckReport({
      ...base,
      deliveries: [
        delivery("2026-09-01", "А", "а", 10, 8584.69, 6.1),
        delivery("2026-09-02", "Б", "б", 10, 9279.14, 9.76),
        delivery("2026-09-03", "В", "в", 10, 661.56, 9.76),
      ],
      fuel: [],
      maintenance: [],
    });
    const sum = Math.round(r.directions.reduce((s, d) => s + d.cost, 0) * 100) / 100;
    expect(r.totals.cost).toBe(sum);
  });

  it("считает топливо и делит ТО и ремонты", () => {
    const r = buildTruckReport({
      ...base,
      deliveries: [],
      fuel: [
        { date: "2026-09-02", fuelTypeName: "Дизель", liters: 100.5, cost: 7000.25, odometer: 1000 },
        { date: "2026-09-10", fuelTypeName: "Дизель", liters: 50, cost: 3500.5, odometer: null },
      ],
      maintenance: [
        { date: "2026-09-05", type: "SERVICE", description: "ТО-1", cost: 20000 },
        { date: "2026-09-20", type: "REPAIR", description: null, cost: 10320 },
      ],
    });
    expect(r.fuel.liters).toBe(150.5);
    expect(r.fuel.cost).toBe(10500.75);
    expect(r.maintenance).toMatchObject({ serviceCost: 20000, repairCost: 10320, totalCost: 30320 });
  });

  it("пустой месяц — нули, а не ошибка", () => {
    const r = buildTruckReport({ ...base, truck: null, deliveries: [], fuel: [], maintenance: [] });
    expect(r.totals).toEqual({ trips: 0, days: 0, massKg: 0, distanceKm: 0, cost: 0 });
    expect(r.directions).toEqual([]);
    expect(r.fuel.cost).toBe(0);
    expect(r.maintenance.totalCost).toBe(0);
  });
});

describe("normalizePlate", () => {
  it("не различает регистр и пробелы", () => {
    expect(normalizePlate(" в 589 кн 92 ")).toBe("В589КН92");
  });
});
