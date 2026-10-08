"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AdminShell, PasswordField } from "@/components/AdminShell";
import { api } from "@/lib/client";

export default function DangerPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState("");

  async function run(action: "delete-counts" | "reset-site") {
    const phrase = action === "delete-counts" ? "DELETE COUNTS" : "RESET SITE";
    const typed = window.prompt(`Type ${phrase} to confirm.`) || "";
    if (typed !== phrase) {
      setMsg("Confirmation phrase did not match.");
      return;
    }
    try {
      const data = await api<{ message: string }>("/api/admin/danger", {
        method: "POST",
        body: JSON.stringify({ action, currentPassword: password }),
      });
      setMsg(data.message);
      if (action === "reset-site") {
        await fetch("/api/auth/logout", { method: "POST" });
        router.push("/setup");
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Failed.");
    }
  }

  return (
    <AdminShell title="Danger zone">
      <p>These actions require your full admin password. They cannot be undone from this screen — download a backup first.</p>
      {msg ? <div className="alert warn">{msg}</div> : null}
      <PasswordField value={password} onChange={setPassword} />
      <div className="row">
        <button className="btn danger" type="button" onClick={() => void run("delete-counts")}>
          Delete all counting data
        </button>
        <button className="btn danger" type="button" onClick={() => void run("reset-site")}>
          Delete website / database
        </button>
      </div>
      <p>Deleting the website/database wipes admins, counters, farms, counts, and export keys, then re-opens first-administrator setup.</p>
    </AdminShell>
  );
}
