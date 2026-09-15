import { Fragment, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type {
  DayAct,
  ImportBatch,
  ImportResult,
  MonthClosing,
  MonthSummaryLine,
  Royalty,
  RoyaltyCondition,
  RoyaltyConditionResult,
  RoyaltyResult,
  RoyaltySummary,
  RoyaltyTruckBreakdown,
  RouteSummaryRow,
} from "../../api/types";
import { Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";
import { formatShortDate, todayLocalDateString } from "../../lib/date";

const TABS = ["Импорт", "Итоги маршрутов", "Роялти", "Журнал"] as const;
type Tab = (typeof TABS)[number];

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Форма загрузки файла — используется и для первой загрузки нового периода
 * (endpoint = "/api/documents/imports"), и для замены файла уже
 * существующего импорта (endpoint = ".../imports/:id/replace"): выбор
 * листа, ошибки валидации и итоговое сообщение показываются одинаково. */
function ImportUploadForm({ endpoint, onUploaded }: { endpoint: string; onUploaded: (batch: ImportBatch) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<string[] | null>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [errors, setErrors] = useState<{ rowNumber: number; date: string; addressText: string; message: string }[] | null>(null);
  const [success, setSuccess] = useState<ImportBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function upload(sheetName?: string) {
    if (!file) return;
    setSubmitting(true);
    setError(null);
    setErrors(null);
    setSuccess(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (sheetName) formData.append("sheetName", sheetName);
      const result = await api.postForm<ImportResult>(endpoint, formData);
      if ("needsSheetSelection" in result) {
        setSheets(result.sheets);
        setSelectedSheet(result.suggested);
        return;
      }
      setSheets(null);
      if (!result.accepted) {
        setErrors(result.errors);
        return;
      }
      setSuccess(result.batch);
      setFile(null);
      onUploaded(result.batch);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await upload();
  }

  return (
    <div>
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-3 flex-wrap">
        <div className="w-80">
          <Field label="Файл .xlsx">
            <input
              type="file"
              accept=".xlsx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-sky-50 file:text-sky-700 file:text-sm hover:file:bg-sky-100"
            />
          </Field>
        </div>
        <Button type="submit" disabled={!file || submitting}>
          {submitting ? "Проверяем…" : "Проверить и загрузить"}
        </Button>
      </form>

      {sheets && (
        <div className="mb-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
          <p className="text-sm text-amber-800 mb-2">
            В файле несколько похожих листов — выберите, какой из них содержит рейсы за этот период:
          </p>
          <div className="flex gap-2 items-end flex-wrap">
            <div className="w-64">
              <Select value={selectedSheet} onChange={(e) => setSelectedSheet(e.target.value)}>
                {sheets.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </div>
            <Button type="button" onClick={() => void upload(selectedSheet)} disabled={submitting}>
              Загрузить этот лист
            </Button>
          </div>
        </div>
      )}

      <ErrorText>{error}</ErrorText>

      {errors && (
        <div className="mb-3 p-3 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm font-semibold text-red-700 mb-2">
            Файл не принят. Найдено ошибок: {errors.length}. Обработка остановлена, ничего не сохранено. Исправьте указанные ошибки и загрузите верный файл повторно.
          </p>
          <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}

      {success && (
        <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          Загружено: {success.rowCount} рейсов, {fmt(success.totalMassKg)} кг, на сумму {fmtMoney(success.totalCost)} ₽ (период{" "}
          {formatShortDate(success.periodFrom)} — {formatShortDate(success.periodTo)}).
        </div>
      )}
    </div>
  );
}

function ImportSection() {
  const { data: batches, reload } = useApi<ImportBatch[]>("/api/documents/imports");
  const [replacingId, setReplacingId] = useState<number | null>(null);

  async function deleteBatch(id: number) {
    if (!window.confirm("Удалить этот импорт и все связанные с ним рейсы? Это необратимо.")) return;
    await api.delete(`/api/documents/imports/${id}`);
    await reload();
  }

  async function downloadOriginal(b: ImportBatch) {
    try {
      await api.downloadFile(`/api/documents/imports/${b.id}/download`, b.sourceFileName);
    } catch (err) {
      window.alert(describeError(err));
    }
  }

  return (
    <div>
      <Card title="Загрузка расшифровки от заказчика">
        <ImportUploadForm endpoint="/api/documents/imports" onUploaded={() => void reload()} />
      </Card>

      <Card title="Загруженные периоды">
        <Table head={["Период", "Файл", "Загружен", "Рейсов", "Масса, кг", "Сумма, ₽", ""]}>
          {(batches ?? []).map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td className="py-2 pr-4">
                  {formatShortDate(b.periodFrom)} — {formatShortDate(b.periodTo)}
                </td>
                <td className="py-2 pr-4">{b.sourceFileName}</td>
                <td className="py-2 pr-4 text-slate-500 text-xs">
                  {formatShortDate(b.createdAt)}
                  {b.updatedAt !== b.createdAt && <div>заменён {formatShortDate(b.updatedAt)}</div>}
                </td>
                <td className="py-2 pr-4">{b.rowCount}</td>
                <td className="py-2 pr-4">{fmt(b.totalMassKg)}</td>
                <td className="py-2 pr-4">{fmtMoney(b.totalCost)}</td>
                <td className="py-2 pr-4 text-right whitespace-nowrap">
                  {b.hasFile && (
                    <button onClick={() => void downloadOriginal(b)} className="text-sky-600 text-xs hover:underline mr-3">
                      Скачать
                    </button>
                  )}
                  <button
                    onClick={() => setReplacingId(replacingId === b.id ? null : b.id)}
                    className="text-sky-600 text-xs hover:underline mr-3"
                  >
                    {replacingId === b.id ? "Отмена" : "Заменить файл"}
                  </button>
                  <button onClick={() => void deleteBatch(b.id)} className="text-red-600 text-xs hover:underline">
                    Убрать
                  </button>
                </td>
              </tr>
              {replacingId === b.id && (
                <tr>
                  <td colSpan={7} className="pb-4 pt-2 bg-slate-50">
                    <p className="text-sm text-slate-600 mb-2">
                      Загрузите новый файл вместо текущего — рейсы этого импорта будут удалены и заменены новыми. Акты, реестр,
                      итоговый акт и счёт за этот период при следующем открытии/скачивании построятся заново из новых данных.
                    </p>
                    <ImportUploadForm
                      endpoint={`/api/documents/imports/${b.id}/replace`}
                      onUploaded={() => {
                        setReplacingId(null);
                        void reload();
                      }}
                    />
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </Table>
      </Card>
    </div>
  );
}

function MonthPicker({ month, onChange }: { month: string; onChange: (v: string) => void }) {
  return (
    <div className="w-40 mb-4">
      <Field label="Месяц">
        <Input type="month" value={month} onChange={(e) => onChange(e.target.value)} />
      </Field>
    </div>
  );
}

function RouteSummarySection() {
  const [month, setMonth] = useState(() => currentYearMonth());
  const { data } = useApi<RouteSummaryRow[]>(`/api/documents/route-summary?month=${month}`, [month]);

  return (
    <Card title="Итоги маршрутов">
      <MonthPicker month={month} onChange={setMonth} />
      <Table head={["Машина", "Перевезено, кг", "Пройдено, км", "Дней с доставками", "Даты"]}>
        {(data ?? []).map((row) => (
          <tr key={row.truckPlate}>
            <td className="py-2 pr-4">{row.truckPlate}</td>
            <td className="py-2 pr-4">{fmt(row.totalMassKg)}</td>
            <td className="py-2 pr-4">{fmt(row.totalDistanceKm)}</td>
            <td className="py-2 pr-4">{row.deliveryDates.length}</td>
            <td className="py-2 pr-4 text-slate-500 text-xs">{row.deliveryDates.map((d) => formatShortDate(d)).join(", ")}</td>
          </tr>
        ))}
        {(data ?? []).length === 0 && (
          <tr>
            <td colSpan={5} className="py-3 text-slate-400 text-sm">
              За этот месяц данных нет
            </td>
          </tr>
        )}
      </Table>
    </Card>
  );
}

/** Форма нового условия внутри роялти — само условие создаётся сразу без
 * машин, состав донастраивается чек-листом в RoyaltyConditionEditor (список
 * госномеров подгружен там же — дублировать его в форме создания незачем). */
function AddConditionForm({ royaltyId, onAdded }: { royaltyId: number; onAdded: () => void }) {
  const [percent, setPercent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post(`/api/documents/royalties/${royaltyId}/conditions`, { percent: Number(percent), trucks: [] });
      setPercent("");
      onAdded();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <div className="w-40">
        <Field label="Процент нового условия, %">
          <Input type="number" min="0" max="1000" step="0.1" value={percent} onChange={(e) => setPercent(e.target.value)} required />
        </Field>
      </div>
      <Button type="submit" variant="secondary" disabled={saving}>
        {saving ? "Добавляем…" : "Добавить условие"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Редактор одного условия роялти: процент и чек-лист машин — галочками по
 * реально встречавшимся госномерам (allPlates), а не свободным текстом,
 * чтобы не разойтись с написанием в загруженных файлах. Одна и та же машина
 * может стоять сразу в нескольких условиях (в т.ч. разных роялти) — это
 * осознанно допустимо, см. Card title="Настройка роялти" ниже. */
function RoyaltyConditionEditor({
  condition,
  allPlates,
  onSaved,
  onDeleted,
}: {
  condition: RoyaltyCondition;
  allPlates: string[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const [percent, setPercent] = useState(String(condition.percent));
  const [trucks, setTrucks] = useState<string[]>(condition.trucks);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = Number(percent) !== condition.percent || trucks.join(",") !== condition.trucks.join(",");

  function toggleTruck(plate: string) {
    setTrucks((prev) => (prev.includes(plate) ? prev.filter((p) => p !== plate) : [...prev, plate]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/documents/royalty-conditions/${condition.id}`, { percent: Number(percent), trucks });
      onSaved();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm("Удалить это условие роялти?")) return;
    await api.delete(`/api/documents/royalty-conditions/${condition.id}`);
    onDeleted();
  }

  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 mb-2">
      <div className="flex gap-2 items-end flex-wrap mb-2">
        <div className="w-28">
          <Field label="Процент, %">
            <Input type="number" min="0" max="1000" step="0.1" value={percent} onChange={(e) => setPercent(e.target.value)} />
          </Field>
        </div>
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
        <Button variant="danger" onClick={() => void remove()}>
          Удалить условие
        </Button>
      </div>
      <p className="text-xs font-medium text-slate-500 mb-1">Машины в этом условии (по госномеру из загруженных файлов)</p>
      <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto p-2 bg-white rounded-lg border border-slate-100">
        {allPlates.length === 0 && (
          <span className="text-xs text-slate-400">Пока нет загруженных доставок — список госномеров появится после первого импорта.</span>
        )}
        {allPlates.map((plate) => (
          <label key={plate} className="flex items-center gap-1 text-sm px-2 py-1 rounded bg-slate-50 border border-slate-200 cursor-pointer">
            <input type="checkbox" checked={trucks.includes(plate)} onChange={() => toggleTruck(plate)} />
            {plate}
          </label>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Карточка настройки одного роялти целиком: название + список его условий
 * + форма добавления нового условия. onChanged общий на все вложенные
 * действия — проще одним колбэком перезагрузить и список роялти, и месячный
 * расчёт (см. RoyaltiesSection), чем городить отдельные пути для каждого. */
function RoyaltyEditor({ royalty, allPlates, onChanged }: { royalty: Royalty; allPlates: string[]; onChanged: () => void }) {
  const [name, setName] = useState(royalty.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameDirty = name !== royalty.name;

  async function saveName() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/api/documents/royalties/${royalty.id}`, { name });
      onChanged();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  async function removeRoyalty() {
    if (!window.confirm(`Удалить «${royalty.name}» вместе со всеми его условиями? Это необратимо.`)) return;
    await api.delete(`/api/documents/royalties/${royalty.id}`);
    onChanged();
  }

  return (
    <div className="p-3 rounded-lg border border-slate-300 mb-4">
      <div className="flex gap-2 items-end flex-wrap mb-3">
        <div className="w-64">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>
        <Button onClick={() => void saveName()} disabled={!nameDirty || saving}>
          {saving ? "Сохраняем…" : "Сохранить название"}
        </Button>
        <Button variant="danger" onClick={() => void removeRoyalty()}>
          Удалить {royalty.name}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {royalty.conditions.map((c) => (
        <RoyaltyConditionEditor key={c.id} condition={c} allPlates={allPlates} onSaved={onChanged} onDeleted={onChanged} />
      ))}
      <AddConditionForm royaltyId={royalty.id} onAdded={onChanged} />
    </div>
  );
}

function AddRoyaltyForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/documents/royalties", { name });
      setName("");
      onAdded();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap">
      <div className="w-64">
        <Field label="Название нового роялти">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Роялти 3" required />
        </Field>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Добавляем…" : "Добавить роялти"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** onChanged — сигнал наверх для RoyaltiesMonthSection: без него расчёт за
 * месяц (отдельный useApi) не узнаёт о правках состава/процента условий и
 * показывает устаревшие суммы до ручного обновления страницы. */
function RoyaltiesConfig({ onChanged }: { onChanged: () => void }) {
  const { data: royalties, reload: reloadRoyalties } = useApi<Royalty[]>("/api/documents/royalties");
  const { data: plates } = useApi<string[]>("/api/documents/truck-plates");

  async function reloadAll() {
    await reloadRoyalties();
    onChanged();
  }

  return (
    <Card title="Настройка роялти" collapsible defaultOpen={false}>
      <p className="text-sm text-slate-500 mb-3">
        Каждое роялти — начисление одному получателю, может состоять из нескольких условий (свой процент от суммы доставок
        своего набора машин), итог по роялти — сумма его условий. Одна и та же машина может входить в условия разных
        роялти одновременно — если её рейсы должны достаться нескольким людям, это ожидаемо, а не ошибка.
      </p>
      {(royalties ?? []).map((r) => (
        <RoyaltyEditor key={r.id} royalty={r} allPlates={plates ?? []} onChanged={() => void reloadAll()} />
      ))}
      <AddRoyaltyForm onAdded={() => void reloadAll()} />
    </Card>
  );
}

function RoyaltyTruckPreview({ truck }: { truck: RoyaltyTruckBreakdown }) {
  return (
    <div className="mt-2 mb-2 pl-4 border-l-2 border-slate-100">
      <Table head={["Дата", "Адрес", "Кг", "Сумма"]}>
        {truck.trips.map((t, i) => (
          <tr key={i}>
            <td className="py-1 pr-3">{formatShortDate(t.date)}</td>
            <td className="py-1 pr-3">{t.addressText}</td>
            <td className="py-1 pr-3">{fmt(t.massKg)}</td>
            <td className="py-1 pr-3">{fmtMoney(t.cost)}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function RoyaltyConditionCard({ condition }: { condition: RoyaltyConditionResult }) {
  const [expandedTruck, setExpandedTruck] = useState<string | null>(null);
  return (
    <div className="pl-3 border-l-2 border-slate-100 mb-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1 text-sm">
        <span className="text-slate-600">
          {fmt(condition.percent)}% — {condition.trucks.length > 0 ? condition.trucks.join(", ") : "машины не выбраны"}
        </span>
        <span>
          База: {fmtMoney(condition.totalCost)} ₽ → <span className="font-semibold">{fmtMoney(condition.amount)} ₽</span>
        </span>
      </div>
      {condition.byTruck.map((t) => (
        <div key={t.truckPlate} className="py-1 border-b border-slate-50 last:border-0">
          <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
            <span>
              {t.truckPlate} — {t.trips.length} {t.trips.length === 1 ? "поездка" : "поездок"}, {fmtMoney(t.totalCost)} ₽
            </span>
            <button
              onClick={() => setExpandedTruck(expandedTruck === t.truckPlate ? null : t.truckPlate)}
              className="text-sky-600 text-xs hover:underline"
            >
              {expandedTruck === t.truckPlate ? "Скрыть" : "Расшифровка"}
            </button>
          </div>
          {expandedTruck === t.truckPlate && <RoyaltyTruckPreview truck={t} />}
        </div>
      ))}
    </div>
  );
}

function RoyaltyCard({ royalty }: { royalty: RoyaltyResult }) {
  return (
    <div className="p-3 rounded-lg border border-slate-200 mb-3">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
        <span className="font-semibold text-slate-800">{royalty.name}</span>
        <span className="text-base font-bold text-sky-800 px-3 py-1 rounded-lg border-2 border-sky-300 bg-sky-50">
          {fmtMoney(royalty.totalAmount)} ₽
        </span>
      </div>
      {royalty.conditions.length === 0 && (
        <p className="text-xs text-slate-400">У роялти пока нет условий — настройте в разделе «Настройка роялти» ниже.</p>
      )}
      {royalty.conditions.map((c) => (
        <RoyaltyConditionCard key={c.conditionId} condition={c} />
      ))}
    </div>
  );
}

function RoyaltiesMonthSection({ refreshKey }: { refreshKey: number }) {
  const [month, setMonth] = useState(() => currentYearMonth());
  const { data: summary } = useApi<RoyaltySummary>(`/api/documents/royalties-summary?month=${month}`, [month, refreshKey]);

  return (
    <Card title="Роялти за месяц">
      <MonthPicker month={month} onChange={setMonth} />
      {(summary?.royalties ?? []).length === 0 && <p className="text-slate-400 text-sm mb-2">Роялти ещё не настроены.</p>}
      {(summary?.royalties ?? []).map((r) => (
        <RoyaltyCard key={r.royaltyId} royalty={r} />
      ))}
      {summary && summary.royalties.length > 0 && (
        <div className="p-3 rounded-lg bg-sky-50 border border-sky-200 mt-2">
          <span className="text-sm font-semibold text-sky-800">
            Общий итог по всем роялти за {month}: {fmtMoney(summary.grandTotal)} ₽
          </span>
        </div>
      )}
      {summary && summary.unassignedTrucks.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-500 mb-1">Машины без роялти за этот месяц</p>
          <ul className="text-xs text-slate-500 space-y-0.5">
            {summary.unassignedTrucks.map((t) => (
              <li key={t.truckPlate}>
                {t.truckPlate} — {fmtMoney(t.totalCost)} ₽
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function RoyaltiesSection() {
  const [refreshKey, setRefreshKey] = useState(0);
  return (
    <div>
      <RoyaltiesMonthSection refreshKey={refreshKey} />
      <RoyaltiesConfig onChanged={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}

function DayActPreview({ act }: { act: DayAct }) {
  return (
    <div className="mt-2 mb-3 pl-4 border-l-2 border-slate-100">
      <Table head={["№", "Точка доставки", "Машина", "₽/кг", "Кг", "Сумма"]}>
        {act.lines.map((line) => (
          <tr key={line.index}>
            <td className="py-1 pr-3">{line.index}</td>
            <td className="py-1 pr-3">{line.deliveryAddress}</td>
            <td className="py-1 pr-3">{line.truckPlate}</td>
            <td className="py-1 pr-3">{fmt(line.ratePerKg)}</td>
            <td className="py-1 pr-3">{fmt(line.massKg)}</td>
            <td className="py-1 pr-3">{fmtMoney(line.cost)}</td>
          </tr>
        ))}
      </Table>
      <p className="text-sm font-semibold mt-1">Итого: {fmtMoney(act.totalCost)} ₽</p>
    </div>
  );
}

function MonthSummaryPreview({ lines }: { lines: MonthSummaryLine[] }) {
  const total = lines.reduce((sum, l) => sum + l.cost, 0);
  return (
    <div className="mt-2 mb-3 pl-4 border-l-2 border-slate-100">
      <Table head={["Тариф, ₽/кг", "Период", "Кг", "Сумма"]}>
        {lines.map((line) => (
          <tr key={line.ratePerKg}>
            <td className="py-1 pr-3">{fmt(line.ratePerKg)}</td>
            <td className="py-1 pr-3">
              {formatShortDate(line.minDate)} — {formatShortDate(line.maxDate)}
            </td>
            <td className="py-1 pr-3">{fmt(line.massKg)}</td>
            <td className="py-1 pr-3">{fmtMoney(line.cost)}</td>
          </tr>
        ))}
      </Table>
      <p className="text-sm font-semibold mt-1">Итого: {fmtMoney(total)} ₽</p>
    </div>
  );
}

function CloseMonthForm({ month, onDone }: { month: string; onDone: () => void }) {
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(() => todayLocalDateString());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await api.post("/api/documents/month-closings", { yearMonth: month, invoiceNumber, invoiceDate });
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end flex-wrap p-3 rounded-lg bg-slate-50 border border-slate-200">
      <div className="w-32">
        <Field label="№ счёта">
          <Input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} required />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Дата счёта">
          <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
        </Field>
      </div>
      <Button type="submit" disabled={saving}>
        {saving ? "Закрываем…" : "Закрыть месяц"}
      </Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function JournalSection() {
  const [month, setMonth] = useState(() => currentYearMonth());
  const { data: dayActs } = useApi<DayAct[]>(`/api/documents/day-acts?month=${month}`, [month]);
  const { data: monthSummary } = useApi<MonthSummaryLine[]>(`/api/documents/month-summary?month=${month}`, [month]);
  const { data: closing, reload: reloadClosing } = useApi<MonthClosing | null>(`/api/documents/month-closings/${month}`, [month]);
  const [expanded, setExpanded] = useState<string | null>(null);

  async function download(path: string, filename: string) {
    try {
      await api.downloadFile(path, filename);
    } catch (err) {
      window.alert(describeError(err));
    }
  }

  const hasData = (dayActs ?? []).length > 0;

  return (
    <Card title="Журнал документов">
      <MonthPicker month={month} onChange={setMonth} />

      {!hasData && <p className="text-slate-400 text-sm mb-4">За этот месяц ещё нет загруженных рейсов.</p>}

      {hasData && (
        <div className="mb-4">
          <p className="text-sm font-semibold text-slate-600 mb-2">Акты по дням</p>
          {(dayActs ?? []).map((act) => (
            <div key={act.date} className="py-2 border-b border-slate-100 last:border-0">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-sm">
                  Акт №{act.actNumber} от {formatShortDate(act.date)} — <span className="font-medium">{fmtMoney(act.totalCost)} ₽</span>
                </span>
                <div className="flex gap-3">
                  <button onClick={() => setExpanded(expanded === act.date ? null : act.date)} className="text-sky-600 text-xs hover:underline">
                    {expanded === act.date ? "Скрыть" : "Просмотреть"}
                  </button>
                  <button
                    onClick={() => void download(`/api/documents/day-acts/${act.date}/download`, `Акт №${act.actNumber} от ${act.date}.xlsx`)}
                    className="text-sky-600 text-xs hover:underline"
                  >
                    Скачать .xlsx
                  </button>
                </div>
              </div>
              {expanded === act.date && <DayActPreview act={act} />}
            </div>
          ))}
          <div className="pt-2">
            <button
              onClick={() => void download(`/api/documents/day-acts/month/${month}/download`, `Акты за ${month}.xlsx`)}
              className="text-sky-600 text-xs hover:underline"
            >
              Скачать все акты за месяц одним файлом (вкладки по дням)
            </button>
          </div>
        </div>
      )}

      {hasData && !closing && (
        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">Реестр, итоговый акт и счёт</p>
          <p className="text-sm text-slate-500 mb-2">
            Чтобы сформировать реестр, итоговый акт и счёт за месяц, укажите номер и дату счёта:
          </p>
          <CloseMonthForm month={month} onDone={() => void reloadClosing()} />
        </div>
      )}

      {hasData && closing && (
        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">Реестр, итоговый акт и счёт</p>
          <div className="py-2 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm">Реестр документов за {month}</span>
              <button
                onClick={() => void download(`/api/documents/registry/${month}/download`, `Реестр ${month}.xlsx`)}
                className="text-sky-600 text-xs hover:underline"
              >
                Скачать .xlsx
              </button>
            </div>
          </div>
          <div className="py-2 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm">
                Итоговый акт №{closing.finalActNumber} от {formatShortDate(closing.finalActDate)}
              </span>
              <div className="flex gap-3">
                <button onClick={() => setExpanded(expanded === "final-act" ? null : "final-act")} className="text-sky-600 text-xs hover:underline">
                  {expanded === "final-act" ? "Скрыть" : "Просмотреть"}
                </button>
                <button
                  onClick={() => void download(`/api/documents/final-act/${month}/download`, `Акт №${closing.finalActNumber} ${month}.xlsx`)}
                  className="text-sky-600 text-xs hover:underline"
                >
                  Скачать .xlsx
                </button>
              </div>
            </div>
            {expanded === "final-act" && <MonthSummaryPreview lines={monthSummary ?? []} />}
          </div>
          <div className="py-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-sm">
                Счёт №{closing.invoiceNumber} от {formatShortDate(closing.invoiceDate)}
              </span>
              <div className="flex gap-3">
                <button onClick={() => setExpanded(expanded === "invoice" ? null : "invoice")} className="text-sky-600 text-xs hover:underline">
                  {expanded === "invoice" ? "Скрыть" : "Просмотреть"}
                </button>
                <button
                  onClick={() => void download(`/api/documents/invoice/${month}/download`, `Счёт №${closing.invoiceNumber} ${month}.xlsx`)}
                  className="text-sky-600 text-xs hover:underline"
                >
                  Скачать .xlsx
                </button>
              </div>
            </div>
            {expanded === "invoice" && <MonthSummaryPreview lines={monthSummary ?? []} />}
          </div>
        </div>
      )}
    </Card>
  );
}

export function DocumentsPage() {
  const [tab, setTab] = useState<Tab>("Импорт");

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === t ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`}
          >
            {t}
          </button>
        ))}
      </div>
      {tab === "Импорт" && <ImportSection />}
      {tab === "Итоги маршрутов" && <RouteSummarySection />}
      {tab === "Роялти" && <RoyaltiesSection />}
      {tab === "Журнал" && <JournalSection />}
    </div>
  );
}
