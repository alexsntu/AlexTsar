import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { describeError } from "../../api/errors";
import { useApi } from "../../hooks/useApi";
import type { Driver, Trip, TripStatus, Truck } from "../../api/types";
import { TRIP_STATUS_LABELS } from "../../api/types";
import { Badge, Button, Card, ErrorText, Field, Input, Select, Table } from "../../components/ui";

const STATUS_TONE: Record<TripStatus, "slate" | "green" | "amber" | "red"> = {
  ASSIGNED: "slate",
  IN_PROGRESS: "amber",
  DONE: "green",
  CANCELLED: "red",
};

export function TripsPage() {
  const { data: drivers } = useApi<Driver[]>("/api/drivers");
  const { data: trucks } = useApi<Truck[]>("/api/trucks");
  const { data: trips, reload } = useApi<Trip[]>("/api/trips");

  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [driverId, setDriverId] = useState("");
  const [truckId, setTruckId] = useState("");
  const [routeFrom, setRouteFrom] = useState("");
  const [routeTo, setRouteTo] = useState("");
  const [cargoDescription, setCargoDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api.post("/api/trips", {
        date,
        driverId: Number(driverId),
        truckId: Number(truckId),
        routeFrom,
        routeTo,
        cargoDescription: cargoDescription || undefined,
      });
      setRouteFrom("");
      setRouteTo("");
      setCargoDescription("");
      await reload();
    } catch (err) {
      setError(describeError(err));
    }
  }

  async function setStatus(id: number, status: TripStatus) {
    await api.patch(`/api/trips/${id}/status`, { status });
    await reload();
  }

  return (
    <div>
      <Card title="Новый рейс">
        <form onSubmit={handleSubmit} className="flex gap-2 items-end mb-2 flex-wrap">
          <div className="w-36">
            <Field label="Дата">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Водитель">
              <Select value={driverId} onChange={(e) => setDriverId(e.target.value)} required>
                <option value="">—</option>
                {(drivers ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.fullName}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
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
          <div className="w-36">
            <Field label="Откуда">
              <Input value={routeFrom} onChange={(e) => setRouteFrom(e.target.value)} required />
            </Field>
          </div>
          <div className="w-36">
            <Field label="Куда">
              <Input value={routeTo} onChange={(e) => setRouteTo(e.target.value)} required />
            </Field>
          </div>
          <div className="w-56">
            <Field label="Груз">
              <Input value={cargoDescription} onChange={(e) => setCargoDescription(e.target.value)} />
            </Field>
          </div>
          <Button type="submit">Создать рейс</Button>
        </form>
        <ErrorText>{error}</ErrorText>
      </Card>

      <Card title="Все рейсы">
        <Table head={["Дата", "Водитель", "Машина", "Маршрут", "Груз", "Статус", ""]}>
          {(trips ?? []).map((trip) => (
            <tr key={trip.id}>
              <td className="py-2 pr-4">{trip.date.slice(0, 10)}</td>
              <td className="py-2 pr-4">{trip.driver?.fullName}</td>
              <td className="py-2 pr-4">
                {trip.truck?.name} ({trip.truck?.plateNumber})
              </td>
              <td className="py-2 pr-4">
                {trip.routeFrom} → {trip.routeTo}
              </td>
              <td className="py-2 pr-4">{trip.cargoDescription ?? "—"}</td>
              <td className="py-2 pr-4">
                <Badge tone={STATUS_TONE[trip.status]}>{TRIP_STATUS_LABELS[trip.status]}</Badge>
              </td>
              <td className="py-2 pr-4 text-right whitespace-nowrap">
                {trip.status !== "DONE" && trip.status !== "CANCELLED" && (
                  <>
                    <button onClick={() => void setStatus(trip.id, "DONE")} className="text-emerald-600 text-xs hover:underline mr-2">
                      Завершить
                    </button>
                    <button onClick={() => void setStatus(trip.id, "CANCELLED")} className="text-red-600 text-xs hover:underline">
                      Отменить
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
