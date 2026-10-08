import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, readSessionToken } from "./lib/session-edge";

const PUBLIC_PREFIXES = [
  "/login",
  "/setup",
  "/offline",
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
  "/icons/",
  "/api/setup",
  "/api/auth/login",
  "/api/auth/pin",
  "/api/auth/logout",
  "/api/export/public",
  "/api/health",
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p.endsWith("/") ? p : `${p}`));
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/_next") || pathname.includes(".")) {
    if (pathname.startsWith("/api/")) {
      // continue
    } else if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/icons/") ||
      pathname === "/sw.js" ||
      pathname === "/manifest.json" ||
      pathname === "/favicon.ico"
    ) {
      return NextResponse.next();
    }
  }

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const token = req.cookies.get(COOKIE_NAME)?.value;
  const session = token ? await readSessionToken(token) : null;

  if (pathname.startsWith("/admin") || pathname.startsWith("/api/admin")) {
    if (!session || session.role !== "admin") {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Admin sign-in required." }, { status: 401 });
      }
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Sign-in required." }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/receiving") && session.role === "counter" && session.access === "shipping") {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }
  if (pathname.startsWith("/shipping") && session.role === "counter" && session.access === "yard") {
    const url = req.nextUrl.clone();
    url.pathname = "/home";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
