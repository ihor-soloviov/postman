import { NextResponse } from "next/server";
import { getDb, nowIso } from "@/lib/db";
import { getTrip } from "@/lib/trips";
import type { Stop, StopStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = (await request.json()) as { status?: StopStatus; comment?: string };
  const stop = getDb().prepare("SELECT * FROM stops WHERE id = ?").get(id) as Stop | undefined;
  if (!stop) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });

  if (body.comment !== undefined) {
    getDb().prepare("UPDATE stops SET comment = ? WHERE id = ?").run(body.comment, id);
  }
  if (body.status) {
    const stamp = body.status === "pending" ? null : nowIso();
    getDb().prepare("UPDATE stops SET status = ?, done_at = ? WHERE id = ?").run(body.status, stamp, id);
    // Лічильник відвідувань адреси ведемо лише по факту доставки.
    if (body.status === "done" && stop.status !== "done") {
      getDb().prepare(
        "UPDATE addresses SET visits = visits + 1, last_visit_at = ? WHERE id = ?",
      ).run(stamp, stop.address_id);
    } else if (stop.status === "done" && body.status !== "done") {
      getDb().prepare(
        "UPDATE addresses SET visits = MAX(0, visits - 1) WHERE id = ?",
      ).run(stop.address_id);
    }
  }
  return NextResponse.json(getTrip(stop.trip_id));
}

export async function DELETE(_request: Request, { params }: Params) {
  const id = Number((await params).id);
  const stop = getDb().prepare("SELECT * FROM stops WHERE id = ?").get(id) as Stop | undefined;
  if (!stop) return NextResponse.json({ error: "Точку не знайдено" }, { status: 404 });
  getDb().prepare("DELETE FROM stops WHERE id = ?").run(id);
  return NextResponse.json(getTrip(stop.trip_id));
}
