"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/client";

type Count = {
  countId: string;
  timestamp: string;
  action: string;
  farmName: string | null;
  sizeName: string;
  gradeName: string;
  quantity: number;
  sessionId: string;
  voidedAt: string | null;
  voidReason: string | null;
  correctionNote: string | null;
};

export default function HistoryPage() {
  const [counts, setCounts] = useState<Count[]>([]);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [msg, setMsg] = useState("");

  async function load() {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (includeVoided) params.set("includeVoided", "1");
    const data = await api<{ counts: Count[] }>(`/api/admin/history?${params.toString()}`);
    setCounts(data.counts);
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function voidRow(id: string) {
    const reason = window.prompt("Correction reason (optional)") || "Admin correction";
    await api("/api/admin/history", { method: "POST", body: JSON.stringify({ action: "void", id, reason }) });
    await load();
  }
  async function noteRow(id: string) {
    const note = window.prompt("Correction note") || "";
    await api("/api/admin/history", { method: "POST", body: JSON.stringify({ action: "note", id, note }) });
    await load();
  }

  return (
    <AdminShell title="Count history">
      <p>Corrections are here. This table never includes who counted — not a name, PIN, account, email, or device id.</p>
      {msg ? <div className="alert error">{msg}</div> : null}
      <div className="row">
        <select value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          <option value="Yard Received">Yard Received</option>
          <option value="Shipped">Shipped</option>
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <input placeholder="Search size/grade/farm" value={q} onChange={(e) => setQ(e.target.value)} />
        <label><input type="checkbox" checked={includeVoided} onChange={(e) => setIncludeVoided(e.target.checked)} /> Include voided</label>
        <button className="btn gold" type="button" onClick={() => void load()}>Filter</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>CountID</th><th>Timestamp</th><th>Action</th><th>Farm</th><th>Size</th><th>Grade</th><th>Qty</th><th>Session</th><th>Correction</th><th />
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.countId} style={{ opacity: c.voidedAt ? 0.55 : 1 }}>
                <td><code>{c.countId.slice(0, 8)}</code></td>
                <td>{c.timestamp}</td>
                <td>{c.action}</td>
                <td>{c.farmName || ""}</td>
                <td>{c.sizeName}</td>
                <td>{c.gradeName}</td>
                <td>{c.quantity}</td>
                <td><code>{c.sessionId.slice(0, 8)}</code></td>
                <td>{c.voidReason || c.correctionNote || ""}</td>
                <td>
                  {!c.voidedAt ? <button className="btn danger" type="button" onClick={() => void voidRow(c.countId)}>Void</button> : "Voided"}{" "}
                  <button className="btn cream" type="button" onClick={() => void noteRow(c.countId)}>Note</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
