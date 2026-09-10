import { describe, expect, it } from "vitest";
import { computeFifoConsumption, InsufficientFuelError } from "../src/lib/fifo.js";

describe("computeFifoConsumption", () => {
  it("списывает из самой старой партии, пока она не закончится (контрольный пример)", () => {
    const lots = [
      { id: 1, litersRemaining: 100, pricePerLiter: 10, valueRemaining: 1000 },
      { id: 2, litersRemaining: 100, pricePerLiter: 15, valueRemaining: 1500 },
    ];

    const first = computeFifoConsumption(lots, 60);
    expect(first.usages).toEqual([{ lotId: 1, litersUsed: 60, pricePerLiterAtUse: 10, cost: 600 }]);
    expect(first.totalCost).toBe(600);
    expect(first.updatedLots).toEqual([{ id: 1, litersRemaining: 40, valueRemaining: 400 }]);

    // применяем результат первого списания к партиям для второго шага
    const lotsAfterFirst = [
      { id: 1, litersRemaining: 40, pricePerLiter: 10, valueRemaining: 400 },
      { id: 2, litersRemaining: 100, pricePerLiter: 15, valueRemaining: 1500 },
    ];

    const second = computeFifoConsumption(lotsAfterFirst, 80);
    expect(second.usages).toEqual([
      { lotId: 1, litersUsed: 40, pricePerLiterAtUse: 10, cost: 400 },
      { lotId: 2, litersUsed: 40, pricePerLiterAtUse: 15, cost: 600 },
    ]);
    expect(second.totalCost).toBe(1000);
    expect(second.updatedLots).toEqual([
      { id: 1, litersRemaining: 0, valueRemaining: 0 },
      { id: 2, litersRemaining: 60, valueRemaining: 900 },
    ]);
  });

  it("выбрасывает InsufficientFuelError при нехватке остатка и ничего не меняет", () => {
    const lots = [{ id: 1, litersRemaining: 10, pricePerLiter: 10, valueRemaining: 100 }];

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
      { id: 1, litersRemaining: 0, pricePerLiter: 10, valueRemaining: 0 },
      { id: 2, litersRemaining: 50, pricePerLiter: 20, valueRemaining: 1000 },
    ];

    const result = computeFifoConsumption(lots, 30);
    expect(result.usages).toEqual([{ lotId: 2, litersUsed: 30, pricePerLiterAtUse: 20, cost: 600 }]);
    expect(result.totalCost).toBe(600);
  });

  it("списывает ровно весь остаток без ошибки", () => {
    const lots = [{ id: 1, litersRemaining: 25, pricePerLiter: 12.5, valueRemaining: 312.5 }];
    const result = computeFifoConsumption(lots, 25);
    expect(result.totalCost).toBe(312.5);
    expect(result.updatedLots).toEqual([{ id: 1, litersRemaining: 0, valueRemaining: 0 }]);
  });

  it("не теряет копейки на округлении цены за литр при полном списании партии (ревью, P1)", () => {
    // Партия: 3 л за 100 ₽ ровно → цена за литр округляется до 33.33 (33.33(3) не хранится),
    // но списание всей партии должно стоить ровно 100 ₽, а не 33.33*3=99.99.
    const lots = [{ id: 1, litersRemaining: 3, pricePerLiter: 33.33, valueRemaining: 100 }];
    const result = computeFifoConsumption(lots, 3);
    expect(result.totalCost).toBe(100);
    expect(result.usages).toEqual([{ lotId: 1, litersUsed: 3, pricePerLiterAtUse: 33.33, cost: 100 }]);
    expect(result.updatedLots).toEqual([{ id: 1, litersRemaining: 0, valueRemaining: 0 }]);
  });

  it("частичное списание считается пропорционально остатку суммы партии, остаток переносится", () => {
    const lots = [{ id: 1, litersRemaining: 3, pricePerLiter: 33.33, valueRemaining: 100 }];
    const result = computeFifoConsumption(lots, 1);
    // Частичное списание — не последняя порция партии: round2(100*1/3).
    expect(result.totalCost).toBe(33.33);
    expect(result.updatedLots).toEqual([{ id: 1, litersRemaining: 2, valueRemaining: 66.67 }]);

    // Остаток партии (2 л) списываем целиком — забираем весь оставшийся хвост суммы.
    const rest = computeFifoConsumption(result.updatedLots.map((l, i) => ({ ...lots[i], ...l })), 2);
    expect(rest.totalCost).toBe(66.67);
    // Сумма обеих операций точно равна исходной сумме партии, без потери копейки.
    expect(round2(result.totalCost + rest.totalCost)).toBe(100);
  });

  it("не даёт отрицательную стоимость на округлённой вверх цене за литр при большом объёме (повторное ревью, P1)", () => {
    // 1000 л за 60005 ₽ → цена за литр округляется до 60.01 (60.005 -> вверх).
    // Списание 999.99 л старым алгоритмом (take*pricePerLiter) стоило бы
    // 60009.40 — на 5 ₽ больше настоящей доли, и последний 0.01 л ушёл бы
    // в минус. Новый алгоритм считает долю от остатка суммы, а не от
    // округлённой цены за литр умноженной на объём.
    const lots = [{ id: 1, litersRemaining: 1000, pricePerLiter: 60.01, valueRemaining: 60005 }];

    const first = computeFifoConsumption(lots, 999.99);
    expect(first.totalCost).toBeGreaterThan(0);
    expect(first.updatedLots[0].valueRemaining).toBeGreaterThanOrEqual(0);

    const second = computeFifoConsumption(
      first.updatedLots.map((l) => ({ ...lots[0], ...l })),
      0.01,
    );
    expect(second.totalCost).toBeGreaterThanOrEqual(0);
    expect(round2(first.totalCost + second.totalCost)).toBe(60005);
  });

  it("две частичные заправки из литровой партии в сумме дают точную стоимость партии (повторное ревью, P1)", () => {
    // 1 л за 60.01 ₽, две заправки по 0.5 л. Старый алгоритм (округлённая
    // цена за литр * объём для каждой) давал 30.01+30.01=60.02 — на копейку
    // больше исходной суммы прихода.
    const lots = [{ id: 1, litersRemaining: 1, pricePerLiter: 60.01, valueRemaining: 60.01 }];
    const first = computeFifoConsumption(lots, 0.5);
    const second = computeFifoConsumption(
      first.updatedLots.map((l) => ({ ...lots[0], ...l })),
      0.5,
    );
    expect(round2(first.totalCost + second.totalCost)).toBe(60.01);
  });
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
