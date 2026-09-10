import bcrypt from "bcryptjs";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { PIN_MAX, PIN_MIN } from "./constants";
import { getAuthSecret } from "./secret";

export { getAuthSecret };

const BCRYPT_ROUNDS = 12;

export function getPinPepper(): string {
  return process.env.PIN_PEPPER || getAuthSecret();
}

export async function hashSecret(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifySecret(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export function pinKey(pin: string): string {
  return createHmac("sha256", getPinPepper()).update(pin, "utf8").digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validatePassword(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must include letters and numbers.";
  }
  return null;
}

export function validatePin(pin: string): string | null {
  if (pin === "" || pin == null) return "PIN is blank. Quick login stays disabled.";
  if (!/^\d+$/.test(pin)) return "PIN must be numbers only.";
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) {
    return `PIN must be ${PIN_MIN}–${PIN_MAX} digits.`;
  }
  return null;
}

export function generateApiKey(): string {
  return randomBytes(24).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function localTimestamp(date = new Date(), timeZone = process.env.APP_TIMEZONE || "America/New_York"): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    fractionalSecondDigits: 3,
    timeZoneName: "longOffset",
  }).formatToParts(date);

  const grab = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const offsetRaw = grab("timeZoneName").replace("GMT", "") || "+00:00";
  const offset = offsetRaw === "" || offsetRaw === "Z" ? "+00:00" : offsetRaw.length === 3 ? `${offsetRaw}:00` : offsetRaw;
  return `${grab("year")}-${grab("month")}-${grab("day")}T${grab("hour")}:${grab("minute")}:${grab("second")}.${grab("fractionalSecond") || "000"}${offset}`;
}

export function localDateKey(date = new Date(), timeZone = process.env.APP_TIMEZONE || "America/New_York"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.map(csvEscape).join(",");
  const body = rows.map((row) => columns.map((col) => csvEscape(row[col])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}
