"use client";
import { createContext, useContext, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { MeResponse, Role } from "@/contracts";
import { useApi } from "./api";

// The one place the browser asks "who am I?". Header, RoleHome, the cards and every page read it from here.
// Looks only: these lists mirror the requireRole calls in src/app/api/**. The UI hides buttons for looks; the server decides.
export const CAN_DECIDE: Role[] = ["approver", "finance_manager", "controller_admin"]; // POST /api/invoices/{id}/decision
export const CAN_CLERK: Role[] = ["ap_clerk", "finance_manager", "controller_admin"]; // payments/prepare, exceptions resolve, bank-change request
export const CAN_RELEASE: Role[] = ["finance_manager", "controller_admin"]; // payments/release, bank-change verify

type Me = { user?: MeResponse["user"]; role?: Role; error?: string };
export const CurrentUserContext = createContext<Me>({});

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  // The layout stays mounted between pages, so ask again whenever the path changes (e.g. right after login).
  const path = usePathname();
  const { data, error } = useApi<MeResponse>(`/api/me?at=${encodeURIComponent(path)}`);
  return <CurrentUserContext.Provider value={{ user: data?.user, role: data?.user.role, error }}>{children}</CurrentUserContext.Provider>;
}

export const useCurrentUser = () => useContext(CurrentUserContext);
// True only once the role is known and listed, so nothing flashes in while /api/me is loading.
export const useCan = (roles: Role[]) => { const { role } = useCurrentUser(); return !!role && roles.includes(role); };
