import { prisma } from "../lib/prisma";

const ZONE = "America/New_York";

type StatusRow = {
  lastBackupAt?: Date | null;
  lastBackupOk?: boolean | null;
  lastBackupError?: string | null;
  lastDownloadAt?: Date | null;
};

function formatNy(at: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
}

export function formatBackupStatus(row: StatusRow | null): string {
  let exportLine = "Last export: never";
  if (row?.lastBackupAt) {
    const time = formatNy(row.lastBackupAt);
    if (row.lastBackupOk) {
      exportLine = `Last export: ${time} — OK`;
    } else {
      const reason = (row.lastBackupError || "unknown error").replace(/\s+/g, " ").trim().slice(0, 80);
      exportLine = `Last export: ${time} — failed (${reason})`;
    }
  }
  const downloadLine = row?.lastDownloadAt ? `Last download: ${formatNy(row.lastDownloadAt)} — OK` : "Last download: never";
  return `${exportLine}\n${downloadLine}`;
}

async function saveStatus(data: {
  lastBackupAt?: Date;
  lastBackupOk?: boolean;
  lastBackupError?: string | null;
  lastDownloadAt?: Date;
  updatedAt: Date;
}): Promise<void> {
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

export async function recordExportResult(result: { ok: boolean; error?: string }, at = new Date()): Promise<void> {
  await saveStatus({
    lastBackupAt: at,
    lastBackupOk: result.ok,
    lastBackupError: result.ok ? null : (result.error || "unknown error").replace(/\s+/g, " ").trim().slice(0, 200),
    updatedAt: at,
  });
}

export async function recordDownload(at = new Date()): Promise<void> {
  await saveStatus({ lastDownloadAt: at, updatedAt: at });
}

export async function backupStatusLine(): Promise<string> {
  try {
    const row = await prisma.appSettings.findUnique({
      where: { id: "default" },
      select: { lastBackupAt: true, lastBackupOk: true, lastBackupError: true, lastDownloadAt: true },
    });
    return formatBackupStatus(row);
  } catch (err) {
    console.error("[backup] could not read backup status", err instanceof Error ? err.message : err);
    return "Last export: — failed (backup status is not ready yet)\nLast download: never";
  }
}
