import { NextResponse } from "next/server";
import { setupLocked } from "@/server/setup";
import { ensureSqlite, getSettings } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  await ensureSqlite();
  const locked = await setupLocked();
  const settings = await getSettings();
  return NextResponse.json({
    locked,
    needsSetup: !locked,
    soundEnabled: settings.soundEnabled,
    vibrationEnabled: settings.vibrationEnabled,
  });
}
