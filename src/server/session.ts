import { createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE_NAME = "session";

// Thrown when signing is impossible; the login route turns it into a plain message (the setting name stays in the log).
export class SessionUnavailable extends Error {}

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new SessionUnavailable("SESSION_SECRET is not set (put it in .env.local)");
  return s;
}

const mac = (value: string) => createHmac("sha256", secret()).update(value).digest("base64url");

// A login lasts 8 hours, then the person signs in again.
export const SESSION_MAX_AGE_S = 8 * 60 * 60;

// Cookie value is "<userId>.<expiresAtSeconds>.<hmac>"; the signature covers both, so neither the id nor the expiry can be edited.
// now is injectable so tests need no real waiting.
export function signSession(userId: number, now: number = Date.now()): string {
  const payload = `${userId}.${Math.floor(now / 1000) + SESSION_MAX_AGE_S}`;
  return `${payload}.${mac(payload)}`;
}

export function verifySession(value: string | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const [id, exp, sig, ...rest] = value.split(".");
  if (!id || !exp || !sig || rest.length) return null;
  const expected = Buffer.from(mac(`${id}.${exp}`));
  const got = Buffer.from(sig);
  // timingSafeEqual compares in constant time; it throws on unequal lengths, hence the length check first.
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  if (!(Number(exp) > now / 1000)) return null; // expired
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
  return `${COOKIE_NAME}=${signSession(userId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_S}${secure}`;
}

// Same name, path and flags as sessionCookie, with an empty value that expired in the past, so the browser drops it.
export function clearedSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secure}`;
}
