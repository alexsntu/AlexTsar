import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type { Driver, FuelType, Truck } from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Table } from "../../components/ui";

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
          <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
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

export function DirectoriesPage() {
  return (
    <div>
      <TrucksSection />
      <DriversSection />
      <FuelTypesSection />
    </div>
  );
}
