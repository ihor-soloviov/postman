"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { dateOnly } from "@/lib/format";
import type { Address } from "@/lib/types";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false });

type Candidate = { label: string; lat: number; lon: number };

type HistoryRow = {
  comment: string;
  status: string;
  done_at: string | null;
  trip_id: number;
  title: string;
  created_at: string;
};

export default function AddressesPage() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [fixQuery, setFixQuery] = useState("");
  const [fixCandidates, setFixCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");

  function load(q = query) {
    api<{ addresses: Address[] }>(`/api/addresses?q=${encodeURIComponent(q)}`)
      .then((data) => setAddresses(data.addresses))
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    const timer = setTimeout(() => load(query), 200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function toggle(address: Address) {
    if (openId === address.id) {
      setOpenId(null);
      return;
    }
    setOpenId(address.id);
    setFixQuery("");
    setFixCandidates([]);
    const data = await api<{ history: HistoryRow[] }>(`/api/addresses/${address.id}`);
    setHistory(data.history);
  }

  /** Зберегти нові координати адреси — геокодер міг промахнутись. */
  async function moveTo(address: Address, point: { lat: number; lon: number }) {
    await api(`/api/addresses/${address.id}`, {
      method: "PATCH",
      body: JSON.stringify(point),
    });
    setAddresses((current) =>
      current.map((item) => (item.id === address.id ? { ...item, ...point, source: "map" } : item)),
    );
    setFixCandidates([]);
    setFixQuery("");
  }

  async function searchFix() {
    setError("");
    try {
      const data = await api<{ candidates: Candidate[] }>(
        `/api/geocode?q=${encodeURIComponent(fixQuery)}`,
      );
      if (!data.candidates.length) setError("Нічого не знайдено");
      setFixCandidates(data.candidates);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function saveNote(address: Address, note: string) {
    if (note === address.note) return;
    await api(`/api/addresses/${address.id}`, { method: "PATCH", body: JSON.stringify({ note }) });
    setAddresses((current) =>
      current.map((item) => (item.id === address.id ? { ...item, note } : item)),
    );
  }

  async function remove(address: Address) {
    if (!confirm(`Видалити «${address.label}» з довідника?`)) return;
    try {
      await api(`/api/addresses/${address.id}`, { method: "DELETE" });
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <h1>Довідник адрес</h1>
      {error && <div className="banner error">{error}</div>}

      <input
        type="text"
        value={query}
        placeholder="Пошук за адресою"
        onChange={(event) => setQuery(event.target.value)}
        style={{ marginBottom: 12 }}
      />

      {addresses.map((address) => (
        <div key={address.id} className="card">
          <div className="spread">
            <div className="grow" onClick={() => void toggle(address)} style={{ cursor: "pointer" }}>
              <b>{address.label}</b>
              <div className="small muted">
                возив {address.visits} р.
                {address.last_visit_at && ` · востаннє ${dateOnly(address.last_visit_at)}`}
              </div>
              <div className="leg">
                {address.lat != null
                  ? `${address.lat.toFixed(5)}, ${address.lon!.toFixed(5)}`
                  : "без координат"}
              </div>
            </div>
            <button className="icon ghost danger" onClick={() => void remove(address)} aria-label="Видалити">
              ✕
            </button>
          </div>

          <label className="field" style={{ marginTop: 10, marginBottom: 0 }}>
            <span>Постійна нотатка (домофон, під&apos;їзд, собака)</span>
            <input
              type="text"
              defaultValue={address.note}
              placeholder="напр.: код 1234, 3-й під'їзд"
              onBlur={(event) => void saveNote(address, event.target.value)}
            />
          </label>

          {openId === address.id && (
            <div style={{ marginTop: 12 }}>
              {address.lat != null && (
                <>
                  <MapView
                    height={220}
                    zoom={16}
                    fit={false}
                    points={[
                      {
                        lat: address.lat,
                        lon: address.lon!,
                        label: address.label,
                        badge: "📍",
                        kind: "pending",
                      },
                    ]}
                    onPick={(point) => void moveTo(address, point)}
                  />
                  <p className="small muted" style={{ marginTop: 6 }}>
                    Мітка не там? Перетягни її або тицьни у правильне місце — збережеться одразу.
                  </p>
                </>
              )}

              <div className="row" style={{ marginBottom: 10 }}>
                <input
                  className="grow"
                  type="text"
                  value={fixQuery}
                  placeholder="Перезнайти: адреса або координати"
                  onChange={(event) => setFixQuery(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && searchFix()}
                />
                <button onClick={() => void searchFix()} disabled={!fixQuery.trim()}>
                  Знайти
                </button>
              </div>
              {fixCandidates.length > 0 && (
                <div className="stack" style={{ marginBottom: 10 }}>
                  {fixCandidates.map((candidate, index) => (
                    <button
                      key={index}
                      className="btn-wide ghost"
                      style={{ textAlign: "left", height: "auto", padding: "8px 10px" }}
                      onClick={() => void moveTo(address, { lat: candidate.lat, lon: candidate.lon })}
                    >
                      📍 {candidate.label}
                      <div className="small muted mono">
                        {candidate.lat.toFixed(5)}, {candidate.lon.toFixed(5)}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="small muted">Історія по цій адресі:</div>
              {history.length === 0 && <div className="small muted">— порожньо</div>}
              {history.map((row, index) => (
                <div key={index} className="note" style={{ borderLeftColor: "var(--accent)" }}>
                  <Link href={`/trip/${row.trip_id}`}>{row.title || dateOnly(row.created_at)}</Link>{" "}
                  <span className="muted">
                    · {row.status === "done" ? "доставлено" : row.status === "failed" ? "не застав" : row.status}
                  </span>
                  {row.comment && <div>{row.comment}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {!addresses.length && <p className="muted">Довідник заповнюється сам, коли будуєш маршрути.</p>}
    </>
  );
}
