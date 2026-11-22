import { getDb } from "./db";
import { writeAudit } from "./audit";
import { COOKIE_NAME, clearedSessionCookie, readCookie, verifySession } from "./session";

// Ends the session. Always succeeds: no or bad cookie just clears it and writes no audit row (nobody to attribute it to).
// The cookie is stateless, so "ended" means the browser drops it; a copied cookie stays valid until its user is terminated.
export function logout(request: Request): Response {
  const id = verifySession(readCookie(request, COOKIE_NAME));
  const exists = id !== null && getDb().prepare("SELECT 1 FROM users WHERE id = ?").get(id);
  if (exists) writeAudit({ actorId: id, action: "logout", entity: "user", entityId: id });
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookie() } });
}
