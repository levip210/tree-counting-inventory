import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { canReviewMiscounts, deleteMiscount, listMiscounts } from "@/server/miscounts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!canReviewMiscounts(session)) return errorJson("Admin sign-in required.", 401);
  const miscounts = await listMiscounts();
  return json({ miscounts });
}

export async function DELETE(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!canReviewMiscounts(session)) return errorJson("Admin sign-in required.", 401);
  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return errorJson("Invalid request.", 400);
  }
  const result = await deleteMiscount(String(body.id || ""));
  if (!result.ok) return errorJson(result.error, 404);
  return json({ ok: true, id: result.id });
}
