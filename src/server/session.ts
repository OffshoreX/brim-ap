import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "session";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set (put it in .env.local)");
  return s;
}

const mac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

// Cookie value is "<userId>.<hmac>"; tampering with the id breaks the signature.
export function signSession(userId: number): string {
  return `${userId}.${mac(String(userId))}`;
}

export function verifySession(value: string | undefined): number | null {
  if (!value) return null;
  const [id, sig, ...rest] = value.split(".");
  if (!id || !sig || rest.length) return null;
  const expected = Buffer.from(mac(id));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  const n = Number(id);
  return Number.isInteger(n) ? n : null;
}

export function readCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
}

// One Set-Cookie value for every way of logging in.
export function sessionCookie(userId: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${signSession(userId)}; HttpOnly; SameSite=Lax; Path=/${secure}`;
}

// Same name, path and flags as sessionCookie, with an empty value that expired in the past, so the browser drops it.
export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
