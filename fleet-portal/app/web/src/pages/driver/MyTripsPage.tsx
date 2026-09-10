import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type { FuelType, Trip, TripStatus } from "../../api/types";
import { TRIP_STATUS_LABELS } from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Select } from "../../components/ui";
import { todayLocalDateString } from "../../lib/date";

const STATUS_TONE: Record<TripStatus, "slate" | "green" | "amber" | "red"> = {
  ASSIGNED: "slate",
  IN_PROGRESS: "amber",
  DONE: "green",
  CANCELLED: "red",
};

function FuelForm({ tripId, onDone }: { tripId: number; onDone: () => void }) {
  const { data: fuelTypes } = useApi<FuelType[]>("/api/fuel-types");
  const [fuelTypeId, setFuelTypeId] = useState("");
  const [liters, setLiters] = useState("");
  const [odometer, setOdometer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    setError(null);
    setOk(false);
    setSubmitting(true);
    try {
      await api.post(`/api/trips/${tripId}/fuel`, {
        fuelTypeId: Number(fuelTypeId),
        date: todayLocalDateString(),
        liters: Number(liters),
        odometer: odometer ? Number(odometer) : undefined,
        idempotencyKey,
      });
      setLiters("");
      setOdometer("");
      setOk(true);
      setIdempotencyKey(crypto.randomUUID());
      onDone();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 border-t border-slate-100 pt-3">
      <p className="text-sm font-medium text-slate-700 mb-2">Заправить</p>
      <div className="flex gap-2 flex-wrap items-end">
        <div className="w-36">
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
        <div className="w-24">
          <Field label="Литры">
            <Input type="number" min="0" step="0.01" value={liters} onChange={(e) => setLiters(e.target.value)} required />
          </Field>
        </div>
        <div className="w-28">
          <Field label="Одометр">
            <Input type="number" min="0" value={odometer} onChange={(e) => setOdometer(e.target.value)} />
          </Field>
        </div>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Списываем…" : "Списать"}
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {ok && <p className="text-sm text-emerald-600 mt-2">Заправка записана</p>}
    </form>
  );
}

export function MyTripsPage() {
  const { data: trips, reload } = useApi<Trip[]>("/api/trips/my");
  const [openFuelForm, setOpenFuelForm] = useState<number | null>(null);

  async function setStatus(id: number, status: TripStatus) {
    await api.patch(`/api/trips/${id}/status`, { status });
    await reload();
  }

  return (
    <div>
      {(trips ?? []).map((trip) => {
        const active = trip.status === "ASSIGNED" || trip.status === "IN_PROGRESS";
        return (
          <Card key={trip.id}>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-semibold text-slate-800">
                  {trip.routeFrom} → {trip.routeTo}
                </p>
                <p className="text-sm text-slate-500">{trip.date.slice(0, 10)}</p>
                <p className="text-sm text-slate-500">
                  {trip.truck?.name} ({trip.truck?.plateNumber})
                </p>
                {trip.cargoDescription && <p className="text-sm text-slate-600 mt-1">Груз: {trip.cargoDescription}</p>}
              </div>
              <Badge tone={STATUS_TONE[trip.status]}>{TRIP_STATUS_LABELS[trip.status]}</Badge>
            </div>

            {active && (
              <div className="flex gap-2 mt-3">
                {trip.status === "ASSIGNED" && (
                  <Button onClick={() => void setStatus(trip.id, "IN_PROGRESS")}>Начать рейс</Button>
                )}
                {trip.status === "IN_PROGRESS" && (
                  <Button variant="secondary" onClick={() => void setStatus(trip.id, "DONE")}>
                    Завершить рейс
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setOpenFuelForm(openFuelForm === trip.id ? null : trip.id)}>
                  Заправить
                </Button>
              </div>
            )}

            {openFuelForm === trip.id && <FuelForm tripId={trip.id} onDone={() => setOpenFuelForm(null)} />}
          </Card>
        );
      })}
      {trips && trips.length === 0 && <p className="text-slate-500">Рейсов пока нет</p>}
    </div>
  );
}
