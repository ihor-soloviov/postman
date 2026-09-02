import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/db";
import type { Settings } from "@/lib/types";

export async function GET() {
  const settings = getSettings();
  // Ключ назовні не віддаємо повністю — лише ознаку, що він заданий.
  return NextResponse.json({
    ...settings,
    ors_api_key: settings.ors_api_key ? "•".repeat(8) : "",
    ors_api_key_set: Boolean(settings.ors_api_key),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as Partial<Settings>;
  // Порожній/замаскований ключ не затирає збережений.
  if (!body.ors_api_key || /^•+$/.test(body.ors_api_key)) delete body.ors_api_key;
  saveSettings(body);
  return NextResponse.json({ ok: true });
}
