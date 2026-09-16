import { prisma } from "../src/lib/prisma";
import { hashSecret } from "../src/lib/security";
import { normalizeEmail, validatePassword } from "../src/lib/security";

async function main() {
  const args = process.argv.slice(2);
  const email = args[args.indexOf("--email") + 1];
  const password = args[args.indexOf("--password") + 1];
  if (!email || !password || args.indexOf("--email") < 0 || args.indexOf("--password") < 0) {
    console.error("Usage: npm run reset-admin-password -- --email you@farm.com --password 'NewPass12345'");
    process.exit(1);
  }
  const err = validatePassword(password);
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const admin = await prisma.adminAccount.findUnique({ where: { email: normalizeEmail(email) } });
  if (!admin) {
    console.error("No admin with that email.");
    process.exit(1);
  }
  await prisma.adminAccount.update({
    where: { id: admin.id },
    data: { passwordHash: await hashSecret(password), updatedAt: new Date() },
  });
  console.log("Password updated for", admin.email);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
