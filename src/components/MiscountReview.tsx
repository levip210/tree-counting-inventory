"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { ConfirmDialog } from "./ConfirmDialog";

type Miscount = {
  id: string;
  farmName: string;
  sizeName: string;
  gradeName: string;
  counterName: string;
  timestampLocal: string;
};

export function MiscountReview() {
  const [rows, setRows] = useState<Miscount[]>([]);
  const [msg, setMsg] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<{ miscounts: Miscount[] }>("/api/admin/miscounts");
    setRows(data.miscounts);
  }

  useEffect(() => {
    load().catch((e) => setMsg(e instanceof Error ? e.message : "Could not load miscounts."));
  }, []);

  async function confirmDelete() {
    if (!pendingId || busy) return;
    setBusy(true);
    try {
      await api("/api/admin/miscounts", { method: "DELETE", body: JSON.stringify({ id: pendingId }) });
      setPendingId(null);
      setMsg("Miscount removed. Live farm counts were not changed.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not delete miscount.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="miscount-review">
      <h3>Miscount review</h3>
      <p>
        Taps of a size and grade that farm does not carry. These never entered the live count.
        Delete removes only this row.
      </p>
      {msg ? <div className="alert info">{msg}</div> : null}
      {rows.length === 0 ? (
        <p>No miscounts.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Farm</th>
                <th>Size</th>
                <th>Grade</th>
                <th>Counter</th>
                <th>Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.farmName}</td>
                  <td>{row.sizeName}</td>
                  <td>{row.gradeName}</td>
                  <td>{row.counterName}</td>
                  <td>{row.timestampLocal}</td>
                  <td>
                    <button className="btn danger" type="button" onClick={() => setPendingId(row.id)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pendingId ? (
        <ConfirmDialog
          title="Delete this miscount?"
          body="This removes the review row only. Live farm counts stay as they are."
          confirmLabel="Delete"
          danger
          busy={busy}
          onCancel={() => {
            if (!busy) setPendingId(null);
          }}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  );
}
