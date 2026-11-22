import { useState } from "react";
import { toast } from "sonner";
import { ConfirmInline } from "@/components/ConfirmInline";
import { ErrorText } from "@/components/ErrorText";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useAction } from "@/hooks/queries";
import { api } from "@/lib/api";
import { toCents } from "@/lib/format";
import { ROLE_LABEL } from "@/lib/roles";
import { USER_STATUSES, type ManagedUser, type Role, type UserPatch, type UserStatus } from "@/lib/types";

const selectCls = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm";
const STATUS_LABEL: Record<UserStatus, string> = { active: "Active", on_leave: "On leave", terminated: "Terminated" };
const FIELD_LABEL: Record<keyof UserPatch, string> = { role: "role", manager_id: "manager", approval_limit_cents: "approval limit", status: "status", delegate_user_id: "delegate" };
const idOrNull = (s: string) => (s === "" ? null : Number(s));

// Side panel for one user. Only the fields that changed are sent. The server owns every rule (no self-promotion, last controller,
// a user on leave needs a delegate, ...): its message is shown here word for word and the panel stays open.
export function UserEdit({ user, users, onClose }: { user: ManagedUser; users: ManagedUser[]; onClose: () => void }) {
  const [role, setRole] = useState<Role>(user.role);
  const [manager, setManager] = useState(String(user.managerId ?? ""));
  const [limit, setLimit] = useState((user.approvalLimitCents / 100).toFixed(2));
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [delegate, setDelegate] = useState(String(user.delegateUserId ?? ""));
  const [error, setError] = useState<string | null>(null);
  const save = useAction((p: UserPatch) => api.updateUser(user.id, p), [["admin-users"], ["audit"], ["me"]]);

  const cents = toCents(limit);
  const patch: UserPatch = {};
  if (role !== user.role) patch.role = role;
  if (idOrNull(manager) !== user.managerId) patch.manager_id = idOrNull(manager);
  if (cents !== null && cents !== user.approvalLimitCents) patch.approval_limit_cents = cents;
  if (status !== user.status) patch.status = status;
  if (idOrNull(delegate) !== user.delegateUserId) patch.delegate_user_id = idOrNull(delegate);
  const changed = (Object.keys(patch) as (keyof UserPatch)[]).map((k) => FIELD_LABEL[k]);

  const others = users.filter((u) => u.id !== user.id);
  const people = (value: string, set: (v: string) => void, id: string) => (
    <select id={id} value={value} onChange={(e) => set(e.target.value)} className={selectCls}>
      <option value="">None</option>
      {others.map((u) => <option key={u.id} value={u.id}>{u.name} ({ROLE_LABEL[u.role]}{u.status === "active" ? "" : `, ${STATUS_LABEL[u.status].toLowerCase()}`})</option>)}
    </select>
  );

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>{user.name}</SheetTitle>
          <SheetDescription>{user.title ?? "No title"}{user.email ? ` · ${user.email}` : ""}. Changes are checked by the server and written to the audit log.</SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div className="space-y-1.5"><Label htmlFor="u-role">Role</Label>
            <select id="u-role" value={role} onChange={(e) => setRole(e.target.value as Role)} className={selectCls}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label htmlFor="u-manager">Manager</Label>{people(manager, setManager, "u-manager")}</div>
          <div className="space-y-1.5"><Label htmlFor="u-limit">Approval limit (CAD)</Label>
            <Input id="u-limit" inputMode="decimal" value={limit} aria-invalid={cents === null} onChange={(e) => setLimit(e.target.value)} className="num" />
            {cents === null && <p className="text-sm font-medium text-bad-foreground">Enter dollars and cents, for example 5000.00</p>}</div>
          <div className="space-y-1.5"><Label htmlFor="u-status">Status</Label>
            <select id="u-status" value={status} onChange={(e) => setStatus(e.target.value as UserStatus)} className={selectCls}>
              {USER_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select></div>
          <div className="space-y-1.5"><Label htmlFor="u-delegate">Delegate (covers approvals while away)</Label>{people(delegate, setDelegate, "u-delegate")}</div>
          <ErrorText error={error} />
          {changed.length === 0 ? <p className="text-sm text-muted-foreground">Nothing changed yet.</p> : (
            <ConfirmInline label="Save changes" confirmLabel="Yes, save" pending={save.isPending || cents === null} message={`Change ${changed.join(", ")} for ${user.name}?`}
              onConfirm={() => { setError(null); save.mutateAsync(patch).then(() => { toast.success(`${user.name} updated`); onClose(); }).catch((e: Error) => setError(e.message)); }} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
