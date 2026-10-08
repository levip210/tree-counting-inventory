"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Keypad } from "@/components/Keypad";
import { api } from "@/lib/client";

export default function LoginClient() {
  const router = useRouter();
  const [mode, setMode] = useState<"pin" | "email">("pin");
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submitPin() {
    if (!pin) {
      setError("Login failed.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/pin", { method: "POST", body: JSON.stringify({ pin }) });
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  async function submitEmail(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
      router.push("/home");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(640px, 100%)" }}>
        <p className="brand-kicker">Lansing, NC · Wholesale Fraser Fir</p>
        <h1 className="brand-title">Powers Tree Farm</h1>
        <p className="brand-sub">Tree counting for the loading yard. Landscape tablet first.</p>
        <div className="panel" style={{ marginTop: 22 }}>
          <div className="row" style={{ marginBottom: 16 }}>
            <button className={`btn ${mode === "pin" ? "gold" : "cream"}`} type="button" onClick={() => setMode("pin")}>
              Numeric keypad
            </button>
            <button className={`btn ${mode === "email" ? "gold" : "cream"}`} type="button" onClick={() => setMode("email")}>
              Admin email & password
            </button>
          </div>
          {error ? <div className="alert error">{error}</div> : null}
          {mode === "pin" ? (
            <>
              <p>Counters use a numeric PIN. Admins can also use an optional Quick Login PIN. A blank PIN never logs anyone in.</p>
              <div className="pin-dots">{pin ? "•".repeat(pin.length) : " "}</div>
              <Keypad value={pin} onChange={setPin} onSubmit={() => void submitPin()} disabled={busy} />
            </>
          ) : (
            <form onSubmit={submitEmail}>
              <p>If a Quick Login PIN is forgotten or not set, sign in here. This is also how account recovery works.</p>
              <label className="field"><span>Email</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
              <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
              <button className="btn gold" type="submit" disabled={busy}>Sign in</button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
