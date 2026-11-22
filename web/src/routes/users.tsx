import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { PageHeader } from "@/components/PageHeader";
import { QueryView, Empty, Forbidden } from "@/components/States";
import { Table, Th, Td } from "@/components/Table";
import { StatusPill } from "@/components/StatusPill";
import { Money } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { UserEdit } from "@/components/UserEdit";
import { useAdminUsers } from "@/hooks/queries";
import { can, ROLE_LABEL } from "@/lib/roles";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/users")({
  ssr: false,
  head: () => pageHead("Users", "Roles, managers, approval limits and delegates."),
  component: () => <AppShell>{(me) => (can(me.role, "admin") ? <UsersPage /> : <Forbidden />)}</AppShell>,
});

function UsersPage() {
  const q = useAdminUsers();
  const [editing, setEditing] = useState<number | null>(null);
  return (
    <>
      <PageHeader title="Users" subtitle="Who can do what, who they report to, and who covers when they are away. Only a controller can change these." />
      <QueryView q={q}>
        {(users) => {
          if (users.length === 0) return <Empty title="No users" />;
          const name = (id: number | null) => (id === null ? "—" : users.find((u) => u.id === id)?.name ?? `User #${id}`);
          const user = users.find((u) => u.id === editing);
          return (
            <>
              <Table>
                <thead><tr><Th>Name</Th><Th>Role</Th><Th>Manager</Th><Th right>Approval limit</Th><Th>Status</Th><Th>Delegate</Th><Th /></tr></thead>
                <tbody>{users.map((u) => (
                  <tr key={u.id} className="hover:bg-muted/50">
                    <Td><span className="font-semibold">{u.name}</span>{u.email && <span className="block text-xs text-muted-foreground">{u.email}</span>}</Td>
                    <Td>{ROLE_LABEL[u.role]}</Td>
                    <Td>{name(u.managerId)}</Td>
                    <Td right><Money cents={u.approvalLimitCents} currency="CAD" /></Td>
                    <Td><StatusPill status={u.status} /></Td>
                    <Td>{name(u.delegateUserId)}</Td>
                    <Td><Button variant="outline" size="sm" aria-label={`Edit ${u.name}`} onClick={() => setEditing(u.id)}>Edit</Button></Td>
                  </tr>
                ))}</tbody>
              </Table>
              {user && <UserEdit key={user.id} user={user} users={users} onClose={() => setEditing(null)} />}
            </>
          );
        }}
      </QueryView>
    </>
  );
}
