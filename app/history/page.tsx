"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { dateTime, dur, km } from "@/lib/format";
import type { Trip } from "@/lib/types";

type TripRow = Trip & { stop_count: number; done_count: number };

export default function HistoryPage() {
  const [trips, setTrips] = useState<TripRow[]>([]);
  const [error, setError] = useState("");

  function load() {
    api<{ trips: TripRow[] }>("/api/trips")
      .then((data) => setTrips(data.trips))
      .catch((err) => setError(err.message));
  }

  useEffect(load, []);

  async function remove(id: number) {
    if (!confirm("Видалити поїздку разом з коментарями?")) return;
    await api(`/api/trips/${id}`, { method: "DELETE" });
    load();
  }

  const totalKm = trips.reduce((sum, trip) => sum + (trip.plan_distance_m ?? 0), 0);
  const totalStops = trips.reduce((sum, trip) => sum + trip.done_count, 0);

  return (
    <>
      <h1>Історія поїздок</h1>
      {error && <div className="banner error">{error}</div>}

      {trips.length > 0 && (
        <div className="card">
          <div className="stats">
            <div className="stat">
              <b>{trips.length}</b>
              <span>поїздок</span>
            </div>
            <div className="stat">
              <b>{km(totalKm)}</b>
              <span>намотано</span>
            </div>
            <div className="stat">
              <b>{totalStops}</b>
              <span>вручень</span>
            </div>
          </div>
        </div>
      )}

      {trips.map((trip) => {
        // Факт рахуємо лише коли поїздка закрита — інакше це просто "ще їду".
        const actual =
          trip.started_at && trip.finished_at
            ? (new Date(trip.finished_at).getTime() - new Date(trip.started_at).getTime()) / 1000
            : null;
        return (
          <div key={trip.id} className="card">
            <div className="spread">
              <Link href={`/trip/${trip.id}`} className="grow">
                <b>{trip.title}</b>
                <div className="small muted">{dateTime(trip.created_at)}</div>
              </Link>
              <button className="icon ghost danger" onClick={() => void remove(trip.id)} aria-label="Видалити">
                ✕
              </button>
            </div>
            <div className="small muted" style={{ marginTop: 8 }}>
              {trip.done_count}/{trip.stop_count} доставлено · {km(trip.plan_distance_m)} ·{" "}
              план {dur(trip.plan_duration_s)}
              {actual != null && ` · факт ${dur(actual)}`}
              {trip.status !== "done" && ` · ${trip.status === "active" ? "у дорозі" : "заплановано"}`}
            </div>
            {trip.note && <div className="note">{trip.note}</div>}
          </div>
        );
      })}

      {!trips.length && !error && <p className="muted">Поки що порожньо. Побудуй перший маршрут.</p>}
    </>
  );
}
