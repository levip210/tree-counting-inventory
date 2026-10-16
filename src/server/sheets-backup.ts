import { SignJWT, importPKCS8 } from "jose";
import { buildBackupDocument, type BackupDocument } from "./backup-document";
import { recordBackupResult } from "./backup-status";

export const BACKUP_INTERVAL_MS = 15 * 60 * 1000;

export const SHEET_TABS = [
  "Farms",
  "Customers",
  "Sizes",
  "Grades",
  "Starting inventory",
  "Sessions",
  "Counts",
  "Miscounts",
] as const;

export type SheetTable = { title: (typeof SHEET_TABS)[number]; rows: string[][] };

export type SheetsClient = {
  listTitles(): Promise<string[]>;
  ensureSheet(title: string): Promise<void>;
  overwrite(title: string, rows: string[][]): Promise<void>;
};

type ServiceAccount = { client_email: string; private_key: string };

function cell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function table(title: SheetTable["title"], header: string[], body: unknown[][]): SheetTable {
  return { title, rows: [header, ...body.map((row) => row.map(cell))] };
}

/** One header row plus data for each Sheet tab. Secrets are not columns. */
export function sheetTables(doc: BackupDocument): SheetTable[] {
  return [
    table(
      "Farms",
      ["FarmID", "Name", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"],
      doc.farms.map((row) => [row.id, row.name, row.displayOrder, row.active, row.createdAt, row.updatedAt]),
    ),
    table(
      "Customers",
      ["CustomerID", "Name", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"],
      doc.customers.map((row) => [row.id, row.name, row.displayOrder, row.active, row.createdAt, row.updatedAt]),
    ),
    table(
      "Sizes",
      ["SizeID", "Name", "Color", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"],
      doc.sizes.map((row) => [row.id, row.name, row.color, row.requireFarm, row.displayOrder, row.active, row.createdAt, row.updatedAt]),
    ),
    table(
      "Grades",
      ["GradeID", "Name", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"],
      doc.grades.map((row) => [row.id, row.name, row.requireFarm, row.displayOrder, row.active, row.createdAt, row.updatedAt]),
    ),
    table(
      "Starting inventory",
      ["InventoryID", "FarmID", "FarmName", "SizeID", "SizeName", "GradeID", "GradeName", "Quantity", "UpdatedAt"],
      doc.startingInventory.map((row) => [
        row.id,
        row.farmId,
        row.farmName,
        row.sizeId,
        row.sizeName,
        row.gradeId,
        row.gradeName,
        row.quantity,
        row.updatedAt,
      ]),
    ),
    table(
      "Sessions",
      ["SessionID", "Action", "FarmID", "FarmName", "CustomerID", "CustomerName", "StartedAt", "EndedAt", "CreatedAt"],
      doc.sessions.map((row) => [
        row.id,
        row.action,
        row.farmId,
        row.farmName,
        row.customerId,
        row.customerName,
        row.startedAt,
        row.endedAt,
        row.createdAt,
      ]),
    ),
    table(
      "Counts",
      [
        "CountID",
        "Timestamp",
        "TimestampUtc",
        "Action",
        "FarmID",
        "FarmName",
        "CustomerID",
        "CustomerName",
        "SizeID",
        "SizeName",
        "GradeID",
        "GradeName",
        "Quantity",
        "SessionID",
        "ClientSyncId",
        "CreatedAt",
        "SyncedAt",
        "VoidedAt",
        "VoidReason",
        "CorrectionNote",
        "CorrectedAt",
      ],
      doc.counts.map((row) => [
        row.id,
        row.timestampLocal,
        row.timestampUtc,
        row.action,
        row.farmId,
        row.farmName,
        row.customerId,
        row.customerName,
        row.sizeId,
        row.sizeName,
        row.gradeId,
        row.gradeName,
        row.quantity,
        row.sessionId,
        row.clientSyncId,
        row.createdAt,
        row.syncedAt,
        row.voidedAt,
        row.voidReason,
        row.correctionNote,
        row.correctedAt,
      ]),
    ),
    table(
      "Miscounts",
      [
        "MiscountID",
        "FarmID",
        "FarmName",
        "SizeID",
        "SizeName",
        "GradeID",
        "GradeName",
        "CounterID",
        "CounterName",
        "CounterRole",
        "Timestamp",
        "TimestampUtc",
        "ClientSyncId",
        "CreatedAt",
      ],
      doc.miscounts.map((row) => [
        row.id,
        row.farmId,
        row.farmName,
        row.sizeId,
        row.sizeName,
        row.gradeId,
        row.gradeName,
        row.counterId,
        row.counterName,
        row.counterRole,
        row.timestampLocal,
        row.timestampUtc,
        row.clientSyncId,
        row.createdAt,
      ]),
    ),
  ];
}

export function readSheetsConfig(env: NodeJS.ProcessEnv = process.env): { ok: true; sheetId: string; serviceAccount: ServiceAccount } | { ok: false; error: string } {
  const sheetId = env.GOOGLE_SHEET_ID?.trim() || "";
  const raw = env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() || "";
  if (!sheetId && !raw) {
    return { ok: false, error: "GOOGLE_SHEET_ID and GOOGLE_SERVICE_ACCOUNT_JSON are not set" };
  }
  if (!sheetId) return { ok: false, error: "GOOGLE_SHEET_ID is not set" };
  if (!raw) return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not set" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON" };
  }
  const record = parsed as { client_email?: unknown; private_key?: unknown };
  const email = typeof record.client_email === "string" ? record.client_email.trim() : "";
  const key = typeof record.private_key === "string" ? record.private_key : "";
  if (!email || !key.includes("PRIVATE KEY")) {
    return { ok: false, error: "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key" };
  }
  return { ok: true, sheetId, serviceAccount: { client_email: email, private_key: key } };
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  const key = await importPKCS8(account.private_key, "RS256");
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/spreadsheets" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.client_email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  if (!response.ok) {
    throw new Error(`Google sign-in failed (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { access_token?: string };
  if (!body.access_token) throw new Error("Google sign-in failed (no access token)");
  return body.access_token;
}

export function createGoogleSheetsClient(sheetId: string, account: ServiceAccount): SheetsClient {
  let tokenPromise: Promise<string> | null = null;
  function token() {
    tokenPromise ??= googleAccessToken(account);
    return tokenPromise;
  }
  async function sheetsFetch(url: string, init: RequestInit) {
    const access = await token();
    const response = await fetch(url, {
      ...init,
      headers: { authorization: `Bearer ${access}`, "content-type": "application/json", ...(init.headers || {}) },
    });
    if (!response.ok) {
      throw new Error(`Google Sheets request failed (HTTP ${response.status})`);
    }
    return response;
  }
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}`;
  return {
    async listTitles() {
      const response = await sheetsFetch(`${base}?fields=sheets.properties.title`, { method: "GET" });
      const body = (await response.json()) as { sheets?: { properties?: { title?: string } }[] };
      return (body.sheets || []).map((sheet) => sheet.properties?.title || "").filter(Boolean);
    },
    async ensureSheet(title) {
      await sheetsFetch(`${base}:batchUpdate`, {
        method: "POST",
        body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] }),
      });
    },
    async overwrite(title, rows) {
      const quoted = `'${title.replace(/'/g, "''")}'`;
      const clearRange = encodeURIComponent(`${quoted}!A:ZZ`);
      const writeRange = encodeURIComponent(`${quoted}!A1`);
      await sheetsFetch(`${base}/values/${clearRange}:clear`, { method: "POST", body: "{}" });
      await sheetsFetch(`${base}/values/${writeRange}?valueInputOption=RAW`, {
        method: "PUT",
        body: JSON.stringify({ values: rows }),
      });
    },
  };
}

