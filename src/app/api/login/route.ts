import { handle } from "@/server/authz";
import { getDb } from "@/server/db";
import { checkOrigin } from "@/server/security";
import { writeAudit } from "@/server/audit";
import { attemptLogin, clientIp, personaPickerEnabled } from "@/server/login";
import { sessionCookie } from "@/server/session";

export const POST = (request: Request) =>
  handle(() => {
    checkOrigin(request); // login is public, so this is the only guard against a cross-site login
    return login(request);
  });

async function login(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Expected a JSON object" }, { status: 400 });

  // Old demo path: body { userId }. Off (404, as if it did not exist) unless DEMO_PERSONA_PICKER=1.
  if ("userId" in body) return personaLogin(body.userId);

  if (typeof body.email !== "string" || typeof body.password !== "string" || !body.email || !body.password || body.password.length > 1024)
    return Response.json({ error: "email and password are required" }, { status: 400 });
  const r = attemptLogin({ email: body.email, password: body.password, ip: clientIp(request) });
  if (r.status !== 200) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ user: r.user }, { headers: { "Set-Cookie": sessionCookie(r.user.id) } });
}

function personaLogin(userId: unknown) {
  if (!personaPickerEnabled()) return Response.json({ error: "Not found" }, { status: 404 });
  // Reject anything that is not an integer userId, so bad input is a 400, never a 500.
  if (!Number.isInteger(userId)) return Response.json({ error: "userId must be an integer" }, { status: 400 });
  const user = getDb().prepare("SELECT id, name, role, status FROM users WHERE id = ?").get(userId) as
    | { id: number; name: string; role: string; status: string }
    | undefined;
  if (!user) return Response.json({ error: "Unknown user" }, { status: 400 });
  if (user.status === "terminated") return Response.json({ error: "Account is terminated" }, { status: 403 });

  writeAudit({ actorId: user.id, action: "login", entity: "user", entityId: user.id, after: { role: user.role } });
  return Response.json({ user: { id: user.id, name: user.name, role: user.role } }, { headers: { "Set-Cookie": sessionCookie(user.id) } });
}
