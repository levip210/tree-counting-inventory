import { NextRequest } from "next/server";
import { getSettings, prisma } from "./prisma";
import { readSessionToken, COOKIE_NAME, type SessionPayload } from "./session";

export async function isSetupLocked(): Promise<boolean> {
  const settings = await getSettings();
  if (settings.setupLocked) return true;
  const admins = await prisma.adminAccount.count();
  return admins > 0;
}

export async function sessionFromRequest(req: NextRequest | Request): Promise<SessionPayload | null> {
  const cookie = req.headers.get("cookie") || "";
  const match = cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
  return readSessionToken(token);
}

export function requireAccess(session: SessionPayload | null, need: "yard" | "shipping" | "admin"): boolean {
  if (!session) return false;
  if (need === "admin") return session.role === "admin";
  if (session.role === "admin") return true;
  if (session.access === "both") return true;
  return session.access === need;
}

export function stripIdentity<T extends Record<string, unknown>>(input: T): T {
  const blocked = [
    "counterName",
    "accountLabel",
    "loginNumber",
    "accountId",
    "counterId",
    "adminId",
    "email",
    "workerId",
    "workerIdentity",
    "deviceId",
    "permanentDeviceId",
    "whoCounted",
  ];
  const copy = { ...input };
  for (const key of blocked) delete copy[key];
  return copy;
}
