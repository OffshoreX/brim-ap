import { handle, requireRole } from "@/server/authz";
import { exportJournal, JOURNAL_ROLES, JournalError, parseJournalQuery } from "@/server/journal";

// ?from=yyyy-mm-dd&to=yyyy-mm-dd&format=csv (csv is the only format and the default). Invoice dates, both ends included.
export const GET = (request: Request) =>
  handle(() => {
    const user = requireRole(request, JOURNAL_ROLES);
    const range = parseJournalQuery(new URL(request.url).searchParams);
    if (typeof range === "string") return Response.json({ error: range }, { status: 400 });
    try {
      const csv = exportJournal(user, range.from, range.to);
      return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="journal-${range.from}-to-${range.to}.csv"` } });
    } catch (e) {
      if (e instanceof JournalError) return Response.json({ error: e.message, invoiceId: e.invoiceId }, { status: 500 });
      throw e;
    }
  });
