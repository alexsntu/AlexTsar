import { Fragment, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type { Address, AddressRate, Driver, FuelType, OrgProfile, OrgRole, Truck } from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Table } from "../../components/ui";
import { formatShortDate, todayLocalDateString } from "../../lib/date";

function fmt(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 });
}

function TrucksSection() {
  const { data, reload } = useApi<Truck[]>("/api/trucks");
  const [name, setName] = useState("");
  const [plateNumber, setPlateNumber] = useState("");
  const [capacityTons, setCapacityTons] = useState("");
  const [normMin, setNormMin] = useState("");
  const [normMax, setNormMax] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/trucks", {
        name,
        plateNumber,
        capacityTons: capacityTons ? Number(capacityTons) : undefined,
        normConsumptionMin: normMin ? Number(normMin) : undefined,
        normConsumptionMax: normMax ? Number(normMax) : undefined,
      });
      setName("");
      setPlateNumber("");
      setCapacityTons("");
      setNormMin("");
      setNormMax("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function deactivate(id: number) {
    await api.delete(`/api/trucks/${id}`);
    await reload();
  }

  return (
    <Card title="Тягачи">
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
        <div className="w-40">
          <Field label="Модель">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Например, Isuzu fvr34" />
          </Field>
        </div>
        <div className="w-32">
          <Field label="Госномер">
            <Input value={plateNumber} onChange={(e) => setPlateNumber(e.target.value)} required />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Грузопод., т">
            <Input type="number" min="0" step="0.1" value={capacityTons} onChange={(e) => setCapacityTons(e.target.value)} />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Норма л/100км от">
            <Input type="number" min="0" step="0.1" value={normMin} onChange={(e) => setNormMin(e.target.value)} />
          </Field>
        </div>
        <div className="w-24">
          <Field label="до">
            <Input type="number" min="0" step="0.1" value={normMax} onChange={(e) => setNormMax(e.target.value)} />
          </Field>
        </div>
        <Button type="submit">Добавить</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <Table head={["Модель", "Госномер", "Грузопод., т", "Норма л/100км", ""]}>
        {(data ?? []).map((truck) => (
          <tr key={truck.id}>
            <td className="py-2 pr-4">{truck.name}</td>
            <td className="py-2 pr-4">{truck.plateNumber}</td>
            <td className="py-2 pr-4">{truck.capacityTons ?? "—"}</td>
            <td className="py-2 pr-4">
              {truck.normConsumptionMin && truck.normConsumptionMax
                ? `${truck.normConsumptionMin}–${truck.normConsumptionMax}`
                : "—"}
            </td>
            <td className="py-2 pr-4 text-right">
              <button onClick={() => void deactivate(truck.id)} className="text-red-600 text-xs hover:underline">
                Убрать
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function CredentialsForm({ driverId, onDone }: { driverId: number; onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.put(`/api/drivers/${driverId}/credentials`, { email, password });
      onDone();
    } catch (err) {
      setError(describeError(err));
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 items-end mt-2">
      <div className="w-48">
        <Field label="Логин">
          <Input type="text" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
      </div>
      <div className="w-40">
        <Field label="Пароль">
          <div className="flex items-center gap-1">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={6}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-700 whitespace-nowrap"
              tabIndex={-1}
            >
              {showPassword ? "скрыть" : "показать"}
            </button>
          </div>
        </Field>
      </div>
      <Button type="submit">Сохранить</Button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function DriversSection() {
  const { data, reload } = useApi<Driver[]>("/api/drivers");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingLoginFor, setEditingLoginFor] = useState<number | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/drivers", { fullName, phone: phone || undefined });
      setFullName("");
      setPhone("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function deactivate(id: number) {
    await api.delete(`/api/drivers/${id}`);
    await reload();
  }

  return (
    <Card title="Водители">
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
        <div className="w-56">
          <Field label="ФИО">
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </Field>
        </div>
        <div className="w-40">
          <Field label="Телефон">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <Button type="submit">Добавить</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <Table head={["ФИО", "Телефон", "Логин в приложении", ""]}>
        {(data ?? []).map((driver) => (
          <tr key={driver.id}>
            <td className="py-2 pr-4 align-top">{driver.fullName}</td>
            <td className="py-2 pr-4 align-top">{driver.phone ?? "—"}</td>
            <td className="py-2 pr-4 align-top">
              {driver.loginEmail ?? <span className="text-slate-400">не заведён</span>}
              {editingLoginFor === driver.id && (
                <CredentialsForm driverId={driver.id} onDone={() => { setEditingLoginFor(null); void reload(); }} />
              )}
            </td>
            <td className="py-2 pr-4 text-right align-top whitespace-nowrap">
              <button
                onClick={() => setEditingLoginFor(editingLoginFor === driver.id ? null : driver.id)}
                className="text-sky-600 text-xs hover:underline mr-3"
              >
                {driver.loginEmail ? "Сменить пароль" : "Завести логин"}
              </button>
              <button onClick={() => void deactivate(driver.id)} className="text-red-600 text-xs hover:underline">
                Убрать
              </button>
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  );
}

function FuelTypesSection() {
  const { data, reload } = useApi<FuelType[]>("/api/fuel-types");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/fuel-types", { name });
      setName("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function deactivate(id: number) {
    await api.delete(`/api/fuel-types/${id}`);
    await reload();
  }

  return (
    <Card title="Виды топлива">
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
        <div className="w-56">
          <Field label="Название">
            <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Например, Дизель" />
          </Field>
        </div>
        <Button type="submit">Добавить</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <div className="flex flex-wrap gap-2">
        {(data ?? []).map((fuelType) => (
          <div key={fuelType.id} className="flex items-center gap-2">
            <Badge>{fuelType.name}</Badge>
            <button onClick={() => void deactivate(fuelType.id)} className="text-red-600 text-xs hover:underline">
              убрать
            </button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Тариф "сейчас" — последний по effectiveFrom, не позже сегодняшней даты
 * (rates приходят с сервера отсортированными по effectiveFrom по убыванию). */
function currentRate(rates: AddressRate[]): AddressRate | undefined {
  const now = Date.now();
  return rates.find((r) => new Date(r.effectiveFrom).getTime() <= now);
}

function AddressRatesEditor({ address, onDone }: { address: Address; onDone: () => void }) {
  const [pricePerKg, setPricePerKg] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(() => todayLocalDateString());
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post(`/api/documents/addresses/${address.id}/rates`, { pricePerKg: Number(pricePerKg), effectiveFrom });
      setPricePerKg("");
      onDone();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function removeRate(id: number) {
    await api.delete(`/api/documents/rates/${id}`);
    onDone();
  }

  return (
    <div className="mt-1 mb-2 pl-4 border-l-2 border-slate-100">
      {address.rates.length > 0 ? (
        <table className="text-xs mb-2">
          <tbody>
            {address.rates.map((r) => (
              <tr key={r.id}>
                <td className="pr-3 py-0.5 text-slate-500">действует с {formatShortDate(r.effectiveFrom)}</td>
                <td className="pr-3 py-0.5 font-medium">{fmt(r.pricePerKg)} ₽/кг</td>
                <td>
                  <button onClick={() => void removeRate(r.id)} className="text-red-600 hover:underline">
                    убрать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-slate-400 mb-2">Тариф ещё не задан</p>
      )}
      <form onSubmit={handleSubmit} className="flex gap-2 items-end">
        <div className="w-28">
          <Field label="Тариф, ₽/кг">
            <Input type="number" min="0" step="0.01" value={pricePerKg} onChange={(e) => setPricePerKg(e.target.value)} required />
          </Field>
        </div>
        <div className="w-36">
          <Field label="Действует с">
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit">Добавить тариф</Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Адреса доставки (справочник "82/N ...") с историей тарифов за кг по
 * каждому — сгруппированы/отсортированы по городу, как просил пользователь,
 * чтобы было удобнее искать. Сервер уже отдаёт список отсортированным по
 * city/fullAddress, здесь только расставляем заголовки групп. */
function AddressesSection() {
  const { data, reload } = useApi<Address[]>("/api/documents/addresses");
  const [code, setCode] = useState("");
  const [fullAddress, setFullAddress] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/documents/addresses", { code: code || undefined, fullAddress, city });
      setCode("");
      setFullAddress("");
      setCity("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function deactivate(id: number) {
    await api.delete(`/api/documents/addresses/${id}`);
    await reload();
  }

  const addresses = data ?? [];
  let lastCity: string | null = null;

  return (
    <Card title="Адреса доставки и тарифы" collapsible>
      <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-4 flex-wrap">
        <div className="w-24">
          <Field label="Код">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="82/49" />
          </Field>
        </div>
        <div className="w-80">
          <Field label="Адрес">
            <Input value={fullAddress} onChange={(e) => setFullAddress(e.target.value)} required />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Город/направление">
            <Input value={city} onChange={(e) => setCity(e.target.value)} required />
          </Field>
        </div>
        <Button type="submit">Добавить</Button>
      </form>
      <ErrorText>{error}</ErrorText>
      <Table head={["Адрес", "Текущий тариф", ""]}>
        {addresses.map((address) => {
          const showCityHeader = address.city !== lastCity;
          lastCity = address.city;
          const active = currentRate(address.rates);
          return (
            <Fragment key={address.id}>
              {showCityHeader && (
                <tr className="bg-slate-50">
                  <td colSpan={3} className="py-1 px-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    {address.city}
                  </td>
                </tr>
              )}
              <tr>
                <td className="py-2 pr-4 align-top">
                  {address.code && <span className="text-slate-400 mr-1">{address.code}</span>}
                  {address.fullAddress}
                </td>
                <td className="py-2 pr-4 align-top">
                  {active ? `${fmt(active.pricePerKg)} ₽/кг` : <span className="text-slate-400">не задан</span>}
                </td>
                <td className="py-2 pr-4 text-right align-top whitespace-nowrap">
                  <button
                    onClick={() => setExpandedId(expandedId === address.id ? null : address.id)}
                    className="text-sky-600 text-xs hover:underline mr-3"
                  >
                    {expandedId === address.id ? "Скрыть тарифы" : "Тарифы"}
                  </button>
                  <button onClick={() => void deactivate(address.id)} className="text-red-600 text-xs hover:underline">
                    Убрать
                  </button>
                </td>
              </tr>
              {expandedId === address.id && (
                <tr>
                  <td colSpan={3} className="pb-1">
                    <AddressRatesEditor address={address} onDone={() => void reload()} />
                  </td>
                </tr>
              )}
            </Fragment>
          );
        })}
      </Table>
    </Card>
  );
}

const ORG_PROFILE_FIELDS: Array<{ key: keyof OrgProfile; label: string; wide?: boolean; type?: string }> = [
  { key: "name", label: "Название" },
  { key: "inn", label: "ИНН" },
  { key: "kpp", label: "КПП" },
  { key: "phone", label: "Телефон" },
  { key: "legalAddress", label: "Юр. адрес", wide: true },
  { key: "bankName", label: "Банк" },
  { key: "bankAccount", label: "Р/с" },
  { key: "bik", label: "БИК" },
  { key: "corrAccount", label: "К/с" },
  { key: "dispatchPoint", label: "Точка отправки (в акте)", wide: true },
  { key: "contractNumber", label: "№ договора" },
  { key: "contractDate", label: "Дата договора", type: "date" },
  { key: "contractIgk", label: "ИГК контракта", wide: true },
];

function OrgProfileForm({ role, profile, onDone }: { role: OrgRole; profile: OrgProfile | undefined; onDone: () => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      ORG_PROFILE_FIELDS.map(({ key, type }) => {
        const raw = profile?.[key];
        const value = typeof raw === "string" ? raw : "";
        return [key, type === "date" ? value.slice(0, 10) : value];
      }),
    ),
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function setValue(key: string, value: string) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v || undefined]));
      await api.patch(`/api/documents/org-profiles/${role}`, payload);
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
      {ORG_PROFILE_FIELDS.map(({ key, label, wide, type }) => (
        <div key={key} className={wide ? "col-span-2" : undefined}>
          <Field label={label}>
            <Input
              type={type ?? "text"}
              value={values[key] ?? ""}
              onChange={(e) => setValue(key, e.target.value)}
              required={key === "name" || key === "inn" || key === "legalAddress"}
            />
          </Field>
        </div>
      ))}
      <div className="col-span-2 flex gap-3 items-center">
        <Button type="submit" disabled={saving}>
          {saving ? "Сохраняем…" : "Сохранить"}
        </Button>
        <ErrorText>{error}</ErrorText>
      </div>
    </form>
  );
}

/** Реквизиты Поставщика/Покупателя для шапок актов и счёта — редактируемые,
 * с реальными данными, засеянными при первом запуске. */
function OrgProfilesSection() {
  const { data, reload } = useApi<OrgProfile[]>("/api/documents/org-profiles");
  if (!data) return null;
  const supplier = data.find((p) => p.role === "SUPPLIER");
  const buyer = data.find((p) => p.role === "BUYER");

  return (
    <Card title="Реквизиты сторон (для актов и счёта)" collapsible>
      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">Поставщик (Исполнитель)</p>
          <OrgProfileForm key={supplier?.id ?? "supplier-new"} role="SUPPLIER" profile={supplier} onDone={() => void reload()} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-600 mb-2">Покупатель (Заказчик)</p>
          <OrgProfileForm key={buyer?.id ?? "buyer-new"} role="BUYER" profile={buyer} onDone={() => void reload()} />
        </div>
      </div>
    </Card>
  );
}

export function DirectoriesPage() {
  return (
    <div>
      <TrucksSection />
      <DriversSection />
      <FuelTypesSection />
      <AddressesSection />
      <OrgProfilesSection />
    </div>
  );
}
