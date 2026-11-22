import { getDb } from "./db";
import { writeAudit } from "./audit";
import { hashPassword, verifyPassword } from "./password";
import { createLimiter, MAX_FAILURES, type Limiter } from "./loginLimiter";
import type { Role } from "@/contracts";

// Same words for wrong email, wrong password, terminated and no password set, so the answer reveals nothing.
const BAD_LOGIN = "Invalid email or password";
// Hashed once at load. Unknown emails are checked against it so every failure pays one scrypt and takes the same time.
const DUMMY_HASH = hashPassword(`not-a-real-password-${Math.random()}`);

const defaultLimiter = createLimiter();

// The old login-by-user-id path (and the user list that feeds it) exists only when this env var is "1".
export const personaPickerEnabled = () => process.env.DEMO_PERSONA_PICKER === "1";

export type LoginResult =
  | { status: 200; user: { id: number; name: string; role: Role } }
  | { status: 401 | 429; error: string };

type Row = { id: number; name: string; role: Role; status: string; password_hash: string | null };

// Email + password login. The role is never taken from the request; the caller sets a cookie holding only the user id.
export function attemptLogin(input: { email: string; password: string; ip: string }, limiter: Limiter = defaultLimiter): LoginResult {
  const email = input.email.trim().toLowerCase().slice(0, 254);
  const keys = [`email:${email}`, `ip:${input.ip}`];
  if (keys.some((k) => limiter.isLocked(k))) return { status: 429, error: "Too many failed attempts. Try again in 10 minutes." };

  const user = getDb().prepare("SELECT id, name, role, status, password_hash FROM users WHERE lower(email) = ?").get(email) as Row | undefined;
  const passwordOk = verifyPassword(input.password, user?.password_hash ?? DUMMY_HASH); // always one scrypt run
  if (user && passwordOk && user.status !== "terminated") {
    limiter.clear(keys[0]); // the IP counter stays, so one valid account cannot be used to reset it
    writeAudit({ actorId: user.id, action: "login_success", entity: "user", entityId: user.id, after: { ip: input.ip } });
    return { status: 200, user: { id: user.id, name: user.name, role: user.role } };
  }

  const outcome = !user ? "unknown_email" : user.status === "terminated" ? "terminated" : "bad_password";
  // Only log text that looks like an email: people sometimes type their password into the wrong box. The password itself is never logged.
  writeAudit({ actorId: user?.id ?? null, action: "login_failed", entity: "user", entityId: user?.id,
    after: { email: email.includes("@") ? email : "[not an email]", ip: input.ip, outcome } });
  const tripped = keys.filter((k) => limiter.fail(k) === MAX_FAILURES);
  if (tripped.length)
    writeAudit({ actorId: user?.id ?? null, action: "login_lockout", entity: "user", entityId: user?.id, after: { locked: tripped.map((k) => k.split(":")[0]), ip: input.ip } });
  return { status: 401, error: BAD_LOGIN };
}

// Client address for the per-IP limit. X-Forwarded-For is a header anyone can send, so it counts only when TRUST_PROXY=1
// (a proxy we run overwrites or appends to it). Otherwise every caller shares one key and the per-email limit still applies.
// With a proxy we take the LAST entry: that is the address our proxy saw; earlier entries are whatever the client claimed.
export const clientIp = (request: Request) =>
  process.env.TRUST_PROXY === "1" ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown" : "unknown";