export type SheetsBackupResult = { ok: boolean; error?: string; skipped?: boolean };

let inFlight = false;

export async function runSheetsBackup(options?: { client?: SheetsClient; now?: Date }): Promise<SheetsBackupResult> {
  if (inFlight) {
    console.log("[backup] skip overlapping run");
    return { ok: false, skipped: true, error: "skipped overlapping run" };
  }
  inFlight = true;
  try {
    return await executeSheetsBackup(options);
  } catch (err) {
    const error = err instanceof Error ? err.message : "backup failed";
    console.error("[backup]", error);
    await recordBackupResult({ ok: false, error }, options?.now);
    return { ok: false, error };
  } finally {
    inFlight = false;
  }
}

async function executeSheetsBackup(options?: { client?: SheetsClient; now?: Date }): Promise<SheetsBackupResult> {
  let client = options?.client;
  if (!client) {
    const config = readSheetsConfig();
    if (!config.ok) {
      console.error("[backup]", config.error);
      await recordBackupResult({ ok: false, error: config.error }, options?.now);
      return { ok: false, error: config.error };
    }
    client = createGoogleSheetsClient(config.sheetId, config.serviceAccount);
  }

  const doc = await buildBackupDocument(options?.now);
  const tables = sheetTables(doc);
  const existing = new Set(await client.listTitles());
  for (const tab of tables) {
    if (!existing.has(tab.title)) {
      await client.ensureSheet(tab.title);
      existing.add(tab.title);
    }
    await client.overwrite(tab.title, tab.rows);
  }
  await recordBackupResult({ ok: true }, options?.now);
  console.log("[backup] Google Sheet updated");
  return { ok: true };
}

export function startSheetsBackupScheduler() {
  const flag = globalThis as { __ptfSheetsBackup?: boolean };
  if (flag.__ptfSheetsBackup) return;
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  flag.__ptfSheetsBackup = true;
  const tick = () => {
    void runSheetsBackup().catch((err) => {
      console.error("[backup] scheduler tick failed", err instanceof Error ? err.message : err);
    });
  };
  const first = setTimeout(tick, 5_000);
  first.unref?.();
  const timer = setInterval(tick, BACKUP_INTERVAL_MS);
  timer.unref?.();
  console.log("[backup] Google Sheets backup scheduled every 15 minutes");
}
