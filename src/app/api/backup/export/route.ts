import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { tokenEquals } from "@/lib/security";
import { buildOperationalExport } from "@/server/backup-document";
import { recordExportResult } from "@/server/backup-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function providedToken(req: NextRequest): string {
  const header = req.headers.get("authorization") || "";
  const match = /^Bearer\s+(\S+)/i.exec(header);
  if (match) return match[1];
  return new URL(req.url).searchParams.get("token") || "";
}

export async function GET(req: NextRequest) {
  const expected = process.env.BACKUP_TOKEN?.trim() || "";
  if (!expected) return errorJson("Backup export is not configured.", 503);
  if (!tokenEquals(providedToken(req), expected)) return errorJson("Unauthorized.", 401);
  const now = new Date();
  try {
    const payload = await buildOperationalExport(now);
    await recordExportResult({ ok: true }, now);
    return json(payload);
  } catch (err) {
    const message = err instanceof Error ? err.message : "export failed";
    await recordExportResult({ ok: false, error: message }, now);
    console.error("[backup] export failed", message);
    return errorJson("Backup export failed.", 500);
  }
}
