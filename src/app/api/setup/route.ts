import { NextRequest } from "next/server";
import { createFirstAdmin } from "@/server/setup";
import { applySessionCookie, errorJson, json, signSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { name?: string; email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  const result = await createFirstAdmin({
    name: body.name || "",
    email: body.email || "",
    password: body.password || "",
  });
  if (!result.ok) return errorJson(result.error, result.status);
  const token = await signSession({
    role: "admin",
    adminId: result.admin.id,
    access: "admin",
    name: result.admin.name,
  });
  const res = json({ ok: true, admin: result.admin });
  return applySessionCookie(res, token);
}
