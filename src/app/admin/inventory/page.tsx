"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { SizeNameChip } from "@/components/SizeColor";
import { api } from "@/lib/client";

type Cat = { id: string; name: string; color?: string | null };
type Row = { farmId: string; sizeId: string; gradeId: string; quantity: number };
type Progress = { farmId: string; sizeId: string; gradeId: string; starting: number; received: number; notYetReceived: number; exceeded: boolean };

export default function InventoryPage() {
  const [farms, setFarms] = useState<Cat[]>([]);
  const [sizes, setSizes] = useState<Cat[]>([]);
  const [grades, setGrades] = useState<Cat[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [farmId, setFarmId] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const data = await api<{ farms: Cat[]; sizes: Cat[]; grades: Cat[]; rows: Row[]; progress: Progress[] }>("/api/admin/inventory");
    setFarms(data.farms);
    setSizes(data.sizes);
    setGrades(data.grades);
    setRows(data.rows);
    setProgress(data.progress);
    if (!farmId && data.farms[0]) setFarmId(data.farms[0].id);
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  function qty(sizeId: string, gradeId: string) {
    return rows.find((r) => r.farmId === farmId && r.sizeId === sizeId && r.gradeId === gradeId)?.quantity ?? "";
  }
  function prog(sizeId: string, gradeId: string) {
    return progress.find((r) => r.farmId === farmId && r.sizeId === sizeId && r.gradeId === gradeId);
  }

  async function save(sizeId: string, gradeId: string, quantity: number) {
    await api("/api/admin/inventory", {
      method: "POST",
      body: JSON.stringify({ farmId, sizeId, gradeId, quantity }),
    });
    await load();
    setMsg("Starting inventory saved.");
  }

  return (
    <AdminShell title="Starting farm inventory">
      <p>
        Optional expected trees by farm, size, and grade. The dashboard shows <b>Not yet received from farm</b> and warns when received exceeds the starting number.
        Leave a cell blank if you are not tracking that combination.
      </p>
      {msg ? <div className="alert ok">{msg}</div> : null}
      <label className="field">
        <span>Farm</span>
        <select value={farmId} onChange={(e) => setFarmId(e.target.value)}>
          {farms.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </label>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Size</th>
              {grades.map((g) => <th key={g.id}>{g.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => (
              <tr key={s.id}>
                <td><SizeNameChip name={s.name} color={s.color} /></td>
                {grades.map((g) => {
                  const p = prog(s.id, g.id);
                  return (
                    <td key={g.id}>
                      <input
                        type="number"
                        min={0}
                        defaultValue={qty(s.id, g.id)}
                        key={`${farmId}-${s.id}-${g.id}-${qty(s.id, g.id)}`}
                        onBlur={(e) => {
                          const n = Number(e.target.value);
                          if (e.target.value === "") return;
                          if (Number.isInteger(n) && n >= 0) void save(s.id, g.id, n);
                        }}
                      />
                      {p ? (
                        <div style={{ fontSize: "0.8rem", marginTop: 4 }}>
                          Rec {p.received} · left {p.notYetReceived}
                          {p.exceeded ? " · EXCEEDS" : ""}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
