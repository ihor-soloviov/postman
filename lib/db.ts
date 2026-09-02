import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import type { Settings } from "./types";

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT ''
);

-- Довідник адрес. Живе довше за поїздки: тут накопичуються постійні нотатки,
-- статистика відвідувань і (наступний етап) телефони.
CREATE TABLE IF NOT EXISTS addresses (
  id            INTEGER PRIMARY KEY,
  label         TEXT NOT NULL,
  norm          TEXT NOT NULL UNIQUE,       -- ключ дедуплікації
  lat           REAL,
  lon           REAL,
  source        TEXT NOT NULL DEFAULT 'manual',  -- ors | map | manual
  note          TEXT NOT NULL DEFAULT '',   -- постійна нотатка: домофон, собака, під'їзд
  visits        INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,
  created_at    TEXT NOT NULL
);

-- Готово під наступний етап: база телефонів по адресах.
CREATE TABLE IF NOT EXISTS phones (
  id         INTEGER PRIMARY KEY,
  address_id INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  flat       TEXT NOT NULL DEFAULT '',
  name       TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_phones_address ON phones(address_id);

CREATE TABLE IF NOT EXISTS trips (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',
  depot_label     TEXT NOT NULL DEFAULT '',
  depot_lat       REAL,
  depot_lon       REAL,
  objective       TEXT NOT NULL DEFAULT 'duration',
  engine          TEXT NOT NULL DEFAULT '',
  plan_distance_m INTEGER,
  plan_duration_s INTEGER,
  geometry        TEXT,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  planned_at      TEXT,
  started_at      TEXT,
  finished_at     TEXT
);

CREATE TABLE IF NOT EXISTS stops (
  id             INTEGER PRIMARY KEY,
  trip_id        INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  address_id     INTEGER NOT NULL REFERENCES addresses(id) ON DELETE CASCADE,
  seq            INTEGER NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  comment        TEXT NOT NULL DEFAULT '',
  leg_distance_m INTEGER,
  leg_duration_s INTEGER,
  done_at        TEXT
);
CREATE INDEX IF NOT EXISTS idx_stops_trip ON stops(trip_id, seq);
`;

export const DEFAULT_SETTINGS: Settings = {
  ors_api_key: process.env.ORS_API_KEY ?? "",
  depot_label: "",
  depot_lat: "",
  depot_lon: "",
  city: "",
  country: "UA",
  avg_speed_kmh: "14",
  stop_minutes: "3",
  geocoder: "nominatim",
  search_radius_km: "25",
  objective: "duration",
  profile: "cycling-regular",
};

function open(): Database.Database {
  const file = process.env.DB_PATH ?? path.join(process.cwd(), "data", "postman.db");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const database = new Database(file);
  // Збірка Next запускає кілька процесів одночасно — даємо їм дочекатись черги.
  database.pragma("busy_timeout = 8000");
  database.exec(SCHEMA);
  const insert = database.prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO NOTHING",
  );
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) insert.run(key, value);
  return database;
}

// З'єднання відкриваємо ліниво: під час збірки Next імпортує модулі, але до бази
// не звертається — а паралельні воркери інакше б'ються за файл.
// У dev-режимі Next перезавантажує модулі, тому тримаємо з'єднання в globalThis.
const globalForDb = globalThis as unknown as { __postmanDb?: Database.Database };

export function getDb(): Database.Database {
  if (!globalForDb.__postmanDb) globalForDb.__postmanDb = open();
  return globalForDb.__postmanDb;
}

export const nowIso = () => new Date().toISOString();

export function getSettings(): Settings {
  const rows = getDb().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const out = { ...DEFAULT_SETTINGS } as Record<string, string>;
  for (const row of rows) out[row.key] = row.value;
  return out as Settings;
}

export function saveSettings(values: Partial<Settings>) {
  const stmt = getDb().prepare(
    "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  const tx = getDb().transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) stmt.run(key, value);
  });
  tx(
    Object.entries(values)
      .filter(([key]) => key in DEFAULT_SETTINGS)
      .map(([key, value]) => [key, String(value ?? "")] as [string, string]),
  );
}

/** Ключ дедуплікації адрес: без регістру, зайвих пробілів і пунктуації. */
export function normalizeAddress(input: string): string {
  return input
    .toLowerCase()
    .replace(/["'`.,;]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
