// Local input types so the rules do not depend on the DB schema.
export type Severity = 'error' | 'warning';
export type Finding = { code: string; message: string; severity: Severity };

export type Line = { totalCents: number };
export type Tax = { amountCents: number };

export type InvoiceKey = {
  id?: string;
  vendorId: string;
  number: string;
  totalCents: number;
  date: string; // ISO yyyy-mm-dd
  kind?: 'invoice' | 'credit_note';
};
