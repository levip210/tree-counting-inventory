import { ACTIONS } from "../lib/constants";
import { prisma } from "../lib/prisma";

const NAME_MAX = 120;

export function normalizeCustomerName(raw: unknown): string | { error: string } {
  const name = String(raw || "").trim().replace(/\s+/g, " ");
  if (!name) return { error: "Customer name is required." };
  if (name.length > NAME_MAX) return { error: "Customer name is too long." };
  return name;
}

export async function countActiveCustomerCounts(customerId: string) {
  return prisma.countRecord.count({
    where: { customerId, action: ACTIONS.SHIP, voidedAt: null },
  });
}

async function nameTaken(name: string, exceptId?: string) {
  const rows = await prisma.customer.findMany({ select: { id: true, name: true } });
  return rows.some(
    (row) =>
      row.id !== exceptId &&
      row.name.localeCompare(name, undefined, { sensitivity: "accent" }) === 0,
  );
}

export async function createCustomer(rawName: unknown) {
  const name = normalizeCustomerName(rawName);
  if (typeof name !== "string") return { ok: false as const, status: 400, error: name.error };
  if (await nameTaken(name)) {
    return { ok: false as const, status: 409, error: "A customer with that name already exists." };
  }
  const max = await prisma.customer.aggregate({ _max: { displayOrder: true } });
  const customer = await prisma.customer.create({
    data: { name, displayOrder: (max._max.displayOrder ?? -1) + 1, active: true },
  });
  return { ok: true as const, customer };
}

export type SizeGradeTotal = {
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: number;
};

export async function customerShippingReport() {
  const [customers, sizes, grades, counts, unassigned] = await Promise.all([
    prisma.customer.findMany({ orderBy: [{ displayOrder: "asc" }, { name: "asc" }] }),
    prisma.treeSize.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.treeGrade.findMany({ orderBy: { displayOrder: "asc" } }),
    prisma.countRecord.findMany({
      where: { action: ACTIONS.SHIP, voidedAt: null, customerId: { not: null } },
      select: {
        customerId: true,
        sizeId: true,
        sizeName: true,
        gradeId: true,
        gradeName: true,
        quantity: true,
      },
    }),
    prisma.countRecord.aggregate({
      where: { action: ACTIONS.SHIP, voidedAt: null, customerId: null },
      _sum: { quantity: true },
    }),
  ]);

  const sizeOrder = new Map(sizes.map((row, index) => [row.id, index]));
  const gradeOrder = new Map(grades.map((row, index) => [row.id, index]));
  const sizeLabel = new Map(sizes.map((row) => [row.id, row.name]));
  const gradeLabel = new Map(grades.map((row) => [row.id, row.name]));
  const totals = new Map<string, number>();
  const byCustomer = new Map<string, Map<string, SizeGradeTotal>>();

  for (const count of counts) {
    if (!count.customerId) continue;
    const qty = count.quantity || 1;
    totals.set(count.customerId, (totals.get(count.customerId) || 0) + qty);
    const group = byCustomer.get(count.customerId) ?? new Map<string, SizeGradeTotal>();
    byCustomer.set(count.customerId, group);
    const key = `${count.sizeId}|${count.gradeId}`;
    const existing = group.get(key);
    if (existing) {
      existing.quantity += qty;
      continue;
    }
    group.set(key, {
      sizeId: count.sizeId,
      sizeName: sizeLabel.get(count.sizeId) || count.sizeName,
      gradeId: count.gradeId,
      gradeName: gradeLabel.get(count.gradeId) || count.gradeName,
      quantity: qty,
    });
  }

  function compareSizeGrade(a: SizeGradeTotal, b: SizeGradeTotal) {
    const sizeDelta = (sizeOrder.get(a.sizeId) ?? 999) - (sizeOrder.get(b.sizeId) ?? 999);
    if (sizeDelta) return sizeDelta;
    const gradeDelta = (gradeOrder.get(a.gradeId) ?? 999) - (gradeOrder.get(b.gradeId) ?? 999);
    if (gradeDelta) return gradeDelta;
    return a.sizeName.localeCompare(b.sizeName) || a.gradeName.localeCompare(b.gradeName);
  }

  return {
    unassignedTrees: unassigned._sum.quantity || 0,
    customers: customers.map((customer) => ({
      ...customer,
      totalTrees: totals.get(customer.id) || 0,
      bySizeGrade: [...(byCustomer.get(customer.id)?.values() ?? [])].sort(compareSizeGrade),
    })),
  };
}

async function pruneEmptySessions(sessionIds: string[]) {
  const unique = [...new Set(sessionIds.filter(Boolean))];
  for (const sessionId of unique) {
    const leftover = await prisma.countRecord.count({ where: { sessionId } });
    if (leftover === 0) {
      await prisma.countSession.delete({ where: { id: sessionId } }).catch(() => undefined);
    }
  }
}

export async function deleteOrDeactivateCustomer(id: string) {
  const customer = await prisma.customer.findUnique({ where: { id } });
  if (!customer) return { ok: false as const, status: 404, error: "Customer not found." };

  const used = await countActiveCustomerCounts(id);
  if (used > 0) {
    await prisma.customer.update({ where: { id }, data: { active: false } });
    return {
      ok: true as const,
      deactivated: true as const,
      message: "Customer has shipped trees, so they were hidden from the list instead of deleted.",
    };
  }

  const leftoverRows = await prisma.countRecord.findMany({
    where: { customerId: id },
    select: { sessionId: true },
  });
  await prisma.countRecord.deleteMany({ where: { customerId: id } });
  await pruneEmptySessions(leftoverRows.map((row) => row.sessionId));
  await prisma.customer.delete({ where: { id } });
  return { ok: true as const, deleted: true as const, message: "Customer deleted." };
}
