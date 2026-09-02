import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { Address } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const id = Number((await params).id);
  const address = getDb().prepare("SELECT * FROM addresses WHERE id = ?").get(id) as
    | Address
    | undefined;
  if (!address) return NextResponse.json({ error: "Немає такої адреси" }, { status: 404 });

  // Уся історія коментарів по цій адресі — щоб не тримати в голові.
  const history = getDb()
    .prepare(
      `SELECT s.comment, s.status, s.done_at, t.id AS trip_id, t.title, t.created_at
       FROM stops s JOIN trips t ON t.id = s.trip_id
       WHERE s.address_id = ? ORDER BY t.created_at DESC LIMIT 100`,
    )
    .all(id);
  const phones = getDb().prepare("SELECT * FROM phones WHERE address_id = ? ORDER BY flat").all(id);
  return NextResponse.json({ address, history, phones });
}

export async function PATCH(request: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = (await request.json()) as { note?: string; label?: string; lat?: number; lon?: number };
  if (body.note !== undefined) {
    getDb().prepare("UPDATE addresses SET note = ? WHERE id = ?").run(body.note, id);
  }
  if (body.label !== undefined) {
    getDb().prepare("UPDATE addresses SET label = ? WHERE id = ?").run(body.label, id);
  }
  if (body.lat != null && body.lon != null) {
    getDb().prepare("UPDATE addresses SET lat = ?, lon = ?, source = 'map' WHERE id = ?").run(
      body.lat,
      body.lon,
      id,
    );
  }
  return NextResponse.json({ address: getDb().prepare("SELECT * FROM addresses WHERE id = ?").get(id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const id = Number((await params).id);
  const used = getDb().prepare("SELECT COUNT(*) AS n FROM stops WHERE address_id = ?").get(id) as {
    n: number;
  };
  if (used.n > 0) {
    return NextResponse.json(
      { error: `Адреса є у ${used.n} поїздці(-ах) — видалення зітре історію` },
      { status: 409 },
    );
  }
  getDb().prepare("DELETE FROM addresses WHERE id = ?").run(id);
  return NextResponse.json({ ok: true });
}
