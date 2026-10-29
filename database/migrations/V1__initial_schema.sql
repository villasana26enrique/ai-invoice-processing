-- Suppliers, received documents, what the model extracted from them, the invoices and every human review.
-- Versioned migration: runs once. Functions live in database/functions.
-- Plain PostgreSQL 15+, no extensions: the same schema runs on Supabase, RDS or Cloud SQL.

CREATE SCHEMA IF NOT EXISTS invoicing;
SET search_path TO invoicing;

-- Known suppliers. An invoice from a supplier that is not here always goes to review.
CREATE TABLE suppliers (
  id              int  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name            text NOT NULL,
  -- "ACME Supply, Inc." and "Acme Supply Inc" are the same supplier
  normalized_name text GENERATED ALWAYS AS (lower(regexp_replace(name, '[^a-zA-Z0-9]+', '', 'g'))) STORED UNIQUE,
  -- EIN, 12-3456789. Matches even when the name on the invoice is written differently.
  tax_id          text UNIQUE CHECK (tax_id ~ '^\d{2}-\d{7}$'),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- One row per file received. The status of the whole process lives here.
CREATE TABLE documents (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source       text   NOT NULL CHECK (source IN ('google_drive', 'upload')),
  -- Drive file id, or the id the upload chose
  source_id    text   NOT NULL,
  file_name    text   NOT NULL,
  mime_type    text   NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  -- sha256 of the file bytes: the same invoice sent twice is processed once
  file_sha256  text   NOT NULL UNIQUE CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  -- Where the original lives (local volume or Supabase Storage), relative to the storage root
  storage_path text   NOT NULL UNIQUE,
  status       text   NOT NULL DEFAULT 'received'
               CHECK (status IN ('received', 'approved', 'needs_review', 'rejected', 'failed')),
  -- Why it failed (failed) or why it was rejected (rejected)
  status_reason text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source, source_id)
);

CREATE INDEX documents_status_idx ON documents (status, created_at DESC);

-- Every call to the model, with its raw answer: lets us audit and re-run the evaluations
CREATE TABLE extraction_runs (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents ON DELETE CASCADE,
  model       text   NOT NULL,
  raw_output  jsonb,
  error       text,
  duration_ms int    CHECK (duration_ms >= 0),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((raw_output IS NULL) <> (error IS NULL))
);

CREATE INDEX extraction_runs_document_idx ON extraction_runs (document_id, created_at DESC);

-- The invoice as it stands now: first what the model read, then what a person corrected.
-- Fields are nullable on purpose: a missing value is a validation issue, not an insert error.
CREATE TABLE invoices (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id    bigint NOT NULL UNIQUE REFERENCES documents ON DELETE CASCADE,
  supplier_id    int    REFERENCES suppliers,
  -- As printed on the invoice, even when it matched a known supplier
  supplier_name  text,
  supplier_tax_id text,
  invoice_number text,
  invoice_date   date,
  due_date       date,
  currency       text   NOT NULL DEFAULT 'USD' CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal       numeric(12, 2),
  tax            numeric(12, 2),
  shipping       numeric(12, 2) NOT NULL DEFAULT 0,
  total          numeric(12, 2),
  -- Result of the last validation: [{code, severity, field, message}]
  issues         jsonb  NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(issues) = 'array'),
  validated_at   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Paying the same invoice twice is the costliest mistake: look it up fast
CREATE INDEX invoices_supplier_number_idx ON invoices (supplier_id, lower(invoice_number));

CREATE TABLE invoice_lines (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  invoice_id  bigint NOT NULL REFERENCES invoices ON DELETE CASCADE,
  line_number int    NOT NULL CHECK (line_number > 0),
  description text,
  quantity    numeric(12, 3),
  unit_price  numeric(12, 4),
  amount      numeric(12, 2),
  UNIQUE (invoice_id, line_number)
);

-- Who did what. Corrections keep what the model proposed and what the person left.
CREATE TABLE review_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES documents ON DELETE CASCADE,
  actor       text   NOT NULL,
  action      text   NOT NULL CHECK (action IN ('edit', 'approve', 'reject')),
  -- edit: {before, after}; approve/reject: null
  changes     jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX review_events_document_idx ON review_events (document_id, created_at);
