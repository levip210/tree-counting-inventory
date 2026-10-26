import { SUGGESTED_GRADES, SUGGESTED_SIZES } from "../lib/constants";
import { prisma } from "../lib/prisma";
import { hashSecret, normalizeEmail, validatePassword } from "../lib/security";

export type SetupInput = {
  name: string;
  email: string;
  password: string;
};

export async function setupLocked(): Promise<boolean> {
  const [settings, count] = await Promise.all([
    prisma.appSettings.findUnique({ where: { id: "default" } }),
    prisma.adminAccount.count(),
  ]);
  return Boolean(settings?.setupLocked) || count > 0;
}

export async function createFirstAdmin(input: SetupInput) {
  if (await setupLocked()) {
    return { ok: false as const, error: "First-administrator setup is permanently disabled.", status: 403 };
  }
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;
  if (!name) return { ok: false as const, error: "Name is required.", status: 400 };
  if (!email || !email.includes("@")) return { ok: false as const, error: "A valid email is required.", status: 400 };
  const passwordError = validatePassword(password);
  if (passwordError) return { ok: false as const, error: passwordError, status: 400 };

  const passwordHash = await hashSecret(password);
  const now = new Date();

  try {
    const admin = await prisma.$transaction(async (tx) => {
      const existing = await tx.adminAccount.count();
      if (existing > 0) throw new Error("LOCKED");
      const created = await tx.adminAccount.create({
        data: { name, email, passwordHash, updatedAt: now },
      });
      await tx.appSettings.upsert({
        where: { id: "default" },
        create: { id: "default", setupLocked: true, updatedAt: now },
        update: { setupLocked: true, updatedAt: now },
      });
      const sizeCount = await tx.treeSize.count();
      if (sizeCount === 0) {
        await tx.treeSize.createMany({
          data: SUGGESTED_SIZES.map((sizeName, i) => ({
            name: sizeName,
            displayOrder: i,
            active: true,
            updatedAt: now,
          })),
        });
      }
      const gradeCount = await tx.treeGrade.count();
      if (gradeCount === 0) {
        await tx.treeGrade.createMany({
          data: SUGGESTED_GRADES.map((gradeName, i) => ({
            name: gradeName,
            displayOrder: i,
            active: true,
            updatedAt: now,
          })),
        });
      }
      return created;
    });

    return {
      ok: true as const,
      admin: { id: admin.id, name: admin.name, email: admin.email },
    };
  } catch (err) {
    if (err instanceof Error && err.message === "LOCKED") {
      return { ok: false as const, error: "First-administrator setup is permanently disabled.", status: 403 };
    }
    throw err;
  }
}
