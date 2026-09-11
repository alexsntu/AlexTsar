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
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table, Textarea } from "../../components/ui";
import { formatShortDate, toLocalDateString, todayLocalDateString } from "../../lib/date";

const TABS = ["Дашборд", "Журнал", "Отчёты"] as const;
type Tab = (typeof TABS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
/** За сколько дней до истечения подсвечивать красным и показывать предупреждение. */
const EXPIRY_WARNING_DAYS = 30;

/** Сколько дней осталось до даты (может быть отрицательным, если уже просрочено). */
function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const due = new Date(dateStr.slice(0, 10) + "T00:00:00");
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / DAY_MS);
}

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
  const [insuranceExpiryDate, setInsuranceExpiryDate] = useState(truck.insuranceExpiryDate?.slice(0, 10) ?? "");
  const [inspectionExpiryDate, setInspectionExpiryDate] = useState(truck.inspectionExpiryDate?.slice(0, 10) ?? "");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      // Пустое поле шлём как null ("очистить"), а не undefined ("не менялось") —
      // иначе сброс даты/интервала в форме не сохранялся на сервере.
      await api.patch(`/api/trucks/${truck.id}`, {
        serviceIntervalKm: intervalKm ? Number(intervalKm) : null,
        serviceIntervalDays: intervalDays ? Number(intervalDays) : null,
        lastServiceDate: lastDate || null,
        lastServiceOdometer: lastOdometer ? Number(lastOdometer) : null,
        insuranceExpiryDate: insuranceExpiryDate || null,
        inspectionExpiryDate: inspectionExpiryDate || null,
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
      <div className="w-36">
        <Field label="Страховка до">
          <Input type="date" value={insuranceExpiryDate} onChange={(e) => setInsuranceExpiryDate(e.target.value)} />
        </Field>
      </div>
      <div className="w-36">
        <Field label="Техосмотр до">
          <Input type="date" value={inspectionExpiryDate} onChange={(e) => setInspectionExpiryDate(e.target.value)} />
        </Field>
      </div>
      <Button type="submit">Сохранить</Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Ячейка даты страховки/техосмотра: красным и жирным предупреждением за месяц до истечения. */
function ExpiryCell({ dateStr, warningLabel }: { dateStr: string | null; warningLabel: string }) {
  if (!dateStr) return <span className="text-slate-400">не указано</span>;
  const days = daysUntil(dateStr);
  const urgent = days !== null && days <= EXPIRY_WARNING_DAYS;
  return (
    <div>
      <span className={urgent ? "text-red-600 font-bold" : ""}>{formatShortDate(dateStr)}</span>
      {urgent && (
        <div className="text-red-600 font-bold text-xs mt-0.5">
          {days !== null && days <= 0 ? `Просрочено! ${warningLabel}` : warningLabel}
        </div>
      )}
    </div>
  );
}

/**
 * Последнее ТО — общий кусок для таблицы (десктоп) и карточки (мобильный).
 * Пробег показываем всегда (даже без даты); дата раскрывается по клику на пробег,
 * чтобы не загромождать таблицу и не терять данные, когда дату не указали.
 */
function LastServiceCell({ truck }: { truck: Truck }) {
  const [showDate, setShowDate] = useState(false);
  const odometer = truck.lastServiceOdometer;
  const date = truck.lastServiceDate;

  if (odometer == null && !date) return <span className="text-slate-400">—</span>;

  return (
    <button
      type="button"
      onClick={() => setShowDate((v) => !v)}
      className="text-left hover:underline decoration-dotted underline-offset-2"
      title={date ? "Нажмите, чтобы показать/скрыть дату ТО" : undefined}
    >
      {odometer != null ? `${fmt(odometer)} км` : "—"}
      {date && showDate && <span className="block text-xs text-slate-400">{formatShortDate(date)}</span>}
    </button>
  );
}

/** Осталось до ТО — общий кусок для таблицы (десктоп) и карточки (мобильный). */
function RemainingCell({ hasSchedule, info }: { hasSchedule: boolean | number | null | undefined; info: UpcomingService | undefined }) {
  if (!hasSchedule) return <span className="text-slate-400">интервал не задан</span>;
  if (info?.overdue) return <Badge tone="red">просрочено</Badge>;
  return (
    <span>
      {info?.remainingKm != null && `${fmt(info.remainingKm)} км `}
      {info?.remainingDays != null && `(${info.remainingDays} дн.)`}
    </span>
  );
}

function UpcomingSection() {
  const { data: trucks, reload: reloadTrucks } = useApi<Truck[]>("/api/trucks");
  const { data: upcoming, reload: reloadUpcoming } = useApi<UpcomingService[]>("/api/maintenance/upcoming");
  const [editingTruckId, setEditingTruckId] = useState<number | null>(null);

  const upcomingByTruck = new Map((upcoming ?? []).map((u) => [u.truckId, u]));

  function toggleEdit(truckId: number) {
    setEditingTruckId(editingTruckId === truckId ? null : truckId);
  }

  function onFormDone() {
    setEditingTruckId(null);
    void reloadTrucks();
    void reloadUpcoming();
  }

  return (
    <Card title="Дашборд по машинам: ТО, страховка, техосмотр">
      {/* Десктоп/планшет — таблица */}
      <div className="hidden sm:block">
        <Table
          head={["Машина", "Интервал", "Последнее ТО", "Текущий пробег", "Осталось", "Страховка до", "Техосмотр до", ""]}
        >
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
                  <LastServiceCell truck={truck} />
                </td>
                <td className="py-2 pr-4 align-top">{info?.currentOdometer != null ? `${fmt(info.currentOdometer)} км` : "—"}</td>
                <td className="py-2 pr-4 align-top">
                  <RemainingCell hasSchedule={hasSchedule} info={info} />
                </td>
                <td className="py-2 pr-4 align-top">
                  <ExpiryCell dateStr={truck.insuranceExpiryDate} warningLabel="Продлите страховку" />
                </td>
                <td className="py-2 pr-4 align-top">
                  <ExpiryCell dateStr={truck.inspectionExpiryDate} warningLabel="Пройдите техосмотр" />
                </td>
                <td className="py-2 pr-4 align-top text-right">
                  <button onClick={() => toggleEdit(truck.id)} className="text-sky-600 text-xs hover:underline">
                    Настроить
                  </button>
                  {editingTruckId === truck.id && <ScheduleForm truck={truck} onDone={onFormDone} />}
                </td>
              </tr>
            );
          })}
        </Table>
      </div>

      {/* Телефон — по одной карточке на машину вместо тесной таблицы */}
      <div className="sm:hidden divide-y divide-slate-100">
        {(trucks ?? []).map((truck) => {
          const info = upcomingByTruck.get(truck.id);
          const hasSchedule = truck.serviceIntervalKm || truck.serviceIntervalDays;
          return (
            <div key={truck.id} className="py-3 first:pt-0">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="font-semibold text-slate-800">
                  {truck.name} <span className="text-slate-400 font-normal">({truck.plateNumber})</span>
                </p>
                <button
                  onClick={() => toggleEdit(truck.id)}
                  className="text-sky-600 text-xs hover:underline shrink-0 whitespace-nowrap pt-0.5"
                >
                  Настроить
                </button>
              </div>
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Интервал ТО</dt>
                  <dd className="text-right">
                    {truck.serviceIntervalKm ? `${fmt(truck.serviceIntervalKm)} км` : "—"}
                    {truck.serviceIntervalDays ? ` / ${truck.serviceIntervalDays} дн.` : ""}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Последнее ТО</dt>
                  <dd className="text-right">
                    <LastServiceCell truck={truck} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Текущий пробег</dt>
                  <dd className="text-right">{info?.currentOdometer != null ? `${fmt(info.currentOdometer)} км` : "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Осталось</dt>
                  <dd className="text-right">
                    <RemainingCell hasSchedule={hasSchedule} info={info} />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Страховка до</dt>
                  <dd className="text-right">
                    <ExpiryCell dateStr={truck.insuranceExpiryDate} warningLabel="Продлите страховку" />
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">Техосмотр до</dt>
                  <dd className="text-right">
                    <ExpiryCell dateStr={truck.inspectionExpiryDate} warningLabel="Пройдите техосмотр" />
                  </dd>
                </div>
              </dl>
              {editingTruckId === truck.id && <ScheduleForm truck={truck} onDone={onFormDone} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function monthRange(date = new Date()): { from: string; to: string } {
  const from = toLocalDateString(new Date(date.getFullYear(), date.getMonth(), 1));
  const to = toLocalDateString(new Date(date.getFullYear(), date.getMonth() + 1, 0));
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
  const [date, setDate] = useState(() => todayLocalDateString());
  const [odometer, setOdometer] = useState("");
  const [description, setDescription] = useState("");
  const [parts, setParts] = useState([{ name: "", cost: "" }]);
  const [error, setError] = useState<string | null>(null);
  // null — форма создаёт новую запись; число — редактируем запись с этим id
  // (та же форма сверху, просто предзаполненная и с другой кнопкой отправки).
  const [editingRecordId, setEditingRecordId] = useState<number | null>(null);
  // Форма свёрнута по умолчанию — меньше "шума" на экране; открывается по
  // клику на заголовок или программно при клике на запись журнала.
  const [formOpen, setFormOpen] = useState(false);

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

  function resetForm() {
    setEditingRecordId(null);
    setTruckId("");
    setType("SERVICE");
    setDate(todayLocalDateString());
    setOdometer("");
    setDescription("");
    setParts([{ name: "", cost: "" }]);
    setFormOpen(false);
  }

  function startEdit(record: MaintenanceRecord) {
    setEditingRecordId(record.id);
    setTruckId(String(record.truckId));
    setType(record.type);
    setDate(record.date.slice(0, 10));
    setOdometer(String(record.odometer));
    setDescription(record.description ?? "");
    setParts(record.parts.length > 0 ? record.parts.map((p) => ({ name: p.name, cost: String(p.cost) })) : [{ name: "", cost: "" }]);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleDelete(record: MaintenanceRecord) {
    if (!window.confirm(`Удалить запись «${record.type === "SERVICE" ? "ТО" : "Ремонт"}» от ${formatShortDate(record.date)}? Это необратимо.`)) return;
    try {
      await api.delete(`/api/maintenance/records/${record.id}`);
      if (editingRecordId === record.id) resetForm();
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      const validParts = parts.filter((p) => p.name.trim() && p.cost !== "").map((p) => ({ name: p.name, cost: Number(p.cost) }));
      const payload = {
        truckId: Number(truckId),
        type,
        date,
        odometer: Number(odometer),
        description: description || undefined,
        parts: validParts,
      };
      if (editingRecordId) {
        await api.patch(`/api/maintenance/records/${editingRecordId}`, payload);
      } else {
        await api.post("/api/maintenance/records", payload);
      }
      resetForm();
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <div>
      <CurrentMonthSummary />
      <Card
        title={editingRecordId ? `Запись №${editingRecordId}: ТО или ремонт` : "Новая запись: ТО или ремонт"}
        collapsible
        open={formOpen}
        onToggle={(next) => {
          if (next) setFormOpen(true);
          else resetForm();
        }}
      >
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
        </div>

        <div className="mb-3">
          <Field label={type === "REPAIR" ? "Что сломалось" : "Комментарий"}>
            <Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
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
          <Button type="submit">{editingRecordId ? "Сохранить изменения" : "Сохранить запись"}</Button>
          {editingRecordId && (
            <button type="button" onClick={resetForm} className="text-sm text-slate-500 hover:underline">
              Отмена
            </button>
          )}
          <span className="text-sm text-slate-600">
            Итого: <strong>{fmt(totalCost)} ₽</strong>
          </span>
        </div>
        <ErrorText>{error}</ErrorText>
      </form>
      </Card>

      <Card title="Журнал ТО и ремонтов" collapsible>
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

        <Table head={["Дата", "Машина", "Тип", "Пробег", "Описание", "Запчасти", "Сумма", ""]}>
          {(records ?? []).map((r) => (
            <tr
              key={r.id}
              onClick={() => startEdit(r)}
              className={`cursor-pointer hover:bg-slate-50 ${editingRecordId === r.id ? "bg-sky-50" : ""}`}
              title="Открыть запись"
            >
              <td className="py-2 pr-4">{formatShortDate(r.date)}</td>
              <td className="py-2 pr-4">
                {r.truck?.name} ({r.truck?.plateNumber})
              </td>
              <td className="py-2 pr-4">
                <Badge tone={r.type === "SERVICE" ? "green" : "amber"}>{r.type === "SERVICE" ? "ТО" : "Ремонт"}</Badge>
              </td>
              <td className="py-2 pr-4">{fmt(r.odometer)} км</td>
              <td className="py-2 pr-4 max-w-xs whitespace-pre-wrap break-words">{r.description ?? "—"}</td>
              <td className="py-2 pr-4">{r.parts.map((p) => p.name).join(", ") || "—"}</td>
              <td className="py-2 pr-4">{fmt(r.totalCost)} ₽</td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(r);
                  }}
                  className="text-red-600 text-xs hover:underline"
                >
                  Удалить
                </button>
              </td>
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
  const [tab, setTab] = useState<Tab>("Дашборд");
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
      {tab === "Дашборд" && <UpcomingSection />}
      {tab === "Журнал" && <JournalSection initialFilter={journalFilter} />}
      {tab === "Отчёты" && <MaintenanceReportsSection onViewRecords={viewRecords} />}
    </div>
  );
}
