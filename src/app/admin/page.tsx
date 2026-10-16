import { Suspense } from "react";
import AdminDashboard from "./DashboardClient";

export default function Page() {
  return (
    <Suspense fallback={<div className="screen">Loading admin…</div>}>
      <AdminDashboard />
    </Suspense>
  );
}
