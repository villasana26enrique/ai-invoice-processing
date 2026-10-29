-- invoice_app: the role the pipeline (n8n) and the review page connect with. The password comes from
-- INVOICE_APP_PASSWORD (.env).
-- It can read everything but write nothing directly: data only changes through the SECURITY DEFINER functions
-- (register_document, record_extraction, record_extraction_failure, save_review, approve_invoice,
-- reject_invoice), which validate first. A bug or an injected query in the app cannot approve an invoice by hand.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'invoice_app') THEN
    EXECUTE format('CREATE ROLE invoice_app LOGIN PASSWORD %L', '${invoice_app_password}');
  ELSE
    EXECUTE format('ALTER ROLE invoice_app LOGIN PASSWORD %L', '${invoice_app_password}');
  END IF;
END $$;

-- Nobody else gets into the schema (on Supabase, this keeps it away from the anon and authenticated roles)
REVOKE ALL ON SCHEMA invoicing FROM PUBLIC;
GRANT USAGE ON SCHEMA invoicing TO invoice_app;
GRANT SELECT ON ALL TABLES IN SCHEMA invoicing TO invoice_app;
-- Functions are executable by any role with USAGE on the schema (PostgreSQL's default). The internal ones
-- (write_invoice, validate_invoice) are not SECURITY DEFINER, so for invoice_app they fail on the tables.
