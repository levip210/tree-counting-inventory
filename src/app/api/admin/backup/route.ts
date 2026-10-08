import { NextRequest } from "next/server";
import { errorJson } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { backupTables } from "@/server/export";
import { toCsv } from "@/lib/security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const table = new URL(req.url).searchParams.get("table") || "counts";
  const data = await backupTables();
  if (table === "json") {
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
