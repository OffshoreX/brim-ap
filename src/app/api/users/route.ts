import { getDb } from "@/server/db";

// Public on purpose: feeds the demo login dropdown (fake users only).
export const GET = () =>
  Response.json({ users: getDb().prepare("SELECT id, name, role FROM users ORDER BY id").all() });
