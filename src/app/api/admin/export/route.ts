import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { confirmAdminPassword } from "@/server/password-gate";
import { generateApiKey, hashSecret } from "@/lib/security";
import { exportCountsCsv, exportCountsJson, exportInventoryCsv, exportInventoryJson } from "@/server/export";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return errorJson("Admin sign-in required.", 401);
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const url = new URL(req.url);
  const kind = url.searchParams.get("kind") || "";
  const format = url.searchParams.get("format") || "csv";
  if (!kind) {
    return json({
      excelEnabled: settings?.excelEnabled ?? false,
      hasKey: Boolean(settings?.excelApiKeyHash),
    });
  }
  if (kind === "counts") {
    const body = format === "json" ? await exportCountsJson() : await exportCountsCsv();
    return new Response(body, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ptf-counts.${format === "json" ? "json" : "csv"}"`,
      },
    });
  }
  if (kind === "inventory") {
    const body = format === "json" ? await exportInventoryJson() : await exportInventoryCsv();
    return new Response(body, {
      headers: {
        "Content-Type": format === "json" ? "application/json" : "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="ptf-starting-inventory.${format === "json" ? "json" : "csv"}"`,
      },
    });
  }
  return errorJson("Unknown export.", 400);
}

export async function POST(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin" || !session.adminId) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  if (!(await confirmAdminPassword(session.adminId, String(body?.currentPassword || "")))) {
    return errorJson("Password confirmation failed.", 403);
  }
  if (body.action === "rotate-key") {
    const apiKey = generateApiKey();
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { excelApiKeyHash: await hashSecret(apiKey), excelEnabled: true, updatedAt: new Date() },
    });
    return json({ ok: true, apiKey, excelEnabled: true });
  }
  if (body.action === "disable") {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { excelEnabled: false, excelApiKeyHash: null, updatedAt: new Date() },
    });
    return json({ ok: true, excelEnabled: false });
  }
  return errorJson("Unknown action.", 400);
}
