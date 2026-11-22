// The one spreadsheet-safe CSV cell. A text cell that starts with = + - @ tab or carriage return runs as a formula in Excel
// and Sheets, so it gets a ' in front. A plain number such as "-12.34" is left alone, or credit amounts would be corrupted.
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
export const guardCell = (v: string) => (/^[=+\-@\t\r]/.test(v) && !PLAIN_NUMBER.test(v) ? `'${v}` : v);

// Quotes the cell when it has a comma, quote or line break (alwaysQuote: always, for text columns).
export function csvCell(v: string | number | null, alwaysQuote = false): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  const s = guardCell(v);
  return alwaysQuote || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
