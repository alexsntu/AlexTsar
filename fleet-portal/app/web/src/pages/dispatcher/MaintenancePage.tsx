import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type {
  MaintenanceCostReport,
  MaintenanceRecord,
  MaintenanceType,
  Truck,
  UpcomingService,
} from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";

const TABS = ["Напоминания", "Журнал", "Отчёты"] as const;
type Tab = (typeof TABS)[number];

interface JournalFilter {
  truckId?: number;
  type?: MaintenanceType;
  from?: string;
  to?: string;
}

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function ScheduleForm({ truck, onDone }: { truck: Truck; onDone: () => void }) {
  const [intervalKm, setIntervalKm] = useState(truck.serviceIntervalKm?.toString() ?? "");
  const [intervalDays, setIntervalDays] = useState(truck.serviceIntervalDays?.toString() ?? "");
  const [lastDate, setLastDate] = useState(truck.lastServiceDate?.slice(0, 10) ?? "");
  const [lastOdometer, setLastOdometer] = useState(truck.lastServiceOdometer?.toString() ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.patch(`/api/trucks/${truck.id}`, {
        serviceIntervalKm: intervalKm ? Number(intervalKm) : undefined,
        serviceIntervalDays: intervalDays ? Number(intervalDays) : undefined,
        lastServiceDate: lastDate || undefined,
        lastServiceOdometer: lastOdometer ? Number(lastOdometer) : undefined,
      });
      onDone();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap mt-2 bg-slate-50 p-2 rounded-lg">
      <div className="w-28">
        <Field label="Интервал, км">
          <Input type="number" min="0" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} />
        </Field>
      </div>
      <div className="w-28">
        <Field label="Интервал, дней">
          <Input type="number" min="0" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
        </Field>
      </div>
      <div className="w-36">
        <Field label="Дата послед. ТО">
          <Input type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
        </Field>
      </div>
      <div className="w-32">
        <Field label="Пробег на тот момент">
          <Input type="number" min="0" value={lastOdometer} onChange={(e) => setLastOdometer(e.target.value)} />
        </Field>
      </div>
      <Button type="submit">Сохранить</Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function UpcomingSection() {
  const { data: trucks, reload: reloadTrucks } = useApi<Truck[]>("/api/trucks");
  const { data: upcoming, reload: reloadUpcoming } = useApi<UpcomingService[]>("/api/maintenance/upcoming");
  const [editingTruckId, setEditingTruckId] = useState<number | null>(null);

  const upcomingByTruck = new Map((upcoming ?? []).map((u) => [u.truckId, u]));

  return (
    <Card title="Ближайшее ТО по машинам">
      <Table head={["Машина", "Интервал", "Последнее ТО", "Текущий пробег", "Осталось", ""]}>
        {(trucks ?? []).map((truck) => {
          const info = upcomingByTruck.get(truck.id);
          const hasSchedule = truck.serviceIntervalKm || truck.serviceIntervalDays;
          return (
            <tr key={truck.id}>
              <td className="py-2 pr-4 align-top">
                {truck.name} ({truck.plateNumber})
              </td>
              <td className="py-2 pr-4 align-top">
                {truck.serviceIntervalKm ? `${fmt(truck.serviceIntervalKm)} км` : "—"}
                {truck.serviceIntervalDays ? ` / ${truck.serviceIntervalDays} дн.` : ""}
              </td>
              <td className="py-2 pr-4 align-top">
                {truck.lastServiceDate
                  ? `${truck.lastServiceDate.slice(0, 10)} (${fmt(truck.lastServiceOdometer ?? 0)} км)`
                  : "—"}
              </td>
              <td className="py-2 pr-4 align-top">{info?.currentOdometer != null ? `${fmt(info.currentOdometer)} км` : "—"}</td>
              <td className="py-2 pr-4 align-top">
                {!hasSchedule ? (
                  <span className="text-slate-400">интервал не задан</span>
                ) : info?.overdue ? (
                  <Badge tone="red">просрочено</Badge>
                ) : (
                  <span>
                    {info?.remainingKm != null && `${fmt(info.remainingKm)} км `}
                    {info?.remainingDays != null && `(${info.remainingDays} дн.)`}
                  </span>
                )}
              </td>
              <td className="py-2 pr-4 align-top text-right">
                <button
                  onClick={() => setEditingTruckId(editingTruckId === truck.id ? null : truck.id)}
                  className="text-sky-600 text-xs hover:underline"
                >
                  Настроить
                </button>
                {editingTruckId === truck.id && (
                  <ScheduleForm
                    truck={truck}
                    onDone={() => {
                      setEditingTruckId(null);
                      void reloadTrucks();
                      void reloadUpcoming();
                    }}
                  />
                )}
              </td>
            </tr>
          );
        })}
      </Table>
    </Card>
  );
}

function monthRange(date = new Date()): { from: string; to: string } {
  const from = new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
  const to = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

function CurrentMonthSummary() {
  const { from, to } = monthRange();
  const { data: records } = useApi<MaintenanceRecord[]>(`/api/maintenance/records?from=${from}&to=${to}`);

  const service = (records ?? []).filter((r) => r.type === "SERVICE");
  const repair = (records ?? []).filter((r) => r.type === "REPAIR");
  const serviceCost = service.reduce((sum, r) => sum + r.totalCost, 0);
  const repairCost = repair.reduce((sum, r) => sum + r.totalCost, 0);

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
      <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">В этом месяце</p>
      <div className="flex flex-wrap gap-x-6 gap-y-1.5">
        <p className="text-sm text-slate-700">
          Плановое ТО: <span className="text-base font-bold text-amber-700">{service.length}</span>
          {" на сумму "}
          <span className="text-base font-bold text-amber-700">{fmt(serviceCost)} ₽</span>
        </p>
        <p className="text-sm text-slate-700">
          Внеплановый ремонт: <span className="text-base font-bold text-amber-700">{repair.length}</span>
          {" на сумму "}
          <span className="text-base font-bold text-amber-700">{fmt(repairCost)} ₽</span>
        </p>
      </div>
    </div>
  );
}

function JournalSection({ initialFilter }: { initialFilter: JournalFilter | null }) {
  const { data: trucks } = useApi<Truck[]>("/api/trucks");

  const [filterTruckId, setFilterTruckId] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  useEffect(() => {
    if (!initialFilter) return;
    setFilterTruckId(initialFilter.truckId ? String(initialFilter.truckId) : "");
    setFilterType(initialFilter.type ?? "");
    setFilterFrom(initialFilter.from ?? "");
    setFilterTo(initialFilter.to ?? "");
  }, [initialFilter]);

  const filterParams = new URLSearchParams();
  if (filterTruckId) filterParams.set("truckId", filterTruckId);
  if (filterType) filterParams.set("type", filterType);
  if (filterFrom) filterParams.set("from", filterFrom);
  if (filterTo) filterParams.set("to", filterTo);
  const { data: records, reload } = useApi<MaintenanceRecord[]>(
    `/api/maintenance/records?${filterParams.toString()}`,
  );

  const [truckId, setTruckId] = useState("");
  const [type, setType] = useState<MaintenanceType>("SERVICE");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [odometer, setOdometer] = useState("");
  const [description, setDescription] = useState("");
  const [parts, setParts] = useState([{ name: "", cost: "" }]);
  const [error, setError] = useState<string | null>(null);

  const totalCost = parts.reduce((sum, p) => sum + (Number(p.cost) || 0), 0);

  function updatePart(index: number, field: "name" | "cost", value: string) {
    setParts((prev) => prev.map((p, i) => (i === index ? { ...p, [field]: value } : p)));
  }

  function addPartRow() {
    setParts((prev) => [...prev, { name: "", cost: "" }]);
  }

  function removePartRow(index: number) {
    setParts((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const validParts = parts.filter((p) => p.name.trim() && p.cost !== "").map((p) => ({ name: p.name, cost: Number(p.cost) }));
      await api.post("/api/maintenance/records", {
        truckId: Number(truckId),
        type,
        date,
        odometer: Number(odometer),
        description: description || undefined,
        parts: validParts,
      });
      setOdometer("");
      setDescription("");
      setParts([{ name: "", cost: "" }]);
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      <CurrentMonthSummary />
      <Card title="Новая запись: ТО или ремонт">
      <form onSubmit={handleSubmit} className="mb-4">
        <div className="flex gap-2 items-end flex-wrap mb-3">
          <div className="w-40">
            <Field label="Тип">
              <Select value={type} onChange={(e) => setType(e.target.value as MaintenanceType)}>
                <option value="SERVICE">Плановое ТО</option>
                <option value="REPAIR">Внеплановый ремонт</option>
              </Select>
            </Field>
          </div>
          <div className="w-44">
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
          <div className="w-36">
            <Field label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <div className="w-32">
            <Field label="Пробег, км">
              <Input type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} required />
            </Field>
          </div>
          <div className="w-64">
            <Field label={type === "REPAIR" ? "Что сломалось" : "Комментарий"}>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </Field>
          </div>
        </div>

        <p className="text-xs font-medium text-slate-500 mb-2">Запчасти</p>
        {parts.map((part, i) => (
          <div key={i} className="flex gap-2 items-end mb-2">
            <div className="w-64">
              <Input placeholder="Название запчасти" value={part.name} onChange={(e) => updatePart(i, "name", e.target.value)} />
            </div>
            <div className="w-32">
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="Стоимость"
                value={part.cost}
                onChange={(e) => updatePart(i, "cost", e.target.value)}
              />
            </div>
            {parts.length > 1 && (
              <button type="button" onClick={() => removePartRow(i)} className="text-red-600 text-xs hover:underline">
                Убрать
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={addPartRow} className="text-sky-600 text-xs hover:underline mb-3">
          + добавить запчасть
        </button>

        <div className="flex items-center gap-4">
          <Button type="submit">Сохранить запись</Button>
          <span className="text-sm text-slate-600">
            Итого: <strong>{fmt(totalCost)} ₽</strong>
          </span>
        </div>
        <ErrorText>{error}</ErrorText>
      </form>
      </Card>

      <Card title="Журнал ТО и ремонтов">
        <div className="flex gap-2 items-end flex-wrap mb-4">
          <div className="w-44">
            <Field label="Машина">
              <Select value={filterTruckId} onChange={(e) => setFilterTruckId(e.target.value)}>
                <option value="">Все машины</option>
                {(trucks ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.plateNumber})
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="w-40">
            <Field label="Тип">
              <Select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
                <option value="">Все типы</option>
                <option value="SERVICE">Плановое ТО</option>
                <option value="REPAIR">Внеплановый ремонт</option>
              </Select>
            </Field>
          </div>
          <div className="w-36">
            <Field label="С">
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </Field>
          </div>
          <div className="w-36">
            <Field label="По">
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </Field>
          </div>
          {(filterTruckId || filterType || filterFrom || filterTo) && (
            <button
              onClick={() => {
                setFilterTruckId("");
                setFilterType("");
                setFilterFrom("");
                setFilterTo("");
              }}
              className="text-sky-600 text-xs hover:underline"
            >
              Сбросить фильтр
            </button>
          )}
        </div>

        <Table head={["Дата", "Машина", "Тип", "Пробег", "Описание", "Запчасти", "Сумма"]}>
          {(records ?? []).map((r) => (
            <tr key={r.id}>
              <td className="py-2 pr-4">{r.date.slice(0, 10)}</td>
              <td className="py-2 pr-4">
                {r.truck?.name} ({r.truck?.plateNumber})
              </td>
              <td className="py-2 pr-4">
                <Badge tone={r.type === "SERVICE" ? "green" : "amber"}>{r.type === "SERVICE" ? "ТО" : "Ремонт"}</Badge>
              </td>
              <td className="py-2 pr-4">{fmt(r.odometer)} км</td>
              <td className="py-2 pr-4">{r.description ?? "—"}</td>
              <td className="py-2 pr-4">{r.parts.map((p) => p.name).join(", ") || "—"}</td>
              <td className="py-2 pr-4">{fmt(r.totalCost)} ₽</td>
            </tr>
          ))}
        </Table>
        {records && records.length === 0 && <p className="text-slate-500 text-sm">Записей не найдено</p>}
      </Card>
    </div>
  );
}

function MaintenanceReportsSection({ onViewRecords }: { onViewRecords: (filter: JournalFilter) => void }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [groupBy, setGroupBy] = useState<"truck" | "type">("truck");
  const [report, setReport] = useState<MaintenanceCostReport | null>(null);
  // Даты/группировка, с которыми реально построен report — чтобы клик по "Записей"
  // вёл в журнал с теми же условиями, даже если поля дат уже поменяли, но не нажали "Показать".
  const [appliedFilter, setAppliedFilter] = useState<{ from: string; to: string; groupBy: "truck" | "type" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const params = new URLSearchParams({ groupBy });
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const result = await api.get<MaintenanceCostReport>(`/api/maintenance/reports/costs?${params}`);
      setReport(result);
      setAppliedFilter({ from, to, groupBy });
    } catch (err) {
      setError(describeError(err));
    }
  }

  function handleRowClick(rowKey: string) {
    if (!appliedFilter) return;
    const [kind, value] = rowKey.split(/-(.+)/);
    const filter: JournalFilter = { from: appliedFilter.from || undefined, to: appliedFilter.to || undefined };
    if (kind === "truck") filter.truckId = Number(value);
    if (kind === "type") filter.type = value as MaintenanceType;
    onViewRecords(filter);
  }

  return (
    <Card title="Расходы на ТО и ремонт">
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
            <Select value={groupBy} onChange={(e) => setGroupBy(e.target.value as "truck" | "type")}>
              <option value="truck">По машинам</option>
              <option value="type">По типу (ТО/ремонт)</option>
            </Select>
          </Field>
        </div>
        <Button onClick={() => void load()}>Показать</Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {report && (
        <>
          <Table head={["", "ТО, ₽", "Ремонт, ₽", "Итого, ₽", "Записей"]}>
            {report.rows.map((row) => (
              <tr key={row.key}>
                <td className="py-2 pr-4">{row.label}</td>
                <td className="py-2 pr-4">{fmt(row.serviceCost)}</td>
                <td className="py-2 pr-4">{fmt(row.repairCost)}</td>
                <td className="py-2 pr-4 font-medium">{fmt(row.totalCost)}</td>
                <td className="py-2 pr-4">
                  <button onClick={() => handleRowClick(row.key)} className="text-sky-600 hover:underline">
                    {row.count}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
          <p className="text-sm mt-3 text-slate-600">
            Итого за период: <strong>{fmt(report.totals.totalCost)} ₽</strong> (ТО: {fmt(report.totals.serviceCost)} ₽, ремонт:{" "}
            {fmt(report.totals.repairCost)} ₽)
          </p>
        </>
      )}
    </Card>
  );
}

export function MaintenancePage() {
  const [tab, setTab] = useState<Tab>("Напоминания");
  const [journalFilter, setJournalFilter] = useState<JournalFilter | null>(null);

  function viewRecords(filter: JournalFilter) {
    setJournalFilter(filter);
    setTab("Журнал");
  }

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
      {tab === "Напоминания" && <UpcomingSection />}
      {tab === "Журнал" && <JournalSection initialFilter={journalFilter} />}
      {tab === "Отчёты" && <MaintenanceReportsSection onViewRecords={viewRecords} />}
    </div>
  );
}
