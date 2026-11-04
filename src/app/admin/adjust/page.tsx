"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminShell } from "@/components/AdminShell";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SizeNameChip } from "@/components/SizeColor";
import { api, newId } from "@/lib/client";

type Named = { id: string; name: string };
type Size = Named & { color?: string | null };
type Grade = Named & { drawsFromGradeId?: string | null };
type Catalog = { farms: Named[]; customers: Named[]; sizes: Size[]; grades: Grade[] };

type Pile = {
  gradeName: string;
  linked: boolean;
  starting: number;
  received: number;
  nextReceived: number | null;
  remaining: number | null;
  exceeded: boolean;
};

type Plan = {
  summary: string | null;
  detail: string;
  current: number;
  next: number | null;
  overPile: boolean;
  pile: Pile | null;
  sizeName: string;
  gradeName: string;
  placeLabel: string;
};

type Recent = {
  countId: string;
  timestamp: string;
  action: string;
  farmName: string | null;
  customerName: string | null;
  sizeName: string;
  gradeName: string;
  quantity: number;
  voidedAt: string | null;
  adjustmentDirection: "add" | "remove" | null;
  adjustedByName: string | null;
};

type Direction = "add" | "remove";
type ActionName = "Yard Received" | "Shipped";

function AmountPad({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  function press(key: string) {
    if (disabled) return;
    if (key === "del") {
      onChange(value.slice(0, -1));
      return;
    }
    if (key === "clear") {
      onChange("");
      return;
    }
    const next = (value + key).replace(/^0+/, "");
    if (next.length > 4) return;
    onChange(next);
  }
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "del"];
  return (
    <div className="keypad adjust-pad" aria-label="Number pad">
      {keys.map((key) => (
        <button key={key} type="button" disabled={disabled} onClick={() => press(key)}>
          {key === "del" ? "⌫" : key === "clear" ? "C" : key}
        </button>
      ))}
    </div>
  );
}

