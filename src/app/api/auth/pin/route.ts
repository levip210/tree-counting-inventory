import { NextRequest } from "next/server";
import { checkLock, clearFailures, clientIp, clientScope, recordFailure } from "@/lib/rate-limit";
import { applySessionCookie, errorJson, json, signSession } from "@/lib/session";
import { validatePin } from "@/lib/security";
import { matchPin } from "@/server/pins";

export const runtime = "nodejs";

const GENERIC = "Login failed.";
const LOCKED = "Login failed. Try again later.";

export async function POST(req: NextRequest) {
  const scope = clientScope("pin", clientIp(req));
  const lock = await checkLock(scope);
  if (!lock.ok) return errorJson(LOCKED, 429);

  let body: { pin?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson(GENERIC, 400);
  }

  const pin = String(body.pin || "");
  if (!pin || validatePin(pin)) {
    await recordFailure(scope);
    return errorJson(GENERIC, 401);
  }

  const match = await matchPin(pin);
  if (!match) {
    await recordFailure(scope);
    return errorJson(GENERIC, 401);
  }
  await clearFailures(scope);

  if (match.kind === "admin") {
    const token = await signSession({
      role: "admin",
      adminId: match.id,
      access: "admin",
      name: match.name,
    });
    return applySessionCookie(json({ ok: true, role: "admin", name: match.name }), token);
  }

  const token = await signSession({
    role: "counter",
    counterId: match.id,
    access: match.access,
    name: match.name,
  });
  return applySessionCookie(
    json({ ok: true, role: "counter", name: match.name, access: match.access }),
    token,
  );
}
