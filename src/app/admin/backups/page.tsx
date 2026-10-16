"use client";

import { useEffect, useState } from "react";
import { AdminShell, PasswordField } from "@/components/AdminShell";
import { api } from "@/lib/client";

export default function BackupsPage() {
  const [status, setStatus] = useState("Last export: …\nLast download: …");
  const [fileName, setFileName] = useState("");
  const [backup, setBackup] = useState<unknown>(null);
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadStatus() {
    const data = await api<{ line: string }>("/api/admin/backup?view=status");
    setStatus(data.line);
  }

  useEffect(() => {
    loadStatus().catch((err) => setError(err instanceof Error ? err.message : "Could not load backup status."));
  }, []);

  async function onFile(file: File | undefined) {
    setMessage("");
    setError("");
    setBackup(null);
    setFileName("");
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setBackup(JSON.parse(text));
    } catch {
      setError("That file is not valid JSON.");
    }
  }

  async function restore() {
    setMessage("");
    setError("");
    if (!backup) {
      setError("Choose a backup file.");
      return;
    }
    setBusy(true);
    try {
      const data = await api<{ message: string }>("/api/admin/backup", {
        method: "POST",
        body: JSON.stringify({ confirmation: phrase, currentPassword: password, backup }),
      });
      setMessage(data.message);
      setPhrase("");
      setPassword("");
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  const confirmed = phrase === "RESTORE";

  return (
    <AdminShell title="Backups">
      <p className="backup-status" data-backup-status={status}>{status}</p>
      <p>
        Last export is the last time the backup URL was pulled. Last download is the last time an admin downloaded the JSON from this page. Times are America/New_York. The Google Sheet pulls that URL with BACKUP_TOKEN. See docs/backup-apps-script.gs.
      </p>
      <p>Downloads never include password hashes, PIN hashes, PIN keys, or API key hashes.</p>
      {message ? <div className="alert ok">{message}</div> : null}
      {error ? <div className="alert error">{error}</div> : null}
      <div className="row">
        <a className="btn gold" href="/api/admin/backup?table=json">Download backup</a>
        <a className="btn cream" href="/api/admin/backup?table=counts">Counts CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=miscounts">Miscounts CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=farms">Farms CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=customers">Customers CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=sizes">Sizes CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=grades">Grades CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=sessions">Sessions CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=startingInventory">Starting inventory CSV</a>
      </div>

      <form
        className="backup-restore"
        onSubmit={(event) => {
          event.preventDefault();
          void restore();
        }}
      >
        <h2>Restore from JSON</h2>
        <p>
          This replaces farms, customers, sizes, grades, starting inventory, sessions, counts, and miscounts. Your admin and counter logins stay as they are, so you are not locked out. A bad file changes nothing.
        </p>
        <label className="field">
          <span>Backup file</span>
          <input
            type="file"
            accept="application/json,.json"
            onChange={(event) => void onFile(event.target.files?.[0])}
          />
        </label>
        {fileName ? <p>Selected: {fileName}</p> : null}
        <label className="field">
          <span>Type RESTORE to confirm</span>
          <input
            value={phrase}
            onChange={(event) => setPhrase(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label="Type RESTORE to confirm"
          />
        </label>
        <PasswordField value={password} onChange={setPassword} />
        {confirmed ? (
          <div className="alert warn" role="status">
            Confirmed. Restoring will replace operational data and keep this admin login.
          </div>
        ) : null}
        <button className="btn danger" type="submit" disabled={busy}>
          Restore from JSON
        </button>
      </form>
    </AdminShell>
  );
}
