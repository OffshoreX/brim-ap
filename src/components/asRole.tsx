// Test helper: renders a node as if /api/me had answered with this role (the provider's context, no network).
import type { ReactNode } from "react";
import type { Role } from "@/contracts";
import { CurrentUserContext } from "./CurrentUser";

export const asRole = (role: string, node: ReactNode) => (
  <CurrentUserContext.Provider value={{ user: { id: 1, name: "T", role: role as Role } as never, role: role as Role }}>{node}</CurrentUserContext.Provider>
);
