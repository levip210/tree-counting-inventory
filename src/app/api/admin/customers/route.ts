import { NextRequest } from "next/server";
import { errorJson, json } from "@/lib/session";
import { sessionFromRequest } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import {
  countActiveCustomerCounts,
  createCustomer,
  customerShippingReport,
  deleteOrDeactivateCustomer,
  normalizeCustomerName,
} from "@/server/customers";

export const runtime = "nodejs";

async function requireAdmin(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session || session.role !== "admin") return null;
  return session;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() || "";
  const report = await customerShippingReport();
  const customers = report.customers.filter(
    (customer) => !q || customer.name.toLowerCase().includes(q) || customer.id.toLowerCase().includes(q),
  );
  return json({ customers, unassignedTrees: report.unassignedTrees });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const result = await createCustomer(body?.name);
  if (!result.ok) return errorJson(result.error, result.status);
  return json({ ok: true, customer: result.customer });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const body = await req.json().catch(() => null);
  const id = String(body?.id || "");
  if (!id) return errorJson("Customer id required.", 400);
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return errorJson("Customer not found.", 404);

  if (body.action === "reorder") {
    const direction = body.direction === "up" ? -1 : 1;
    const all = await prisma.customer.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] });
    const idx = all.findIndex((row) => row.id === id);
    const swap = all[idx + direction];
    if (!swap) return json({ ok: true });
    await prisma.$transaction([
      prisma.customer.update({ where: { id: customer.id }, data: { displayOrder: swap.displayOrder } }),
      prisma.customer.update({ where: { id: swap.id }, data: { displayOrder: customer.displayOrder } }),
    ]);
    return json({ ok: true });
  }

  const data: { name?: string; active?: boolean } = {};
  if (typeof body.name === "string" && body.name.trim() && body.name.trim() !== customer.name) {
    const name = normalizeCustomerName(body.name);
    if (typeof name !== "string") return errorJson(name.error, 400);
    const rows = await prisma.customer.findMany({ select: { id: true, name: true } });
    const taken = rows.some(
      (row) => row.id !== id && row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
    );
    if (taken) return errorJson("A customer with that name already exists.", 409);
    const used = await countActiveCustomerCounts(id);
    if (used > 0 && !body.confirmRename) {
      return json(
        {
          needsConfirm: true,
          message: `This customer has ${used} shipped trees. Rename anyway? Past counts keep the name they were counted under.`,
        },
        409,
      );
    }
    data.name = name;
  }
  if (typeof body.active === "boolean") data.active = body.active;
  const updated = await prisma.customer.update({ where: { id }, data });
  return json({ ok: true, customer: updated });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin(req))) return errorJson("Admin sign-in required.", 401);
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!id) return errorJson("Customer id required.", 400);
  const result = await deleteOrDeactivateCustomer(id);
  if (!result.ok) return errorJson(result.error, result.status);
  return json(result);
}
