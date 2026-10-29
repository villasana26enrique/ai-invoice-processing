-- Approved invoices, one row each, ready to export as CSV (or to load into an accounting system)

SET search_path TO invoicing;

CREATE OR REPLACE VIEW approved_invoices AS
SELECT d.id                                         AS document_id,
       coalesce(s.name, i.supplier_name)            AS supplier,
       i.invoice_number,
       i.invoice_date,
       i.due_date,
       i.currency,
       i.subtotal,
       i.tax,
       i.shipping,
       i.total,
       d.updated_at                                 AS approved_at,
       -- "automatic" when nobody had to look at it
       coalesce(approval.actor, 'automatic')        AS approved_by,
       d.file_name
FROM documents d
JOIN invoices i ON i.document_id = d.id
LEFT JOIN suppliers s ON s.id = i.supplier_id
LEFT JOIN LATERAL (SELECT e.actor FROM review_events e
                   WHERE e.document_id = d.id AND e.action = 'approve'
                   ORDER BY e.created_at DESC LIMIT 1) approval ON true
WHERE d.status = 'approved';

-- Here and not in R__app_role.sql: Flyway runs that file first, before this view exists
GRANT SELECT ON approved_invoices TO invoice_app;
