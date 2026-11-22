import { HttpError } from "./authz";

// The one place a JSON request body is read. It enforces: size cap, an object at the top, no prototype-pollution keys,
// and a maximum length on every string (by field name). Anything wrong is a 400/413 here, before a route or rule sees it.
export const MAX_BODY_BYTES = 1_000_000;
const MAX_DEPTH = 8;
// Field-name caps from the issue: emails 254, names 200, passwords 1024. Every other string (notes, comments, reasons) gets 2000.
const MAX_STRING = (key: string) => (/email/i.test(key) ? 254 : /password/i.test(key) ? 1024 : /name$/i.test(key) ? 200 : 2000);
const BAD_KEYS = ["__proto__", "constructor", "prototype"];

function check(v: unknown, key: string, depth: number): void {
  if (typeof v === "string") {
    if (v.length > MAX_STRING(key)) throw new HttpError(400, `${key} must be at most ${MAX_STRING(key)} characters`);
  } else if (v && typeof v === "object") {
    if (depth > MAX_DEPTH) throw new HttpError(400, "JSON is nested too deeply");
    for (const [k, child] of Object.entries(v)) { // JSON.parse makes "__proto__" an own key, so Object.entries sees it
      if (BAD_KEYS.includes(k)) throw new HttpError(400, `Key not allowed: ${k}`);
      check(child, k, depth + 1);
    }
  }
}

// Returns the parsed JSON, or null when the body is empty or not JSON (callers already answer 400 for null).
// ponytail: the body is read whole and then measured; a streaming cap would stop a huge upload earlier. Content-Length is checked first.
export async function readJson(request: Request): Promise<any> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  const text = await request.text().catch(() => "");
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  let body: unknown;
  try { body = JSON.parse(text); } catch { return null; }
  check(body, "body", 0);
  return body;
}
