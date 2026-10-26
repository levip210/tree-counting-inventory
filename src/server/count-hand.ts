import type { SessionPayload } from "../lib/session-edge";
import { normalizeCountHand, type CountHand } from "../lib/count-hand";
import { prisma } from "../lib/prisma";

function accountOf(session: SessionPayload): { role: "admin" | "counter"; id: string } | null {
  if (session.role === "admin" && session.adminId) return { role: "admin", id: session.adminId };
  if (session.role === "counter" && session.counterId) return { role: "counter", id: session.counterId };
  return null;
}

/**
 * Read the signed-in account's layout. If the column is missing or the value
 * is blank, return the default right-handed layout instead of failing the request.
 */
export async function getCountHand(session: SessionPayload): Promise<CountHand> {
  const who = accountOf(session);
  if (!who) return "right";
  try {
    if (who.role === "admin") {
      const row = await prisma.adminAccount.findUnique({
        where: { id: who.id },
        select: { countHand: true },
      });
      return normalizeCountHand(row?.countHand);
    }
    const row = await prisma.counterAccount.findUnique({
      where: { id: who.id },
      select: { countHand: true },
    });
    return normalizeCountHand(row?.countHand);
  } catch {
    return "right";
  }
}

export async function setCountHand(session: SessionPayload, value: unknown): Promise<CountHand> {
  if (value !== "left" && value !== "right") {
    throw new Error("INVALID");
  }
  const who = accountOf(session);
  if (!who) throw new Error("NO_ACCOUNT");
  const data = { countHand: value, updatedAt: new Date() };
  if (who.role === "admin") {
    await prisma.adminAccount.update({ where: { id: who.id }, data });
  } else {
    await prisma.counterAccount.update({ where: { id: who.id }, data });
  }
  return value;
}
