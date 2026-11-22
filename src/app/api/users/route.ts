import { getDb } from "@/server/db";
import { personaPickerEnabled } from "@/server/login";
import { HttpError, requireRole } from "@/server/authz";
import { listUsersForAdmin } from "@/server/users";

// Controller and auditor get the full user list (role/status checked in requireRole, from the database).
// Everyone else keeps the demo persona picker feed (fake users only): 404 unless DEMO_PERSONA_PICKER=1, so it cannot be used to list accounts.
// Not wrapped in handle() (the callers read the answer synchronously), so it sets Cache-Control itself.
const NO_STORE = { "Cache-Control": "no-store" };
export const GET = (request: Request) => {
  try {
    requireRole(request, ["controller_admin", "auditor"]);
    return Response.json({ users: listUsersForAdmin() }, { headers: NO_STORE });
  } catch (e) {
    if (!(e instanceof HttpError)) throw e; // 401/403 just means "not an admin viewer"
  }
  return personaPickerEnabled()
    ? Response.json({ users: getDb().prepare("SELECT id, name, role FROM users ORDER BY id").all() }, { headers: NO_STORE })
    : Response.json({ error: "Not found" }, { status: 404, headers: NO_STORE });
};
