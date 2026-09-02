"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, send } from "@/lib/client";
import { dur, km } from "@/lib/format";
import type { Settings, StopStatus, StopWithAddress, Trip } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type TripFull = { trip: Trip; stops: StopWithAddress[]; warning?: string };

const STATUS_LABEL: Record<StopStatus, string> = {
  pending: "У черзі",
  done: "Доставлено",
  failed: "Не застав",
  skipped: "Пропущено",
};

export default function TripPage() {
  const params = useParams<{ id: string }>();
  const tripId = Number(params.id);

  const [trip, setTrip] = useState<Trip | null>(null);
  const [stops, setStops] = useState<StopWithAddress[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [warning, setWarning] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showMap, setShowMap] = useState(true);
  const [newAddress, setNewAddress] = useState("");

  const apply = useCallback((data: TripFull) => {
    setTrip(data.trip);
    setStops(data.stops);
    if (data.warning) setWarning(data.warning);
  }, []);

  useEffect(() => {
    api<TripFull>(`/api/trips/${tripId}`).then(apply).catch((e) => setError(e.message));
    api<Settings>("/api/settings").then(setSettings);
  }, [tripId, apply]);

  const stopMinutes = Number(settings?.stop_minutes ?? 3);
  const doneCount = stops.filter((stop) => stop.status === "done").length;
  const handledCount = stops.filter((stop) => stop.status !== "pending").length;

  /** Орієнтовний час прибуття на кожну точку: дорога + вручення на попередніх. */
  const etas = useMemo(() => {
    const base = trip?.started_at ? new Date(trip.started_at).getTime() : Date.now();
    let elapsed = 0;
    return stops.map((stop, index) => {
      elapsed += (stop.leg_duration_s ?? 0) * 1000 + (index > 0 ? stopMinutes * 60000 : 0);
      return new Date(base + elapsed);
    });
  }, [stops, trip?.started_at, stopMinutes]);

  const nextIndex = stops.findIndex((stop) => stop.status === "pending");

  const mapPoints = useMemo(() => {
    const points = stops
      .filter((stop) => stop.lat != null)
      .map((stop, index) => ({
        lat: stop.lat!,
        lon: stop.lon!,
        label: `${index + 1}. ${stop.label}`,
        badge: String(index + 1),
        kind: (stop.status === "done" ? "done" : "pending") as "done" | "pending",
      }));
    if (trip?.depot_lat != null && trip.depot_lon != null) {
      points.unshift({
        lat: trip.depot_lat,
        lon: trip.depot_lon,
        label: trip.depot_label || "Відділення",
        badge: "🏤",
        kind: "depot" as never,
      });
    }
    return points;
  }, [stops, trip]);

  const line = useMemo<[number, number][]>(() => {
    try {
      return trip?.geometry ? (JSON.parse(trip.geometry) as [number, number][]) : [];
    } catch {
      return [];
    }
  }, [trip?.geometry]);

  async function updateStop(stopId: number, patch: { status?: StopStatus; comment?: string }) {
    setStops((current) =>
      current.map((stop) => (stop.id === stopId ? { ...stop, ...patch } : stop)),
    );
    try {
      const data = await send<TripFull>(`/api/stops/${stopId}`, "PATCH", patch);
      if (data) apply(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function call(path: string, method: string, body: unknown) {
    setBusy(true);
    setError("");
    setWarning("");
    try {
      apply(await api<TripFull>(path, { method, body: JSON.stringify(body) }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= stops.length) return;
    const reordered = stops.slice();
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    setStops(reordered);
    void call(`/api/trips/${tripId}`, "PATCH", { order: reordered.map((stop) => stop.id) });
  }

  if (error && !trip) return <div className="banner error">{error}</div>;
  if (!trip) return <p className="muted">Завантаження…</p>;

  const driveSeconds = trip.plan_duration_s ?? 0;
  const totalSeconds = driveSeconds + stops.length * stopMinutes * 60;

  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>{trip.title}</h1>
        <span className="chip">
          {trip.status === "active" ? "У дорозі" : trip.status === "done" ? "Завершено" : "Заплановано"}
        </span>
      </div>

      {error && <div className="banner error" style={{ marginTop: 12 }}>{error}</div>}
      {warning && <div className="banner warn" style={{ marginTop: 12 }}>{warning}</div>}
      {trip.engine === "haversine" && (
        <div className="banner warn" style={{ marginTop: 12 }}>
          Маршрут порахований по прямій, без доріг. Додай ключ ORS у{" "}
          <Link href="/settings">Налаштуваннях</Link>.
        </div>
      )}

      <div className="card">
        <div className="stats">
          <div className="stat">
            <b>{km(trip.plan_distance_m)}</b>
            <span>відстань</span>
          </div>
          <div className="stat">
            <b>{dur(driveSeconds)}</b>
            <span>у дорозі</span>
          </div>
          <div className="stat">
            <b>{dur(totalSeconds)}</b>
            <span>разом з врученнями</span>
          </div>
          <div className="stat">
            <b>
              {doneCount}/{stops.length}
            </b>
            <span>доставлено</span>
          </div>
        </div>
      </div>

      <div className="row wrap" style={{ marginBottom: 12 }}>
        {trip.status !== "done" && (
          <button
            className="primary grow"
            onClick={() =>
              void call(`/api/trips/${tripId}`, "PATCH", {
                status: trip.status === "active" ? "done" : "active",
              })
            }
          >
            {trip.status === "active" ? "Завершити поїздку" : "Почати поїздку"}
          </button>
        )}
        <button onClick={() => void call(`/api/trips/${tripId}/optimize`, "POST", { mode: "optimize" })} disabled={busy}>
          {busy ? "…" : "Перерахувати"}
        </button>
        <button className="ghost" onClick={() => setShowMap((value) => !value)}>
          {showMap ? "Сховати карту" : "Карта"}
        </button>
      </div>

      {handledCount > 0 && trip.status !== "done" && (
        <p className="small muted" style={{ marginTop: -6 }}>
          «Перерахувати» переставить лише точки, що попереду, і почне з останньої відвіданої.
        </p>
      )}

      {showMap && mapPoints.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <MapView points={mapPoints} line={line} />
        </div>
      )}

      {stops.map((stop, index) => (
        <div key={stop.id} className={`stop ${stop.status}`}>
          <div className="badge">{index + 1}</div>
          <div className="grow">
            <div className="spread">
              <div className="stop-title">{stop.label}</div>
              {index === nextIndex && trip.status === "active" && <span className="chip">наступна</span>}
            </div>
            <div className="leg">
              {km(stop.leg_distance_m)} · {dur(stop.leg_duration_s)} у дорозі ·{" "}
              {etas[index]?.toLocaleTimeString("uk-UA", { hour: "2-digit", minute: "2-digit" })}
              {stop.status !== "pending" && ` · ${STATUS_LABEL[stop.status]}`}
            </div>

            {stop.note && <div className="note">📌 {stop.note}</div>}

            <div className="row wrap" style={{ marginTop: 8 }}>
              <button
                className={stop.status === "done" ? "primary" : ""}
                onClick={() => void updateStop(stop.id, { status: stop.status === "done" ? "pending" : "done" })}
              >
                ✓ Доставлено
              </button>
              <button
                className={stop.status === "failed" ? "primary" : ""}
                onClick={() => void updateStop(stop.id, { status: stop.status === "failed" ? "pending" : "failed" })}
              >
                ✗ Не застав
              </button>
              {stop.lat != null && (
                <a
                  className="chip"
                  style={{ padding: "12px 14px" }}
                  href={`https://www.google.com/maps/dir/?api=1&destination=${stop.lat},${stop.lon}&travelmode=bicycling`}
                  target="_blank"
                  rel="noreferrer"
                >
                  ➜ Навігація
                </a>
              )}
              <button className="icon ghost" onClick={() => move(index, -1)} aria-label="Вище">↑</button>
              <button className="icon ghost" onClick={() => move(index, 1)} aria-label="Нижче">↓</button>
              <button
                className="icon ghost danger"
                aria-label="Прибрати з маршруту"
                onClick={() => void call(`/api/stops/${stop.id}`, "DELETE", {})}
              >
                ✕
              </button>
            </div>

            <textarea
              style={{ marginTop: 8 }}
              placeholder="Коментар до адреси (необов'язково)"
              defaultValue={stop.comment}
              onBlur={(event) => {
                if (event.target.value !== stop.comment) {
                  void updateStop(stop.id, { comment: event.target.value });
                }
              }}
            />
          </div>
        </div>
      ))}

      <div className="card">
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Додати адресу в цю поїздку</span>
          <div className="row">
            <input
              className="grow"
              type="text"
              value={newAddress}
              placeholder="вул. Лесі Українки 4"
              onChange={(event) => setNewAddress(event.target.value)}
            />
            <button
              disabled={busy || !newAddress.trim()}
              onClick={async () => {
                await call(`/api/trips/${tripId}/stops`, "POST", { label: newAddress.trim() });
                setNewAddress("");
              }}
            >
              Додати
            </button>
          </div>
        </label>
      </div>

      <div className="card">
        <label className="field" style={{ marginBottom: 0 }}>
          <span>Нотатка до поїздки</span>
          <textarea
            defaultValue={trip.note}
            placeholder="Погода, дорога, що варто памʼятати наступного разу"
            onBlur={(event) => {
              if (event.target.value !== trip.note) {
                void send(`/api/trips/${tripId}`, "PATCH", { note: event.target.value });
              }
            }}
          />
        </label>
      </div>
    </>
  );
}
