import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { setupLocked } from "@/server/setup";

export default async function RootPage() {
  const locked = await setupLocked();
  const session = await getSession();
  if (!locked) redirect("/setup");
  if (!session) redirect("/login");
  redirect("/home");
}
