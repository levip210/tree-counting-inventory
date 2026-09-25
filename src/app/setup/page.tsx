import { redirect } from "next/navigation";
import { setupLocked } from "@/server/setup";
import SetupPage from "./SetupClient";

export default async function Page() {
  if (await setupLocked()) redirect("/login");
  return <SetupPage />;
}
