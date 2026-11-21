"use client";
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { Icon, type IconName } from "./icons";

// Buttons that change data. The UI only locks and explains; the server still decides who may do what and answers 403.
export type Result = { ok?: string; error?: string };
type Lock = { current: string | null };
type Ui = { busy: (key: string | null) => void; result: (key: string, r: Result) => void };

// One request at a time per page. A second click while one is in flight returns at once, so a double click is one request.
export async function runLocked(lock: Lock, key: string, send: () => Promise<{ error?: string }>, ok: string, ui: Ui): Promise<boolean> {
  if (lock.current) return false;
  lock.current = key;
  ui.busy(key);
  let error: string | undefined;
  try {
    error = (await send()).error;
  } catch {
    error = "Could not reach the server.";
  }
  lock.current = null;
  ui.busy(null);
  ui.result(key, error ? { error } : { ok });
  return !error;
}

// Results are kept by control key at page level, so a success message survives the reload that removes the button (a released payment).
export function useActions(onSuccess: () => void) {
  const lock = useRef<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, Result>>({});
  const ui: Ui = {
    busy: (k) => { setBusyKey(k); if (k) setResults((r) => ({ ...r, [k]: {} })); },
    result: (k, r) => setResults((all) => ({ ...all, [k]: r })),
  };
  return {
    busyKey,
    locked: busyKey !== null, // every action button on the page is disabled while any request runs
    run: async (key: string, send: () => Promise<{ error?: string }>, ok: string) => { if (await runLocked(lock, key, send, ok, ui)) onSuccess(); },
    show: (key: string) => <ActionResult result={results[key] ?? {}} onDismiss={() => setResults((all) => ({ ...all, [key]: {} }))} />,
  };
}

// Success is polite and stays until dismissed (it is about money); an error is an alert and stays until the next attempt.
export function ActionResult({ result, onDismiss }: { result: Result; onDismiss: () => void }) {
  return (
    <div className="result">
      <div aria-live="polite">
        {result.ok && <p className="result-ok"><Icon name="approved" />{result.ok}<button type="button" className="secondary" aria-label={`Dismiss: ${result.ok}`} onClick={onDismiss}>Dismiss</button></p>}
      </div>
      {result.error && <p role="alert" className="error"><Icon name="error" />{result.error}</p>}
    </div>
  );
}

type ButtonProps = { label: string; busyLabel: string; ariaLabel?: string; icon?: IconName; secondary?: boolean; submit?: boolean; busy: boolean; locked: boolean; onClick?: () => void; ref?: Ref<HTMLButtonElement> };
export function ActionButton({ label, busyLabel, ariaLabel, icon, secondary, submit, busy, locked, onClick, ref }: ButtonProps) {
  return (
    <button ref={ref} type={submit ? "submit" : "button"} className={secondary ? "secondary" : undefined} disabled={locked} aria-busy={busy} aria-label={busy ? undefined : ariaLabel} onClick={onClick}>
      {busy ? <><span className="spin" aria-hidden="true" />{busyLabel}</> : <>{icon && <Icon name={icon} />}{label}</>}
    </button>
  );
}

type StepProps = {
  title: string; facts: [string, string][]; confirmLabel: string; ask?: { label: string; required?: boolean };
  text: string; onText: (t: string) => void; missing: boolean; onConfirm: () => void; onCancel: () => void; cancelRef?: Ref<HTMLButtonElement>;
};
// The inline confirm step: what will happen, to whom, for how much; then the one button that does it, and Cancel.
export function ConfirmStep({ title, facts, confirmLabel, ask, text, onText, missing, onConfirm, onCancel, cancelRef }: StepProps) {
  return (
    <div className="confirm" role="group" aria-label={title} onKeyDown={(e: KeyboardEvent) => e.key === "Escape" && onCancel()}>
      <p><strong>{title}</strong></p>
      <dl className="fields">{facts.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
      {ask && <label>{ask.label}<input value={text} onChange={(e) => onText(e.target.value)} aria-required={ask.required} aria-invalid={missing} /></label>}
      {missing && <p role="alert" className="error"><Icon name="error" />Write a reason first. It goes in the audit log.</p>}
      <div className="row">
        <button type="button" onClick={onConfirm}>{confirmLabel}</button>
        <button type="button" className="secondary" onClick={onCancel} ref={cancelRef}>Cancel</button>
      </div>
    </div>
  );
}

type ConfirmProps = Omit<ButtonProps, "onClick" | "ref"> & Pick<StepProps, "title" | "facts" | "confirmLabel" | "ask"> & { onConfirm: (text: string, idempotencyKey: string) => void };
// Click opens the step, nothing is sent until Confirm. Each Confirm gets a fresh Idempotency-Key, so one intent is one request.
// ponytail: crypto.randomUUID needs https or localhost, which the demo and Vercel both are.
export function ConfirmAction({ title, facts, confirmLabel, ask, onConfirm, ...button }: ConfirmProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [missing, setMissing] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const was = useRef(open);
  // Focus moves into the step (on Cancel, the safe choice for money) and back to the trigger when it closes; never on first render.
  useEffect(() => {
    if (was.current !== open) (open ? cancel : trigger).current?.focus();
    was.current = open;
  }, [open]);
  const close = () => { setOpen(false); setText(""); setMissing(false); };
  function confirm() {
    if (ask?.required && !text.trim()) return setMissing(true);
    onConfirm(text.trim(), crypto.randomUUID());
    close();
  }
  return open && !button.locked ? (
    <ConfirmStep title={title} facts={facts} confirmLabel={confirmLabel} ask={ask} text={text} onText={setText} missing={missing} onConfirm={confirm} onCancel={close} cancelRef={cancel} />
  ) : (
    <ActionButton {...button} ref={trigger} onClick={() => setOpen(true)} />
  );
}
