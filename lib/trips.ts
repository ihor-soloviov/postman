import { getDb, getSettings, nowIso, normalizeAddress } from "./db";
import { buildMatrix, buildRouteLine, geocode } from "./geo";
import { solveTour } from "./optimize";
import type { Address, Point, StopWithAddress, Trip } from "./types";

export type TripFull = {
  trip: Trip;
  stops: StopWithAddress[];
  warning?: string;
};

export function depotPoint(): (Point & { label: string }) | null {
  const settings = getSettings();
  const lat = Number(settings.depot_lat);
  const lon = Number(settings.depot_lon);
  if (!settings.depot_lat || !settings.depot_lon || Number.isNaN(lat) || Number.isNaN(lon)) {
    return null;
  }
  return { lat, lon, label: settings.depot_label || "Відділення" };
}

export function getTrip(id: number): TripFull | null {
  const trip = getDb().prepare("SELECT * FROM trips WHERE id = ?").get(id) as Trip | undefined;
  if (!trip) return null;
  const stops = getDb()
    .prepare(
      `SELECT s.*, a.label, a.lat, a.lon, a.note
       FROM stops s JOIN addresses a ON a.id = s.address_id
       WHERE s.trip_id = ? ORDER BY s.seq`,
    )
    .all(id) as StopWithAddress[];
  return { trip, stops };
}

/** Знаходить адресу в довіднику або створює нову, за потреби геокодує. */
export async function resolveAddress(input: {
  label: string;
  lat?: number | null;
  lon?: number | null;
}): Promise<Address> {
  const label = input.label.trim();
  const norm = normalizeAddress(label);
  if (!norm) throw new Error("Порожня адреса");

  const existing = getDb().prepare("SELECT * FROM addresses WHERE norm = ?").get(norm) as
    | Address
    | undefined;
  if (existing) {
    // Координати могли прийти з карти пізніше, ніж адресу створили вручну.
    if (existing.lat == null && input.lat != null && input.lon != null) {
      getDb().prepare("UPDATE addresses SET lat = ?, lon = ?, source = 'map' WHERE id = ?").run(
        input.lat,
        input.lon,
        existing.id,
      );
      return { ...existing, lat: input.lat, lon: input.lon, source: "map" };
    }
    return existing;
  }

  let lat = input.lat ?? null;
  let lon = input.lon ?? null;
  let source = lat != null ? "map" : "manual";
  if (lat == null || lon == null) {
    const settings = getSettings();
    const candidates = await geocode(label, {
      apiKey: settings.ors_api_key,
      city: settings.city,
      country: settings.country,
      focus: depotPoint(),
      radiusKm: Number(settings.search_radius_km) || 25,
      provider: settings.geocoder,
    });
    if (!candidates.length) throw new Error(`Не вдалося знайти на карті: ${label}`);
    lat = candidates[0].lat;
    lon = candidates[0].lon;
    source = "ors";
  }

  const info = getDb()
    .prepare(
      "INSERT INTO addresses(label, norm, lat, lon, source, created_at) VALUES(?, ?, ?, ?, ?, ?)",
    )
    .run(label, norm, lat, lon, source, nowIso());
  return getDb().prepare("SELECT * FROM addresses WHERE id = ?").get(info.lastInsertRowid) as Address;
}

/**
 * Рахує маршрут для поїздки.
 *
 * mode = "optimize" — шукає найкращий порядок; mode = "keep" — лишає поточний
 * (після ручного перетягування) і лише перераховує відстані та час.
 *
 * Вже відпрацьовані точки (доставлено / не застав / пропущено) заморожені:
 * перерахунок посеред дня переставляє тільки те, що попереду, і стартує з
 * останньої відвіданої адреси — тобто з місця, де ти зараз.
 */
