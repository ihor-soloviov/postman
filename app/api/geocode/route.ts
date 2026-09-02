import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db";
import { geocode } from "@/lib/geo";
import { depotPoint } from "@/lib/trips";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = params.get("q")?.trim();
  if (!query) return NextResponse.json({ candidates: [] });
  const settings = getSettings();
  // Пошук самого відділення не можна підказувати поточним відділенням:
  // одна помилка тоді підкріплювала б сама себе.
  const focus = params.get("bias") === "none" ? null : depotPoint();
  try {
    const candidates = await geocode(query, {
      apiKey: settings.ors_api_key,
      city: settings.city,
      country: settings.country,
      focus,
      radiusKm: Number(settings.search_radius_km) || 25,
      provider: settings.geocoder,
    });
    return NextResponse.json({ candidates });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
