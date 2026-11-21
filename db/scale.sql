-- Indexes for the real query paths (T41). Named scale.sql so it sorts after rules.sql, which creates approval_steps.
-- Duplicate check: same vendor, then invoice number or date.
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_number ON invoices(vendor_id, invoice_number);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_date ON invoices(vendor_id, invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_total ON invoices(total_cents);
-- Employee list and dashboard filter on the requester; the due-this-week sum filters on due_date.
CREATE INDEX IF NOT EXISTS idx_invoices_requester ON invoices(requester_id);
CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(due_date);
CREATE INDEX IF NOT EXISTS idx_approvals_invoice ON approvals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_steps_user ON approval_steps(user_id, status);
-- Audit: filter by entity (and id) newest first, or by time alone; trail looks up by entity + id.
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at, id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor_id, at);
CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);
CREATE INDEX IF NOT EXISTS idx_inbox_class ON inbox_mail(class);
CREATE INDEX IF NOT EXISTS idx_audit_entity_at ON audit_log(entity, at);
