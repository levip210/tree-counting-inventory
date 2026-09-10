"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/client";
import { ConfirmDialog } from "@/components/ConfirmDialog";

type Farm = {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  countTotal: number;
};

export default function FarmsPage() {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  async function load(query = q) {
    const data = await api<{ farms: Farm[] }>(`/api/admin/farms?q=${encodeURIComponent(query)}`);
    setFarms(data.farms);
  }
  useEffect(() => {
    load("").catch((e) => setMsg(String(e.message)));
  }, []);

  async function add() {
    await api("/api/admin/farms", { method: "POST", body: JSON.stringify({ name }) });
    setName("");
    await load();
  }

  async function patch(body: object, confirmRename = false) {
    const res = await fetch("/api/admin/farms", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, confirmRename }),
    });
    const data = await res.json();
    if (res.status === 409 && data.needsConfirm) {
      setRename({ id: (body as { id: string }).id, name: (body as { name: string }).name });
      setMsg(data.message);
      return;
    }
    setMsg(data.message || "");
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/farms?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(data.message || (data.deactivated ? "Deactivated." : "Deleted."));
    await load();
  }

  return (
    <AdminShell title="Farms">
      <p>Only active farms appear on Yard Receiving. Farms with saved counts cannot be permanently deleted — deactivate them instead.</p>
      {msg ? <div className="alert info">{msg}</div> : null}
      <div className="row">
        <input placeholder="Search farms" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} />
        <button className="btn cream" type="button" onClick={() => void load()}>Search</button>
        <input placeholder="New farm name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn gold" type="button" onClick={() => void add()}>Add farm</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>FarmID</th><th>FarmName</th><th>DisplayOrder</th><th>Active</th><th>CreatedAt</th><th>UpdatedAt</th><th>Counts</th><th /></tr>
          </thead>
          <tbody>
            {farms.map((f, i) => (
              <tr key={f.id}>
                <td><code>{f.id}</code></td>
                <td>
                  <input
                    defaultValue={f.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== f.name) void patch({ id: f.id, name: e.target.value });
                    }}
                  />
                </td>
                <td>
                  <button className="btn cream" type="button" disabled={i === 0} onClick={() => void patch({ id: f.id, action: "reorder", direction: "up" })}>Up</button>{" "}
                  <button className="btn cream" type="button" disabled={i === farms.length - 1} onClick={() => void patch({ id: f.id, action: "reorder", direction: "down" })}>Down</button>
                </td>
                <td>{f.active ? "Active" : "Inactive"}</td>
                <td>{new Date(f.createdAt).toLocaleString()}</td>
                <td>{new Date(f.updatedAt).toLocaleString()}</td>
                <td>{f.countTotal}</td>
                <td>
                  <button className="btn" type="button" onClick={() => void patch({ id: f.id, active: !f.active })}>
                    {f.active ? "Deactivate" : "Reactivate"}
                  </button>{" "}
                  <button className="btn danger" type="button" onClick={() => void remove(f.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rename ? (
        <ConfirmDialog
          title="Rename farm with saved counts?"
          body="Past counts keep the farm name they had when they were tapped. New counts will use the new name."
          confirmLabel="Rename anyway"
          onCancel={() => setRename(null)}
          onConfirm={() => {
            void patch({ id: rename.id, name: rename.name }, true);
            setRename(null);
          }}
        />
      ) : null}
    </AdminShell>
  );
}
