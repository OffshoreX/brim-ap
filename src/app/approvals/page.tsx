"use client";
import { LoadError, useApi } from "@/components/api";
import { InboxTable, type InboxRow } from "@/components/InboxTable";
import { Skeleton } from "@/components/ui";
import RoleHome from "@/components/RoleHome";

// GET /api/approvals/inbox. The table decides nothing itself: Approve posts to the invoice decision route, where the server checks the role.
export default function ApprovalsPage() {
  const url = "/api/approvals/inbox";
  const { data, error, reload } = useApi<InboxRow[]>(url);
  return (
    <main id="main">
      <h1>Approvals inbox{data ? ` (${data.length})` : ""}</h1>
      <RoleHome page="/approvals" />
      {error ? <LoadError url={url} error={error} /> : data === undefined ? <Skeleton /> : <InboxTable rows={data} reload={reload} />}
    </main>
  );
}
