import { prisma } from "../lib/prisma";

const ZONE = "America/New_York";

export function formatBackupStatus(
  row: { lastBackupAt?: Date | null; lastBackupOk?: boolean | null; lastBackupError?: string | null } | null,
): string {
  if (!row?.lastBackupAt) return "Last backup: never";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(row.lastBackupAt);
  if (row.lastBackupOk) return `Last backup: ${time} — OK`;
  const reason = (row.lastBackupError || "unknown error").replace(/\s+/g, " ").trim().slice(0, 80);
  return `Last backup: ${time} — failed (${reason})`;
}

export async function recordBackupResult(result: { ok: boolean; error?: string }, at = new Date()): Promise<void> {
  const data = {
    lastBackupAt: at,
    lastBackupOk: result.ok,
    lastBackupError: result.ok ? null : (result.error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 200),
    updatedAt: at,
  };
  try {
    await prisma.appSettings.upsert({
      where: { id: "default" },
      create: { id: "default", ...data },
      update: data,
    });
  } catch (err) {
    console.error("[backup] could not save backup status", err instanceof Error ? err.message : err);
  }
}

export async function backupStatusLine(): Promise<string> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { lastBackupAt: true, lastBackupOk: true, lastBackupError: true },
    });
    return formatBackupStatus(row);
  } catch (err) {
    console.error("[backup] could not read backup status", err instanceof Error ? err.message : err);
    return "Last backup: — failed (backup status is not ready yet)";
  }
}
