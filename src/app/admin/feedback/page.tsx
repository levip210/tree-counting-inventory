"use client";

import { useEffect, useState } from "react";
import { AdminShell } from "@/components/AdminShell";
import { api } from "@/lib/client";
import { playFeedback } from "@/lib/feedback";

export default function FeedbackPage() {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api<{ soundEnabled: boolean; vibrationEnabled: boolean }>("/api/admin/dashboard")
      .then((d) => {
        setSoundEnabled(d.soundEnabled);
        setVibrationEnabled(d.vibrationEnabled);
      })
      .catch((e) => setMsg(e.message));
  }, []);

  async function save(next: { soundEnabled?: boolean; vibrationEnabled?: boolean }) {
    await api("/api/admin/settings", { method: "POST", body: JSON.stringify(next) });
    setMsg("Saved.");
  }

  return (
    <AdminShell title="Sound, vibration, and tests">
      <p>Every successful tap should beep, vibrate when the tablet supports it, flash green, and bump totals. A failed save uses a warning sound, red flash, and “Count not saved — tap again”.</p>
      {msg ? <div className="alert ok">{msg}</div> : null}
      <label className="field">
        <span><input type="checkbox" checked={soundEnabled} onChange={(e) => { setSoundEnabled(e.target.checked); void save({ soundEnabled: e.target.checked }); }} /> Sound on</span>
      </label>
      <label className="field">
        <span><input type="checkbox" checked={vibrationEnabled} onChange={(e) => { setVibrationEnabled(e.target.checked); void save({ vibrationEnabled: e.target.checked }); }} /> Vibration on</span>
      </label>
      <div className="row">
        <button className="btn gold" type="button" onClick={() => playFeedback(true, true, true)}>Test success beep / vibrate</button>
        <button className="btn danger" type="button" onClick={() => playFeedback(false, true, true)}>Test failed-save warning</button>
      </div>
      <h3>Offline counting test</h3>
      <ol>
        <li>Open Yard Receiving or Shipping on this tablet.</li>
        <li>Turn on airplane mode.</li>
        <li>Tap several size/grade buttons. Totals should still move, with a Pending sync number.</li>
        <li>Turn the network back on. Pending should drop as counts upload. Tapping again must not duplicate already-synced counts.</li>
      </ol>
    </AdminShell>
  );
}
