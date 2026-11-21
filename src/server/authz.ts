// The ONLY place roles are checked. Routes call requireRole; the UI never decides.
import type { Role, User } from "@/contracts";
import { getDb } from "./db";
import { COOKIE_NAME, readCookie, verifySession } from "./session";

export class HttpError extends Error {
  constructor(public status: 401 | 403, message: string) {
    super(message);
  }
}

// Throws 401 (no/invalid cookie or unknown user) or 403 (role not allowed).
export function requireRole(request: Request, allowedRoles: readonly Role[]): User {
  const id = verifySession(readCookie(request, COOKIE_NAME));
  if (id === null) throw new HttpError(401, "Not signed in");
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
  if (!user) throw new HttpError(401, "Not signed in");
  if (!allowedRoles.includes(user.role)) throw new HttpError(403, "Forbidden");
  return user;
}

// Turns a thrown HttpError into a JSON response; anything else is a real bug, rethrow.
export function handle(fn: () => Response): Response {
  try {
    return fn();
  } catch (e) {
    if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
