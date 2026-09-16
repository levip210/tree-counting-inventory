import { AdminShell } from "@/components/AdminShell";

export default function BackupsPage() {
  return (
    <AdminShell title="Backups">
      <p>CSV / JSON downloads of operational data. Password hashes, PIN hashes, PIN keys, and Excel API key hashes are never included.</p>
      <div className="row">
        <a className="btn gold" href="/api/admin/backup?table=json">Full JSON backup</a>
        <a className="btn cream" href="/api/admin/backup?table=counts">Counts CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=farms">Farms CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=sizes">Sizes CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=grades">Grades CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=sessions">Sessions CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=startingInventory">Starting inventory CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=counterAccounts">Counter accounts CSV</a>
        <a className="btn cream" href="/api/admin/backup?table=adminAccounts">Admin accounts CSV</a>
      </div>
    </AdminShell>
  );
}
