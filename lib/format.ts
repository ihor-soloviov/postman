export function km(meters: number | null | undefined): string {
  if (meters == null) return "—";
  return meters < 950 ? `${Math.round(meters)} м` : `${(meters / 1000).toFixed(1)} км`;
}

export function dur(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h} год ${m} хв` : `${m} хв`;
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("uk-UA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function dateOnly(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("uk-UA", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Час у дорозі + час на самих адресах. */
export function totalWithStops(driveSeconds: number | null, stops: number, minutesPerStop: number) {
  return (driveSeconds ?? 0) + stops * minutesPerStop * 60;
}
