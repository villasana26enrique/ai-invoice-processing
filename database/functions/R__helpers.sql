-- Small helpers to read what the model (or a person) typed without failing on bad input.
-- An unreadable value becomes null, and validation reports it as missing: one typo never stops the pipeline.

SET search_path TO invoicing;

-- "2026-03-15" -> date; "15/03/2026", "next Friday", "" -> null. Only ISO dates: the model is asked for them.
CREATE OR REPLACE FUNCTION try_date(p_value text) RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
BEGIN
  IF p_value !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN p_value::date;
EXCEPTION WHEN others THEN
  RETURN NULL;  -- 2026-02-30
END $$;

-- "1,234.50", "$1234.5", 1234.5 -> 1234.50; "", "N/A" -> null
CREATE OR REPLACE FUNCTION try_amount(p_value text) RETURNS numeric
LANGUAGE plpgsql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
BEGIN
  RETURN nullif(regexp_replace(btrim(p_value), '[$,\s]', '', 'g'), '')::numeric;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION normalize_name(p_name text) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
  -- Same expression as suppliers.normalized_name
  SELECT nullif(lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '', 'g')), '')
$$;

-- Rounding differences a real invoice can have (taxes rounded per line, for example)
CREATE OR REPLACE FUNCTION amount_tolerance() RETURNS numeric
LANGUAGE sql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
  SELECT 0.02::numeric
$$;

-- 1234.5 -> "$1,234.50", for the messages a reviewer reads
CREATE OR REPLACE FUNCTION money_text(p_amount numeric) RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
  SELECT CASE WHEN p_amount < 0 THEN '-' ELSE '' END || '$' || btrim(to_char(abs(p_amount), 'FM999,999,999,990.00'))
$$;

-- One validation issue, in the shape the review page shows: {code, severity, field, message}
CREATE OR REPLACE FUNCTION issue(p_code text, p_severity text, p_field text, p_message text) RETURNS jsonb
LANGUAGE sql IMMUTABLE
SET search_path = invoicing, pg_temp AS $$
  SELECT jsonb_build_array(jsonb_build_object('code', p_code, 'severity', p_severity, 'field', p_field,
                                              'message', p_message))
$$;

-- Known supplier for a name and/or tax id printed on an invoice. The tax id wins: names are written in many ways.
CREATE OR REPLACE FUNCTION match_supplier(p_name text, p_tax_id text) RETURNS int
LANGUAGE sql STABLE
SET search_path = invoicing, pg_temp AS $$
  SELECT coalesce(
    (SELECT id FROM suppliers WHERE tax_id = btrim(p_tax_id)),
    (SELECT id FROM suppliers WHERE normalized_name = normalize_name(p_name)))
$$;

-- The invoice with its lines, as the review page shows it and as review_events stores it
CREATE OR REPLACE FUNCTION invoice_json(p_document_id bigint) RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = invoicing, pg_temp AS $$
  SELECT jsonb_build_object(
    'supplier_id', i.supplier_id, 'supplier_name', i.supplier_name, 'supplier_tax_id', i.supplier_tax_id,
    'invoice_number', i.invoice_number, 'invoice_date', i.invoice_date, 'due_date', i.due_date,
    'currency', i.currency, 'subtotal', i.subtotal, 'tax', i.tax, 'shipping', i.shipping, 'total', i.total,
    'lines', coalesce((SELECT jsonb_agg(jsonb_build_object(
                         'line_number', l.line_number, 'description', l.description, 'quantity', l.quantity,
                         'unit_price', l.unit_price, 'amount', l.amount) ORDER BY l.line_number)
                       FROM invoice_lines l WHERE l.invoice_id = i.id), '[]'))
  FROM invoices i
  WHERE i.document_id = p_document_id
$$;

-- Replaces the invoice of a document (fields and lines) with p_invoice, in the shape invoice_json returns.
-- Used by the pipeline (what the model read) and by the review page (what a person corrected).
-- Internal: not SECURITY DEFINER, so invoice_app (read-only on the tables) cannot call it directly.
CREATE OR REPLACE FUNCTION write_invoice(p_document_id bigint, p_invoice jsonb) RETURNS bigint
LANGUAGE plpgsql
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_invoice_id  bigint;
  v_supplier_id int;
  v_lines       jsonb := coalesce(p_invoice->'lines', '[]');
BEGIN
  IF jsonb_typeof(v_lines) <> 'array' THEN
    v_lines := '[]';
  END IF;

  -- An explicit supplier (chosen on the review page) wins over matching by name
  v_supplier_id := coalesce((SELECT id FROM suppliers WHERE id::text = p_invoice->>'supplier_id'),
                            match_supplier(p_invoice->>'supplier_name', p_invoice->>'supplier_tax_id'));

  INSERT INTO invoices AS i (document_id, supplier_id, supplier_name, supplier_tax_id, invoice_number,
                             invoice_date, due_date, currency, subtotal, tax, shipping, total, updated_at)
  VALUES (p_document_id, v_supplier_id,
          nullif(btrim(p_invoice->>'supplier_name'), ''), nullif(btrim(p_invoice->>'supplier_tax_id'), ''),
          nullif(btrim(p_invoice->>'invoice_number'), ''),
          try_date(p_invoice->>'invoice_date'), try_date(p_invoice->>'due_date'),
          coalesce(upper(nullif(btrim(p_invoice->>'currency'), '')), 'USD'),
          try_amount(p_invoice->>'subtotal'), try_amount(p_invoice->>'tax'),
          coalesce(try_amount(p_invoice->>'shipping'), 0), try_amount(p_invoice->>'total'), now())
  ON CONFLICT (document_id) DO UPDATE SET
    supplier_id = excluded.supplier_id, supplier_name = excluded.supplier_name,
    supplier_tax_id = excluded.supplier_tax_id, invoice_number = excluded.invoice_number,
    invoice_date = excluded.invoice_date, due_date = excluded.due_date, currency = excluded.currency,
    subtotal = excluded.subtotal, tax = excluded.tax, shipping = excluded.shipping, total = excluded.total,
    updated_at = now()
  RETURNING i.id INTO v_invoice_id;

  DELETE FROM invoice_lines WHERE invoice_id = v_invoice_id;
  INSERT INTO invoice_lines (invoice_id, line_number, description, quantity, unit_price, amount)
  SELECT v_invoice_id, n, nullif(btrim(l->>'description'), ''),
         try_amount(l->>'quantity'), try_amount(l->>'unit_price'), try_amount(l->>'amount')
  FROM jsonb_array_elements(v_lines) WITH ORDINALITY AS t(l, n)
  WHERE jsonb_typeof(l) = 'object';

  RETURN v_invoice_id;
END $$;
