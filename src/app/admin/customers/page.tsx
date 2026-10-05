"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api } from "@/lib/client";

type SizeGrade = {
  sizeId: string;
  sizeName: string;
  gradeId: string;
  gradeName: string;
  quantity: number;
};

type Customer = {
  id: string;
  name: string;
  displayOrder: number;
  active: boolean;
  totalTrees: number;
  bySizeGrade: SizeGrade[];
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [unassigned, setUnassigned] = useState(0);
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");
  const [rename, setRename] = useState<{ id: string; name: string } | null>(null);

  async function load(query = q) {
    const data = await api<{ customers: Customer[]; unassignedTrees: number }>(
      `/api/admin/customers?q=${encodeURIComponent(query)}`,
    );
    setCustomers(data.customers);
    setUnassigned(data.unassignedTrees || 0);
  }

  useEffect(() => {
    load("").catch((e) => setMsg(String(e.message)));
  }, []);

  async function add() {
    setMsg("");
    try {
      await api("/api/admin/customers", { method: "POST", body: JSON.stringify({ name }) });
      setName("");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Could not add customer.");
    }
  }

  async function patch(body: object, confirmRename = false) {
    const res = await fetch("/api/admin/customers", {
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
    if (!res.ok) {
      setMsg(data.error || "Could not update customer.");
      return;
    }
    setMsg(data.message || "");
    await load();
  }

  async function remove(id: string) {
    const res = await fetch(`/api/admin/customers?id=${id}`, { method: "DELETE" });
    const data = await res.json();
    setMsg(data.message || data.error || (data.deactivated ? "Hidden from the shipping list." : "Deleted."));
    await load();
  }

  return (
    <AdminShell title="Customers">
      <p>
        Shipping counters pick a customer from this list before they can count. Totals are trees shipped to each
        customer, split by size and grade. Voided counts are left out.
      </p>
      {unassigned > 0 ? (
        <div className="alert info">
          {unassigned} shipped {unassigned === 1 ? "tree was" : "trees were"} counted before a customer was required.
          Those trees stay in the yard shipped total and are not assigned to a customer.
        </div>
      ) : null}
      {msg ? <div className="alert info">{msg}</div> : null}
      <div className="customer-admin-add">
        <label className="field">
          <span>New customer</span>
          <input
            placeholder="Customer name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void add();
            }}
          />
        </label>
        <button className="btn gold" type="button" onClick={() => void add()}>
          Add customer
        </button>
      </div>
      <div className="row">
        <input
          placeholder="Search customers"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void load()}
        />
        <button className="btn cream" type="button" onClick={() => void load()}>
          Search
        </button>
      </div>
      {customers.length === 0 ? <p>No customers yet. Add the buyers trucks arrive for.</p> : null}
      {customers.map((customer, index) => (
        <article className="customer-card" key={customer.id}>
          <div className="customer-card-head">
            <div>
              <h3>{customer.name}</h3>
              <p className="customer-meta">
                {customer.active ? "On the shipping list" : "Hidden from counters"}
              </p>
            </div>
            <div className="customer-total">
              <b>{customer.totalTrees}</b>
              <span>{customer.totalTrees === 1 ? "tree shipped" : "trees shipped"}</span>
            </div>
          </div>
          {customer.bySizeGrade.length === 0 ? (
            <p className="customer-empty">No trees shipped to this customer yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Size</th>
                    <th>Grade</th>
                    <th>Trees</th>
                  </tr>
                </thead>
                <tbody>
                  {customer.bySizeGrade.map((row) => (
                    <tr key={`${row.sizeId}-${row.gradeId}`}>
                      <td>{row.sizeName}</td>
                      <td>{row.gradeName}</td>
                      <td>{row.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="customer-actions">
            <label className="field" style={{ marginBottom: 0, flex: "1 1 180px" }}>
              <span>Rename</span>
              <input
                key={`${customer.id}:${customer.name}`}
                defaultValue={customer.name}
                onBlur={(e) => {
                  const next = e.target.value.trim();
                  if (next && next !== customer.name) void patch({ id: customer.id, name: next });
                }}
              />
            </label>
            <button
              className="btn cream"
              type="button"
              disabled={index === 0}
              onClick={() => void patch({ id: customer.id, action: "reorder", direction: "up" })}
            >
              Up
            </button>
            <button
              className="btn cream"
              type="button"
              disabled={index === customers.length - 1}
              onClick={() => void patch({ id: customer.id, action: "reorder", direction: "down" })}
            >
              Down
            </button>
            <button className="btn" type="button" onClick={() => void patch({ id: customer.id, active: !customer.active })}>
              {customer.active ? "Hide" : "Show"}
            </button>
            <button className="btn danger" type="button" onClick={() => void remove(customer.id)}>
              Delete
            </button>
          </div>
        </article>
      ))}
      {rename ? (
        <ConfirmDialog
          title="Rename customer with shipped trees?"
          body="Past counts keep the customer name they had when they were tapped. New counts use the new name. Totals stay on this customer."
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
