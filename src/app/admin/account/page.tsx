"use client";

import { useEffect, useState } from "react";
import { AdminShell, PasswordField } from "@/components/AdminShell";
import { api } from "@/lib/client";

export default function AccountPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [hasPin, setHasPin] = useState(false);
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const data = await api<{ admin: { name: string; email: string; hasPin: boolean } }>("/api/admin/me");
    setName(data.admin.name);
    setEmail(data.admin.email);
    setHasPin(data.admin.hasPin);
  }
  useEffect(() => {
    load().catch((e) => setMsg(e.message));
  }, []);

  async function setQuickPin() {
    try {
      await api("/api/admin/me", { method: "POST", body: JSON.stringify({ action: "set-pin", pin }) });
      setPin("");
      setMsg("Quick Login PIN saved. Email and password still work if you forget it.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }
  async function removePin() {
    try {
      await api("/api/admin/me", { method: "POST", body: JSON.stringify({ action: "remove-pin" }) });
      setMsg("Quick Login PIN removed.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }
  async function resetPin() {
    try {
      await api("/api/admin/me", { method: "POST", body: JSON.stringify({ action: "reset-pin", currentPassword: password }) });
      setMsg("Quick Login PIN reset. Set a new one if you want keypad login.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }
  async function changeAccount() {
    try {
      await api("/api/admin/account", {
        method: "POST",
        body: JSON.stringify({
          currentPassword: password,
          email: newEmail || undefined,
          newPassword: newPassword || undefined,
          name: name || undefined,
        }),
      });
      setNewEmail("");
      setNewPassword("");
      setMsg("Account updated.");
      await load();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <AdminShell title="Admin account">
      <p>Signed in as {name} · {email}. Quick Login PIN is {hasPin ? "on" : "off"}.</p>
      {msg ? <div className="alert info">{msg}</div> : null}

      <h3>Optional Quick Login PIN</h3>
      <p>Blank PIN means quick login is disabled. A blank PIN can never sign anyone in.</p>
      <div className="row">
        <input placeholder="New numeric PIN" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn gold" type="button" onClick={() => void setQuickPin()}>Save PIN</button>
        <button className="btn cream" type="button" onClick={() => void removePin()}>Remove PIN</button>
      </div>
      <PasswordField value={password} onChange={setPassword} />
      <button className="btn" type="button" onClick={() => void resetPin()}>Reset PIN (requires password)</button>

      <h3 style={{ marginTop: 24 }}>Change email or password</h3>
      <p>These changes require your current admin password.</p>
      <label className="field"><span>Display name</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field"><span>New email</span><input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} /></label>
      <label className="field"><span>New password</span><input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
      <button className="btn gold" type="button" onClick={() => void changeAccount()}>Save account changes</button>
    </AdminShell>
  );
}
