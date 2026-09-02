import { NextResponse } from "next/server";
import { SESSION_COOKIE, appPassword, safeEqual, sessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const { password } = (await request.json().catch(() => ({}))) as { password?: string };
  if (!password || !safeEqual(password, appPassword())) {
    return NextResponse.json({ error: "Невірний пароль" }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
