"use client";

/** Тонка обгортка над fetch + черга змін на час, коли зв'язку немає. */

const QUEUE_KEY = "postman_queue_v1";

type Queued = { path: string; method: string; body: unknown; at: number };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((data as { error?: string }).error ?? `Помилка ${response.status}`);
  return data as T;
}

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]") as Queued[];
  } catch {
    return [];
  }
}

function writeQueue(items: Queued[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

export function pendingCount(): number {
  return readQueue().length;
}

/**
 * Зміни в дорозі (позначки "доставлено", коментарі) не мають втрачатись
 * у під'їзді без зв'язку: не вийшло надіслати — кладемо в чергу.
 */
export async function send<T>(path: string, method: string, body: unknown): Promise<T | null> {
  try {
    return await api<T>(path, { method, body: JSON.stringify(body) });
  } catch (error) {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      writeQueue([...readQueue(), { path, method, body, at: Date.now() }]);
      return null;
    }
    throw error;
  }
}

export async function flushQueue(): Promise<number> {
  const items = readQueue();
  if (!items.length) return 0;
  const left: Queued[] = [];
  let sent = 0;
  for (const item of items) {
    try {
      await api(item.path, { method: item.method, body: JSON.stringify(item.body) });
      sent++;
    } catch {
      left.push(item);
    }
  }
  writeQueue(left);
  return sent;
}
