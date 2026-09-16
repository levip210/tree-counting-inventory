import { AdminShell } from "@/components/AdminShell";
import { CategoryManager } from "@/components/CategoryManager";
import { SUGGESTED_SIZES } from "@/lib/constants";

export default function SizesPage() {
  return (
    <AdminShell title="Tree sizes">
      <CategoryManager kind="size" title="Size" suggested={[...SUGGESTED_SIZES]} />
    </AdminShell>
  );
}
