import type { Point } from "./types";

const ORS = "https://api.openrouteservice.org";

/** Скільки точок ORS погоджується обробити за один запит (безкоштовний тариф). */
const MATRIX_MAX_LOCATIONS = 50;
const DIRECTIONS_MAX_WAYPOINTS = 50;

export type GeocodeCandidate = {
  label: string;
  lat: number;
  lon: number;
  confidence: number;
  source: "coords" | "nominatim" | "ors";
};

export type Matrix = {
  /** durations[i][j] — секунди від точки i до точки j */
  durations: number[][];
  /** distances[i][j] — метри */
  distances: number[][];
  engine: "ors" | "haversine";
  warning?: string;
};

export type RouteLine = {
  /** Ламана у порядку [lat, lon] — готова для Leaflet */
  coords: [number, number][];
  distance_m: number;
  duration_s: number;
  engine: "ors" | "haversine";
};

export function haversineMeters(a: Point, b: Point): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function orsFetch(path: string, apiKey: string, body?: unknown) {
  const response = await fetch(`${ORS}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      Accept: "application/json, application/geo+json",
    },
    body: body ? JSON.stringify(body) : undefined,
    // Маршрути не кешуємо: адреси змінюються між поїздками.
    cache: "no-store",
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`ORS ${response.status}: ${text.slice(0, 300)}`);
  }
  return response.json();
}

/**
 * Розпізнає координати, введені руками або вставлені з карт.
 *
 * Розуміє "47.9116, 33.3399", те саме з хвостом на кшталт зуму,
 * посилання Google Maps (@lat,lon,17z та !3d…!4d…) і geo:-схему.
 * Обидва числа мають бути дробовими — інакше "буд. 9, кв. 12" помилково
 * зійшло б за координати.
 */
export function parseCoordinates(input: string): Point | null {
  const text = input.trim();

  const patterns = [
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,        // google maps: /@47.91,33.33,17z
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,        // google maps: !3d47.91!4d33.33
    /(?:^|[?&]q=|geo:)\s*(-?\d+\.\d+)\s*[,;\s]\s*(-?\d+\.\d+)/,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const lat = Number(match[1]);
    const lon = Number(match[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat, lon };
  }
  return null;
}

/** Прямокутник навколо точки — щоб підказати геокодеру, де саме шукати. */
function viewbox(center: Point, radiusKm: number): string {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((center.lat * Math.PI) / 180)));
  // Nominatim чекає left,top,right,bottom
  return [center.lon - dLon, center.lat + dLat, center.lon + dLon, center.lat - dLat]
    .map((value) => value.toFixed(6))
    .join(",");
}

// Nominatim просить не частіше за запит на секунду — тримаємо чергу.
const NOMINATIM_MIN_INTERVAL_MS = 1100;
let nominatimChain: Promise<unknown> = Promise.resolve();

function throttled<T>(task: () => Promise<T>): Promise<T> {
  const result = nominatimChain.then(task);
  nominatimChain = result
    .catch(() => undefined)
    .then(() => new Promise((resolve) => setTimeout(resolve, NOMINATIM_MIN_INTERVAL_MS)));
  return result;
}

async function nominatim(path: string, params: URLSearchParams) {
  return throttled(async () => {
    const response = await fetch(`https://nominatim.openstreetmap.org/${path}?${params}`, {
      headers: {
        // Правила Nominatim вимагають назвати застосунок.
        "User-Agent": "postman-route-planner/1.0 (self-hosted, personal use)",
        "Accept-Language": "uk,en",
      },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Nominatim ${response.status}`);
    return response.json();
  });
}

type NominatimPlace = { lat: string; lon: string; display_name: string; importance?: number };

async function geocodeNominatim(
  query: string,
  opts: { city?: string; country?: string; focus?: Point | null; radiusKm?: number },
): Promise<GeocodeCandidate[]> {
  const text =
    opts.city && !query.toLowerCase().includes(opts.city.toLowerCase())
      ? `${query}, ${opts.city}`
      : query;
  const params = new URLSearchParams({
    format: "jsonv2",
    limit: "8",
    q: text,
    "accept-language": "uk",
  });
  if (opts.country) params.set("countrycodes", opts.country.toLowerCase());
  // Підказка "шукай тут" без жорсткої заборони: доставка буває й за містом.
  if (opts.focus) params.set("viewbox", viewbox(opts.focus, opts.radiusKm ?? 25));

  const places = (await nominatim("search", params)) as NominatimPlace[];
  return places.map((place) => ({
    label: place.display_name,
    lat: Number(place.lat),
    lon: Number(place.lon),
    confidence: place.importance ?? 0,
    source: "nominatim" as const,
  }));
}

async function geocodeOrs(
  query: string,
  opts: { apiKey: string; city?: string; country?: string; focus?: Point | null },
): Promise<GeocodeCandidate[]> {
  if (!opts.apiKey) throw new Error("Не вказано ключ OpenRouteService — додай його в Налаштуваннях");
  const text =
    opts.city && !query.toLowerCase().includes(opts.city.toLowerCase())
      ? `${query}, ${opts.city}`
      : query;
  const params = new URLSearchParams({ api_key: opts.apiKey, text, size: "8" });
  if (opts.country) params.set("boundary.country", opts.country);
  if (opts.focus) {
    params.set("focus.point.lat", String(opts.focus.lat));
    params.set("focus.point.lon", String(opts.focus.lon));
  }
  const data = (await orsFetch(`/geocode/search?${params}`, opts.apiKey)) as {
    features?: {
      geometry: { coordinates: [number, number] };
      properties: { label?: string; name?: string; confidence?: number };
    }[];
  };
  return (data.features ?? []).map((feature) => ({
    label: feature.properties.label ?? feature.properties.name ?? query,
    lon: feature.geometry.coordinates[0],
    lat: feature.geometry.coordinates[1],
    confidence: feature.properties.confidence ?? 0,
    source: "ors" as const,
  }));
}

/** Як називається точка з такими координатами (щоб підписати введену вручну). */
export async function reverseGeocode(point: Point): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat: String(point.lat),
      lon: String(point.lon),
      "accept-language": "uk",
    });
    const place = (await nominatim("reverse", params)) as { display_name?: string };
    return place.display_name ?? null;
  } catch {
    return null;
  }
}

/**
 * Пошук адреси.
 *
 * Спершу пробуємо прочитати введене як координати — тоді жоден геокодер не потрібен.
 * Далі йде Nominatim (OpenStreetMap): на українських адресах він точний, тоді як
 * вбудований у ORS Pelias часто промахується на сотні кілометрів.
 */
export async function geocode(
  query: string,
  opts: {
    apiKey: string;
    city?: string;
    country?: string;
    focus?: Point | null;
    radiusKm?: number;
    provider?: string;
  },
): Promise<GeocodeCandidate[]> {
  const coords = parseCoordinates(query);
  if (coords) {
    const label = await reverseGeocode(coords);
    return [
      {
        ...coords,
        label: label ?? `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}`,
        confidence: 1,
        source: "coords",
      },
    ];
  }

  if (opts.provider === "ors") return geocodeOrs(query, opts);

  try {
    const found = await geocodeNominatim(query, opts);
    if (found.length) return found;
  } catch (error) {
    if (!opts.apiKey) throw error;
  }
  // Запасний варіант, якщо Nominatim мовчить або нічого не знайшов.
  return opts.apiKey ? geocodeOrs(query, opts) : [];
}

/** Запасний варіант без карт: пряма відстань і середня швидкість. */
function haversineMatrix(points: Point[], speedKmh: number, warning?: string): Matrix {
  const speed = Math.max(4, speedKmh) / 3.6;
  const size = points.length;
  const distances = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  const durations = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      if (i === j) continue;
      // Коефіцієнт 1.3 — типова поправка на те, що вулиці не прямі.
      const meters = haversineMeters(points[i], points[j]) * 1.3;
      distances[i][j] = meters;
      durations[i][j] = meters / speed;
    }
  }
  return { durations, distances, engine: "haversine", warning };
}

export async function buildMatrix(
  points: Point[],
  opts: { apiKey: string; profile: string; speedKmh: number },
): Promise<Matrix> {
  if (!opts.apiKey) {
    return haversineMatrix(points, opts.speedKmh, "Без ключа ORS маршрут рахується по прямій.");
  }
  if (points.length > MATRIX_MAX_LOCATIONS) {
    return haversineMatrix(
      points,
      opts.speedKmh,
      `Точок більше за ${MATRIX_MAX_LOCATIONS} — ORS стільки за раз не рахує, ужито наближення по прямій.`,
    );
  }
  try {
    const data = (await orsFetch(`/v2/matrix/${opts.profile}`, opts.apiKey, {
      locations: points.map((p) => [p.lon, p.lat]),
      metrics: ["duration", "distance"],
      units: "m",
    })) as { durations: (number | null)[][]; distances: (number | null)[][] };
    const fallback = haversineMatrix(points, opts.speedKmh);
    // ORS повертає null, якщо точку не вдалось прив'язати до дороги — підміняємо прямою.
    const fix = (grid: (number | null)[][], backup: number[][]) =>
      grid.map((row, i) => row.map((value, j) => (value == null ? backup[i][j] : value)));
    return {
      durations: fix(data.durations, fallback.durations),
      distances: fix(data.distances, fallback.distances),
      engine: "ors",
    };
  } catch (error) {
    return haversineMatrix(
      points,
      opts.speedKmh,
      `ORS недоступний (${(error as Error).message}). Маршрут наближено по прямій.`,
    );
  }
}

export async function buildRouteLine(
  orderedPoints: Point[],
  opts: { apiKey: string; profile: string; speedKmh: number },
): Promise<RouteLine> {
  const straight: RouteLine = {
    coords: orderedPoints.map((p) => [p.lat, p.lon] as [number, number]),
    distance_m: orderedPoints.reduce(
      (sum, p, i) => (i === 0 ? 0 : sum + haversineMeters(orderedPoints[i - 1], p) * 1.3),
      0,
    ),
    duration_s: 0,
    engine: "haversine",
  };
  straight.duration_s = straight.distance_m / (Math.max(4, opts.speedKmh) / 3.6);
  if (!opts.apiKey || orderedPoints.length < 2) return straight;

  try {
    const coords: [number, number][] = [];
    let distance = 0;
    let duration = 0;
    // ORS обмежує кількість проміжних точок — ріжемо на шматки й склеюємо.
    for (let start = 0; start < orderedPoints.length - 1; start += DIRECTIONS_MAX_WAYPOINTS - 1) {
      const chunk = orderedPoints.slice(start, start + DIRECTIONS_MAX_WAYPOINTS);
      if (chunk.length < 2) break;
      const data = (await orsFetch(`/v2/directions/${opts.profile}/geojson`, opts.apiKey, {
        coordinates: chunk.map((p) => [p.lon, p.lat]),
      })) as {
        features: {
          geometry: { coordinates: [number, number][] };
          properties: { summary?: { distance?: number; duration?: number } };
        }[];
      };
      const feature = data.features?.[0];
      if (!feature) throw new Error("порожня відповідь ORS");
      const line = feature.geometry.coordinates.map(
        ([lon, lat]) => [lat, lon] as [number, number],
      );
      coords.push(...(coords.length ? line.slice(1) : line));
      distance += feature.properties.summary?.distance ?? 0;
      duration += feature.properties.summary?.duration ?? 0;
    }
    if (!coords.length) return straight;
    return { coords, distance_m: distance, duration_s: duration, engine: "ors" };
  } catch {
    return straight;
  }
}
