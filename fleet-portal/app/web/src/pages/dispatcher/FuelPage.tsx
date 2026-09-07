import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type {
  ConsumptionReport,
  FuelBalanceRow,
  FuelLot,
  FuelType,
  FuelWithdrawal,
  Per100KmReport,
  Truck,
} from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";

const TABS = ["Приход", "Заправки", "Отчёты"] as const;
type Tab = (typeof TABS)[number];

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
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
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
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
    <Card title="Приход топлива">
      <FuelBalanceStrip balance={balance} />
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
  );
}

function WithdrawalsSection() {
  const { data: fuelTypes } = useApi<FuelType[]>("/api/fuel-types");
  const { data: trucks } = useApi<Truck[]>("/api/trucks");
  const { data: withdrawals, reload } = useApi<FuelWithdrawal[]>("/api/fuel/withdrawals");
  const { data: balance, reload: reloadBalance } = useApi<FuelBalanceRow[]>("/api/fuel/reports/balance");

  const [fuelTypeId, setFuelTypeId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [liters, setLiters] = useState("");
  const [isPersonal, setIsPersonal] = useState(false);
  const [truckId, setTruckId] = useState("");
  const [odometer, setOdometer] = useState("");
  const [personalComment, setPersonalComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/fuel/withdrawals", {
        fuelTypeId: Number(fuelTypeId),
        date,
        liters: Number(liters),
        isPersonal,
        truckId: isPersonal ? undefined : Number(truckId),
        odometer: !isPersonal && odometer ? Number(odometer) : undefined,
        personalComment: isPersonal ? personalComment : undefined,
      });
      setLiters("");
      setOdometer("");
      setPersonalComment("");
      await Promise.all([reload(), reloadBalance()]);
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <Card title="Заправка (списание топлива)">
      <FuelBalanceStrip balance={balance} />
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
        <Button type="submit">Заправить</Button>
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
            <p className="text-sm text-slate-700">
              Расход: <strong>{fmt(per100km.litersPer100Km!)} л/100км</strong> ({fmt(per100km.totalLiters)} л за{" "}
              {per100km.distanceKm} км)
              {per100km.norm.min && per100km.norm.max && (
                <>
                  {" · "}норма: {per100km.norm.min}–{per100km.norm.max} л/100км
                </>
              )}
            </p>
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
