"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/client";
import { dateOnly, km, dur } from "@/lib/format";
import type { Address, Settings, Trip } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Candidate = { label: string; lat: number; lon: number; confidence: number; source: string };
type Draft = {
  label: string;
  lat?: number;
  lon?: number;
  fromBook: boolean;
  /** Інші варіанти від геокодера — щоб виправити промах в один тап. */
  alternatives?: Candidate[];
};
type TripRow = Trip & { stop_count: number; done_count: number };

export default function PlanPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [book, setBook] = useState<Address[]>([]);
  const [openTrips, setOpenTrips] = useState<TripRow[]>([]);

  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Draft[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState<"duration" | "distance">("duration");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openAlternatives, setOpenAlternatives] = useState<number | null>(null);

  useEffect(() => {
    api<Settings>("/api/settings").then((data) => {
      setSettings(data);
      setObjective(data.objective);
    });
    api<{ addresses: Address[] }>("/api/addresses").then((data) => setBook(data.addresses));
    api<{ trips: TripRow[] }>("/api/trips").then((data) =>
      setOpenTrips(data.trips.filter((trip) => trip.status === "active" || trip.status === "planned")),
    );
  }, []);

  // Підказки з довідника адрес: те, що вже возив раніше, вводиться в один тап.
  const suggestions = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) return [];
    const taken = new Set(items.map((item) => item.label.toLowerCase()));
    return book
      .filter((address) => address.label.toLowerCase().includes(needle) && !taken.has(address.label.toLowerCase()))
      .slice(0, 6);
  }, [query, book, items]);

  const mapPoints = useMemo(() => {
    const points = items
      .filter((item) => item.lat != null)
      .map((item, index) => ({
        lat: item.lat!,
        lon: item.lon!,
        label: item.label,
        badge: String(index + 1),
        kind: "pending" as const,
      }));
    if (settings?.depot_lat) {
      points.unshift({
        lat: Number(settings.depot_lat),
        lon: Number(settings.depot_lon),
        label: settings.depot_label || "Відділення",
        badge: "🏤",
        kind: "depot" as never,
      });
    }
    return points;
  }, [items, settings]);

  function addDraft(draft: Draft) {
    setItems((current) =>
      current.some((item) => item.label.toLowerCase() === draft.label.toLowerCase())
        ? current
        : [...current, draft],
    );
    setQuery("");
    setCandidates([]);
    setError("");
  }

  async function lookup() {
    const text = query.trim();
    if (!text) return;
    setError("");
    setBusy(true);
    try {
      const data = await api<{ candidates: Candidate[] }>(`/api/geocode?q=${encodeURIComponent(text)}`);
      if (!data.candidates.length) {
        setError(`Не знайшов на карті: ${text}`);
        return;
      }
      const [best, ...rest] = data.candidates;
      addDraft({
        label: best.label,
        lat: best.lat,
        lon: best.lon,
        fromBook: false,
        alternatives: rest,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    if (!items.length) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ trip: Trip; failed?: string[] }>("/api/trips", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), objective, addresses: items }),
      });
      router.push(`/trip/${result.trip.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const depotMissing = settings && !settings.depot_lat;

  return (
    <>
      <h1>Новий маршрут</h1>

      {depotMissing && (
        <div className="banner warn">
          Не вказано відділення. <Link href="/settings">Задати в Налаштуваннях</Link>
        </div>
      )}

      {openTrips.map((trip) => (
        <Link key={trip.id} href={`/trip/${trip.id}`} className="card spread" style={{ display: "flex" }}>
          <div>
            <b>{trip.title || dateOnly(trip.created_at)}</b>
            <div className="small muted">
              {trip.status === "active" ? "У дорозі" : "Заплановано"} · {trip.done_count}/{trip.stop_count} доставлено ·{" "}
              {km(trip.plan_distance_m)}
            </div>
          </div>
          <span className="chip">Продовжити →</span>
        </Link>
      ))}

      <div className="card">
        <label className="field">
          <span>Адреса</span>
          <div className="row">
            <input
              className="grow"
              type="text"
              value={query}
              placeholder="вул. Шевченка 12 або координати з карт"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void lookup();
                }
              }}
            />
            <button onClick={() => void lookup()} disabled={busy || !query.trim()}>
              Додати
            </button>
          </div>
        </label>

        {suggestions.length > 0 && (
          <div className="stack">
            {suggestions.map((address) => (
              <button
                key={address.id}
                className="btn-wide ghost"
                style={{ textAlign: "left", justifyContent: "flex-start" }}
                onClick={() =>
                  addDraft({
                    label: address.label,
                    lat: address.lat ?? undefined,
                    lon: address.lon ?? undefined,
                    fromBook: true,
                  })
                }
              >
                🏠 {address.label}
                {address.visits > 0 && <span className="muted small"> · возив {address.visits} р.</span>}
              </button>
            ))}
          </div>
        )}

        {candidates.length > 0 && (
          <>
            <p className="small muted">Кілька варіантів — обери потрібний:</p>
            <div className="stack">
              {candidates.map((candidate, index) => (
                <button
                  key={index}
                  className="btn-wide ghost"
                  style={{ textAlign: "left" }}
                  onClick={() => addDraft({ ...candidate, fromBook: false })}
                >
                  📍 {candidate.label}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div className="banner error" style={{ marginTop: 10 }}>{error}</div>}
      </div>

      {items.length > 0 && (
        <>
          <h2>
            Точки <span className="muted">({items.length})</span>
          </h2>
          {items.map((item, index) => (
            <div key={item.label} className="stop">
              <div className="badge">{index + 1}</div>
              <div className="grow">
                <div className="stop-title">{item.label}</div>
                <div className="leg">
                  {item.lat != null
                    ? `${item.lat.toFixed(5)}, ${item.lon!.toFixed(5)}`
                    : "без координат"}
                  {item.fromBook && " · з довідника"}
                </div>
                {Boolean(item.alternatives?.length) && (
                  <button
                    className="ghost small"
                    style={{ minHeight: 32, padding: "0 8px", marginTop: 6 }}
                    onClick={() => setOpenAlternatives(openAlternatives === index ? null : index)}
                  >
                    Не те місце?
                  </button>
                )}
                {openAlternatives === index && (
                  <div className="stack" style={{ marginTop: 8 }}>
                    {item.alternatives!.map((alternative, position) => (
                      <button
                        key={position}
                        className="btn-wide ghost"
                        style={{ textAlign: "left", height: "auto", padding: "8px 10px" }}
                        onClick={() => {
                          setItems(
                            items.map((entry, i) =>
                              i === index
                                ? { ...entry, label: alternative.label, lat: alternative.lat, lon: alternative.lon }
                                : entry,
                            ),
                          );
                          setOpenAlternatives(null);
                        }}
                      >
                        📍 {alternative.label}
                        <div className="small muted mono">
                          {alternative.lat.toFixed(5)}, {alternative.lon.toFixed(5)}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className="icon ghost danger"
                aria-label="Прибрати"
                onClick={() => setItems(items.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            </div>
          ))}

          {mapPoints.length > 0 && (
            <>
              <div style={{ marginBottom: 8 }}>
                <MapView points={mapPoints} height={260} />
              </div>
              <p className="small muted" style={{ marginTop: -2 }}>
                Перевір на карті, чи всі точки там, де ти їх очікуєш.
              </p>
            </>
          )}

          <div className="card">
            <label className="field">
              <span>Назва поїздки (необов'язково)</span>
              <input
                type="text"
                value={title}
                placeholder={dateOnly(new Date().toISOString())}
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Мінімізувати</span>
              <select value={objective} onChange={(event) => setObjective(event.target.value as "duration" | "distance")}>
                <option value="duration">Час у дорозі</option>
                <option value="distance">Відстань</option>
              </select>
            </label>
            <button className="primary btn-wide" onClick={() => void build()} disabled={busy || Boolean(depotMissing)}>
              {busy ? "Рахую маршрут…" : `Побудувати маршрут (${items.length})`}
            </button>
            {settings && (
              <p className="small muted" style={{ marginBottom: 0, marginTop: 8 }}>
                Плюс {settings.stop_minutes} хв на кожну адресу — це{" "}
                {dur(Number(settings.stop_minutes) * 60 * items.length)} лише на самі вручення.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}
