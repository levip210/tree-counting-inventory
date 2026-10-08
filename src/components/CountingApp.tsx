"use client";

import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ACTIONS, DOUBLE_TAP_MS } from "@/lib/constants";
import { countGridColumns, normalizeCountHand, type CountHand } from "@/lib/count-hand";
import { api, exactLocalTimestamp, newId } from "@/lib/client";
import { allPending, cacheCatalog, pendingCount, queueCount, readCachedCatalog, removePending, type PendingCount } from "@/lib/offline";
import { playFeedback } from "@/lib/feedback";
import { ConfirmDialog } from "./ConfirmDialog";
import { SizeNameChip } from "./SizeColor";

type Cat = { id: string; name: string; displayOrder: number; active: boolean; color?: string | null };
type Farm = Cat;
type Progress = {
  farmId: string;
  sizeId: string;
  gradeId: string;
  starting: number;
  received: number;
  notYetReceived: number;
  exceeded: boolean;
  sizeName: string;
  gradeName: string;
};

type TapMeta = { key: string; size: string; grade: string; color: string | null };

type Catalog = {
  farms: Farm[];
  customers?: Farm[];
  sizes: Cat[];
  grades: Cat[];
  soundEnabled: boolean;
  vibrationEnabled: boolean;
  startingProgress: Progress[];
  countHand?: CountHand | null;
};

const PENDING_HAND = "ptf-count-hand-pending";

function readPendingHand(): CountHand | null {
  try {
    const value = sessionStorage.getItem(PENDING_HAND);
    return value === "left" || value === "right" ? value : null;
  } catch {
    return null;
  }
}

