import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type {
  ConsumptionReport,
  FuelBalanceRow,
  FuelLot,
  FuelType,
  FuelWithdrawal,
  InflowReport,
  Per100KmReport,
  Truck,
} from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";
import { todayLocalDateString } from "../../lib/date";

const TABS = ["Приход", "Заправки", "Отчёты"] as const;
type Tab = (typeof TABS)[number];

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Границы месяца по строке "YYYY-MM" — без Date/toISOString, поэтому без сдвига часового пояса. */
function monthToRange(yyyyMm: string): { from: string; to: string } {
  const [y, m] = yyyyMm.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  return { from: `${yyyyMm}-01`, to: `${yyyyMm}-${String(lastDay).padStart(2, "0")}` };
}

function yearToRange(year: string): { from: string; to: string } {
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function FuelBalanceStrip({ balance }: { balance: FuelBalanceRow[] | null }) {
  if (!balance || balance.length === 0) return null;
  return (
    <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
      <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide mb-2">
        На балансе сейчас (в наличии)
      </p>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        {balance.map((row) => (
          <div key={row.fuelTypeId} className="flex items-baseline gap-1.5">
            <span className="text-sm text-slate-700">{row.fuelTypeName}:</span>
            <span className="text-base font-bold text-emerald-700">{fmt(row.liters)} л</span>
            <span className="text-xs text-slate-500">({fmt(row.value)} ₽)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LotsSection() {
  const { data: fuelTypes } = useApi<FuelType[]>("/api/fuel-types");
  const { data: lots, reload } = useApi<FuelLot[]>("/api/fuel/lots");
  const { data: balance, reload: reloadBalance } = useApi<FuelBalanceRow[]>("/api/fuel/reports/balance");

  const [fuelTypeId, setFuelTypeId] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [liters, setLiters] = useState("");
  const [pricePerLiter, setPricePerLiter] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/fuel/lots", {
        fuelTypeId: Number(fuelTypeId),
        date,
        liters: Number(liters),
        pricePerLiter: pricePerLiter ? Number(pricePerLiter) : undefined,
        totalAmount: totalAmount ? Number(totalAmount) : undefined,
        supplier: supplier || undefined,
      });
      setLiters("");
      setPricePerLiter("");
      setTotalAmount("");
      setSupplier("");
      await Promise.all([reload(), reloadBalance()]);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      {/* Баланс и дашборд видны всегда; форма добавления и журнал партий — по клику, чтобы не отвлекали. */}
      <FuelBalanceStrip balance={balance} />
      <InOutDashboard />
      <Card title="Приход топлива" collapsible>
        <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
          <div className="w-40">
            <Field label="Вид топлива">
              <Select value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)} required>
                <option value="">—</option>
                {(fuelTypes ?? []).map((ft) => (
                  <option key={ft.id} value={ft.id}>
                    {ft.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <div className="w-28">
            <Field label="Литры">
              <Input type="number" min="0" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Цена за литр">
              <Input type="number" min="0" step="0.01" value={pricePerLiter} onChange={(e) => setPricePerLiter(e.target.value)} />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Или сумма">
              <Input type="number" min="0" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Поставщик">
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </Field>
          </div>
          <Button type="submit">Добавить приход</Button>
        </form>
        <ErrorText>{error}</ErrorText>
        <Table head={["Дата", "Вид топлива", "Приход, л", "Цена/л", "Сумма", "Остаток, л"]}>
          {(lots ?? []).map((lot) => (
            <tr key={lot.id}>
              <td className="py-2 pr-4">{lot.date.slice(0, 10)}</td>
              <td className="py-2 pr-4">{lot.fuelType?.name}</td>
              <td className="py-2 pr-4">{fmt(lot.litersIn)}</td>
              <td className="py-2 pr-4">{fmt(lot.pricePerLiter)}</td>
              <td className="py-2 pr-4">{fmt(lot.totalAmount)}</td>
              <td className="py-2 pr-4">{fmt(lot.litersRemaining)}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

/** Общее состояние выбора периода (месяц/год) для дашбордов топлива. */
function usePeriodRange() {
  const [periodMode, setPeriodMode] = useState<"month" | "year">("month");
  const [month, setMonth] = useState(() => currentYearMonth());
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  const { from, to } = periodMode === "month" ? monthToRange(month) : yearToRange(year);
  return { periodMode, setPeriodMode, month, setMonth, year, setYear, from, to };
}

function PeriodModeSelector({ state }: { state: ReturnType<typeof usePeriodRange> }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-4">
      <div className="flex gap-1">
        <button
          onClick={() => state.setPeriodMode("month")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${state.periodMode === "month" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Месяц
        </button>
        <button
          onClick={() => state.setPeriodMode("year")}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium ${state.periodMode === "year" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
        >
          Год
        </button>
      </div>
      {state.periodMode === "month" ? (
        <div className="w-40">
          <Field label="Месяц">
            <Input type="month" value={state.month} onChange={(e) => state.setMonth(e.target.value)} />
          </Field>
        </div>
      ) : (
        <div className="w-28">
          <Field label="Год">
            <Input type="number" min="2020" max="2100" value={state.year} onChange={(e) => state.setYear(e.target.value)} />
          </Field>
        </div>
      )}
    </div>
  );
}

function FuelDashboard() {
  const period = usePeriodRange();
  const { data: trucks } = useApi<Truck[]>("/api/trucks");
  const [report, setReport] = useState<ConsumptionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "" — сводная таблица по всем машинам; иначе — детальный список заправок
  // этой конкретной машины за тот же период (когда, сколько).
  const [selectedTruckId, setSelectedTruckId] = useState("");
  const [truckDetails, setTruckDetails] = useState<FuelWithdrawal[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .get<ConsumptionReport>(`/api/fuel/reports/consumption?${new URLSearchParams({ groupBy: "truck", from: period.from, to: period.to })}`)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  useEffect(() => {
    if (!selectedTruckId) {
      setTruckDetails(null);
      return;
    }
    let cancelled = false;
    api
      .get<FuelWithdrawal[]>(
        `/api/fuel/withdrawals?${new URLSearchParams({ truckId: selectedTruckId, from: period.from, to: period.to })}`,
      )
      .then((r) => {
        if (!cancelled) setTruckDetails(r);
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTruckId, period.from, period.to]);

  // Показываем ВСЕ действующие машины, даже с 0 заправок за период — отчёт
  // отдаёт строку только если у машины реально была хоть одна заправка,
  // поэтому недостающие достраиваем нулями сами.
  const reportedRows = (report?.rows ?? []).filter((r) => r.key !== "personal");
  const reportedTruckIds = new Set(reportedRows.map((r) => r.key));
  const zeroRows = (trucks ?? [])
    .filter((t) => !reportedTruckIds.has(t.id))
    .map((t) => ({
      key: t.id,
      label: `${t.name} (${t.plateNumber})`,
      count: 0,
      companyLiters: 0,
      companyCost: 0,
      personalLiters: 0,
      personalCost: 0,
    }));
  const truckRows = [...reportedRows, ...zeroRows].sort((a, b) => a.label.localeCompare(b.label, "ru"));

  return (
    <Card title="Дашборд по заправкам">
      <PeriodModeSelector state={period} />
      <div className="w-56 mb-4">
        <Field label="Машина — посмотреть детально">
          <Select value={selectedTruckId} onChange={(e) => setSelectedTruckId(e.target.value)}>
            <option value="">Все машины (сводка)</option>
            {(trucks ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name} ({t.plateNumber})
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <ErrorText>{error}</ErrorText>

      {selectedTruckId ? (
        truckDetails && (
          <>
            <Table head={["Дата", "Литры", "Сумма, ₽", "Одометр"]}>
              {truckDetails.map((w) => (
                <tr key={w.id}>
                  <td className="py-2 pr-4">{w.date.slice(0, 10)}</td>
                  <td className="py-2 pr-4">{fmt(w.liters)}</td>
                  <td className="py-2 pr-4">{fmt(w.totalCost)} ₽</td>
                  <td className="py-2 pr-4">{w.odometer != null ? `${fmt(w.odometer)} км` : "—"}</td>
                </tr>
              ))}
            </Table>
            {truckDetails.length === 0 && <p className="text-sm text-slate-500">За этот период у этой машины заправок не было</p>}
            {truckDetails.length > 0 && (
              <div className="text-sm mt-3 text-slate-600 flex flex-col sm:flex-row sm:flex-wrap gap-y-1 sm:gap-x-2">
                <span>
                  Заправок: <strong>{truckDetails.length}</strong>
                </span>
                <span>
                  Всего:{" "}
                  <strong>
                    {fmt(truckDetails.reduce((s, w) => s + w.liters, 0))} л /{" "}
                    {fmt(truckDetails.reduce((s, w) => s + w.totalCost, 0))} ₽
                  </strong>
                </span>
              </div>
            )}
          </>
        )
      ) : (
        report && (
          <>
            <Table head={["Машина", "Заправок", "Литров", "Сумма, ₽"]}>
              {truckRows.map((r) => (
                <tr key={String(r.key)}>
                  <td className="py-2 pr-4">{r.label}</td>
                  <td className="py-2 pr-4">{r.count}</td>
                  <td className="py-2 pr-4">{fmt(r.companyLiters)}</td>
                  <td className="py-2 pr-4">{fmt(r.companyCost)} ₽</td>
                </tr>
              ))}
            </Table>
            {truckRows.length === 0 && <p className="text-sm text-slate-500">За этот период заправок машин не было</p>}
            <div className="text-sm mt-3 text-slate-600 flex flex-col sm:flex-row sm:flex-wrap gap-y-1 sm:gap-x-2">
              <span>
                Заправлено машин: <strong>{reportedRows.length}</strong> из <strong>{truckRows.length}</strong>
              </span>
              <span>
                Всего по машинам:{" "}
                <strong>
                  {fmt(report.totals.companyLiters)} л / {fmt(report.totals.companyCost)} ₽
                </strong>
              </span>
              {report.totals.personalLiters > 0 && (
                <span>
                  Личное (не в счёт предприятия):{" "}
                  <strong>
                    {fmt(report.totals.personalLiters)} л / {fmt(report.totals.personalCost)} ₽
                  </strong>
                </span>
              )}
            </div>
          </>
        )
      )}
    </Card>
  );
}

function InOutDashboard() {
  const period = usePeriodRange();
  const [inflow, setInflow] = useState<InflowReport | null>(null);
  const [outflow, setOutflow] = useState<ConsumptionReport | null>(null);
  const [lots, setLots] = useState<FuelLot[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    Promise.all([
      api.get<InflowReport>(`/api/fuel/reports/inflow?${new URLSearchParams({ from: period.from, to: period.to })}`),
      api.get<ConsumptionReport>(
        `/api/fuel/reports/consumption?${new URLSearchParams({ groupBy: "fuelType", from: period.from, to: period.to })}`,
      ),
      api.get<FuelLot[]>(`/api/fuel/lots?${new URLSearchParams({ from: period.from, to: period.to })}`),
    ])
      .then(([inflowReport, outflowReport, lotsList]) => {
        if (!cancelled) {
          setInflow(inflowReport);
          setOutflow(outflowReport);
          setLots(lotsList);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(describeError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [period.from, period.to]);

  // Сводим приход и расход по видам топлива в одну таблицу — ушло считаем
  // и служебное, и личное (реально покинуло склад в обоих случаях).
  const fuelTypeIds = new Set<number>();
  (inflow?.rows ?? []).forEach((r) => fuelTypeIds.add(r.fuelTypeId));
  (outflow?.rows ?? []).forEach((r) => {
    if (typeof r.key === "number") fuelTypeIds.add(r.key);
  });

  const combinedRows = Array.from(fuelTypeIds).map((id) => {
    const inRow = inflow?.rows.find((r) => r.fuelTypeId === id);
    const outRow = outflow?.rows.find((r) => r.key === id);
    return {
      fuelTypeId: id,
      name: inRow?.fuelTypeName ?? outRow?.label ?? "—",
      inLiters: inRow?.liters ?? 0,
      inCost: inRow?.cost ?? 0,
      outLiters: (outRow?.companyLiters ?? 0) + (outRow?.personalLiters ?? 0),
      outCost: (outRow?.companyCost ?? 0) + (outRow?.personalCost ?? 0),
    };
  });

  const totalOutLiters = (outflow?.totals.companyLiters ?? 0) + (outflow?.totals.personalLiters ?? 0);
  const totalOutCost = (outflow?.totals.companyCost ?? 0) + (outflow?.totals.personalCost ?? 0);

  return (
    <Card title="Приход и расход топлива за период">
      <PeriodModeSelector state={period} />
      <ErrorText>{error}</ErrorText>
      {(inflow || outflow) && (
        <>
          <Table head={["Вид топлива", "Пришло, л", "Пришло, ₽", "Ушло, л", "Ушло, ₽"]}>
            {combinedRows.map((r) => (
              <tr key={r.fuelTypeId}>
                <td className="py-2 pr-4">{r.name}</td>
                <td className="py-2 pr-4">{fmt(r.inLiters)}</td>
                <td className="py-2 pr-4">{fmt(r.inCost)} ₽</td>
                <td className="py-2 pr-4">{fmt(r.outLiters)}</td>
                <td className="py-2 pr-4">{fmt(r.outCost)} ₽</td>
              </tr>
            ))}
          </Table>
          {combinedRows.length === 0 && <p className="text-sm text-slate-500">За этот период движений топлива не было</p>}
          <p className="text-sm mt-3 text-slate-600">
            Итого пришло:{" "}
            <strong>
              {fmt(inflow?.totals.liters ?? 0)} л / {fmt(inflow?.totals.cost ?? 0)} ₽
            </strong>
            {" · "}
            Итого ушло:{" "}
            <strong>
              {fmt(totalOutLiters)} л / {fmt(totalOutCost)} ₽
            </strong>
          </p>

          {lots && lots.length > 0 && (
            <details className="mt-4 [&_summary::-webkit-details-marker]:hidden group">
              <summary className="text-sm text-sky-600 cursor-pointer select-none list-none flex items-center gap-1.5 w-fit">
                <span className="text-slate-400 text-xs transition-transform group-open:rotate-90">▶</span>
                Каждый приход отдельно ({lots.length})
              </summary>
              <div className="mt-2">
                <Table head={["Дата", "Вид топлива", "Литры", "Цена/л", "Сумма"]}>
                  {lots.map((lot) => (
                    <tr key={lot.id}>
                      <td className="py-2 pr-4">{lot.date.slice(0, 10)}</td>
                      <td className="py-2 pr-4">{lot.fuelType?.name}</td>
                      <td className="py-2 pr-4">{fmt(lot.litersIn)}</td>
                      <td className="py-2 pr-4">{fmt(lot.pricePerLiter)} ₽</td>
                      <td className="py-2 pr-4">{fmt(lot.totalAmount)} ₽</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </details>
          )}
        </>
      )}
    </Card>
  );
}

function WithdrawalsSection() {
  const { data: fuelTypes } = useApi<FuelType[]>("/api/fuel-types");
  const { data: trucks } = useApi<Truck[]>("/api/trucks");
  const { data: withdrawals, reload } = useApi<FuelWithdrawal[]>("/api/fuel/withdrawals");
  const { data: balance, reload: reloadBalance } = useApi<FuelBalanceRow[]>("/api/fuel/reports/balance");

  const [fuelTypeId, setFuelTypeId] = useState("");
  const [date, setDate] = useState(() => todayLocalDateString());
  const [liters, setLiters] = useState("");
  const [isPersonal, setIsPersonal] = useState(false);
  const [truckId, setTruckId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [personalComment, setPersonalComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Один и тот же ключ на все попытки отправить текущую заправку — повтор
  // (двойной клик, ретрай при обрыве связи) не спишет топливо дважды.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/api/fuel/withdrawals", {
        fuelTypeId: Number(fuelTypeId),
        date,
        liters: Number(liters),
        isPersonal,
        truckId: isPersonal ? undefined : Number(truckId),
        odometer: !isPersonal && odometer ? Number(odometer) : undefined,
        personalComment: isPersonal ? personalComment : undefined,
        idempotencyKey,
      });
      setLiters("");
      setOdometer("");
      setPersonalComment("");
      setIdempotencyKey(crypto.randomUUID());
      await Promise.all([reload(), reloadBalance()]);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <FuelBalanceStrip balance={balance} />
      <FuelDashboard />
      <Card title="Заправка (списание топлива)" collapsible>
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
        <div className="w-40">
          <Field label="Вид топлива">
            <Select value={fuelTypeId} onChange={(e) => setFuelTypeId(e.target.value)} required>
              <option value="">—</option>
              {(fuelTypes ?? []).map((ft) => (
                <option key={ft.id} value={ft.id}>
                  {ft.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="w-36">
          <Field label="Дата">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Литры">
            <Input type="number" min="0" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Получатель">
            <Select value={isPersonal ? "personal" : "truck"} onChange={(e) => setIsPersonal(e.target.value === "personal")}>
              <option value="truck">Служебный транспорт</option>
              <option value="personal">Личное авто</option>
            </Select>
          </Field>
        </div>
        {isPersonal ? (
          <div className="w-64">
            <Field label="Чьё авто (комментарий)">
              <Input value={personalComment} onChange={(e) => setPersonalComment(e.target.value)} required />
            </Field>
          </div>
        ) : (
          <>
            <div className="w-40">
              <Field label="Машина">
                <Select value={truckId} onChange={(e) => setTruckId(e.target.value)} required>
                  <option value="">—</option>
                  {(trucks ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} ({t.plateNumber})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="w-32">
              <Field label="Одометр">
                <Input type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
              </Field>
            </div>
          </>
        )}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Заправляем…" : "Заправить"}
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <Table head={["Дата", "Вид топлива", "Литры", "Сумма", "Получатель"]}>
        {(withdrawals ?? []).map((w) => (
          <tr key={w.id}>
            <td className="py-2 pr-4">{w.date.slice(0, 10)}</td>
            <td className="py-2 pr-4">{w.fuelType?.name}</td>
            <td className="py-2 pr-4">{fmt(w.liters)}</td>
            <td className="py-2 pr-4">{fmt(w.totalCost)}</td>
            <td className="py-2 pr-4">
              {w.isPersonal ? (
                <Badge tone="amber">Личное: {w.personalComment}</Badge>
              ) : (
                <Badge tone="green">
                  {w.truck?.name} ({w.truck?.plateNumber})
                </Badge>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </Card>
    </div>
  );
}

function ReportsSection() {
  const { data: balance } = useApi<FuelBalanceRow[]>("/api/fuel/reports/balance");
  const { data: trucks } = useApi<Truck[]>("/api/trucks");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<"fuelType" | "truck">("truck");
  const [consumption, setConsumption] = useState<ConsumptionReport | null>(null);

  const [per100kmTruckId, setPer100kmTruckId] = useState("");
  const [per100kmFrom, setPer100kmFrom] = useState("");
  const [per100kmTo, setPer100kmTo] = useState("");
  const [per100km, setPer100km] = useState<Per100KmReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadConsumption() {
    setError(null);
    try {
      const params = new URLSearchParams({ groupBy });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const report = await api.get<ConsumptionReport>(`/api/fuel/reports/consumption?${params}`);
      setConsumption(report);
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function loadPer100km() {
    setError(null);
    try {
      const params = new URLSearchParams({ truckId: per100kmTruckId });
      if (per100kmFrom) params.set("from", per100kmFrom);
      if (per100kmTo) params.set("to", per100kmTo);
      const report = await api.get<Per100KmReport>(`/api/fuel/reports/per-100km?${params}`);
      setPer100km(report);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      <Card title="Текущий остаток топлива">
        <Table head={["Вид топлива", "Остаток, л", "Стоимость остатка"]}>
          {(balance ?? []).map((row) => (
            <tr key={row.fuelTypeId}>
              <td className="py-2 pr-4">{row.fuelTypeName}</td>
              <td className="py-2 pr-4">{fmt(row.liters)}</td>
              <td className="py-2 pr-4">{fmt(row.value)}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Расход топлива за период">
        <div className="flex gap-2 items-end mb-4 flex-wrap">
          <div className="w-36">
            <Field label="С">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="По">
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <div className="w-40">
            <Field label="Группировка">
              <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "fuelType" | "truck")}>
                <option value="truck">По машинам</option>
                <option value="fuelType">По видам топлива</option>
              </Select>
            </Field>
          </div>
          <Button onClick={() => void loadConsumption()}>Показать</Button>
        </div>
        <ErrorText>{error}</ErrorText>
        {consumption && (
          <>
            <Table head={["", "Расход предприятия, л", "Расход предприятия, ₽", "Личное, л", "Личное, ₽"]}>
              {consumption.rows.map((row) => (
                <tr key={String(row.key)}>
                  <td className="py-2 pr-4">{row.label}</td>
                  <td className="py-2 pr-4">{fmt(row.companyLiters)}</td>
                  <td className="py-2 pr-4">{fmt(row.companyCost)}</td>
                  <td className="py-2 pr-4">{fmt(row.personalLiters)}</td>
                  <td className="py-2 pr-4">{fmt(row.personalCost)}</td>
                </tr>
              ))}
            </Table>
            <p className="text-sm mt-3 text-slate-600">
              Итого расходы предприятия:{" "}
              <strong>
                {fmt(consumption.totals.companyLiters)} л / {fmt(consumption.totals.companyCost)} ₽
              </strong>
              {" · "}личное (реализовано на сторону):{" "}
              <strong>
                {fmt(consumption.totals.personalLiters)} л / {fmt(consumption.totals.personalCost)} ₽
              </strong>
            </p>
          </>
        )}
      </Card>

      <Card title="Расход на 100 км по машине">
        <div className="flex gap-2 items-end mb-4 flex-wrap">
          <div className="w-40">
            <Field label="Машина">
              <Select value={per100kmTruckId} onChange={(e) => setPer100kmTruckId(e.target.value)} required>
                <option value="">—</option>
                {(trucks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.plateNumber})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="С">
              <Input type="date" value={per100kmFrom} onChange={(e) => setPer100kmFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="По">
              <Input type="date" value={per100kmTo} onChange={(e) => setPer100kmTo(e.target.value)} />
            </Field>
          </div>
          <Button onClick={() => void loadPer100km()} disabled={!per100kmTruckId}>
            Показать
          </Button>
        </div>
        {per100km &&
          (per100km.insufficientData ? (
            <p className="text-sm text-amber-600">
              Недостаточно данных (нужно минимум 2 показания одометра при служебных заправках в этом периоде).
            </p>
          ) : (
            <>
              <p className="text-sm text-slate-700">
                Расход: <strong>{fmt(per100km.litersPer100Km!)} л/100км</strong> ({fmt(per100km.totalLiters)} л за{" "}
                {per100km.distanceKm} км)
                {per100km.norm.min && per100km.norm.max && (
                  <>
                    {" · "}норма: {per100km.norm.min}–{per100km.norm.max} л/100км
                  </>
                )}
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Оценочный показатель: в сумму попадает и первая заправка периода, которая на самом деле только
                задаёт стартовый уровень бака, а не характеризует расход. Не использовать как единственное
                доказательство перерасхода — сверяйте с водителем перед выводами.
              </p>
            </>
          ))}
      </Card>
    </div>
  );
}

export function FuelPage() {
  const [tab, setTab] = useState<Tab>("Приход");

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              tab === t ? "bg-sky-600 text-white" : "bg-white text-slate-600 border border-slate-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Приход" && <LotsSection />}
      {tab === "Заправки" && <WithdrawalsSection />}
      {tab === "Отчёты" && <ReportsSection />}
    </div>
  );
}
