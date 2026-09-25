export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err.error || err.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export function exactLocalTimestamp(date = new Date()): string {
  const pad = (n: number, z = 2) => String(n).padStart(z, "0");
  const tzMin = -date.getTimezoneOffset();
  const sign = tzMin >= 0 ? "+" : "-";
  const abs = Math.abs(tzMin);
  const off = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${off}`;
}

export function newId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
