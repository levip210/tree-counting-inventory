"use client";

import { useEffect, useMemo, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
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

type PendingDelete = { ids: string[] };

export default function HistoryPage() {
  const [counts, setCounts] = useState<Count[]>([]);
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [q, setQ] = useState("");
  const [includeVoided, setIncludeVoided] = useState(false);
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [busy, setBusy] = useState(false);

  const activeIds = useMemo(
    () => counts.filter((c) => !c.voidedAt).map((c) => c.countId),
    [counts],
  );
  const selectedIds = useMemo(
    () => activeIds.filter((id) => selected.has(id)),
    [activeIds, selected],
  );
  const allVisibleSelected = activeIds.length > 0 && selectedIds.length === activeIds.length;

  async function load() {
    const params = new URLSearchParams();
    if (action) params.set("action", action);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (q) params.set("q", q);
    if (includeVoided) params.set("includeVoided", "1");
    const data = await api<{ counts: Count[] }>(`/api/admin/history?${params.toString()}`);
    setCounts(data.counts);
    const keep = new Set(data.counts.filter((c) => !c.voidedAt).map((c) => c.countId));
    setSelected((prev) => new Set([...prev].filter((id) => keep.has(id))));
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const id of activeIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of activeIds) next.add(id);
      return next;
    });
  }

  function askDelete(ids: string[]) {
    const unique = [...new Set(ids)].filter((id) => activeIds.includes(id));
    if (unique.length === 0) return;
    setMsg("");
    setPendingDelete({ ids: unique });
  }

  async function confirmDelete() {
    if (!pendingDelete || busy) return;
    setBusy(true);
    try {
      const result = await api<{ voided: number }>("/api/admin/history", {
        method: "POST",
        body: JSON.stringify({ action: "void", ids: pendingDelete.ids }),
      });
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of pendingDelete.ids) next.delete(id);
        return next;
      });
      setPendingDelete(null);
      setMsg(result.voided === 1 ? "Deleted 1 count." : `Deleted ${result.voided} counts.`);
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not delete counts.");
    } finally {
      setBusy(false);
    }
  }

  async function noteRow(id: string) {
    const note = window.prompt("Correction note");
    if (note === null) return;
    await api("/api/admin/history", { method: "POST", body: JSON.stringify({ action: "note", id, note }) });
    await load();
  }

  const deleteCount = pendingDelete?.ids.length ?? 0;

  return (
    <AdminShell title="Count history">
      <p>Corrections are here. This table never includes who counted — not a name, PIN, account, email, or device id.</p>
      {msg ? <div className="alert info">{msg}</div> : null}
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
      <div className="history-actions">
        <button className="btn cream" type="button" onClick={toggleAllVisible} disabled={activeIds.length === 0}>
          {allVisibleSelected ? "Clear all" : "Select all"}
        </button>
        <span className="count-selected">
          {selectedIds.length === 0 ? "None selected" : `${selectedIds.length} selected`}
        </span>
        <button
          className="btn danger"
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => askDelete(selectedIds)}
        >
          Delete selected
        </button>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th className="check-col">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  disabled={activeIds.length === 0}
                  onChange={toggleAllVisible}
                  aria-label="Select all visible counts"
                />
              </th>
              <th>CountID</th><th>Timestamp</th><th>Action</th><th>Farm</th><th>Size</th><th>Grade</th><th>Qty</th><th>Session</th><th>Correction</th><th />
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr
                key={c.countId}
                className={selected.has(c.countId) ? "selected" : undefined}
                style={{ opacity: c.voidedAt ? 0.55 : 1, cursor: c.voidedAt ? "default" : "pointer" }}
                onClick={() => {
                  if (!c.voidedAt) toggle(c.countId);
                }}
              >
                <td className="check-col" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={selected.has(c.countId)}
                    disabled={Boolean(c.voidedAt)}
                    onChange={() => toggle(c.countId)}
                    aria-label={`Select count ${c.countId.slice(0, 8)}`}
                  />
                </td>
                <td><code>{c.countId.slice(0, 8)}</code></td>
                <td>{c.timestamp}</td>
                <td>{c.action}</td>
                <td>{c.farmName || ""}</td>
                <td>{c.sizeName}</td>
                <td>{c.gradeName}</td>
                <td>{c.quantity}</td>
                <td><code>{c.sessionId.slice(0, 8)}</code></td>
                <td>{c.voidReason || c.correctionNote || ""}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  {!c.voidedAt ? (
                    <button className="btn danger" type="button" onClick={() => askDelete([c.countId])}>
                      Void
                    </button>
                  ) : (
                    "Voided"
                  )}{" "}
                  <button className="btn cream" type="button" onClick={() => void noteRow(c.countId)}>Note</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pendingDelete ? (
        <ConfirmDialog
          title={deleteCount === 1 ? "Delete this count?" : `Delete ${deleteCount} counts?`}
          body={
            deleteCount === 1
              ? "This count will be voided and dropped from totals. Cancel leaves it as-is."
              : "Selected counts will be voided and dropped from totals. Cancel leaves them as-is."
          }
          confirmLabel={deleteCount === 1 ? "Delete" : `Delete ${deleteCount} counts`}
          danger
          busy={busy}
          onCancel={() => {
            if (!busy) setPendingDelete(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </AdminShell>
  );
}
