import { prisma } from "../lib/prisma";
import { pinKey, verifySecret } from "../lib/security";

export type PinMatch =
  | { kind: "admin"; id: string; name: string; email: string }
  | { kind: "counter"; id: string; name: string; access: "yard" | "shipping" | "both" }
  | null;

export async function pinInUse(pin: string, except?: { adminId?: string; counterId?: string }): Promise<boolean> {
  const key = pinKey(pin);
  const admin = await prisma.adminAccount.findFirst({
    where: { pinKey: key, ...(except?.adminId ? { id: { not: except.adminId } } : {}) },
  });
  if (admin) return true;
  const counter = await prisma.counterAccount.findFirst({
    where: {
      pinKey: key,
      active: true,
      ...(except?.counterId ? { id: { not: except.counterId } } : {}),
    },
  });
  return Boolean(counter);
}

export async function matchPin(pin: string): Promise<PinMatch> {
  const key = pinKey(pin);
  const admin = await prisma.adminAccount.findFirst({ where: { pinKey: key } });
  if (admin?.pinHash && (await verifySecret(pin, admin.pinHash))) {
    return { kind: "admin", id: admin.id, name: admin.name, email: admin.email };
  }
  const counter = await prisma.counterAccount.findFirst({ where: { pinKey: key, active: true } });
  if (counter && (await verifySecret(pin, counter.pinHash))) {
    const access = counter.access as "yard" | "shipping" | "both";
    if (access !== "yard" && access !== "shipping" && access !== "both") return null;
    return { kind: "counter", id: counter.id, name: counter.accountLabel, access };
  }
  return null;
}
