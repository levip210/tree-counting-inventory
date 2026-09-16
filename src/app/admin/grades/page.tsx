import { AdminShell } from "@/components/AdminShell";
import { CategoryManager } from "@/components/CategoryManager";
import { SUGGESTED_GRADES } from "@/lib/constants";

export default function GradesPage() {
  return (
    <AdminShell title="Tree grades">
      <CategoryManager kind="grade" title="Grade" suggested={[...SUGGESTED_GRADES]} />
    </AdminShell>
  );
}
