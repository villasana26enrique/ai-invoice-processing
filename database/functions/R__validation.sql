-- The checks that decide whether an invoice can be approved without a person.
-- severity "error": the data is wrong or incomplete; nobody can approve it until it is fixed.
-- severity "warning": the data adds up but needs a person's eye (unknown supplier, old date); a reviewer may approve it.
-- An invoice is approved automatically only with no issues at all.

SET search_path TO invoicing;

CREATE OR REPLACE FUNCTION invoice_issues(p_invoice_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = invoicing, pg_temp AS $$
DECLARE
  inv        invoices%ROWTYPE;
  issues     jsonb := '[]';
  tolerance  numeric := amount_tolerance();
  line       record;
  line_count int;
  line_sum   numeric;
  field      text;
  duplicate  bigint;
BEGIN
  SELECT * INTO inv FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  ---------------------------------------------------------------- required fields
  FOREACH field IN ARRAY ARRAY['supplier_name', 'invoice_number', 'invoice_date', 'subtotal', 'tax', 'total'] LOOP
    IF to_jsonb(inv)->field = 'null' THEN
      issues := issues || issue('missing_field', 'error', field,
                                initcap(replace(field, '_', ' ')) || ' is missing or unreadable.');
    END IF;
  END LOOP;

  ---------------------------------------------------------------- lines
  SELECT count(*), sum(amount) INTO line_count, line_sum FROM invoice_lines WHERE invoice_id = inv.id;
  IF line_count = 0 THEN
    issues := issues || issue('no_lines', 'error', 'lines', 'The invoice has no line items.');
  END IF;

  FOR line IN SELECT * FROM invoice_lines WHERE invoice_id = inv.id ORDER BY line_number LOOP
    IF line.amount IS NULL THEN
      issues := issues || issue('missing_field', 'error', 'lines.' || line.line_number || '.amount',
                                'Line ' || line.line_number || ' has no amount.');
    ELSIF line.quantity IS NOT NULL AND line.unit_price IS NOT NULL
          AND abs(round(line.quantity * line.unit_price, 2) - line.amount) > tolerance THEN
      issues := issues || issue('line_amount_mismatch', 'error', 'lines.' || line.line_number || '.amount',
                                format('Line %s: %s x %s is %s, but the amount says %s.', line.line_number,
                                       line.quantity::float8, money_text(line.unit_price),
                                       money_text(round(line.quantity * line.unit_price, 2)), money_text(line.amount)));
    END IF;
  END LOOP;

  ---------------------------------------------------------------- totals
  -- Only when every line has an amount: otherwise the sum means nothing and the line is already reported
  IF line_count > 0 AND inv.subtotal IS NOT NULL
     AND NOT EXISTS (SELECT FROM invoice_lines WHERE invoice_id = inv.id AND amount IS NULL)
     AND abs(line_sum - inv.subtotal) > tolerance THEN
    issues := issues || issue('subtotal_mismatch', 'error', 'subtotal',
                              format('The line items add up to %s, but the subtotal says %s.',
                                     money_text(line_sum), money_text(inv.subtotal)));
  END IF;

  IF inv.subtotal IS NOT NULL AND inv.tax IS NOT NULL AND inv.total IS NOT NULL
     AND abs(inv.subtotal + inv.tax + inv.shipping - inv.total) > tolerance THEN
    issues := issues || issue('total_mismatch', 'error', 'total',
                              format('Subtotal + tax + shipping is %s, but the total says %s.',
                                     money_text(inv.subtotal + inv.tax + inv.shipping), money_text(inv.total)));
  END IF;

  IF inv.total IS NOT NULL AND inv.total <= 0 THEN
    issues := issues || issue('non_positive_total', 'error', 'total',
                              'The total is zero or negative (credit notes are not supported).');
  END IF;

  ---------------------------------------------------------------- dates
  IF inv.invoice_date > current_date THEN
    issues := issues || issue('future_date', 'error', 'invoice_date',
                              format('The invoice date (%s) is in the future.', inv.invoice_date));
  ELSIF inv.invoice_date < current_date - 365 THEN
    issues := issues || issue('old_date', 'warning', 'invoice_date',
                              format('The invoice date (%s) is more than a year ago.', inv.invoice_date));
  END IF;

  IF inv.due_date < inv.invoice_date THEN
    issues := issues || issue('due_before_invoice', 'error', 'due_date',
                              format('The due date (%s) is before the invoice date (%s).', inv.due_date, inv.invoice_date));
  END IF;

  ---------------------------------------------------------------- supplier and duplicates
  IF inv.supplier_id IS NULL AND inv.supplier_name IS NOT NULL THEN
    issues := issues || issue('unknown_supplier', 'warning', 'supplier_name',
                              format('"%s" is not a known supplier.', inv.supplier_name));
  END IF;

  IF inv.currency <> 'USD' THEN
    issues := issues || issue('foreign_currency', 'warning', 'currency',
                              format('The invoice is in %s, not USD.', inv.currency));
  END IF;

  -- Same supplier and number as an earlier invoice (or an approved one) that was not rejected: paying it would
  -- pay twice. Only earlier ones, so the original is not blocked by the copy that arrived after it.
  IF inv.invoice_number IS NOT NULL THEN
    SELECT d.id INTO duplicate
    FROM invoices other
    JOIN documents d ON d.id = other.document_id
    WHERE other.id <> inv.id
      AND d.status NOT IN ('rejected', 'failed')
      AND (d.id < inv.document_id OR d.status = 'approved')
      AND lower(btrim(other.invoice_number)) = lower(btrim(inv.invoice_number))
      AND (other.supplier_id = inv.supplier_id
           OR (inv.supplier_id IS NULL AND other.supplier_id IS NULL
               AND normalize_name(other.supplier_name) = normalize_name(inv.supplier_name)))
    ORDER BY d.id
    LIMIT 1;

    IF duplicate IS NOT NULL THEN
      issues := issues || issue('duplicate_invoice', 'error', 'invoice_number',
                                format('Invoice %s from this supplier was already received (document %s).',
                                       inv.invoice_number, duplicate));
    END IF;
  END IF;

  RETURN issues;
END $$;

-- Runs the checks, stores the result on the invoice and summarizes it. Does not change the document status.
CREATE OR REPLACE FUNCTION validate_invoice(p_document_id bigint) RETURNS jsonb
LANGUAGE plpgsql
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_invoice_id bigint := (SELECT id FROM invoices WHERE document_id = p_document_id);
  v_issues     jsonb;
BEGIN
  IF v_invoice_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This document has no invoice yet.');
  END IF;

  v_issues := invoice_issues(v_invoice_id);
  UPDATE invoices SET issues = v_issues, validated_at = now() WHERE id = v_invoice_id;

  RETURN jsonb_build_object(
    'ok', true,
    'issues', v_issues,
    'errors', (SELECT count(*) FROM jsonb_array_elements(v_issues) i WHERE i->>'severity' = 'error'),
    'warnings', (SELECT count(*) FROM jsonb_array_elements(v_issues) i WHERE i->>'severity' = 'warning'));
END $$;
