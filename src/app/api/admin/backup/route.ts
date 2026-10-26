import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { backupTables } from "@/server/export";
import { parseBackupDocument, restoreBackupDocument } from "@/server/backup-document";
import { backupStatusLine, recordDownload } from "@/server/backup-status";
import { confirmAdminPassword } from "@/server/password-gate";
import { toCsv } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const url = new URL(req.url);
  if (url.searchParams.get("view") === "status") {
    return json({ line: await backupStatusLine() });
  }
  const table = url.searchParams.get("table") || "counts";
  const data = await backupTables();
  if (table === "json") {
    await recordDownload();
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="ptf-backup.json"',
      },
    });
  }
  const rows = (data as Record<string, unknown>)[table];
  if (!Array.isArray(rows)) return errorJson("Unknown backup table.", 400);
  const columns = rows.length ? Object.keys(rows[0] as object) : [];
  const csv = toCsv(rows as Record<string, unknown>[], columns);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ptf-${table}.csv"`,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return errorJson("That file is not valid JSON.", 400);
  if (body.confirmation !== "RESTORE") return errorJson("Type RESTORE to confirm.", 400);
  if (!(await confirmAdminPassword(session.adminId, String(body.currentPassword || "")))) {
    return errorJson("Password confirmation failed.", 403);
  }
  const parsed = parseBackupDocument(body.backup);
  if (!parsed.ok) return errorJson(parsed.error, 400);
  try {
    await restoreBackupDocument(parsed.doc);
  } catch (err) {
    console.error("[backup] restore failed", err instanceof Error ? err.message : err);
    return errorJson("Restore failed and no data was changed.", 500);
  }
  return json({ ok: true, message: "Backup restored. Admin and counter logins were kept." });
}
