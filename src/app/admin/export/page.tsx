"use client";

import { useEffect, useState } from "react";
import { AdminShell, PasswordField } from "@/components/AdminShell";
import { api } from "@/lib/client";

export default function ExportPage() {
  const [excelEnabled, setExcelEnabled] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const data = await api<{ excelEnabled: boolean; hasKey: boolean }>("/api/admin/export");
    setExcelEnabled(data.excelEnabled);
    setHasKey(data.hasKey);
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function rotate() {
    try {
      const data = await api<{ apiKey: string; excelEnabled: boolean }>("/api/admin/export", {
        method: "POST",
        body: JSON.stringify({ action: "rotate-key", currentPassword: password }),
      });
      setApiKey(data.apiKey);
      setExcelEnabled(true);
      setHasKey(true);
      setMsg("New API key created. Copy it now — it will not be shown again.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }
  async function disable() {
    try {
      await api("/api/admin/export", {
        method: "POST",
        body: JSON.stringify({ action: "disable", currentPassword: password }),
      });
      setApiKey("");
      setExcelEnabled(false);
      setHasKey(false);
      setMsg("Excel export API disabled and key removed.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <AdminShell title="Excel export">
      <p>
        This app downloads CSV or JSON that Excel can open. It does not build an .xlsx workbook. Exports never include passwords, PIN hashes, API keys, or who counted.
      </p>
      <p>Status: {excelEnabled ? "API enabled" : "API disabled"} · {hasKey ? "A key is set" : "No key"}.</p>
      {msg ? <div className="alert info">{msg}</div> : null}
      {apiKey ? (
        <div className="alert ok">
          API key (copy once): <code>{apiKey}</code>
        </div>
      ) : null}
      <PasswordField value={password} onChange={setPassword} />
      <div className="row">
        <button className="btn gold" type="button" onClick={() => void rotate()}>Create / rotate API key</button>
        <button className="btn danger" type="button" onClick={() => void disable()}>Disable export API</button>
      </div>
      <h3 style={{ marginTop: 22 }}>Signed-in downloads</h3>
      <div className="row">
        <a className="btn cream" href="/api/admin/export?kind=counts&format=csv">Counts CSV</a>
        <a className="btn cream" href="/api/admin/export?kind=counts&format=json">Counts JSON</a>
        <a className="btn cream" href="/api/admin/export?kind=inventory&format=csv">Starting inventory CSV</a>
        <a className="btn cream" href="/api/admin/export?kind=inventory&format=json">Starting inventory JSON</a>
      </div>
      <h3 style={{ marginTop: 22 }}>External Excel / Power Query</h3>
      <p>
        <code>GET /api/export/public?kind=counts&format=csv</code><br />
        <code>GET /api/export/public?kind=inventory&format=json</code><br />
        Header: <code>Authorization: Bearer YOUR_API_KEY</code> or query <code>?key=YOUR_API_KEY</code>
      </p>
    </AdminShell>
  );
}
