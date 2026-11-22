// The ONLY place roles are checked. Routes call requireRole; the UI never decides.
import type { Role, User } from "@/contracts";
import { getDb } from "./db";
import { checkOrigin } from "./security";
import { COOKIE_NAME, readCookie, verifySession } from "./session";

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 413 | 429, message: string) {
    super(message);
  }
}

// Throws 401 (no/invalid cookie or unknown user) or 403 (role not allowed).
export function requireRole(request: Request, allowedRoles: readonly Role[]): User {
  checkOrigin(request); // a cross-site write is refused before anything else, signed in or not
  const id = verifySession(readCookie(request, COOKIE_NAME));
  if (id === null) throw new HttpError(401, "Not signed in");
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as (User & { status?: string; password_hash?: string | null }) | undefined; // status is not in the contracts User type
  // A terminated user's old cookie must stop working at once, so status is read from the DB on every call.
  if (!user || user.status === "terminated") throw new HttpError(401, "Not signed in");
  delete user.password_hash; // /api/me returns this object, so the hash must never leave here
  if (!allowedRoles.includes(user.role)) throw new HttpError(403, "Forbidden");
  return user;
}

// Turns a thrown HttpError into a JSON response; works for sync and async route code.
// Anything else is a real bug: the details go to the server log only, the caller gets a plain 500
// (no stack, SQL or file path).
export async function handle(fn: () => Response | Promise<Response>): Promise<Response> {
  const res = await run(fn);
  res.headers.set("Cache-Control", "no-store"); // every API answer is per-user; nothing may sit in a browser or proxy cache
  return res;
}

async function run(fn: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    console.error("API error:", e);
    return Response.json({ error: "Something went wrong" }, { status: 500 });
  }
}
