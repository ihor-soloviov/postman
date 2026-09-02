import { NextResponse } from "next/server";
import { getDb, getSettings, nowIso } from "@/lib/db";
import { depotPoint, planTrip, resolveAddress } from "@/lib/trips";

export async function GET() {
  const trips = getDb()
    .prepare(
      `SELECT t.*,
              (SELECT COUNT(*) FROM stops s WHERE s.trip_id = t.id) AS stop_count,
              (SELECT COUNT(*) FROM stops s WHERE s.trip_id = t.id AND s.status = 'done') AS done_count
       FROM trips t ORDER BY t.created_at DESC LIMIT 200`,
    )
    .all();
  return NextResponse.json({ trips });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    title?: string;
    objective?: "duration" | "distance";
    addresses: { label: string; lat?: number; lon?: number }[];
  };
  if (!body.addresses?.length) {
    return NextResponse.json({ error: "Список адрес порожній" }, { status: 400 });
  }
  const depot = depotPoint();
  if (!depot) {
    return NextResponse.json(
      { error: "Спочатку вкажи адресу відділення в Налаштуваннях" },
      { status: 400 },
    );
  }

  const settings = getSettings();
  const objective = body.objective ?? settings.objective;
  const failed: string[] = [];
  const resolved: number[] = [];
  for (const item of body.addresses) {
    try {
      const address = await resolveAddress(item);
      if (!resolved.includes(address.id)) resolved.push(address.id);
    } catch (error) {
      failed.push(`${item.label}: ${(error as Error).message}`);
    }
  }
  if (!resolved.length) {
    return NextResponse.json({ error: failed.join("; ") || "Жодну адресу не розпізнано" }, { status: 400 });
  }

  const created = getDb()
    .prepare(
      `INSERT INTO trips(title, status, depot_label, depot_lat, depot_lon, objective, created_at)
       VALUES(?, 'draft', ?, ?, ?, ?, ?)`,
    )
    .run(
      body.title?.trim() || new Date().toLocaleDateString("uk-UA"),
      depot.label,
      depot.lat,
      depot.lon,
      objective,
      nowIso(),
    );
  const tripId = Number(created.lastInsertRowid);

  const insertStop = getDb().prepare(
    "INSERT INTO stops(trip_id, address_id, seq) VALUES(?, ?, ?)",
  );
  getDb().transaction(() => {
    resolved.forEach((addressId, index) => insertStop.run(tripId, addressId, index + 1));
  })();

  try {
    const full = await planTrip(tripId, "optimize");
    return NextResponse.json({ ...full, failed });
  } catch (error) {
    return NextResponse.json(
      { tripId, error: (error as Error).message, failed },
      { status: 500 },
    );
  }
}
