import { NextResponse } from "next/server";
import { planTrip } from "@/lib/trips";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const id = Number((await params).id);
  const body = (await request.json().catch(() => ({}))) as { mode?: "optimize" | "keep" };
  try {
    return NextResponse.json(await planTrip(id, body.mode ?? "optimize"));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
