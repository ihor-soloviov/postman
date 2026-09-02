import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

/** Доступне без входу: сторінка логіну, іконки, маніфест, service worker. */
const PUBLIC_PATHS = new Set([
  "/login",
  "/api/login",
  "/offline",
  "/favicon.ico",
  "/manifest.webmanifest",
  "/sw.js",
]);

function isPublic(pathname: string): boolean {
  return (
    PUBLIC_PATHS.has(pathname) ||
    pathname.startsWith("/icon") ||
    pathname.startsWith("/apple-icon")
  );
}

/** Пускаємо далі лише з валідною сесією. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (await isValidSession(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Потрібен вхід" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Статику Next віддаємо повз перевірку — вона не містить даних.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
