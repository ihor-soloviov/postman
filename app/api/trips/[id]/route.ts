import { NextResponse } from "next/server";
import { getDb, nowIso } from "@/lib/db";
import { getTrip, planTrip } from "@/lib/trips";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const full = getTrip(Number((await params).id));
  if (!full) return NextResponse.json({ error: "Поїздку не знайдено" }, { status: 404 });
  return NextResponse.json(full);
}

export async function PATCH(request: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = (await request.json()) as {
    status?: "draft" | "planned" | "active" | "done";
    title?: string;
    note?: string;
    objective?: "duration" | "distance";
    order?: number[]; // id зупинок у новому порядку
  };

  if (body.title !== undefined) getDb().prepare("UPDATE trips SET title = ? WHERE id = ?").run(body.title, id);
  if (body.note !== undefined) getDb().prepare("UPDATE trips SET note = ? WHERE id = ?").run(body.note, id);
  if (body.objective) getDb().prepare("UPDATE trips SET objective = ? WHERE id = ?").run(body.objective, id);

  if (body.status) {
    const stamp = nowIso();
    if (body.status === "active") {
      getDb().prepare("UPDATE trips SET status = 'active', started_at = COALESCE(started_at, ?) WHERE id = ?").run(stamp, id);
    } else if (body.status === "done") {
      getDb().prepare("UPDATE trips SET status = 'done', finished_at = ? WHERE id = ?").run(stamp, id);
    } else {
      getDb().prepare("UPDATE trips SET status = ? WHERE id = ?").run(body.status, id);
    }
  }

  // Ручне перетягування: порядок лишаємо як є, перераховуємо лише плечі маршруту.
  if (body.order?.length) {
    const update = getDb().prepare("UPDATE stops SET seq = ? WHERE id = ? AND trip_id = ?");
    getDb().transaction(() => {
      body.order!.forEach((stopId, index) => update.run(index + 1, stopId, id));
    })();
    try {
      return NextResponse.json(await planTrip(id, "keep"));
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  return NextResponse.json(getTrip(id));
}

export async function DELETE(_request: Request, { params }: Params) {
  getDb().prepare("DELETE FROM trips WHERE id = ?").run(Number((await params).id));
  return NextResponse.json({ ok: true });
}
