// Shared types and API shapes. Changes go through the lead.
export const ROLES = [
  "employee",
  "ap_clerk",
  "approver",
  "finance_manager",
  "controller_admin",
  "auditor",
] as const;

export type Role = (typeof ROLES)[number];

export interface User {
  id: number;
  name: string;
  role: Role;
  manager_id: number | null;
  approval_limit_cents: number;
  province: string | null;
}

export interface ApiError {
  error: string;
}

// GET /api/me, POST /api/login (body: { userId }) and GET /api/users
export type MeResponse = { user: User };
export type UsersResponse = { users: Pick<User, "id" | "name" | "role">[] };
