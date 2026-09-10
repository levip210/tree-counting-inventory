"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

export default function SetupClient() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/api/setup", { method: "POST", body: JSON.stringify({ name, email, password }) });
      router.push("/admin?welcome=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="screen" style={{ display: "grid", placeItems: "center" }}>
      <form className="panel" style={{ width: "min(560px, 100%)" }} onSubmit={onSubmit}>
        <p className="brand-kicker" style={{ color: "#2a6b48" }}>Powers Tree Farm · Lansing, NC</p>
        <h1>First administrator setup</h1>
        <p>Create the only public admin account. After this, this page is permanently disabled. Later visitors cannot create themselves as admin.</p>
        {error ? <div className="alert error">{error}</div> : null}
        <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Secure password</span><input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} required /></label>
        <p style={{ color: "#5c5648" }}>Use at least 10 characters with letters and numbers. Keep this email and password — they are required for normal admin login and account recovery.</p>
        <button className="btn gold" type="submit" disabled={busy}>{busy ? "Creating…" : "Create administrator"}</button>
      </form>
    </div>
  );
}