export async function planTrip(
  tripId: number,
  mode: "optimize" | "keep" = "optimize",
): Promise<TripFull> {
  const full = getTrip(tripId);
  if (!full) throw new Error("Поїздку не знайдено");
  const settings = getSettings();
  const depot = depotPoint();
  if (!depot) throw new Error("Спочатку вкажи адресу відділення в Налаштуваннях");

  const located = full.stops.filter((stop) => stop.lat != null && stop.lon != null);
  if (!located.length) throw new Error("У поїздці немає точок з координатами");

  const settled = located.filter((stop) => stop.status !== "pending");
  const pending = located.filter((stop) => stop.status === "pending");

  // Одна матриця на весь перерахунок: 0 — відділення, далі відвідані, далі решта.
  const ordered = [...settled, ...pending];
  const points: Point[] = [depot, ...ordered.map((s) => ({ lat: s.lat!, lon: s.lon! }))];
  const matrix = await buildMatrix(points, {
    apiKey: settings.ors_api_key,
    profile: settings.profile,
    speedKmh: Number(settings.avg_speed_kmh) || 14,
  });

  const objective =
    (full.trip.objective || settings.objective) === "distance" ? "distance" : "duration";
  const cost = objective === "distance" ? matrix.distances : matrix.durations;

  let sequence: StopWithAddress[];
  if (mode === "keep") {
    sequence = located;
  } else if (!pending.length) {
    sequence = settled;
  } else {
    const pendingIndex = pending.map((_, i) => settled.length + 1 + i);
    if (!settled.length) {
      const { tour } = solveTour(subMatrix(cost, [0, ...pendingIndex]));
      sequence = tour.slice(1, -1).map((i) => pending[i - 1]);
    } else {
      // Шлях "звідки я зараз → всі точки → відділення" зводимо до замкненого кола:
      // ребро "відділення → поточна точка" робимо безкоштовним, решту входів у
      // старт і виходів з відділення — забороненими.
      const origin = settled.length; // індекс останньої відвіданої точки
      const nodes = [origin, ...pendingIndex, 0];
      const sub = subMatrix(cost, nodes);
      const depotNode = nodes.length - 1;
      const BLOCKED = 1e9;
      for (let i = 0; i < nodes.length; i++) {
        if (i !== depotNode) sub[i][0] = BLOCKED;
        if (i !== 0) sub[depotNode][i] = BLOCKED;
      }
      sub[depotNode][0] = 0;
      const { tour } = solveTour(sub);
      const inner = tour.slice(1, -1).filter((node) => node !== depotNode);
      sequence = [...settled, ...inner.map((node) => pending[node - 1])];
    }
  }

  const indexOf = new Map(ordered.map((stop, i) => [stop.id, i + 1]));
  const path = [0, ...sequence.map((stop) => indexOf.get(stop.id)!), 0];

  let totalDistance = 0;
  let totalDuration = 0;
  const legs: { id: number; seq: number; distance: number; duration: number }[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const from = path[i];
    const to = path[i + 1];
    totalDistance += matrix.distances[from][to];
    totalDuration += matrix.durations[from][to];
    if (i < sequence.length) {
      legs.push({
        id: sequence[i].id,
        seq: i + 1,
        distance: Math.round(matrix.distances[from][to]),
        duration: Math.round(matrix.durations[from][to]),
      });
    }
  }

  const line = await buildRouteLine(
    [depot, ...sequence.map((s) => ({ lat: s.lat!, lon: s.lon! })), depot],
    {
      apiKey: settings.ors_api_key,
      profile: settings.profile,
      speedKmh: Number(settings.avg_speed_kmh) || 14,
    },
  );

  const updateStop = getDb().prepare(
    "UPDATE stops SET seq = ?, leg_distance_m = ?, leg_duration_s = ? WHERE id = ?",
  );
  const setSeq = getDb().prepare("UPDATE stops SET seq = ? WHERE id = ?");
  getDb().transaction(() => {
    for (const leg of legs) updateStop.run(leg.seq, leg.distance, leg.duration, leg.id);
    // Точки без координат лишаємо в кінці списку, щоб не загубились.
    let tail = legs.length + 1;
    for (const stop of full.stops) {
      if (stop.lat == null || stop.lon == null) setSeq.run(tail++, stop.id);
    }
    getDb().prepare(
      `UPDATE trips SET plan_distance_m = ?, plan_duration_s = ?, geometry = ?, engine = ?,
        objective = ?, planned_at = ?,
        status = CASE WHEN status = 'draft' THEN 'planned' ELSE status END
       WHERE id = ?`,
    ).run(
      Math.round(totalDistance),
      Math.round(totalDuration),
      JSON.stringify(line.coords),
      matrix.engine,
      objective,
      nowIso(),
      tripId,
    );
  })();

  const result = getTrip(tripId)!;
  if (matrix.warning) result.warning = matrix.warning;
  return result;
}

/** Вирізає підматрицю за списком індексів вихідної матриці. */
function subMatrix(cost: number[][], nodes: number[]): number[][] {
  return nodes.map((from) => nodes.map((to) => cost[from][to]));
}

/** Сумарний час поїздки з урахуванням часу на кожній адресі. */
export function estimatedTotalSeconds(trip: Trip, stopCount: number): number {
  const perStop = (Number(getSettings().stop_minutes) || 0) * 60;
  return (trip.plan_duration_s ?? 0) + perStop * stopCount;
}
