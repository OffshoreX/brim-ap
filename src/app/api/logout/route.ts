import { handle } from "@/server/authz";
import { logout } from "@/server/logout";
import { checkOrigin } from "@/server/security";

// Open to everyone on purpose: signing out must work even when the session is already gone. Still refuses a cross-site POST.
export const POST = (request: Request) =>
  handle(() => {
    checkOrigin(request);
    return logout(request);
  });
