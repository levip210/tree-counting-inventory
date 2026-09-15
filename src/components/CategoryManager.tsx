"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client";
import { SizeColorPicker } from "@/components/SizeColor";

type Item = {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  countTotal: number;
  color?: string | null;
};

export function CategoryManager({ kind, title, suggested }: { kind: "size" | "grade"; title: string; suggested: string[] }) {
  const [items, setItems] = useState<Item[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const showColor = kind === "size";

  async function load() {
    const data = await api<{ items: Item[] }>(`/api/admin/categories?kind=${kind}`);
    setItems(data.items);
  }
  useEffect(() => {
    load().catch((e) => setMsg(String(e.message)));
  }, [kind]);

  async function add() {
    await api("/api/admin/categories", {
      method: "POST",
      body: JSON.stringify({ kind, name, ...(showColor ? { color } : {}) }),
    });
    setName("");
    setColor(null);
    await load();
  }
  async function patch(body: object) {
    const res = await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, ...body }),
    });
    const data = await res.json();
    if (!res.ok) setMsg(data.error || data.message || "Update failed");
    await load();
  }
  async function patchColor(id: string, next: string | null) {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, color: next } : it)));
    const res = await fetch("/api/admin/categories", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, id, color: next }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMsg(data.error || data.message || "Update failed");
      await load();
    }
  }
  async function remove(id: string) {
    const res = await fetch(`/api/admin/categories?kind=${kind}&id=${id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(data.message || (data.deactivated ? "Deactivated because it is used in counts." : "Deleted."));
    await load();
  }

  return (
    <div>
      <p>The Yard Receiving and Shipping grids are the cartesian product of active sizes × active grades. Changes here update the grids automatically.</p>
      <p style={{ color: "#5c5648" }}>Suggested starting list: {suggested.join(", ")}. You can rename, add, or deactivate any of these.</p>
      {showColor ? (
        <p style={{ color: "#5c5648" }}>
          Optional color: pick any color or paste a hex value. Counting tablets show it on size labels so crew can glance at color instead of reading the name. Leave empty for no color. Grades do not have colors.
        </p>
      ) : null}
      {msg ? <div className="alert info">{msg}</div> : null}
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`New ${title.toLowerCase()}`} />
        {showColor ? <SizeColorPicker value={color} onChange={setColor} /> : null}
        <button className="btn gold" type="button" onClick={() => void add()}>Add</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr>
              <th>Name</th>
              {showColor ? <th>Color</th> : null}
              <th>Order</th>
              <th>Active</th>
              <th>Used in counts</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => (
              <tr key={item.id}>
                <td>
                  <input
                    defaultValue={item.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== item.name) {
                        void patch({ id: item.id, name: e.target.value });
                      }
                    }}
                  />
                </td>
                {showColor ? (
                  <td>
                    <SizeColorPicker value={item.color} onChange={(next) => void patchColor(item.id, next)} />
                  </td>
                ) : null}
                <td>
                  <button className="btn cream" type="button" disabled={i === 0} onClick={() => void patch({ id: item.id, action: "reorder", direction: "up" })}>Up</button>{" "}
                  <button className="btn cream" type="button" disabled={i === items.length - 1} onClick={() => void patch({ id: item.id, action: "reorder", direction: "down" })}>Down</button>
                </td>
                <td>{item.active ? "Active" : "Inactive"}</td>
                <td>{item.countTotal}</td>
                <td>
                  <button className="btn" type="button" onClick={() => void patch({ id: item.id, active: !item.active })}>
                    {item.active ? "Deactivate" : "Reactivate"}
                  </button>{" "}
                  <button className="btn danger" type="button" onClick={() => void remove(item.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
