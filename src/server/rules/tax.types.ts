import type { Finding } from './types';

// Local input shapes so the tax rule does not depend on the DB schema.
export type TaxLine = { amountCents: number; taxCode: string | null };
// One tax charge on the invoice, tied to the line (0-based index) it was charged on.
export type InvoiceTax = { lineIndex: number; amountCents: number };
// province null = the code applies in every province (e.g. a zero-rated or exempt code).
export type TaxCodeRate = { code: string; province: string | null; rateBps: number };
// lineIndex is null only for findings that are not about one line (bad input).
export type TaxFinding = Finding & { lineIndex: number | null };
