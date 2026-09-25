import { SignJWT, jwtVerify } from "jose";
import type { CounterAccess, Role } from "./constants";
import { getAuthSecret } from "./secret";

export const COOKIE_NAME = "ptf_session";

export type SessionPayload = {
  role: Role;
  adminId?: string;
  counterId?: string;
  access: CounterAccess | "admin";
  name: string;
};

function secretKey() {
  return new TextEncoder().encode(getAuthSecret());
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("18h")
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    if (payload.role !== "admin" && payload.role !== "counter") return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}
