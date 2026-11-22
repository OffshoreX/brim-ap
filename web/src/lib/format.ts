// Money arrives as integer cents; we only divide at display time.
export function formatMoney(cents: number, currency: string): string {
  const n = new Intl.NumberFormat("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
  return `${n} ${currency}`;
}
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(d);
}
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short" }).format(d);
}
export function plural(n: number, word: string, pluralWord = `${word}s`): string {
  return `${n.toLocaleString("en-CA")} ${n === 1 ? word : pluralWord}`;
}
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
}
