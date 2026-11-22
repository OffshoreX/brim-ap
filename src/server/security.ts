import { HttpError } from "./authz";
import { createLimiter } from "./loginLimiter";

const SAFE_METHODS = ["GET", "HEAD", "OPTIONS"];

// CSRF guard for every write (POST, PUT, PATCH, DELETE). Browsers always send Origin on cross-site writes, so a
// foreign Origin is refused. No Origin means a script or curl (a browser would have sent one), which is allowed.
// We compare against the Host header, not the request URL: behind the Vite dev proxy the URL says :3000 but the browser is on :5173.
export function checkOrigin(request: Request): void {
  if (SAFE_METHODS.includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin === null) return;
  let host: string | null = null;
  try {
    host = new URL(origin).host; // the literal "null" origin (sandboxed pages) fails to parse and is refused
  } catch {}
  if (host === null || host !== (request.headers.get("host") ?? new URL(request.url).host))
    throw new HttpError(403, "Cross-site request refused");
}

// Per-user request limits for the two routes that are expensive or move money. Same in-memory limiter as login.
// ponytail: per process and lost on restart; move to a DB table if the app ever runs on several servers.
export const LIMITS = { upload: { max: 30, windowMs: 60_000 }, release: { max: 30, windowMs: 60_000 } } as const;
const limiters = { upload: createLimiter(Date.now, LIMITS.upload.max, LIMITS.upload.windowMs), release: createLimiter(Date.now, LIMITS.release.max, LIMITS.release.windowMs) };

// Counts this request, and refuses it (429) once the user has used up the window.
export function rateLimit(route: keyof typeof LIMITS, userId: number): void {
  const key = `user:${userId}`;
  if (limiters[route].isLocked(key)) throw new HttpError(429, "Too many requests. Try again in a minute.");
  limiters[route].fail(key); // "fail" is just the limiter's word for "record one hit"
}
