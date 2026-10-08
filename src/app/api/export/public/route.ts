import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifySecret } from "@/lib/security";
import { exportCountsCsv, exportCountsJson, exportInventoryCsv, exportInventoryJson } from "@/server/export";

export const runtime = "nodejs";

async function authorized(req: NextRequest): Promise<boolean> {
  const url = new URL(req.url);
  const header = req.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const provided = bearer || url.searchParams.get("key") || "";
  if (!provided) return false;
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!settings?.excelEnabled || !settings.excelApiKeyHash) return false;
  return verifySecret(provided, settings.excelApiKeyHash);
}

export async function GET(req: NextRequest) {
  if (!(await authorized(req))) {
    return new Response(JSON.stringify({ error: "Unauthorized." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "counts";
  const format = url.searchParams.get("format") || "csv";
  if (kind === "inventory") {
    const body = format === "json" ? await exportInventoryJson() : await exportInventoryCsv();
    return new Response(body, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ptf-starting-inventory.${format === "json" ? "json" : "csv"}"`,
      },
    });
  }
  const body = format === "json" ? await exportCountsJson() : await exportCountsCsv();
  return new Response(body, {
    headers: {
      "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ptf-counts.${format === "json" ? "json" : "csv"}"`,
    },
  });
}
