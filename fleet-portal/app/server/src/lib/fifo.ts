// Чистая логика списания топлива по FIFO (без обращения к БД) — списываем
// сначала из самой старой партии, пока она не закончится, потом переходим
// к следующей. Одно списание может "занимать" топливо из нескольких партий.

const EPSILON = 1e-9;

export interface FifoLot {
  id: number;
  litersRemaining: number;
  pricePerLiter: number;
}

export interface FifoUsage {
  lotId: number;
  litersUsed: number;
  pricePerLiterAtUse: number;
}

export interface FifoUpdatedLot {
  id: number;
  litersRemaining: number;
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
    usages.push({ lotId: lot.id, litersUsed: take, pricePerLiterAtUse: lot.pricePerLiter });
    updatedLots.push({ id: lot.id, litersRemaining: lot.litersRemaining - take });
    totalCost += take * lot.pricePerLiter;
    remaining -= take;
  }

  return { usages, updatedLots, totalCost };
}
