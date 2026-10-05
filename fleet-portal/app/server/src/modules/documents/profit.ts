import type { PrismaClient } from "@prisma/client";
import { round2 } from "../../lib/money.js";
import { mskDayStart } from "../../lib/date.js";
import { getMonthDeliveries, monthRange, totalCost } from "./queries.js";
import { buildRoyaltySummary, listRoyalties } from "./royalties.js";

/** Налоги считаются как фиксированный процент от суммы услуг за месяц. */
export const TAX_PERCENT = 10;

export interface ProfitInputs {
  yearMonth: string;
  revenue: number;
  fuelCost: number;
  personalFuelCost: number;
  serviceCost: number;
  repairCost: number;
  royalties: number;
  /** null — ЗП за этот месяц ещё не введена. */
  salary: number | null;
}

export interface ProfitSummary {
  yearMonth: string;
  revenue: number;
  taxPercent: number;
  taxes: number;
  fuel: number;
  maintenance: number;
  royalties: number;
  salary: number | null;
  // Без введённой ЗП итог не считаем вообще (а не показываем "прибыль без
  // ЗП") — иначе завышенную цифру легко принять за настоящую прибыль.
  totalExpenses: number | null;
  profit: number | null;
  details: {
    serviceCost: number;
    repairCost: number;
    // Личные заправки в расходы предприятия не входят (как и в отчётах
    // раздела "Топливо") — отдаём отдельно, только для справки.
    personalFuelCost: number;
  };
}

export function buildProfitSummary(input: ProfitInputs): ProfitSummary {
  const revenue = round2(input.revenue);
  const taxes = round2(revenue * (TAX_PERCENT / 100));
  const fuel = round2(input.fuelCost);
  const serviceCost = round2(input.serviceCost);
  const repairCost = round2(input.repairCost);
  const maintenance = round2(serviceCost + repairCost);
  const royalties = round2(input.royalties);
  const salary = input.salary === null ? null : round2(input.salary);

  // Итог — из уже округлённых статей, чтобы он всегда сходился с суммой
  // строк, которые видит пользователь (тот же приём, что в queries.ts).
  const totalExpenses = salary === null ? null : round2(taxes + fuel + maintenance + royalties + salary);
  const profit = totalExpenses === null ? null : round2(revenue - totalExpenses);

  return {
    yearMonth: input.yearMonth,
    revenue,
    taxPercent: TAX_PERCENT,
    taxes,
    fuel,
    maintenance,
    royalties,
    salary,
    totalExpenses,
    profit,
    details: { serviceCost, repairCost, personalFuelCost: round2(input.personalFuelCost) },
  };
}

/** Заправки и ТО/ремонты — реальные метки времени, поэтому границы месяца
 * для них московские (как в отчётах этих разделов), в отличие от Delivery,
 * где даты календарные и границы в UTC (см. monthRange в queries.ts). */
function mskMonthRange(yearMonth: string): { start: Date; end: Date } {
  const { start, end } = monthRange(yearMonth);
  return { start: mskDayStart(start)!, end: mskDayStart(end)! };
}

export async function getProfitSummary(prisma: PrismaClient, yearMonth: string): Promise<ProfitSummary> {
  const { start, end } = mskMonthRange(yearMonth);
  const [deliveries, royaltyConfigs, withdrawals, maintenanceRecords, payroll] = await Promise.all([
    getMonthDeliveries(prisma, yearMonth),
    listRoyalties(prisma),
    prisma.fuelWithdrawal.findMany({ where: { date: { gte: start, lt: end } }, select: { totalCost: true, isPersonal: true } }),
    prisma.maintenanceRecord.findMany({ where: { date: { gte: start, lt: end } }, select: { totalCost: true, type: true } }),
    prisma.monthPayroll.findUnique({ where: { yearMonth } }),
  ]);

  const sum = (rows: { totalCost: number }[]) => rows.reduce((acc, r) => acc + r.totalCost, 0);

  return buildProfitSummary({
    yearMonth,
    revenue: totalCost(deliveries),
    fuelCost: sum(withdrawals.filter((w) => !w.isPersonal)),
    personalFuelCost: sum(withdrawals.filter((w) => w.isPersonal)),
    serviceCost: sum(maintenanceRecords.filter((r) => r.type === "SERVICE")),
    repairCost: sum(maintenanceRecords.filter((r) => r.type !== "SERVICE")),
    royalties: buildRoyaltySummary(deliveries, royaltyConfigs).grandTotal,
    salary: payroll ? payroll.amount : null,
  });
}
