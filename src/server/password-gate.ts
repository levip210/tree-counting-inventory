import { prisma } from "../lib/prisma";
import { verifySecret } from "../lib/security";

export async function confirmAdminPassword(adminId: string, password: string): Promise<boolean> {
  const admin = await prisma.adminAccount.findUnique({ where: { id: adminId } });
  if (!admin) return false;
  return verifySecret(password, admin.passwordHash);
}
