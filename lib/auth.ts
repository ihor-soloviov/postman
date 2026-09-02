/**
 * Один користувач, один пароль. Сесія — підписаний cookie, який неможливо
 * підробити без SECRET_KEY. Працює і в middleware (Web Crypto), і в API-роутах.
 */
export const SESSION_COOKIE = "postman_session";

function secret(): string {
  return process.env.SECRET_KEY ?? "dev-secret-change-me";
}

export function appPassword(): string {
  return process.env.APP_PASSWORD ?? "postman";
}

export async function sessionToken(): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("postman-v1"));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function isValidSession(value: string | undefined): Promise<boolean> {
  if (!value) return false;
  return safeEqual(value, await sessionToken());
}
