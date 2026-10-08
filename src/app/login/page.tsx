import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { setupLocked } from "@/server/setup";
import LoginClient from "./LoginClient";

export default async function LoginPage() {
  if (!(await setupLocked())) redirect("/setup");
  const session = await getSession();
  if (session) redirect("/home");
  return <LoginClient />;
}
