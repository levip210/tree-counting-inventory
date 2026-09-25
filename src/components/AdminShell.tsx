"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const LINKS = [
  ["/admin", "Dashboard"],
  ["/admin/farms", "Farms"],
  ["/admin/sizes", "Sizes"],
  ["/admin/grades", "Grades"],
  ["/admin/counters", "Counter access"],
  ["/admin/history", "Count history"],
  ["/admin/inventory", "Starting inventory"],
  ["/admin/export", "Excel export"],
  ["/admin/backups", "Backups"],
  ["/admin/feedback", "Sound / tests"],
  ["/admin/account", "Account"],
  ["/admin/danger", "Danger zone"],
];

export function AdminShell({ title, children }: { title: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="screen">
      <p className="brand-kicker">Powers Tree Farm · Admin</p>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 className="brand-title" style={{ fontSize: "2rem" }}>{title}</h1>
        <div className="row">
          <Link className="btn cream" href="/home">Home</Link>
          <button className="btn ghost" type="button" onClick={logout}>Logout</button>
        </div>
      </div>
      <nav className="admin-nav">
        {LINKS.map(([href, label]) => (
          <Link key={href} href={href} className={pathname === href ? "active" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="panel">{children}</div>
    </div>
  );
}

export function PasswordField({
  value,
  onChange,
  label = "Current admin password",
}: {
  value: string;
  onChange: (v: string) => void;
  label?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input type="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
