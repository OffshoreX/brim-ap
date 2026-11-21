"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import { SeverityChip, Skeleton } from "./ui";

// The UI never decides who may do what: every call goes to the server, which answers 401 or 403.
// This file only turns those answers into a clear message.
export const FORBIDDEN = "brim:forbidden";
async function failure(res: Response): Promise<string | undefined> {
  if (res.ok) return undefined;
  if (res.status === 401) return "You are not signed in. Use the Sign in link.";
  const body = await res.json().catch(() => null);
  if (res.status === 403) {
    const msg = `Not allowed: ${body?.error ?? "your role cannot do this"}`;
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FORBIDDEN, { detail: msg })); // the header shows it as a banner
    return msg;
  }
  return body?.error ?? `Request failed (${res.status})`;
}

// `total` is the server's X-Total-Count (the whole list size when the body is only one page).
export async function call<T = unknown>(url: string, init?: RequestInit): Promise<{ data?: T; error?: string; total?: number }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { error: "Could not reach the server." };
  }
  const error = await failure(res.clone());
  if (error) return { error };
  const header = res.headers.get("X-Total-Count");
  return { data: (await res.json().catch(() => null)) as T, total: header === null ? undefined : Number(header) };
}

// Downloads a file endpoint through fetch so a 401 or 403 shows a message instead of saving an error page.
export async function download(url: string, filename: string): Promise<string | undefined> {
  const res = await fetch(url).catch(() => null);
  if (!res) return "Could not reach the server.";
  const error = await failure(res.clone());
  if (error) return error;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(await res.blob());
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// Sends one file as multipart. XHR (not fetch) because only XHR tells us when the bytes have gone, so the row can
// switch from "uploading" to "processing" while the server reads the invoice. Errors reuse failure() like call().
export function sendFile<T>(file: File, onSent: () => void): Promise<{ data?: T; error?: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/invoices/upload");
    xhr.upload.onloadend = onSent;
    xhr.onerror = () => resolve({ error: "Could not reach the server." });
    xhr.onload = async () => {
      const res = new Response(xhr.responseText, { status: xhr.status });
      const error = await failure(res.clone());
      resolve(error ? { error } : { data: (await res.json().catch(() => null)) as T });
    };
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export const post = <T,>(url: string, body: unknown, headers?: Record<string, string>) =>
  call<T>(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

// Loads a GET endpoint. Pass null to wait (e.g. until a filter is ready).
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string; total?: number }>({});
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (url === null) return;
    let live = true;
    call<T>(url).then((r) => live && setState(r));
    return () => {
      live = false;
    };
  }, [url, tick]);
  return { ...state, reload: useCallback(() => setTick((t) => t + 1), []) };
}

// Shows loading or the error message, otherwise hands the data to the page.
export function Load<T>({ url, children }: { url: string | null; children: (data: T, reload: () => void) => ReactNode }) {
  const { data, error, reload } = useApi<T>(url);
  if (error) return <p role="alert" className="error-box">{error}</p>; // 401 and 403 text comes from failure()
  if (data === undefined) return <Skeleton />;
  return <>{children(data, reload)}</>;
}

// Integer cents to "1,234.56". Display only, no arithmetic on floats.
export const money = (cents: number | null | undefined, currency = "") =>
  cents === null || cents === undefined
    ? "—"
    : `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("en-CA")}.${String(Math.abs(cents) % 100).padStart(2, "0")} ${currency}`.trim();

// Success is a toast that fades after a few seconds; an error stays on screen as a banner until the next action.
// ponytail: the same success text twice in a row does not re-show, fine because each action changes the page.
export function Notice({ ok, error }: { ok?: string; error?: string }) {
  const [gone, setGone] = useState<string>();
  useEffect(() => {
    setGone(undefined);
    if (!ok) return;
    const t = setTimeout(() => setGone(ok), 5000);
    return () => clearTimeout(t);
  }, [ok]);
  if (error) return <p role="alert" className="error"><Icon name="error" />{error}</p>;
  return ok && gone !== ok ? <p role="status" className="ok toast"><Icon name="approved" />{ok}<button className="secondary" aria-label="Dismiss message" onClick={() => setGone(ok)}><Icon name="rejected" /></button></p> : null;
}

// Backend flags are {code, message, severity} objects.
export type Flag = { code: string; message: string; severity?: string };
// Plain names for the budget and outlier warnings, shown before the server's own reason text.
export const FLAG_TITLE: Record<string, string> = { department_over_budget: "Department over budget", amount_outlier: "Unusual amount for this vendor" };
const RANK: Record<string, number> = { error: 0, warning: 1, info: 2 };
const rank = (f: Flag) => RANK[f.severity ?? ""] ?? 1; // a flag with no or an unknown severity counts as a warning, like the server does
// The worst flag first; ties keep the order the server sent.
export const topFlag = (flags: Flag[]) => [...flags].sort((a, b) => rank(a) - rank(b))[0];
export const worstSeverity = (flags: Flag[]): "error" | "warning" | "info" => (flags.length === 0 ? "info" : (["error", "warning", "info"] as const)[rank(topFlag(flags))]);

// The reason is the message; the machine code follows it, small. An error says "Blocked" in words, not only in red.
export function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return <p className="empty"><Icon name="approved" />No flags. Every check passed.</p>;
  return (
    <ul className="flags">
      {flags.map((f, i) => (
        <li key={i}>
          <SeverityChip severity={f.severity} /> {f.severity === "error" && <strong>Blocked: </strong>}{FLAG_TITLE[f.code] && <strong>{FLAG_TITLE[f.code]}: </strong>}{f.message} <small className="muted"><code>{f.code}</code></small>
        </li>
      ))}
    </ul>
  );
}

// Panel that takes the colour of its worst flag: red "Blocked", amber "Needs attention", blue "For information".
const FLAGBOX_TITLE = { error: "Blocked", warning: "Why this needs attention", info: "For information" };
export function FlagBox({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return null;
  const worst = worstSeverity(flags);
  return (
    <section className={`flagbox flagbox-${worst}`} aria-label="Flags">
      <h2>{FLAGBOX_TITLE[worst]} ({flags.length})</h2>
      {worst === "error" && <p>Resolve the problem below before this invoice goes any further.</p>}
      <Flags flags={flags} />
    </section>
  );
}

// "1234.5" -> 123450, string and integer math only. Returns null if it is not a money amount.
export function toCents(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}
