// Чистая логика списания топлива по FIFO (без обращения к БД) — списываем
// сначала из самой старой партии, пока она не закончится, потом переходим
// к следующей. Одно списание может "занимать" топливо из нескольких партий.
import { round2 } from "./money.js";

const EPSILON = 1e-9;

export interface FifoLot {
  id: number;
  litersRemaining: number;
  pricePerLiter: number;
  /** Сколько от исходной суммы партии ещё не отнесено на предыдущие списания. */
  valueRemaining: number;
}

export interface FifoUsage {
  lotId: number;
  litersUsed: number;
  pricePerLiterAtUse: number;
  /** Реальная стоимость этой порции (не всегда litersUsed*pricePerLiterAtUse — см. ниже). */
  cost: number;
}

export interface FifoUpdatedLot {
  id: number;
  litersRemaining: number;
  valueRemaining: number;
}

export interface FifoConsumptionResult {
  usages: FifoUsage[];
  updatedLots: FifoUpdatedLot[];
  totalCost: number;
}

export class InsufficientFuelError extends Error {
  readonly available: number;
  readonly requested: number;

  constructor(available: number, requested: number) {
    super(`Недостаточно топлива: запрошено ${requested} л, в наличии ${available} л`);
    this.name = "InsufficientFuelError";
    this.available = available;
    this.requested = requested;
  }
}

/**
 * lotsOldestFirst — партии одного вида топлива с остатком > 0, уже
 * отсортированные от самой старой к самой новой (по дате, затем по id).
 */
export function computeFifoConsumption(lotsOldestFirst: FifoLot[], litersRequested: number): FifoConsumptionResult {
  if (litersRequested <= 0) {
    throw new Error("litersRequested должен быть положительным");
  }

  const totalAvailable = lotsOldestFirst.reduce((sum, lot) => sum + lot.litersRemaining, 0);
  if (totalAvailable + EPSILON < litersRequested) {
    throw new InsufficientFuelError(totalAvailable, litersRequested);
  }

  let remaining = litersRequested;
  const usages: FifoUsage[] = [];
  const updatedLots: FifoUpdatedLot[] = [];
  let totalCost = 0;

  for (const lot of lotsOldestFirst) {
    if (remaining <= EPSILON) break;
    if (lot.litersRemaining <= EPSILON) continue;

    const take = Math.min(lot.litersRemaining, remaining);
    const drainsLot = take >= lot.litersRemaining - EPSILON;
    // Стоимость порции — пропорциональная доля от ТЕКУЩЕГО остатка суммы
    // партии (valueRemaining/litersRemaining), а НЕ take*pricePerLiter:
    // pricePerLiter округлена до копеек один раз при приходе, и умножение
    // этой округлённой цены на большой объём может ощутимо разойтись с
    // реальной суммой (при 999.99 л разница набегает на несколько рублей,
    // а не на копейку — повторное ревью воспроизвело даже отрицательную
    // стоимость последнего "хвоста"). Последнее списание, опустошающее
    // партию, забирает весь оставшийся остаток целиком (округлённый заранее),
    // а не пропорцию — так сумма всех списаний с партии всегда точно равна
    // totalAmount, без накопленной ошибки и без отрицательного хвоста.
    const cost = drainsLot ? round2(lot.valueRemaining) : round2((lot.valueRemaining * take) / lot.litersRemaining);

    usages.push({ lotId: lot.id, litersUsed: take, pricePerLiterAtUse: lot.pricePerLiter, cost });
    updatedLots.push({
      id: lot.id,
      litersRemaining: lot.litersRemaining - take,
      valueRemaining: drainsLot ? 0 : round2(lot.valueRemaining - cost),
    });
    totalCost += cost;
    remaining -= take;
  }

  return { usages, updatedLots, totalCost };
}
