"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import type { Settings } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type GeoCandidate = { label: string; lat: number; lon: number; source?: string };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [depotQuery, setDepotQuery] = useState("");
  const [candidates, setCandidates] = useState<GeoCandidate[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Settings>("/api/settings").then(setSettings).catch((e) => setError(e.message));
  }, []);

  function patch(values: Partial<Settings>) {
    setSettings((current) => (current ? { ...current, ...values } : current));
  }

  async function save() {
    if (!settings) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      setMessage("Збережено");
      setTimeout(() => setMessage(""), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function findDepot() {
    setError("");
    setCandidates([]);
    try {
      // Налаштування мають бути збережені до пошуку: геокодер бере з них місто й ключ.
      await api("/api/settings", { method: "PUT", body: JSON.stringify(settings) });
      // bias=none: інакше неправильно збережене відділення підказувало б себе саме.
      const data = await api<{ candidates: GeoCandidate[] }>(
        `/api/geocode?bias=none&q=${encodeURIComponent(depotQuery)}`,
      );
      if (!data.candidates.length) setError("Нічого не знайдено");
      setCandidates(data.candidates);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function pickDepot(candidate: GeoCandidate) {
    patch({
      depot_label: candidate.label,
      depot_lat: String(candidate.lat),
      depot_lon: String(candidate.lon),
    });
    setCandidates([]);
  }

  async function logout() {
    await api("/api/logout", { method: "POST" });
    location.href = "/login";
  }

  if (!settings) return <p className="muted">Завантаження…</p>;

  return (
    <>
      <h1>Налаштування</h1>
      {error && <div className="banner error">{error}</div>}
      {message && <div className="banner info">{message}</div>}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Карти</h2>
        <label className="field">
          <span>Ключ OpenRouteService</span>
          <input
            type="password"
            value={settings.ors_api_key}
            placeholder="без ключа маршрут рахується по прямій"
            onChange={(event) => patch({ ors_api_key: event.target.value })}
          />
        </label>
        <p className="small muted" style={{ marginTop: -6 }}>
          Безкоштовний ключ: openrouteservice.org/dev/#/signup — 2000 запитів на добу.
        </p>
        <div className="row">
          <label className="field grow">
            <span>Місто (підказка геокодеру)</span>
            <input
              type="text"
              value={settings.city}
              placeholder="Наприклад: Ковель"
              onChange={(event) => patch({ city: event.target.value })}
            />
          </label>
          <label className="field" style={{ width: 110 }}>
            <span>Країна</span>
            <input
              type="text"
              value={settings.country}
              onChange={(event) => patch({ country: event.target.value.toUpperCase() })}
            />
          </label>
        </div>
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Відділення (початок і кінець маршруту)</h2>
        {settings.depot_lat ? (
          <p className="small">
            <b>{settings.depot_label}</b>
            <br />
            <span className="muted mono">
              {Number(settings.depot_lat).toFixed(5)}, {Number(settings.depot_lon).toFixed(5)}
            </span>
          </p>
        ) : (
          <div className="banner warn">Відділення не задано — без нього маршрут не побудується.</div>
        )}
        <div className="row">
          <input
            className="grow"
            type="text"
            value={depotQuery}
            placeholder="Адреса або координати з карт"
            onChange={(event) => setDepotQuery(event.target.value)}
            onKeyDown={(event) => event.key === "Enter" && findDepot()}
          />
          <button onClick={findDepot}>Знайти</button>
        </div>
        <p className="small muted" style={{ marginTop: 6 }}>
          Можна вставити координати або посилання з Google Maps — тоді пошук не потрібен.
        </p>
        {candidates.length > 0 && (
          <div className="stack" style={{ marginTop: 10 }}>
            {candidates.map((candidate, index) => (
              <button
                key={index}
                className="btn-wide ghost"
                style={{ textAlign: "left", height: "auto", padding: "10px 12px" }}
                onClick={() => pickDepot(candidate)}
              >
                {candidate.label}
                <div className="small muted mono">
                  {candidate.lat.toFixed(5)}, {candidate.lon.toFixed(5)}
                </div>
              </button>
            ))}
          </div>
        )}

        {settings.depot_lat && (
          <>
            <div style={{ marginTop: 12 }}>
              <MapView
                height={240}
                zoom={16}
                fit={false}
                points={[
                  {
                    lat: Number(settings.depot_lat),
                    lon: Number(settings.depot_lon),
                    label: settings.depot_label || "Відділення",
                    badge: "🏤",
                    kind: "depot",
                  },
                ]}
                onPick={(point) =>
                  patch({ depot_lat: String(point.lat), depot_lon: String(point.lon) })
                }
              />
            </div>
            <p className="small muted" style={{ marginTop: 6 }}>
              Перевір, чи мітка стоїть там, де треба. Не там — перетягни її або тицьни в
              потрібне місце на карті, тоді натисни «Зберегти».
            </p>
          </>
        )}
      </div>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Як рахувати</h2>
        <label className="field">
          <span>Що мінімізувати</span>
          <select
            value={settings.objective}
            onChange={(event) => patch({ objective: event.target.value as Settings["objective"] })}
          >
            <option value="duration">Час у дорозі</option>
            <option value="distance">Відстань</option>
          </select>
        </label>
        <label className="field">
          <span>Пошук адрес</span>
          <select
            value={settings.geocoder}
            onChange={(event) => patch({ geocoder: event.target.value as Settings["geocoder"] })}
          >
            <option value="nominatim">OpenStreetMap / Nominatim — точний на українських адресах</option>
            <option value="ors">OpenRouteService — часто промахується, лише як запасний</option>
          </select>
        </label>
        <label className="field">
          <span>Радіус підказки пошуку, км</span>
          <input
            type="number"
            min={1}
            max={200}
            value={settings.search_radius_km}
            onChange={(event) => patch({ search_radius_km: event.target.value })}
          />
        </label>
        <p className="small muted" style={{ marginTop: -4 }}>
          Підказує геокодеру шукати біля відділення. Адреси за межами радіуса теж
          знаходяться — просто нижче в списку.
        </p>
        <label className="field">
          <span>Профіль руху</span>
          <select value={settings.profile} onChange={(event) => patch({ profile: event.target.value })}>
            <option value="cycling-regular">Велосипед — звичайний</option>
            <option value="cycling-electric">Велосипед — електро</option>
            <option value="cycling-road">Велосипед — шосейний</option>
            <option value="cycling-mountain">Велосипед — гірський</option>
            <option value="foot-walking">Пішки</option>
          </select>
        </label>
        <div className="row">
          <label className="field grow">
            <span>Середня швидкість, км/год</span>
            <input
              type="number"
              min={4}
              max={40}
              value={settings.avg_speed_kmh}
              onChange={(event) => patch({ avg_speed_kmh: event.target.value })}
            />
          </label>
          <label className="field grow">
            <span>Хвилин на одну адресу</span>
            <input
              type="number"
              min={0}
              max={60}
              value={settings.stop_minutes}
              onChange={(event) => patch({ stop_minutes: event.target.value })}
            />
          </label>
        </div>
        <p className="small muted" style={{ marginTop: -4 }}>
          Швидкість використовується лише як запасний варіант, якщо ORS недоступний.
        </p>
      </div>

      <button className="primary btn-wide" onClick={save} disabled={busy}>
        {busy ? "Зберігаю…" : "Зберегти"}
      </button>
      <button className="ghost btn-wide" style={{ marginTop: 10 }} onClick={logout}>
        Вийти
      </button>
    </>
  );
}
