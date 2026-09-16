"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";

type Me = { role: "admin" | "counter"; access: string; name: string };

export default function HomePage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    api<Me>("/api/auth/me")
      .then(setMe)
      .catch(() => router.push("/login"));
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const canYard = me?.role === "admin" || me?.access === "yard" || me?.access === "both";
  const canShip = me?.role === "admin" || me?.access === "shipping" || me?.access === "both";

  return (
    <div className="screen">
      <p className="brand-kicker">Powers Tree Farm · Lansing, NC</p>
      <h1 className="brand-title">Count trees</h1>
      <p className="brand-sub">Wholesale Fraser Fir · loading yard receiving and shipping. Signed in as {me?.name || "…"}.</p>
      <div className="home-grid">
        {canYard ? (
          <button className="giant pine" type="button" onClick={() => router.push("/receiving")}>
            <b>Yard Receiving</b>
            <span>Trees arriving at the loading yard. Choose a farm, then tap.</span>
          </button>
        ) : null}
        {canShip ? (
          <button className="giant" type="button" onClick={() => router.push("/shipping")}>
            <b>Shipping</b>
            <span>Trees leaving the loading yard. No farm or customer needed.</span>
          </button>
        ) : null}
        {me?.role === "admin" ? (
          <button className="giant cream span-all" type="button" onClick={() => router.push("/admin")}>
            <b>Admin</b>
            <span>Farms, sizes, grades, counters, history, Excel export, backups.</span>
          </button>
        ) : null}
        <button className="giant muted span-all" type="button" onClick={() => void logout()}>
          <b>Logout</b>
          <span>Return to the keypad. Counts already saved stay in the database.</span>
        </button>
      </div>
    </div>
  );
}
