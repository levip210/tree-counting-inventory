"use client";

const TIME_ZONE = "America/New_York";

function formatUpdated(at: Date): string {
  const clock = at.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone: TIME_ZONE,
  });
  return `Updated ${clock}`;
}

export function AdminRefresh({
  onRefresh,
  busy,
  updatedAt,
}: {
  onRefresh: () => void;
  busy: boolean;
  updatedAt: Date | null;
}) {
  return (
    <div className="admin-refresh" role="group" aria-label="Refresh counts" aria-busy={busy}>
      <button className="btn gold" type="button" onClick={onRefresh} disabled={busy}>
        {busy ? "Refreshing…" : "Refresh"}
      </button>
      <span className="admin-refresh-time" aria-live="polite">
        {busy ? "Fetching latest counts…" : updatedAt ? formatUpdated(updatedAt) : "Not loaded yet"}
      </span>
    </div>
  );
}
