import { describe, expect, it } from "vitest";
import { buildProfitSummary } from "../src/modules/documents/profit.js";

const base = {
  yearMonth: "2026-09",
  revenue: 1_000_000,
  fuelCost: 150_000,
  personalFuelCost: 5_000,
  serviceCost: 20_000,
  repairCost: 30_000,
  royalties: 80_000,
  salary: 200_000,
};

describe("buildProfitSummary", () => {
  it("вычитает из суммы услуг налоги 10%, ГСМ, ремонты/ТО, роялти и ЗП", () => {
    const s = buildProfitSummary(base);
    expect(s.taxes).toBe(100_000);
    expect(s.maintenance).toBe(50_000);
    expect(s.totalExpenses).toBe(580_000);
    expect(s.profit).toBe(420_000);
  });

  it("не считает итог, пока ЗП не введена", () => {
    const s = buildProfitSummary({ ...base, salary: null });
    expect(s.salary).toBeNull();
    expect(s.totalExpenses).toBeNull();
    expect(s.profit).toBeNull();
    // Остальные статьи при этом видны
    expect(s.taxes).toBe(100_000);
    expect(s.fuel).toBe(150_000);
  });

  it("ЗП, введённая как 0, — это введённая ЗП: итог считается", () => {
    const s = buildProfitSummary({ ...base, salary: 0 });
    expect(s.profit).toBe(620_000);
  });

  it("личные заправки в расходы не входят", () => {
    const s = buildProfitSummary({ ...base, personalFuelCost: 999_999 });
    expect(s.profit).toBe(420_000);
    expect(s.details.personalFuelCost).toBe(999_999);
  });

  it("показывает убыток отрицательной прибылью", () => {
    const s = buildProfitSummary({ ...base, revenue: 100_000 });
    expect(s.taxes).toBe(10_000);
    expect(s.profit).toBe(-390_000);
  });

  it("итог сходится с суммой показанных строк на копеечных суммах", () => {
    const s = buildProfitSummary({
      ...base,
      revenue: 1_234_567.89,
      fuelCost: 123_456.785,
      serviceCost: 10_000.335,
      repairCost: 0.1 + 0.2,
      royalties: 61_728.39,
      salary: 333_333.33,
    });
    expect(s.taxes).toBe(123_456.79);
    const lines = s.taxes + s.fuel + s.maintenance + s.royalties + s.salary!;
    expect(s.totalExpenses).toBe(Math.round(lines * 100) / 100);
    expect(s.profit).toBe(Math.round((s.revenue - s.totalExpenses!) * 100) / 100);
  });

  it("пустой месяц с введённой ЗП — убыток на сумму ЗП", () => {
    const s = buildProfitSummary({ yearMonth: "2026-01", revenue: 0, fuelCost: 0, personalFuelCost: 0, serviceCost: 0, repairCost: 0, royalties: 0, salary: 50_000 });
    expect(s.profit).toBe(-50_000);
  });
});
