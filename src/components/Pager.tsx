// Paging for a list whose server sends the whole size (X-Total-Count). The page only asks for one slice at a time.
export const PAGE_SIZE = 50;

// The API address for one page of invoices, newest first from the server. The status is sent to the server, never filtered here.
export const invoicesUrl = (status: string, page: number) =>
  `/api/invoices?limit=${PAGE_SIZE}&offset=${(page - 1) * PAGE_SIZE}${status ? `&status=${encodeURIComponent(status)}` : ""}`;

export default function Pager({ page, shown, total, onPage }: { page: number; shown: number; total: number; onPage: (p: number) => void }) {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = (page - 1) * PAGE_SIZE + shown;
  return (
    <nav className="pager" aria-label="Pages">
      <button className="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span role="status">{shown > 0 ? `Showing ${first} to ${last} of ${total}` : `Showing none of ${total}`}</span>
      <button className="secondary" disabled={last >= total} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}
