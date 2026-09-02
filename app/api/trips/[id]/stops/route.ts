import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTrip, planTrip, resolveAddress } from "@/lib/trips";

type Params = { params: Promise<{ id: string }> };

/** Додати адресу посеред дня і одразу перебудувати залишок маршруту. */
export async function POST(request: Request, { params }: Params) {
  const tripId = Number((await params).id);
  const body = (await request.json()) as { label: string; lat?: number; lon?: number };
  const full = getTrip(tripId);
  if (!full) return NextResponse.json({ error: "Поїздку не знайдено" }, { status: 404 });

  try {
    const address = await resolveAddress(body);
    const exists = full.stops.some((stop) => stop.address_id === address.id);
    if (exists) return NextResponse.json({ error: "Ця адреса вже в поїздці" }, { status: 409 });
    const maxSeq = full.stops.reduce((max, stop) => Math.max(max, stop.seq), 0);
    getDb().prepare("INSERT INTO stops(trip_id, address_id, seq) VALUES(?, ?, ?)").run(
      tripId,
      address.id,
      maxSeq + 1,
    );
    return NextResponse.json(await planTrip(tripId, "optimize"));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
