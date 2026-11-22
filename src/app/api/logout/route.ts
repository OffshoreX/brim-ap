import { logout } from "@/server/logout";

// Open to everyone on purpose: signing out must work even when the session is already gone.
export const POST = (request: Request) => logout(request);
