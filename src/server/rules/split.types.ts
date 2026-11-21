// Local input shapes so the split and credit-note rules do not depend on the DB schema.
export type SplitInvoice = { id?: string; vendorId: string; totalCents: number; date: string }; // date: ISO yyyy-mm-dd

export type CreditNote = {
  vendorId: string;
  totalCents: number; // negative for a credit note
  referencesInvoiceId: string | null; // the invoice it credits, as written on the document
};

// creditedCents = sum of earlier credit notes already applied to this invoice (positive number).
export type OriginalInvoice = { id: string; vendorId: string; totalCents: number; creditedCents: number };
