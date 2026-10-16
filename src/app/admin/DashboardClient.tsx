"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminShell } from "@/components/AdminShell";
import { CHECKLIST_STEPS, INVENTORY_DISCLAIMER } from "@/lib/constants";
import { api } from "@/lib/client";

type Dash = {
  stats: {
    today: string;
    timezone: string;
    received: number;
    shipped: number;
    inventory: number;
    todayReceived: number;
    todayShipped: number;
    hourly: { hour: string; received: number; shipped: number }[];
    byCategory: { sizeName: string; gradeName: string; received: number; shipped: number; inventory: number }[];
  };
  progress: { farmName: string; sizeName: string; gradeName: string; starting: number; received: number; notYetReceived: number; exceeded: boolean }[];
  checklist: Record<string, boolean>;
  checklistDismissed: boolean;
  excelEnabled: boolean;
};

export default function DashboardClient() {
  const welcome = useSearchParams().get("welcome") === "1";
  const [data, setData] = useState<Dash | null>(null);

  async function load() {
    setData(await api<Dash>("/api/admin/dashboard"));
  }
  useEffect(() => {
    load().catch(() => undefined);
  }, []);

  async function toggleStep(id: string) {
    if (!data) return;
    const checklist = { ...data.checklist, [id]: !data.checklist[id] };
    await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ checklist }) });
    await load();
  }
  async function dismiss() {
    await api("/api/admin/settings", { method: "POST", body: JSON.stringify({ checklistDismissed: true }) });
    await load();
  }

  const maxHour = Math.max(1, ...(data?.stats.hourly.map((h) => h.received + h.shipped) || [1]));

  return (
    <AdminShell title="Admin dashboard">
      {welcome ? (
        <div className="alert ok">Administrator created. First-time setup is now locked. You can explore immediately — the checklist is a guide, not a gate.</div>
      ) : null}
      {!data?.checklistDismissed ? (
        <section>
          <h2>Initial setup checklist</h2>
          <p>Work through these at your own pace. Nothing here blocks counting.</p>
          <div className="checklist">
            {CHECKLIST_STEPS.map((step) => (
              <label key={step.id}>
                <input type="checkbox" checked={Boolean(data?.checklist[step.id])} onChange={() => void toggleStep(step.id)} />
                <span>
                  {step.label} — <Link href={step.href}>Open</Link>
                </span>
              </label>
            ))}
          </div>
          <button className="btn cream" type="button" onClick={() => void dismiss()} style={{ marginTop: 10 }}>Hide checklist</button>
        </section>
      ) : null}

      <section style={{ marginTop: 18 }}>
        <h2>Yard picture</h2>
        <p>{INVENTORY_DISCLAIMER}</p>
        <div className="home-grid">
          <div className="giant pine" style={{ minHeight: 120 }}><b>{data?.stats.received ?? "—"}</b><span>Received (all time)</span></div>
          <div className="giant" style={{ minHeight: 120 }}><b>{data?.stats.shipped ?? "—"}</b><span>Shipped (all time)</span></div>
          <div className="giant cream span-all" style={{ minHeight: 120 }}><b>{data?.stats.inventory ?? "—"}</b><span>Category inventory = Received − Shipped</span></div>
        </div>
        <p style={{ marginTop: 12 }}>
          Today ({data?.stats.today} {data?.stats.timezone}): received {data?.stats.todayReceived ?? 0}, shipped {data?.stats.todayShipped ?? 0}.
        </p>
        <div className="hour-bar" title="Hourly activity today">
          {data?.stats.hourly.map((h) => (
            <i key={h.hour} style={{ height: `${((h.received + h.shipped) / maxHour) * 100}%` }} title={`${h.hour}:00 r${h.received} s${h.shipped}`} />
          ))}
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h3>By size and grade</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Size</th><th>Grade</th><th>Received</th><th>Shipped</th><th>Inventory</th></tr></thead>
            <tbody>
              {(data?.stats.byCategory || []).map((row) => (
                <tr key={`${row.sizeName}-${row.gradeName}`}>
                  <td>{row.sizeName}</td><td>{row.gradeName}</td><td>{row.received}</td><td>{row.shipped}</td><td>{row.inventory}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <h3>Not yet received from farm</h3>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Farm</th><th>Size</th><th>Grade</th><th>Starting</th><th>Received</th><th>Not yet</th><th>Status</th></tr></thead>
            <tbody>
              {(data?.progress || []).map((row, i) => (
                <tr key={i}>
                  <td>{row.farmName}</td><td>{row.sizeName}</td><td>{row.gradeName}</td>
                  <td>{row.starting}</td><td>{row.received}</td><td>{row.notYetReceived}</td>
                  <td>{row.exceeded ? "Exceeds starting inventory" : "On track"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p style={{ marginTop: 16 }}>
        Excel export is {data?.excelEnabled ? "on" : "off"}. Open <Link href="/admin/export">Excel settings</Link>.
      </p>
    </AdminShell>
  );
}