export function CountingApp({ mode }: { mode: "yard" | "shipping" }) {
  const router = useRouter();
  const action = mode === "yard" ? ACTIONS.YARD : ACTIONS.SHIP;
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [farm, setFarm] = useState<Farm | null>(null);
  const [customer, setCustomer] = useState<Farm | null>(null);
  const [customerQuery, setCustomerQuery] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<string>("");
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [sessionTotal, setSessionTotal] = useState(0);
  const [last, setLast] = useState<{ size: string; grade: string; color: string | null } | null>(null);
  const [online, setOnline] = useState(true);
  const [pending, setPending] = useState(0);
  const [flashKey, setFlashKey] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<"ok" | "bad" | null>(null);
  const [failMsg, setFailMsg] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmFarm, setConfirmFarm] = useState(false);
  const [confirmCustomer, setConfirmCustomer] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [sound, setSound] = useState(true);
  const [vibe, setVibe] = useState(true);
  const [hand, setHand] = useState<CountHand>("right");
  const lastTap = useRef<Record<string, number>>({});
  const undoStack = useRef<string[]>([]);
  const syncing = useRef(false);
  const appliedRef = useRef<Map<string, TapMeta>>(new Map());
  const heldRef = useRef<Map<string, TapMeta>>(new Map());
  const noticeTimer = useRef<number | null>(null);
  const handSave = useRef(0);

  const storageKey = `ptf-${mode}`;

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  useEffect(() => {
    const cached = readCachedCatalog<Catalog>();
    if (cached) {
      setCatalog(cached);
      setSound(cached.soundEnabled);
      setVibe(cached.vibrationEnabled);
      setHand(readPendingHand() ?? normalizeCountHand(cached.countHand));
    }
    api<Catalog>("/api/catalog")
      .then((c) => {
        setCatalog(c);
        setSound(c.soundEnabled);
        setVibe(c.vibrationEnabled);
        cacheCatalog(c);
        const pending = readPendingHand();
        if (pending && pending !== normalizeCountHand(c.countHand)) {
          setHand(pending);
          void persistHand(pending);
        } else {
          setHand(normalizeCountHand(c.countHand));
          try {
            sessionStorage.removeItem(PENDING_HAND);
          } catch {
            /* private mode */
          }
        }
      })
      .catch(() => undefined);
    pendingCount().then(setPending);
  }, []);

  useEffect(() => {
    if (!online) return;
    void flush();
  }, [online]);

  const sizes = catalog?.sizes || [];
  const grades = catalog?.grades || [];

  function cellKey(sizeId: string, gradeId: string) {
    return `${sizeId}|${gradeId}`;
  }

  function farmCarries(farmId: string, sizeId: string, gradeId: string) {
    return (catalog?.startingProgress || []).some(
      (row) => row.farmId === farmId && row.sizeId === sizeId && row.gradeId === gradeId,
    );
  }

  function startSession(nextFarm: Farm | null, nextCustomer: Farm | null = null) {
    const id = newId();
    const ts = new Date().toISOString();
    setSessionId(id);
    setStartedAt(ts);
    setTotals({});
    setSessionTotal(0);
    setLast(null);
    undoStack.current = [];
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ id, ts, farmId: nextFarm?.id || null, customerId: nextCustomer?.id || null }),
    );
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        action,
        farmId: nextFarm?.id || null,
        farmName: nextFarm?.name || null,
        customerId: nextCustomer?.id || null,
        customerName: nextCustomer?.name || null,
        startedAt: ts,
      }),
    });
  }

  async function persistHand(next: CountHand) {
    const ticket = ++handSave.current;
    try {
      sessionStorage.setItem(PENDING_HAND, next);
    } catch {
      /* private mode */
    }
    try {
      await api("/api/auth/me", { method: "PATCH", body: JSON.stringify({ countHand: next }) });
      if (handSave.current !== ticket) return;
      try {
        sessionStorage.removeItem(PENDING_HAND);
      } catch {
        /* private mode */
      }
      setCatalog((current) => {
        if (!current) return current;
        const updated = { ...current, countHand: next };
        cacheCatalog(updated);
        return updated;
      });
    } catch {
      if (handSave.current !== ticket) return;
      showNotice("Couldn't save hand preference yet. It will retry.");
    }
  }

  function toggleHand() {
    const next: CountHand = hand === "left" ? "right" : "left";
    setHand(next);
    void persistHand(next);
  }

  function showNotice(message: string) {
    setFailMsg("");
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 2200);
  }

  function applyLiveTap(id: string, meta: TapMeta) {
    if (appliedRef.current.has(id)) return;
    heldRef.current.delete(id);
    appliedRef.current.set(id, meta);
    undoStack.current.push(id);
    setTotals((t) => ({ ...t, [meta.key]: (t[meta.key] || 0) + 1 }));
    setSessionTotal((n) => n + 1);
    setLast({ size: meta.size, grade: meta.grade, color: meta.color });
  }

  function revertLiveTap(id: string) {
    const meta = appliedRef.current.get(id);
    if (!meta) return;
    appliedRef.current.delete(id);
    undoStack.current = undoStack.current.filter((saved) => saved !== id);
    setTotals((t) => ({ ...t, [meta.key]: Math.max(0, (t[meta.key] || 0) - 1) }));
    setSessionTotal((n) => Math.max(0, n - 1));
  }

  function reconcileAccepted(accepted: { clientSyncId: string; miscount?: boolean }[]) {
    let intercepted = false;
    for (const row of accepted) {
      if (row.miscount) {
        if (appliedRef.current.has(row.clientSyncId)) {
          revertLiveTap(row.clientSyncId);
          intercepted = true;
        }
        heldRef.current.delete(row.clientSyncId);
        continue;
      }
      const held = heldRef.current.get(row.clientSyncId);
      if (held) applyLiveTap(row.clientSyncId, held);
    }
    if (intercepted) showNotice("Not on this farm — saved for review");
  }

  async function flush() {
    if (syncing.current) return;
    syncing.current = true;
    try {
      const pendingRows = await allPending();
      if (pendingRows.length === 0) {
        setPending(0);
        return;
      }
      const res = await fetch("/api/counts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ counts: pendingRows }),
      });
      const data = await res.json().catch(() => ({}));
      const accepted = (data.accepted || []) as { clientSyncId: string; miscount?: boolean }[];
      const rejected = (data.rejected || []) as { error?: string }[];
      reconcileAccepted(accepted);
      await removePending(accepted.map((a) => a.clientSyncId));
      setPending(await pendingCount());
      if (rejected.length > 0) {
        setNotice("");
        setFailMsg(rejected[0]?.error || "Count not saved — tap again");
        window.setTimeout(() => setFailMsg(""), 2200);
      }
    } catch {
      setPending(await pendingCount());
    } finally {
      syncing.current = false;
    }
  }

  function flash(ok: boolean, key?: string) {
    setOverlay(ok ? "ok" : "bad");
    if (key) setFlashKey(key);
    playFeedback(ok, sound, vibe);
    window.setTimeout(() => {
      setOverlay(null);
      setFlashKey(null);
    }, 220);
  }

  function ensureSession(): { id: string; started: string } {
    if (sessionId && startedAt) return { id: sessionId, started: startedAt };
    const id = newId();
    const ts = new Date().toISOString();
    setSessionId(id);
    setStartedAt(ts);
    const nextCustomer = mode === "shipping" ? customer : null;
    const nextFarm = mode === "yard" ? farm : null;
    sessionStorage.setItem(
      storageKey,
      JSON.stringify({ id, ts, farmId: nextFarm?.id || null, customerId: nextCustomer?.id || null }),
    );
    void fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        action,
        farmId: nextFarm?.id || null,
        farmName: nextFarm?.name || null,
        customerId: nextCustomer?.id || null,
        customerName: nextCustomer?.name || null,
        startedAt: ts,
      }),
    });
    return { id, started: ts };
  }

  async function tap(size: Cat, grade: Cat) {
    if (mode === "yard" && !farm) return;
    if (mode === "shipping" && !customer) return;
    const { id: sid, started } = ensureSession();

    const key = cellKey(size.id, grade.id);
    const now = Date.now();
    if (now - (lastTap.current[key] || 0) < DOUBLE_TAP_MS) return;
    lastTap.current[key] = now;

    const count: PendingCount = {
      clientSyncId: newId(),
      timestampLocal: exactLocalTimestamp(),
      action,
      farmId: mode === "yard" ? farm?.id : null,
      farmName: mode === "yard" ? farm?.name : null,
      customerId: mode === "shipping" ? customer?.id : null,
      customerName: mode === "shipping" ? customer?.name : null,
      sizeId: size.id,
      sizeName: size.name,
      gradeId: grade.id,
      gradeName: grade.name,
      quantity: 1,
      sessionId: sid,
      sessionStartedAt: started,
    };

    const meta: TapMeta = { key, size: size.name, grade: grade.name, color: size.color || null };
    const onFarmList = mode !== "yard" || !farm || farmCarries(farm.id, size.id, grade.id);

    try {
      await queueCount(count);
    } catch {
      flash(false);
      setNotice("");
      setFailMsg("Count not saved — tap again");
      window.setTimeout(() => setFailMsg(""), 1800);
      return;
    }

    if (onFarmList) {
      applyLiveTap(count.clientSyncId, meta);
      flash(true, key);
    } else {
      heldRef.current.set(count.clientSyncId, meta);
      flash(false);
      showNotice("Not on this farm — saved for review");
    }
    setPending((n) => n + 1);
    void flush();
  }

  async function undo() {
    const id = undoStack.current.pop();
    if (!id) return;
    appliedRef.current.delete(id);
    heldRef.current.delete(id);
    const pendingRows = await allPending();
    const local = pendingRows.find((p) => p.clientSyncId === id);
    if (local) {
      await removePending([id]);
    } else {
      await fetch("/api/counts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientSyncId: id }),
      });
    }
    setSessionTotal((n) => Math.max(0, n - 1));
    setPending(await pendingCount());
  }

  const warnings = useMemo(() => {
    if (mode !== "yard" || !farm || !catalog) return [];
    return catalog.startingProgress.filter((p) => p.farmId === farm.id && p.exceeded);
  }, [catalog, farm, mode]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function endSession() {
    if (sessionId) {
      await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: sessionId }),
      });
    }
    sessionStorage.removeItem(storageKey);
    router.push("/home");
  }

  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => undefined);
    else document.exitFullscreen?.();
  }

  if (!catalog) {
    return (
      <div className="screen">
        <p>Loading counting grid…</p>
      </div>
    );
  }

  if (mode === "yard" && !farm) {
    return (
      <div className="screen">
        <p className="brand-kicker">Yard Receiving</p>
        <h1 className="brand-title">Select a farm</h1>
        <p className="brand-sub">A farm is required before counting. Only active farms are listed.</p>
        <div className="farm-pick" style={{ marginTop: 22 }}>
          {catalog.farms.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setFarm(f);
                startSession(f);
              }}
            >
              {f.name}
            </button>
          ))}
        </div>
        {catalog.farms.length === 0 ? <p>No active farms. Ask an admin to add one.</p> : null}
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn cream" type="button" onClick={() => router.push("/home")}>Home</button>
          <button className="btn ghost" type="button" onClick={logout}>Logout</button>
        </div>
      </div>
    );
  }

  if (mode === "shipping" && !customer) {
    const query = customerQuery.trim().toLowerCase();
    const allCustomers = catalog.customers || [];
    const customers = allCustomers.filter((row) => !query || row.name.toLowerCase().includes(query));
    return (
      <div className="screen">
        <p className="brand-kicker">Shipping</p>
        <h1 className="brand-title">Select a customer</h1>
        <p className="brand-sub">Find the customer this truck is for. Counting stays locked until you pick one.</p>
        <label className="customer-search">
          <span>Find customer</span>
          <input
            value={customerQuery}
            onChange={(e) => setCustomerQuery(e.target.value)}
            placeholder="Type a name"
            autoComplete="off"
            enterKeyHint="search"
            aria-label="Find customer"
          />
        </label>
        <div className="customer-pick" role="listbox" aria-label="Customers">
          {customers.map((row) => (
            <button
              key={row.id}
              type="button"
              role="option"
              onClick={() => {
                setCustomer(row);
                startSession(null, row);
              }}
            >
              {row.name}
            </button>
          ))}
        </div>
        {allCustomers.length === 0 ? <p>No customers yet. Ask an admin to add one.</p> : null}
        {allCustomers.length > 0 && customers.length === 0 ? <p>No customer matches that search.</p> : null}
        <div className="row" style={{ marginTop: 20 }}>
          <button className="btn cream" type="button" onClick={() => router.push("/home")}>Home</button>
          <button className="btn ghost" type="button" onClick={logout}>Logout</button>
        </div>
      </div>
    );
  }

  return (
    <div className="screen counting-screen">
      {overlay ? <div className={`flash-overlay ${overlay}`} /> : null}
      {failMsg ? <div className="toast-fail">{failMsg}</div> : null}
      {notice ? <div className="toast-miscount">{notice}</div> : null}
      <div className="status-bar">
        <div className="row">
          <span className={`pill ${online ? "" : "offline"}`}>{online ? "Online" : "Offline"}</span>
          <span className={`pill ${pending ? "pending" : ""}`}>Pending sync {pending}</span>
        </div>
        <strong>{mode === "yard" ? "Yard Receiving" : "Shipping"}</strong>
        <div className="row">
          <button
            className={`btn hand-toggle ${hand === "left" ? "gold" : "cream"}`}
            type="button"
            aria-pressed={hand === "left"}
            aria-label={hand === "left" ? "Count buttons are on the left. Switch to the right." : "Count buttons are on the right. Switch to the left."}
            onClick={toggleHand}
          >
            {hand === "left" ? "Buttons on left" : "Buttons on right"}
          </button>
          <button className="btn cream" type="button" onClick={goFullscreen}>Fullscreen</button>
        </div>
      </div>

      {mode === "yard" && farm ? (
        <div className="farm-banner">
          <div>
            <div className="brand-kicker" style={{ color: "inherit" }}>Counting farm</div>
            <strong>{farm.name}</strong>
          </div>
          <button className="btn pine" type="button" onClick={() => setConfirmFarm(true)} style={{ background: "#21543a" }}>
            Change farm
          </button>
        </div>
      ) : null}

      {mode === "shipping" && customer ? (
        <div className="farm-banner">
          <div>
            <div className="brand-kicker" style={{ color: "inherit" }}>Counting for</div>
            <strong>{customer.name}</strong>
          </div>
          <button className="btn pine" type="button" onClick={() => setConfirmCustomer(true)} style={{ background: "#21543a" }}>
            Change customer
          </button>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="alert warn">
          Received exceeds starting inventory for: {warnings.map((w) => `${w.sizeName} ${w.gradeName}`).join(", ")}
        </div>
      ) : null}

      <div className="last-count">
        <div className="row" style={{ gap: 8 }}>
          Last counted:
          {last ? (
            <>
              <SizeNameChip name={last.size} color={last.color} compact />
              <b>{last.grade}</b>
            </>
          ) : (
            <b>—</b>
          )}
        </div>
        <div>Visible session total: <b>{sessionTotal}</b></div>
      </div>

      {sizes.length === 0 || grades.length === 0 ? (
        <div className="alert info">Ask an admin to add active sizes and grades. The counting grid is the cartesian product of those lists.</div>
      ) : (
        <div className={`count-wrap hand-${hand}`} data-count-hand={hand}>
          <div
            className="count-grid"
            style={{ gridTemplateColumns: countGridColumns(hand, grades.length) } as CSSProperties}
          >
            {hand === "right" ? <div className="count-corner" aria-hidden /> : null}
            {grades.map((g) => (
              <div key={g.id} className="grade-head">
                {g.name}
              </div>
            ))}
            {hand === "left" ? <div className="count-corner" aria-hidden /> : null}
            {sizes.map((s) => (
              <Fragment key={s.id}>
                {hand === "right" ? (
                  <div className="size-lab">
                    <SizeNameChip name={s.name} color={s.color} />
                  </div>
                ) : null}
                {grades.map((g) => {
                  const key = cellKey(s.id, g.id);
                  return (
                    <button
                      key={g.id}
                      type="button"
                      className={`count-btn ${s.color ? "has-size-color" : ""} ${flashKey === key ? "flash" : ""}`}
                      style={s.color ? ({ "--size-color": s.color } as CSSProperties) : undefined}
                      aria-label={`${s.name} ${g.name}, count ${totals[key] || 0}`}
                      onPointerDown={(e) => {
                        e.preventDefault();
                        void tap(s, g);
                      }}
                    >
                      <span className="qty">{totals[key] || 0}</span>
                      <small className="count-fit">
                        {s.name} {g.name}
                      </small>
                    </button>
                  );
                })}
                {hand === "left" ? (
                  <div className="size-lab">
                    <SizeNameChip name={s.name} color={s.color} />
                  </div>
                ) : null}
              </Fragment>
            ))}
          </div>
        </div>
      )}

      <div className="session-bar">
        <button className="btn cream" type="button" onClick={() => void undo()}>Undo last</button>
        <button className="btn cream" type="button" onClick={() => { setTotals({}); setSessionTotal(0); setLast(null); }}>
          Reset visible totals
        </button>
        <button className="btn cream" type="button" onClick={() => startSession(mode === "yard" ? farm : null, mode === "shipping" ? customer : null)}>Start counting</button>
        <button className="btn gold" type="button" onClick={() => setEndOpen(true)}>End session</button>
        <button className="btn ghost" type="button" onClick={logout}>Logout</button>
      </div>

      {confirmFarm ? (
        <ConfirmDialog
          title="Change farm?"
          body="Visible session totals will reset. Saved counts stay in the database."
          confirmLabel="Change farm"
          onCancel={() => setConfirmFarm(false)}
          onConfirm={() => {
            setConfirmFarm(false);
            setFarm(null);
            setSessionId(null);
          }}
        />
      ) : null}
      {confirmCustomer ? (
        <ConfirmDialog
          title="Change customer?"
          body="Visible session totals will reset. Saved counts stay with the customer they were counted for."
          confirmLabel="Change customer"
          onCancel={() => setConfirmCustomer(false)}
          onConfirm={() => {
            setConfirmCustomer(false);
            setCustomer(null);
            setCustomerQuery("");
            setSessionId(null);
          }}
        />
      ) : null}
      {endOpen ? (
        <ConfirmDialog
          title="End this session?"
          body="This closes the current counting session on this tablet. Saved counts are kept."
          confirmLabel="End session"
          onCancel={() => setEndOpen(false)}
          onConfirm={() => void endSession()}
        />
      ) : null}
    </div>
  );
}
