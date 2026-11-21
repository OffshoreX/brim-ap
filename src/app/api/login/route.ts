import { getDb } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { COOKIE_NAME, signSession } from "@/server/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  // Reject anything that is not a JSON object with an integer userId, so bad input is a 400, never a 500.
  if (!body || typeof body !== "object" || !Number.isInteger(body.userId))
    return Response.json({ error: "userId must be an integer" }, { status: 400 });
  const user = getDb().prepare("SELECT id, name, role, status FROM users WHERE id = ?").get(body.userId) as
    | { id: number; name: string; role: string; status: string }
    | undefined;
  if (!user) return Response.json({ error: "Unknown user" }, { status: 400 });
  if (user.status === "terminated") return Response.json({ error: "Account is terminated" }, { status: 403 });

  writeAudit({ actorId: user.id, action: "login", entity: "user", entityId: user.id, after: { role: user.role } });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { user: { id: user.id, name: user.name, role: user.role } },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=${signSession(user.id)}; HttpOnly; SameSite=Lax; Path=/${secure}` } }
  );
}
