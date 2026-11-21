import { getDb } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { COOKIE_NAME, signSession } from "@/server/session";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const user = getDb().prepare("SELECT id, name, role FROM users WHERE id = ?").get(body?.userId) as
    | { id: number; name: string; role: string }
    | undefined;
  if (!user) return Response.json({ error: "Unknown user" }, { status: 400 });

  writeAudit({ actorId: user.id, action: "login", entity: "user", entityId: user.id, after: { role: user.role } });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { user },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=${signSession(user.id)}; HttpOnly; SameSite=Lax; Path=/${secure}` } }
  );
}
