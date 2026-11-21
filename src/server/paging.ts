// Shared paging for list endpoints: ?limit= (default 50, max 200) and ?offset=. The body stays a plain array so
// existing callers keep working; the total goes in the X-Total-Count header.
export type Page = { limit: number; offset: number };
export const DEFAULT_PAGE: Page = { limit: 50, offset: 0 };
export const MAX_LIMIT = 200;

const whole = (v: string | null, min: number) => (v === null ? undefined : Number.isInteger(Number(v)) && v.trim() !== "" && Number(v) >= min ? Number(v) : NaN);

// Returns a 400 Response for junk input; a limit above the max is capped, not rejected.
export function parsePage(request: Request): Page | Response {
  const q = new URL(request.url).searchParams;
  const limit = whole(q.get("limit"), 1);
  const offset = whole(q.get("offset"), 0);
  if (Number.isNaN(limit) || Number.isNaN(offset))
    return Response.json({ error: "limit must be a whole number from 1 and offset from 0" }, { status: 400 });
  return { limit: Math.min(limit ?? DEFAULT_PAGE.limit, MAX_LIMIT), offset: offset ?? 0 };
}

export const pagedJson = (rows: unknown[], total: number) => Response.json(rows, { headers: { "X-Total-Count": String(total) } });
