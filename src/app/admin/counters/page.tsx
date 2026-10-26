"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/client";

type Account = {
  id: string;
  accountLabel: string;
  active: boolean;
  access: "yard" | "shipping" | "both";
  createdAt: string;
};

export default function CountersPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [label, setLabel] = useState("");
  const [pin, setPin] = useState("");
  const [access, setAccess] = useState<"yard" | "shipping" | "both">("both");
  const [msg, setMsg] = useState("");

  async function load() {
    setAccounts((await api<{ accounts: Account[] }>("/api/admin/counters")).accounts);
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function add() {
    try {
      await api("/api/admin/counters", {
        method: "POST",
        body: JSON.stringify({ accountLabel: label, pin, access }),
      });
      setLabel("");
      setPin("");
      setMsg("Counter-access account created. The PIN is not stored in readable form.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not create account.");
    }
  }

  async function patch(id: string, body: object) {
    try {
      await api("/api/admin/counters", { method: "PATCH", body: JSON.stringify({ id, ...body }) });
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Update failed.");
    }
  }

  return (
    <AdminShell title="Counter-access accounts">
      <p>
        Counters sign in with a numeric PIN only — no email, username, or password. Counts never store who tapped.
        Two active accounts cannot share a PIN.
      </p>
      {msg ? <div className="alert info">{msg}</div> : null}
      <div className="row">
        <input placeholder="Account label (tablet 1, yard crew…)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input placeholder="Numeric PIN" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        <select value={access} onChange={(e) => setAccess(e.target.value as "yard" | "shipping" | "both")}>
          <option value="yard">Yard Receiving</option>
          <option value="shipping">Shipping</option>
          <option value="both">Both</option>
        </select>
        <button className="btn gold" type="button" onClick={() => void add()}>Create</button>
      </div>
      <div className="table-wrap" style={{ marginTop: 16 }}>
        <table className="data">
          <thead>
            <tr><th>Label</th><th>Access</th><th>Active</th><th>Created</th><th /></tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id}>
                <td>
                  <input defaultValue={a.accountLabel} onBlur={(e) => e.target.value !== a.accountLabel && void patch(a.id, { accountLabel: e.target.value })} />
                </td>
                <td>
                  <select defaultValue={a.access} onChange={(e) => void patch(a.id, { access: e.target.value })}>
                    <option value="yard">Yard Receiving</option>
                    <option value="shipping">Shipping</option>
                    <option value="both">Both</option>
                  </select>
                </td>
                <td>{a.active ? "Active" : "Inactive"}</td>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>
                  <button className="btn" type="button" onClick={() => void patch(a.id, { active: !a.active })}>
                    {a.active ? "Deactivate" : "Reactivate"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
