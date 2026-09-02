import { NextResponse } from "next/server";
import { getDb, normalizeAddress } from "@/lib/db";
import { resolveAddress } from "@/lib/trips";
import type { Address } from "@/lib/types";

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  // Пошук нормалізуємо так само, як і збережений ключ: інакше "вул. А, 1"
  // не знайде збережене "вул а 1".
  const query = normalizeAddress(raw);
  const rows = query
    ? (getDb()
        .prepare(
          "SELECT * FROM addresses WHERE norm LIKE ? ORDER BY visits DESC, label LIMIT 40",
        )
        .all(`%${query}%`) as Address[])
    : (getDb()
        .prepare("SELECT * FROM addresses ORDER BY visits DESC, label LIMIT 200")
        .all() as Address[]);
  return NextResponse.json({ addresses: rows });
}

export async function POST(request: Request) {
  const body = (await request.json()) as { label: string; lat?: number; lon?: number };
  try {
    const address = await resolveAddress(body);
    return NextResponse.json({ address });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