export default function AdjustPage() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [action, setAction] = useState<ActionName>("Yard Received");
  const [farmId, setFarmId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [sizeId, setSizeId] = useState("");
  const [gradeId, setGradeId] = useState("");
  const [digits, setDigits] = useState("");
  const [status, setStatus] = useState<Plan | null>(null);
  const [statusError, setStatusError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [msg, setMsg] = useState("");
  const [msgOk, setMsgOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ plan: Plan; direction: Direction; amount: number; requestId: string } | null>(null);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [voidId, setVoidId] = useState<string | null>(null);

  const ready = Boolean(action && sizeId && gradeId && (action === "Yard Received" ? farmId : customerId));
  const amount = Number(digits);
  const amountOk = digits.length > 0 && Number.isInteger(amount) && amount >= 1 && amount <= 9999;
  const selectedGrade = catalog?.grades.find((grade) => grade.id === gradeId);
  const pileName = catalog?.grades.find((grade) => grade.id === selectedGrade?.drawsFromGradeId)?.name;

  const payload = useMemo(
    () => ({
      action,
      farmId: action === "Yard Received" ? farmId : "",
      customerId: action === "Shipped" ? customerId : "",
      sizeId,
      gradeId,
    }),
    [action, farmId, customerId, sizeId, gradeId],
  );

  async function loadRecent() {
    const data = await api<{ adjustments: Recent[] }>("/api/admin/adjustments");
    setRecent(data.adjustments);
  }

  useEffect(() => {
    api<Catalog>("/api/catalog")
      .then(setCatalog)
      .catch((err: Error) => setLoadError(err.message));
    loadRecent().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ready) {
      setStatus(null);
      setStatusError("");
      return;
    }
    let cancel = false;
    setStatus(null);
    api<Plan>("/api/admin/adjustments", { method: "POST", body: JSON.stringify({ ...payload, mode: "status" }) })
      .then((plan) => {
        if (cancel) return;
        setStatus(plan);
        setStatusError("");
      })
      .catch((err: Error) => {
        if (cancel) return;
        setStatus(null);
        setStatusError(err.message);
      });
    return () => {
      cancel = true;
    };
  }, [ready, payload]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (pending || voidId) return;
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        setDigits((current) => {
          const next = (current + event.key).replace(/^0+/, "");
          return next.length > 4 ? current : next;
        });
      } else if (event.key === "Backspace") {
        event.preventDefault();
        setDigits((current) => current.slice(0, -1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, voidId]);

  async function ask(direction: Direction) {
    if (!amountOk || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const requestId = newId();
      const plan = await api<Plan>("/api/admin/adjustments", {
        method: "POST",
        body: JSON.stringify({ ...payload, mode: "preview", direction, amount, clientRequestId: requestId }),
      });
      setPending({ plan, direction, amount, requestId });
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : "Could not prepare that adjustment.");
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!pending || busy) return;
    setBusy(true);
    try {
      const saved = await api<{ saved?: { duplicate: boolean } }>("/api/admin/adjustments", {
        method: "POST",
        body: JSON.stringify({
          ...payload,
          mode: "commit",
          direction: pending.direction,
          amount: pending.amount,
          clientRequestId: pending.requestId,
        }),
      });
      setPending(null);
      setDigits("");
      setMsgOk(true);
      setMsg(saved.saved?.duplicate ? "That adjustment was already saved." : "Saved. Totals and inventory include it.");
      await loadRecent();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : "Could not save that adjustment.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmVoid() {
    if (!voidId || busy) return;
    setBusy(true);
    try {
      await api("/api/admin/history", {
        method: "POST",
        body: JSON.stringify({ action: "void", ids: [voidId], reason: "Void admin adjustment" }),
      });
      setVoidId(null);
      setMsgOk(true);
      setMsg("Adjustment voided. It no longer counts in the totals.");
      await loadRecent();
    } catch (err) {
      setMsgOk(false);
      setMsg(err instanceof Error ? err.message : "Could not void that adjustment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="Number pad">
      <p>
        Add or take away a batch without tapping each tree. Pick the same place, size, and grade a count would use, type the number, then confirm.
        Counters do not see this page. Each save is stored with your name and can be voided from the list below or from{" "}
        <Link href="/admin/history">Count history</Link>.
      </p>
      {loadError ? <div className="alert error">{loadError}</div> : null}
      {statusError ? <div className="alert error">{statusError}</div> : null}
      {msg ? <div className={msgOk ? "alert ok" : "alert error"}>{msg}</div> : null}

      <section className="adjust-section">
        <h2>Where</h2>
        <div className="choice-grid">
          <button type="button" className={action === "Yard Received" ? "selected" : ""} onClick={() => setAction("Yard Received")}>
            Yard receiving
          </button>
          <button type="button" className={action === "Shipped" ? "selected" : ""} onClick={() => setAction("Shipped")}>
            Shipping
          </button>
        </div>
        {action === "Yard Received" ? (
          <div className="choice-grid">
            {(catalog?.farms || []).map((farm) => (
              <button key={farm.id} type="button" className={farmId === farm.id ? "selected" : ""} onClick={() => setFarmId(farm.id)}>
                {farm.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="choice-grid">
            {(catalog?.customers || []).map((customer) => (
              <button
                key={customer.id}
                type="button"
                className={customerId === customer.id ? "selected" : ""}
                onClick={() => setCustomerId(customer.id)}
              >
                {customer.name}
              </button>
            ))}
          </div>
        )}
        {catalog && action === "Yard Received" && catalog.farms.length === 0 ? <p>Add a farm first.</p> : null}
        {catalog && action === "Shipped" && catalog.customers.length === 0 ? <p>Add a customer first.</p> : null}
      </section>

      <section className="adjust-section">
        <h2>Size</h2>
        <div className="choice-grid">
          {(catalog?.sizes || []).map((size) => (
            <button key={size.id} type="button" className={sizeId === size.id ? "selected" : ""} onClick={() => setSizeId(size.id)}>
              <SizeNameChip name={size.name} color={size.color} />
            </button>
          ))}
        </div>
      </section>

      <section className="adjust-section">
        <h2>Grade</h2>
        <div className="choice-grid">
          {(catalog?.grades || []).map((grade) => (
            <button key={grade.id} type="button" className={gradeId === grade.id ? "selected" : ""} onClick={() => setGradeId(grade.id)}>
              {grade.name}
            </button>
          ))}
        </div>
        {action === "Yard Received" && pileName ? (
          <p>Yard counts of {selectedGrade?.name} draw from the {pileName} pile, the same way a tap does.</p>
        ) : null}
      </section>

      <section className="adjust-section">
        <h2>How many</h2>
        {status ? <p>{status.detail}</p> : ready ? <p>Checking the current count…</p> : <p>Choose the place, size, and grade first.</p>}
        <div className="adjust-amount" aria-live="polite">{digits || "—"}</div>
        <AmountPad value={digits} onChange={setDigits} disabled={Boolean(pending) || Boolean(voidId)} />
        <div className="adjust-actions">
          <button className="btn gold" type="button" disabled={!ready || !amountOk || Boolean(statusError) || busy} onClick={() => void ask("add")}>
            Add
          </button>
          <button className="btn danger" type="button" disabled={!ready || !amountOk || Boolean(statusError) || busy} onClick={() => void ask("remove")}>
            Take away
          </button>
        </div>
      </section>

      <section className="adjust-section">
        <h2>Recent adjustments</h2>
        {recent.length === 0 ? <p>None yet.</p> : null}
        {recent.length > 0 ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Change</th>
                  <th>Where</th>
                  <th>Size</th>
                  <th>Grade</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.countId} style={{ opacity: row.voidedAt ? 0.55 : 1 }}>
                    <td>{row.timestamp}</td>
                    <td>
                      {row.adjustmentDirection === "remove" ? "Take away" : "Add"} {Math.abs(row.quantity)}
                      <div>{row.action}</div>
                    </td>
                    <td>{row.farmName || row.customerName || ""}</td>
                    <td>{row.sizeName}</td>
                    <td>{row.gradeName}</td>
                    <td>{row.adjustedByName || ""}</td>
                    <td>
                      {row.voidedAt ? (
                        "Voided"
                      ) : (
                        <button className="btn danger" type="button" onClick={() => setVoidId(row.countId)}>
                          Void
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {pending ? (
        <ConfirmDialog
          title={pending.plan.summary || "Save this adjustment?"}
          body={pending.plan.detail}
          confirmLabel={pending.direction === "add" ? "Add them" : "Take them away"}
          danger={pending.direction === "remove"}
          busy={busy}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
          onConfirm={() => void commit()}
        />
      ) : null}
      {voidId ? (
        <ConfirmDialog
          title="Void this adjustment?"
          body="It will drop out of the totals, the same way a voided tap does. Cancel leaves it in place."
          confirmLabel="Void adjustment"
          danger
          busy={busy}
          onCancel={() => {
            if (!busy) setVoidId(null);
          }}
          onConfirm={() => void confirmVoid()}
        />
      ) : null}
    </AdminShell>
  );
}
