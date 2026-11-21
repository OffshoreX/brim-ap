import { getDb } from "@/server/db";
import { personaPickerEnabled } from "@/server/login";

// Feeds the demo persona picker only (fake users). Hidden (404) unless DEMO_PERSONA_PICKER=1, so it cannot be used to list accounts.
export const GET = () =>
  personaPickerEnabled()
    ? Response.json({ users: getDb().prepare("SELECT id, name, role FROM users ORDER BY id").all() })
    : Response.json({ error: "Not found" }, { status: 404 });
