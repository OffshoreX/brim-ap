"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { SeverityChip } from "./ui";

// The UI never decides who may do what: every call goes to the server, which answers 401 or 403.
// This file only turns those answers into a clear message.
async function failure(res: Response): Promise<string | undefined> {
  if (res.ok) return undefined;
  if (res.status === 401) return "You are not signed in. Use the Sign in link.";
  const body = await res.json().catch(() => null);
  if (res.status === 403) return `Not allowed: ${body?.error ?? "your role cannot do this"}`;
  return body?.error ?? `Request failed (${res.status})`;
}

export async function call<T = unknown>(url: string, init?: RequestInit): Promise<{ data?: T; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    return { error: "Could not reach the server." };
  }
  const error = await failure(res.clone());
  return error ? { error } : { data: (await res.json().catch(() => null)) as T };
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

export const post = <T,>(url: string, body: unknown) =>
  call<T>(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Loads a GET endpoint. Pass null to wait (e.g. until a filter is ready).
export function useApi<T>(url: string | null) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
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
  if (data === undefined) return <p className="loading" role="status">Loading…</p>;
  return <>{children(data, reload)}</>;
}

// Integer cents to "1,234.56". Display only, no arithmetic on floats.
export const money = (cents: number | null | undefined, currency = "") =>
  cents === null || cents === undefined
    ? "—"
    : `${cents < 0 ? "-" : ""}${Math.floor(Math.abs(cents) / 100).toLocaleString("en-CA")}.${String(Math.abs(cents) % 100).padStart(2, "0")} ${currency}`.trim();

// Result line shown under a button: green on success, red on error.
export function Notice({ ok, error }: { ok?: string; error?: string }) {
  if (error) return <p role="alert" className="error">{error}</p>;
  return ok ? <p role="status" className="ok">{ok}</p> : null;
}

// Backend flags are {code, message, severity} objects.
export type Flag = { code: string; message: string; severity?: string };
export function Flags({ flags }: { flags: Flag[] }) {
  if (flags.length === 0) return <p className="empty">No flags. Every check passed.</p>;
  return (
    <ul className="flags">
      {flags.map((f, i) => (
        <li key={i}>
          <SeverityChip severity={f.severity} /> <code>{f.code}</code> {f.message}
        </li>
      ))}
    </ul>
  );
}

// "1234.5" -> 123450, string and integer math only. Returns null if it is not a money amount.
export function toCents(text: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
}
