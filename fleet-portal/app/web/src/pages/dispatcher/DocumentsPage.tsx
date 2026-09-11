import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type { DayAct, ImportBatch, ImportResult, MonthClosing, MonthSummaryLine, RouteSummaryRow } from "../../api/types";
import { Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";
import { formatShortDate, todayLocalDateString } from "../../lib/date";

const TABS = ["Импорт", "Итоги маршрутов", "Журнал"] as const;
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

function ImportSection() {
  const { data: batches, reload } = useApi<ImportBatch[]>("/api/documents/imports");
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
      const result = await api.postForm<ImportResult>("/api/documents/imports", formData);
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
      await reload();
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

  async function deleteBatch(id: number) {
    if (!window.confirm("Удалить этот импорт и все связанные с ним рейсы? Это необратимо.")) return;
    await api.delete(`/api/documents/imports/${id}`);
    await reload();
  }

  return (
    <div>
      <Card title="Загрузка расшифровки от заказчика">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
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
          <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
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
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
            <p className="text-sm font-semibold text-red-700 mb-2">
              Файл не принят — {errors.length} {errors.length === 1 ? "расхождение" : "расхождений"} с тарифами/справочником. Ничего не сохранено.
            </p>
            <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
              {errors.map((e, i) => (
                <li key={i}>{e.message}</li>
              ))}
            </ul>
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            Загружено: {success.rowCount} рейсов, {fmt(success.totalMassKg)} кг, на сумму {fmtMoney(success.totalCost)} ₽ (период{" "}
            {formatShortDate(success.periodFrom)} — {formatShortDate(success.periodTo)}).
          </div>
        )}
      </Card>

      <Card title="Загруженные периоды">
        <Table head={["Период", "Файл", "Рейсов", "Масса, кг", "Сумма, ₽", ""]}>
          {(batches ?? []).map((b) => (
            <tr key={b.id}>
              <td className="py-2 pr-4">
                {formatShortDate(b.periodFrom)} — {formatShortDate(b.periodTo)}
              </td>
              <td className="py-2 pr-4">{b.sourceFileName}</td>
              <td className="py-2 pr-4">{b.rowCount}</td>
              <td className="py-2 pr-4">{fmt(b.totalMassKg)}</td>
              <td className="py-2 pr-4">{fmtMoney(b.totalCost)}</td>
              <td className="py-2 pr-4 text-right">
                <button onClick={() => void deleteBatch(b.id)} className="text-red-600 text-xs hover:underline">
                  Удалить
                </button>
              </td>
            </tr>
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
      {tab === "Журнал" && <JournalSection />}
    </div>
  );
}
