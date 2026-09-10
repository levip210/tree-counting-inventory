import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { hashSecret, pinKey, validatePin } from "@/lib/security";
import { pinInUse } from "@/server/pins";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const accounts = await prisma.counterAccount.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, accountLabel: true, active: true, access: true, createdAt: true, updatedAt: true },
  });
  return json({ accounts });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const accountLabel = String(body?.accountLabel || "").trim();
  const pin = String(body?.pin || "");
  const access = body?.access as string;
  if (!accountLabel) return errorJson("Account label is required.", 400);
  const pinErr = validatePin(pin);
  if (pinErr) return errorJson(pinErr, 400);
  if (access !== "yard" && access !== "shipping" && access !== "both") {
    return errorJson("Access must be Yard Receiving, Shipping, or Both.", 400);
  }
  if (await pinInUse(pin)) return errorJson("That PIN is already used by an active account.", 409);
  const account = await prisma.counterAccount.create({
    data: {
      accountLabel,
      pinHash: await hashSecret(pin),
      pinKey: pinKey(pin),
      access,
      active: true,
      updatedAt: new Date(),
    },
    select: { id: true, accountLabel: true, active: true, access: true, createdAt: true },
  });
  return json({ ok: true, account });
}

export async function PATCH(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  const existing = await prisma.counterAccount.findUnique({ where: { id } });
  if (!existing) return errorJson("Account not found.", 404);
  const data: {
    accountLabel?: string;
    active?: boolean;
    access?: string;
    pinHash?: string;
    pinKey?: string;
    updatedAt: Date;
  } = { updatedAt: new Date() };
  if (typeof body.accountLabel === "string" && body.accountLabel.trim()) data.accountLabel = body.accountLabel.trim();
  if (typeof body.active === "boolean") data.active = body.active;
  if (body.access === "yard" || body.access === "shipping" || body.access === "both") data.access = body.access;
  if (body.pin) {
    const pinErr = validatePin(String(body.pin));
    if (pinErr) return errorJson(pinErr, 400);
    if (await pinInUse(String(body.pin), { counterId: id })) {
      return errorJson("That PIN is already used by an active account.", 409);
    }
    data.pinHash = await hashSecret(String(body.pin));
    data.pinKey = pinKey(String(body.pin));
  }
  const account = await prisma.counterAccount.update({
    where: { id },
    data,
    select: { id: true, accountLabel: true, active: true, access: true, updatedAt: true },
  });
  return json({ ok: true, account });
}
