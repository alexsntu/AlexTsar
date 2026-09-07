import { describe, expect, it } from "vitest";
import { computeFifoConsumption, InsufficientFuelError } from "../src/lib/fifo.js";

describe("computeFifoConsumption", () => {
  it("списывает из самой старой партии, пока она не закончится (контрольный пример)", () => {
    const lots = [
      { id: 1, litersRemaining: 100, pricePerLiter: 10 },
      { id: 2, litersRemaining: 100, pricePerLiter: 15 },
    ];

    const first = computeFifoConsumption(lots, 60);
    expect(first.usages).toEqual([{ lotId: 1, litersUsed: 60, pricePerLiterAtUse: 10 }]);
    expect(first.totalCost).toBe(600);
    expect(first.updatedLots).toEqual([{ id: 1, litersRemaining: 40 }]);

    // применяем результат первого списания к партиям для второго шага
    const lotsAfterFirst = [
      { id: 1, litersRemaining: 40, pricePerLiter: 10 },
      { id: 2, litersRemaining: 100, pricePerLiter: 15 },
    ];

    const second = computeFifoConsumption(lotsAfterFirst, 80);
    expect(second.usages).toEqual([
      { lotId: 1, litersUsed: 40, pricePerLiterAtUse: 10 },
      { lotId: 2, litersUsed: 40, pricePerLiterAtUse: 15 },
    ]);
    expect(second.totalCost).toBe(1000);
    expect(second.updatedLots).toEqual([
      { id: 1, litersRemaining: 0 },
      { id: 2, litersRemaining: 60 },
    ]);
  });

  it("выбрасывает InsufficientFuelError при нехватке остатка и ничего не меняет", () => {
    const lots = [{ id: 1, litersRemaining: 10, pricePerLiter: 10 }];

    expect(() => computeFifoConsumption(lots, 50)).toThrow(InsufficientFuelError);
    try {
      computeFifoConsumption(lots, 50);
    } catch (error) {
      expect(error).toBeInstanceOf(InsufficientFuelError);
      expect((error as InsufficientFuelError).available).toBe(10);
      expect((error as InsufficientFuelError).requested).toBe(50);
    }
  });

  it("пропускает уже пустые партии и берёт из следующей", () => {
    const lots = [
      { id: 1, litersRemaining: 0, pricePerLiter: 10 },
      { id: 2, litersRemaining: 50, pricePerLiter: 20 },
    ];

    const result = computeFifoConsumption(lots, 30);
    expect(result.usages).toEqual([{ lotId: 2, litersUsed: 30, pricePerLiterAtUse: 20 }]);
    expect(result.totalCost).toBe(600);
  });

  it("списывает ровно весь остаток без ошибки", () => {
    const lots = [{ id: 1, litersRemaining: 25, pricePerLiter: 12.5 }];
    const result = computeFifoConsumption(lots, 25);
    expect(result.totalCost).toBe(312.5);
    expect(result.updatedLots).toEqual([{ id: 1, litersRemaining: 0 }]);
  });
});
