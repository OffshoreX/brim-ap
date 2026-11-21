// Money-action tests with fetch mocked. There is no DOM in this repo's tests, so clicks are made by calling the
// onClick of the button elements a component returns, and states are checked in server-rendered HTML.
import type { ReactElement, ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, test, vi } from "vitest";
import { ActionButton, ConfirmAction, ConfirmStep, runLocked } from "./actions";
import { FlagBox, post } from "./api";

afterEach(() => vi.unstubAllGlobals());

type El = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
const walk = (n: ReactNode, out: El[] = []): El[] => {
  if (Array.isArray(n)) n.forEach((c) => walk(c, out));
  else if (n && typeof n === "object" && "props" in n) { out.push(n as El); walk((n as El).props.children, out); }
  return out;
};
const textOf = (n: ReactNode): string => (Array.isArray(n) ? n.map(textOf).join("") : typeof n === "string" ? n : n && typeof n === "object" && "props" in n ? textOf((n as El).props.children) : "");
const clickButton = (root: ReactNode, label: string) => walk(root).find((e) => e.type === "button" && textOf(e) === label)!.props.onClick!();

const step = (over = {}) => ({
  title: "Confirm release of payment 7", facts: [["Amount", "1,234.56 CAD"], ["Payee", "Acme Ltd"], ["Method", "EFT"], ["Scheduled", "2026-12-01"]] as [string, string][],
  confirmLabel: "Release 1,234.56 CAD to Acme Ltd via EFT", text: "", onText: () => {}, missing: false, onConfirm: () => {}, onCancel: () => {}, ...over,
});

test("the confirm step names amount, payee, method and date, then offers Release and Cancel", () => {
  const html = renderToString(<ConfirmStep {...step()} />);
  for (const t of ["1,234.56 CAD", "Acme Ltd", "EFT", "2026-12-01", "Cancel"]) expect(html).toContain(t);
  expect(html).toContain(">Release 1,234.56 CAD to Acme Ltd via EFT<");
});

test("before the click only the Release button shows, with the row in its accessible name", () => {
  const html = renderToString(
    <ConfirmAction {...step()} label="Release" busyLabel="Releasing…" ariaLabel="Release payment 7 to Acme Ltd" busy={false} locked={false} onConfirm={() => {}} />
  );
  expect(html).toContain('aria-label="Release payment 7 to Acme Ltd"');
  expect(html).not.toContain("Confirm release");
});

test("Cancel sends nothing; Confirm hands over once", () => {
  const send = vi.fn();
  vi.stubGlobal("fetch", send);
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  clickButton(ConfirmStep(step({ onConfirm, onCancel })), "Cancel");
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onConfirm).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
  clickButton(ConfirmStep(step({ onConfirm, onCancel })), "Release 1,234.56 CAD to Acme Ltd via EFT");
  expect(onConfirm).toHaveBeenCalledOnce();
});

test("a double click is one request, and a fresh Idempotency-Key goes with each confirmed intent", async () => {
  const send = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", send);
  const lock = { current: null as string | null };
  const ui = { busy: () => {}, result: vi.fn() };
  const go = (key: string) => runLocked(lock, "release-7", () => post("/api/payments/release", { paymentId: 7 }, { "idempotency-key": key }), "Payment 7 released", ui);
  const [first, second] = await Promise.all([go("key-1"), go("key-1")]);
  expect([first, second]).toEqual([true, false]);
  expect(send).toHaveBeenCalledOnce();
  expect((send.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ "idempotency-key": "key-1" });
  await go("key-2"); // after the first finished, a new confirm is a new intent
  expect(send).toHaveBeenCalledTimes(2);
  expect(ui.result).toHaveBeenLastCalledWith("release-7", { ok: "Payment 7 released" });
});

test("a refused or unreachable request shows an error and frees the lock", async () => {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: "Payment is not scheduled" }), { status: 409 }));
  const lock = { current: null as string | null };
  const ui = { busy: vi.fn(), result: vi.fn() };
  expect(await runLocked(lock, "k", () => post("/x", {}), "ok", ui)).toBe(false);
  expect(ui.result).toHaveBeenCalledWith("k", { error: "Payment is not scheduled" });
  expect(lock.current).toBeNull();
  expect(ui.busy).toHaveBeenLastCalledWith(null);
});

test("while busy the button is disabled and says what is happening", () => {
  const html = renderToString(<ActionButton label="Release" busyLabel="Releasing…" busy locked onClick={() => {}} />);
  expect(html).toContain("disabled");
  expect(html).toContain("Releasing…");
});

test("flag box: red and 'Blocked' for an error, amber for warnings only, neutral for info", () => {
  const error = { code: "bank_details_changed", message: "Bank details changed since the last payment", severity: "error" };
  const warning = { code: "amount_outlier", message: "Unusual amount", severity: "warning" };
  const info = { code: "fx_note", message: "Converted at the daily rate", severity: "info" };
  const red = renderToString(<FlagBox flags={[warning, error]} />);
  expect(red).toContain("flagbox-error");
  expect(red).toContain("Blocked");
  expect(red).toContain("Bank details changed since the last payment"); // the reason sits next to the flag
  const amber = renderToString(<FlagBox flags={[warning, info]} />);
  expect(amber).toContain("flagbox-warning");
  expect(amber).not.toContain("Blocked");
  const blue = renderToString(<FlagBox flags={[info]} />);
  expect(blue).toContain("flagbox-info");
  expect(blue).not.toContain("flagbox-warning");
  expect(renderToString(<FlagBox flags={[]} />)).toBe("");
});
