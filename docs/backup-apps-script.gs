/**
 * Powers Tree Farm — Google Sheets backup pull
 *
 * Paste-and-setup
 * 1. Create or open the Google Sheet that should hold the backup.
 * 2. Extensions > Apps Script. Replace the sample code with this whole file. Save.
 * 3. Choose setupBackup in the function list and click Run. Approve the permissions.
 * 4. Paste the export URL, for example https://YOUR-APP.up.railway.app/api/backup/export
 * 5. Paste the BACKUP_TOKEN from the server environment.
 *    setupBackup stores both in Script Properties (not in this file) and installs a
 *    trigger that runs pullBackup every 15 minutes.
 *
 * pullBackup fetches the URL with Authorization: Bearer <token>, then overwrites one
 * tab per table (creating a tab when it is missing). A fetch or parse error updates
 * the Status tab only and leaves the data tabs untouched.
 *
 * Run setupBackup again to change the URL or token.
 */

function setupBackup() {
  var ui = SpreadsheetApp.getUi();
  var urlPrompt = ui.prompt(
    "Backup export URL",
    "Paste the full URL, for example https://your-app.up.railway.app/api/backup/export",
    ui.ButtonSet.OK_CANCEL
  );
  if (urlPrompt.getSelectedButton() !== ui.Button.OK) return;
  var tokenPrompt = ui.prompt(
    "BACKUP_TOKEN",
    "Paste the BACKUP_TOKEN from the server environment. It is stored in Script Properties, not in this script.",
    ui.ButtonSet.OK_CANCEL
  );
  if (tokenPrompt.getSelectedButton() !== ui.Button.OK) return;
  saveBackupConfig_(urlPrompt.getResponseText(), tokenPrompt.getResponseText());
  installBackupTrigger();
}

function saveBackupConfig_(url, token) {
  var cleanUrl = String(url || "").trim();
  var cleanToken = String(token || "").trim();
  if (!cleanUrl || !cleanToken) throw new Error("URL and token are required.");
  PropertiesService.getScriptProperties().setProperties({
    BACKUP_URL: cleanUrl,
    BACKUP_TOKEN: cleanToken,
  });
}

function installBackupTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === "pullBackup") ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger("pullBackup").timeBased().everyMinutes(15).create();
}

function pullBackup() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("BACKUP_URL");
  var token = props.getProperty("BACKUP_TOKEN");
  try {
    if (!url || !token) throw new Error("Run setupBackup first.");
    var response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + token },
      muteHttpExceptions: true,
    });
    var code = response.getResponseCode();
    if (code !== 200) throw new Error("HTTP " + code);
    var payload = JSON.parse(response.getContentText());
    applyBackupPayload(SpreadsheetApp.getActiveSpreadsheet(), payload);
    writeBackupStatus_("OK");
  } catch (err) {
    writeBackupStatus_("failed (" + (err && err.message ? err.message : err) + ")");
  }
}

function applyBackupPayload(spreadsheet, payload) {
  var tables = tablesFromExport(payload);
  for (var i = 0; i < tables.length; i++) {
    var table = tables[i];
    var sheet = spreadsheet.getSheetByName(table.title);
    if (!sheet) sheet = spreadsheet.insertSheet(table.title);
    sheet.clearContents();
    if (table.rows.length && table.rows[0].length) {
      sheet.getRange(1, 1, table.rows.length, table.rows[0].length).setValues(table.rows);
    }
  }
}

function writeBackupStatus_(result) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName("Status");
  if (!sheet) sheet = spreadsheet.insertSheet("Status");
  var stamp = Utilities.formatDate(new Date(), "America/New_York", "MMM d, yyyy, h:mm a z");
  sheet.getRange(1, 1, 1, 2).setValues([["Last backup", stamp + " — " + result]]);
}

function tablesFromExport(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Backup payload was not valid");
  var required = ["farms", "customers", "sizes", "grades", "startingInventory", "sessions", "counts", "miscounts"];
  for (var i = 0; i < required.length; i++) {
    if (!Array.isArray(payload[required[i]])) throw new Error("Backup payload was not valid");
  }
  return [
    tableFrom_("Farms", ["id", "name", "displayOrder", "active", "createdAt", "updatedAt"], ["FarmID", "Name", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"], payload.farms),
    tableFrom_("Customers", ["id", "name", "displayOrder", "active", "createdAt", "updatedAt"], ["CustomerID", "Name", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"], payload.customers),
    tableFrom_("Sizes", ["id", "name", "color", "requireFarm", "displayOrder", "active", "createdAt", "updatedAt"], ["SizeID", "Name", "Color", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"], payload.sizes),
    tableFrom_("Grades", ["id", "name", "requireFarm", "displayOrder", "active", "createdAt", "updatedAt"], ["GradeID", "Name", "RequireFarm", "DisplayOrder", "Active", "CreatedAt", "UpdatedAt"], payload.grades),
    tableFrom_("Starting inventory", ["id", "farmId", "farmName", "sizeId", "sizeName", "gradeId", "gradeName", "quantity", "updatedAt"], ["InventoryID", "FarmID", "Farm", "SizeID", "Size", "GradeID", "Grade", "Quantity", "UpdatedAt"], payload.startingInventory),
    tableFrom_("Sessions", ["id", "action", "farmId", "farmName", "customerId", "customerName", "startedAt", "endedAt", "createdAt"], ["SessionID", "Action", "FarmID", "Farm", "CustomerID", "Customer", "StartedAt", "EndedAt", "CreatedAt"], payload.sessions),
    tableFrom_("Counts", ["id", "timestampLocal", "timestampUtc", "action", "farmId", "farmName", "customerId", "customerName", "sizeId", "sizeName", "gradeId", "gradeName", "quantity", "sessionId", "clientSyncId", "createdAt", "syncedAt", "voidedAt", "voidReason", "correctionNote", "correctedAt"], ["CountID", "TimestampLocal", "TimestampUtc", "Action", "FarmID", "Farm", "CustomerID", "Customer", "SizeID", "Size", "GradeID", "Grade", "Quantity", "SessionID", "ClientSyncID", "CreatedAt", "SyncedAt", "VoidedAt", "VoidReason", "CorrectionNote", "CorrectedAt"], payload.counts),
    tableFrom_("Miscounts", ["id", "timestampLocal", "timestampUtc", "farmId", "farmName", "sizeId", "sizeName", "gradeId", "gradeName", "counterId", "counterName", "counterRole", "clientSyncId", "createdAt"], ["MiscountID", "TimestampLocal", "TimestampUtc", "FarmID", "Farm", "SizeID", "Size", "GradeID", "Grade", "CounterID", "Counter", "CounterRole", "ClientSyncID", "CreatedAt"], payload.miscounts),
  ];
}

function tableFrom_(title, keys, header, records) {
  var rows = [header];
  for (var i = 0; i < records.length; i++) rows.push(rowFrom_(records[i], keys));
  return { title: title, rows: rows };
}

function rowFrom_(record, keys) {
  var out = [];
  for (var i = 0; i < keys.length; i++) out.push(cell_(record ? record[keys[i]] : ""));
  return out;
}

function cell_(value) {
  if (value === null || value === undefined) return "";
  if (value === true) return "true";
  if (value === false) return "false";
  return String(value);
}
