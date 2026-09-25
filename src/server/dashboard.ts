import { ACTIONS, TIMEZONE } from "../lib/constants";
import { prisma } from "../lib/prisma";
import { localDateKey } from "../lib/security";

function activeFilter() {
  return { voidedAt: null };
}

export async function dashboardStats() {
  const today = localDateKey(new Date(), TIMEZONE);
  const counts = await prisma.countRecord.findMany({
    where: activeFilter(),
    select: {
      action: true,
      quantity: true,
      timestampLocal: true,
      farmId: true,
      farmName: true,
      sizeId: true,
      sizeName: true,
      gradeId: true,
      gradeName: true,
    },
  });

  let received = 0;
  let shipped = 0;
  let todayReceived = 0;
  let todayShipped = 0;
  const hourly: Record<string, { received: number; shipped: number }> = {};
  const byCategory: Record<string, { sizeName: string; gradeName: string; received: number; shipped: number }> = {};
  const byFarm: Record<string, { farmName: string; received: number }> = {};

  for (const c of counts) {
    const qty = c.quantity || 1;
    const isToday = c.timestampLocal.slice(0, 10) === today;
    const hour = isToday ? c.timestampLocal.slice(11, 13) : null;
    if (c.action === ACTIONS.YARD) {
      received += qty;
      if (isToday) todayReceived += qty;
      if (hour) {
        hourly[hour] ||= { received: 0, shipped: 0 };
        hourly[hour].received += qty;
      }
      if (c.farmId) {
        byFarm[c.farmId] ||= { farmName: c.farmName || "Farm", received: 0 };
        byFarm[c.farmId].received += qty;
      }
    } else if (c.action === ACTIONS.SHIP) {
      shipped += qty;
      if (isToday) todayShipped += qty;
      if (hour) {
        hourly[hour] ||= { received: 0, shipped: 0 };
        hourly[hour].shipped += qty;
      }
    }
    const key = `${c.sizeName}|${c.gradeName}`;
    byCategory[key] ||= { sizeName: c.sizeName, gradeName: c.gradeName, received: 0, shipped: 0 };
    if (c.action === ACTIONS.YARD) byCategory[key].received += qty;
    if (c.action === ACTIONS.SHIP) byCategory[key].shipped += qty;
  }

  const hours = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, "0");
    return { hour: h, received: hourly[h]?.received || 0, shipped: hourly[h]?.shipped || 0 };
  });

  return {
    timezone: TIMEZONE,
    today,
    received,
    shipped,
    inventory: received - shipped,
    todayReceived,
    todayShipped,
    todayInventory: todayReceived - todayShipped,
    hourly: hours,
    byCategory: Object.values(byCategory).map((row) => ({
      ...row,
      inventory: row.received - row.shipped,
    })),
    byFarm: Object.values(byFarm),
  };
}

export async function farmProgress() {
  const [inventory, farms, sizes, grades, counts] = await Promise.all([
    prisma.startingInventory.findMany(),
    prisma.farm.findMany(),
    prisma.treeSize.findMany(),
    prisma.treeGrade.findMany(),
    prisma.countRecord.findMany({
      where: { action: ACTIONS.YARD, voidedAt: null },
      select: { farmId: true, sizeId: true, gradeId: true, quantity: true },
    }),
  ]);

  const receivedMap = new Map<string, number>();
  for (const c of counts) {
    if (!c.farmId) continue;
    const key = `${c.farmId}|${c.sizeId}|${c.gradeId}`;
    receivedMap.set(key, (receivedMap.get(key) || 0) + (c.quantity || 1));
  }

  const farmName = Object.fromEntries(farms.map((f) => [f.id, f.name]));
  const sizeName = Object.fromEntries(sizes.map((s) => [s.id, s.name]));
  const gradeName = Object.fromEntries(grades.map((g) => [g.id, g.name]));

  return inventory.map((row) => {
    const key = `${row.farmId}|${row.sizeId}|${row.gradeId}`;
    const received = receivedMap.get(key) || 0;
    const remaining = Math.max(0, row.quantity - received);
    return {
      farmId: row.farmId,
      farmName: farmName[row.farmId] || row.farmId,
      sizeId: row.sizeId,
      sizeName: sizeName[row.sizeId] || row.sizeId,
      gradeId: row.gradeId,
      gradeName: gradeName[row.gradeId] || row.gradeId,
      starting: row.quantity,
      received,
      notYetReceived: remaining,
      exceeded: received > row.quantity,
    };
  });
}
