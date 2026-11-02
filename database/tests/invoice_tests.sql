-- Database tests for registration, extraction, validation, review and the app role's permissions.
-- Runs inside a transaction that is rolled back: nothing is left behind.
-- The assertions run as invoice_app (the role the pipeline and the review page use).
-- Expected output: NOTICE: ALL TESTS PASSED

\set ON_ERROR_STOP on
BEGIN;

-- Fixtures (as the owner: invoice_app cannot write tables)
INSERT INTO invoicing.suppliers (name, tax_id) VALUES
  ('TEST Acme Dental Supply, Inc.', '11-1111111'),
  ('TEST Bright Smile Labs LLC', '22-2222222');

-- A clean invoice from Acme, dated last week: 2 x $10.00 + 1 x $5.50 = $25.50, tax $2.04, shipping $4.00
CREATE FUNCTION pg_temp.clean_invoice(p_number text DEFAULT 'INV-1001') RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'supplier_name', 'test acme dental supply inc', 'supplier_tax_id', NULL,
    'invoice_number', p_number, 'invoice_date', (current_date - 7)::text, 'due_date', (current_date + 23)::text,
    'currency', 'USD', 'subtotal', 25.50, 'tax', 2.04, 'shipping', 4.00, 'total', 31.54,
    'lines', jsonb_build_array(
      jsonb_build_object('description', 'Nitrile gloves (box)', 'quantity', 2, 'unit_price', 10, 'amount', 20.00),
      jsonb_build_object('description', 'Prophy paste', 'quantity', 1, 'unit_price', 5.5, 'amount', 5.50)))
$$;

SET LOCAL ROLE invoice_app;

DO $$
DECLARE
  r      jsonb;
  doc    bigint;
  first  bigint;
  copy   bigint;
BEGIN
  ---------------------------------------------------------------- helpers
  ASSERT invoicing.try_date('2026-03-15') = '2026-03-15'::date, 'ISO dates should parse';
  ASSERT invoicing.try_date('2026-02-30') IS NULL AND invoicing.try_date('03/15/2026') IS NULL
         AND invoicing.try_date('') IS NULL, 'Invalid or non-ISO dates should become null';
  ASSERT invoicing.try_amount('$1,234.50') = 1234.50 AND invoicing.try_amount('12') = 12,
         'Amounts with $ and thousands separators should parse';
  ASSERT invoicing.try_amount('N/A') IS NULL AND invoicing.try_amount('') IS NULL, 'Unreadable amounts become null';
  ASSERT invoicing.money_text(1234.5) = '$1,234.50' AND invoicing.money_text(-3) = '-$3.00',
         'Money should read like money: ' || invoicing.money_text(1234.5);

  ---------------------------------------------------------------- registration
  r := invoicing.register_document('upload', 'test-1', 'TEST invoice.pdf', 'application/pdf', repeat('a', 64), 'test/1.pdf');
  ASSERT (r->>'ok')::boolean AND r->>'action' = 'registered' AND r->>'status' = 'received',
         'A new file should be registered: ' || r::text;
  doc := (r->>'document_id')::bigint;

  r := invoicing.register_document('google_drive', 'drive-9', 'copy.pdf', 'application/pdf', repeat('a', 64), 'test/9.pdf');
  ASSERT (r->>'ok')::boolean AND r->>'action' = 'duplicate_file' AND (r->>'document_id')::bigint = doc,
         'The same bytes from another source should be the same document: ' || r::text;

  r := invoicing.register_document('upload', 'test-1', 'other.pdf', 'application/pdf', repeat('b', 64), 'test/b.pdf');
  ASSERT (r->>'ok')::boolean = false, 'A source id cannot be reused by a different file';
  r := invoicing.register_document('upload', 'test-x', 'x.docx', 'application/msword', repeat('c', 64), 'test/x');
  ASSERT (r->>'ok')::boolean = false AND r->>'message' LIKE 'Unsupported file type%', 'Only PDFs and photos';
  r := invoicing.register_document('upload', 'test-x', 'x.pdf', 'application/pdf', 'not-a-hash', 'test/x');
  ASSERT (r->>'ok')::boolean = false, 'The hash must be a sha256';
  r := invoicing.register_document('email', 'test-x', 'x.pdf', 'application/pdf', repeat('c', 64), 'test/x');
  ASSERT (r->>'ok')::boolean = false, 'Unknown sources should be rejected';
  r := invoicing.register_document('upload', ' ', 'x.pdf', 'application/pdf', repeat('c', 64), 'test/x');
  ASSERT (r->>'ok')::boolean = false, 'A source id is required';

  ---------------------------------------------------------------- a clean invoice is approved alone
  r := invoicing.record_extraction(doc, 'test-model', pg_temp.clean_invoice(), 1200);
  ASSERT (r->>'ok')::boolean AND r->>'status' = 'approved' AND jsonb_array_length(r->'issues') = 0,
         'A clean invoice from a known supplier should be approved automatically: ' || r::text;
  ASSERT (SELECT supplier_id = (SELECT id FROM invoicing.suppliers WHERE tax_id = '11-1111111')
          FROM invoicing.invoices WHERE document_id = doc),
         'The supplier should match by name, ignoring case and punctuation';
  ASSERT (SELECT count(*) FROM invoicing.invoice_lines l JOIN invoicing.invoices i ON i.id = l.invoice_id
          WHERE i.document_id = doc) = 2, 'The lines should be stored';
  ASSERT (SELECT raw_output->>'invoice_number' = 'INV-1001' AND duration_ms = 1200
          FROM invoicing.extraction_runs WHERE document_id = doc), 'The raw model output should be kept';
  ASSERT (SELECT approved_by = 'automatic' AND total = 31.54 FROM invoicing.approved_invoices WHERE document_id = doc),
         'An automatic approval should be exported as "automatic"';

  r := invoicing.record_extraction(doc, 'test-model', pg_temp.clean_invoice());
  ASSERT (r->>'ok')::boolean = false, 'A decided document must not be extracted again';
  r := invoicing.record_extraction(999999999, 'test-model', pg_temp.clean_invoice());
  ASSERT (r->>'ok')::boolean = false, 'Unknown documents should be rejected';

  ---------------------------------------------------------------- each check, one invoice at a time
  -- Registers a fresh fake file, records p_output for it and returns the result (with its document_id)
  CREATE FUNCTION pg_temp.extract(p_output jsonb) RETURNS jsonb
  LANGUAGE plpgsql AS $f$
  DECLARE
    v_n   int := (SELECT count(*) FROM invoicing.documents) + 1000;
    v_reg jsonb;
  BEGIN
    v_reg := invoicing.register_document('upload', 'test-' || v_n, 'TEST ' || v_n || '.pdf', 'application/pdf',
                                         encode(sha256(v_n::text::bytea), 'hex'), 'test/' || v_n || '.pdf');
    RETURN invoicing.record_extraction((v_reg->>'document_id')::bigint, 'test-model', p_output);
  END $f$;

  CREATE FUNCTION pg_temp.codes(p_result jsonb) RETURNS text[]
  LANGUAGE sql IMMUTABLE AS $f$
    SELECT coalesce(array_agg(i->>'code' ORDER BY i->>'code'), '{}') FROM jsonb_array_elements(p_result->'issues') i
  $f$;

  -- Matched by tax id even with the name written differently
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2001') || '{"supplier_name": "Acme (Dental)", "supplier_tax_id": "11-1111111"}');
  ASSERT r->>'status' = 'approved', 'The tax id should match the supplier: ' || r::text;

  -- Rounding inside the tolerance is fine; outside it is not
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2002') || '{"total": 31.55}');
  ASSERT r->>'status' = 'approved', 'A one-cent difference is within the tolerance: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2003') || '{"total": 31.57}');
  ASSERT r->>'status' = 'needs_review' AND pg_temp.codes(r) = '{total_mismatch}',
         'Three cents off the total should go to review: ' || r::text;
  ASSERT r->'issues'->0->>'message' = 'Subtotal + tax + shipping is $31.54, but the total says $31.57.'
         AND r->'issues'->0->>'severity' = 'error' AND r->'issues'->0->>'field' = 'total',
         'The message should say what does not add up: ' || r::text;

  r := pg_temp.extract(pg_temp.clean_invoice('INV-2004') || '{"subtotal": 27.50, "total": 33.54}');
  ASSERT pg_temp.codes(r) = '{subtotal_mismatch}', 'Lines that do not add up to the subtotal: ' || r::text;

  r := pg_temp.extract(jsonb_set(pg_temp.clean_invoice('INV-2005'), '{lines,0,amount}', '21.00'));
  ASSERT pg_temp.codes(r) = '{line_amount_mismatch,subtotal_mismatch}',
         'A line whose quantity x price is not its amount: ' || r::text;
  ASSERT r->'issues'->0->>'message' = 'Line 1: 2 x $10.00 is $20.00, but the amount says $21.00.',
         'The line message should show the math: ' || r::text;

  -- A line with only an amount (a flat fee) is fine
  r := pg_temp.extract(jsonb_set(pg_temp.clean_invoice('INV-2006'), '{lines,1}',
                                 '{"description": "Handling fee", "amount": 5.50}'));
  ASSERT r->>'status' = 'approved', 'A line with only an amount should be accepted: ' || r::text;
  r := pg_temp.extract(jsonb_set(pg_temp.clean_invoice('INV-2007'), '{lines,1,amount}', '"N/A"'));
  ASSERT pg_temp.codes(r) = '{missing_field}' AND r->'issues'->0->>'field' = 'lines.2.amount',
         'A line without an amount (and no subtotal check on a broken sum): ' || r::text;

  r := pg_temp.extract(pg_temp.clean_invoice('INV-2008') || '{"total": "N/A", "invoice_date": "15/03/2026"}');
  ASSERT pg_temp.codes(r) = '{missing_field,missing_field}', 'Unreadable values are missing fields: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2009') || '{"lines": []}');
  ASSERT pg_temp.codes(r) = '{no_lines}', 'An invoice needs line items: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2010') || '{"subtotal": 0, "tax": 0, "shipping": 0, "total": 0, "lines": [{"amount": 0}]}');
  ASSERT pg_temp.codes(r) = '{non_positive_total}', 'A zero total is not an invoice to pay: ' || r::text;

  -- Dates
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2011') || jsonb_build_object('invoice_date', (current_date + 1)::text));
  ASSERT pg_temp.codes(r) = '{future_date}', 'Future invoice dates are errors: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2013') || jsonb_build_object('invoice_date', (current_date - 400)::text,
                                                                             'due_date', (current_date - 370)::text));
  ASSERT r->>'status' = 'needs_review' AND pg_temp.codes(r) = '{old_date}'
         AND r->'issues'->0->>'severity' = 'warning', 'Old invoices are a warning: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2014') || jsonb_build_object('due_date', (current_date - 10)::text));
  ASSERT pg_temp.codes(r) = '{due_before_invoice}', 'A due date before the invoice date: ' || r::text;

  -- Supplier and currency
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2015') || '{"supplier_name": "TEST Unknown Dental Co"}');
  ASSERT r->>'status' = 'needs_review' AND pg_temp.codes(r) = '{unknown_supplier}',
         'An unknown supplier always goes to review: ' || r::text;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-2016') || '{"currency": "cad"}');
  ASSERT pg_temp.codes(r) = '{foreign_currency}', 'Non-USD invoices need a look: ' || r::text;

  ---------------------------------------------------------------- duplicates
  r := pg_temp.extract(pg_temp.clean_invoice(' inv-1001 '));
  ASSERT r->>'status' = 'needs_review' AND pg_temp.codes(r) = '{duplicate_invoice}',
         'Same supplier and number (any case or spacing) should be a duplicate: ' || r::text;
  copy := (r->>'document_id')::bigint;
  r := invoicing.approve_invoice(copy, 'test-reviewer');
  ASSERT (r->>'ok')::boolean = false, 'A duplicate cannot be approved, even by a person';

  r := pg_temp.extract(pg_temp.clean_invoice('INV-1001') || '{"supplier_name": "TEST Bright Smile Labs LLC"}');
  ASSERT r->>'status' = 'approved', 'The same number from another supplier is not a duplicate: ' || r::text;

  -- Two invoices waiting for review: only the later one is the duplicate, so the first one can still be approved
  r := pg_temp.extract(pg_temp.clean_invoice('INV-3001') || '{"supplier_name": "TEST Unknown Dental Co"}');
  first := (r->>'document_id')::bigint;
  r := pg_temp.extract(pg_temp.clean_invoice('INV-3001') || '{"supplier_name": "TEST Unknown Dental Co."}');
  ASSERT pg_temp.codes(r) = '{duplicate_invoice,unknown_supplier}',
         'Unknown suppliers are compared by name for duplicates: ' || r::text;
  r := invoicing.approve_invoice(first, 'test-reviewer', 'New supplier, checked by phone');
  ASSERT (r->>'ok')::boolean AND r->>'status' = 'approved',
         'The original must not be blocked by the copy that came after it: ' || r::text;

  ---------------------------------------------------------------- review: fix, approve, reject
  r := pg_temp.extract(pg_temp.clean_invoice('INV-4001') || '{"total": 13.54}');
  doc := (r->>'document_id')::bigint;
  r := invoicing.approve_invoice(doc, 'test-reviewer');
  ASSERT (r->>'ok')::boolean = false AND pg_temp.codes(r) = '{total_mismatch}',
         'Errors block approval and come back to show: ' || r::text;

  r := invoicing.save_review(doc, 'test-reviewer', invoicing.invoice_json(doc) || '{"total": "31.54"}');
  ASSERT (r->>'ok')::boolean AND jsonb_array_length(r->'issues') = 0, 'The corrected invoice validates: ' || r::text;
  ASSERT (SELECT status FROM invoicing.documents WHERE id = doc) = 'needs_review',
         'Saving is not approving: the document stays in review';
  ASSERT (SELECT changes->'before'->>'total' = '13.54' AND changes->'after'->>'total' = '31.54' AND actor = 'test-reviewer'
          FROM invoicing.review_events WHERE document_id = doc AND action = 'edit'),
         'The correction should record what the model said, what the person left and who';

  r := invoicing.save_review(doc, 'test-reviewer', invoicing.invoice_json(doc));
  ASSERT (SELECT count(*) FROM invoicing.review_events WHERE document_id = doc) = 1,
         'Saving without changes is not a correction';

  r := invoicing.approve_invoice(doc, ' ');
  ASSERT (r->>'ok')::boolean = false, 'Approving needs who approves';
  r := invoicing.approve_invoice(doc, 'test-reviewer');
  ASSERT (r->>'ok')::boolean AND (SELECT approved_by FROM invoicing.approved_invoices WHERE document_id = doc) = 'test-reviewer',
         'An approved invoice is exported with who approved it: ' || r::text;
  r := invoicing.save_review(doc, 'test-reviewer', invoicing.invoice_json(doc) || '{"total": 1}');
  ASSERT (r->>'ok')::boolean = false, 'An approved invoice cannot be edited';

  -- Rejecting: a reason is required; an automatic approval can be rejected before it is paid
  r := invoicing.reject_invoice(copy, 'test-reviewer', '');
  ASSERT (r->>'ok')::boolean = false, 'Rejecting needs a reason';
  r := invoicing.reject_invoice(copy, 'test-reviewer', 'Duplicate of INV-1001');
  ASSERT (r->>'ok')::boolean AND (SELECT status_reason FROM invoicing.documents WHERE id = copy) = 'Duplicate of INV-1001',
         'A rejected document keeps its reason: ' || r::text;
  r := invoicing.reject_invoice(copy, 'test-reviewer', 'again');
  ASSERT (r->>'ok')::boolean = false, 'A rejected document is final';

  r := pg_temp.extract(pg_temp.clean_invoice('INV-5001'));
  doc := (r->>'document_id')::bigint;
  r := invoicing.reject_invoice(doc, 'test-reviewer', 'Not ordered by the clinic');
  ASSERT (r->>'ok')::boolean, 'An automatically approved invoice can still be rejected';
  r := pg_temp.extract(pg_temp.clean_invoice('INV-5001'));
  ASSERT r->>'status' = 'approved', 'A rejected invoice does not count as a duplicate: ' || r::text;

  ---------------------------------------------------------------- failures and retries
  r := invoicing.register_document('upload', 'test-fail', 'TEST blurry.jpg', 'image/jpeg', repeat('f', 64), 'test/f.jpg');
  doc := (r->>'document_id')::bigint;
  r := invoicing.record_extraction(doc, 'test-model', '"not an object"');
  ASSERT (r->>'ok')::boolean AND r->>'status' = 'failed', 'An invalid model answer marks the document failed: ' || r::text;
  r := invoicing.record_extraction_failure(doc, 'test-model', '503 Service Unavailable', 30000);
  ASSERT (SELECT status = 'failed' AND status_reason = '503 Service Unavailable' FROM invoicing.documents WHERE id = doc),
         'A failure keeps the error';
  r := invoicing.record_extraction(doc, 'test-model', pg_temp.clean_invoice('INV-6001'));
  ASSERT r->>'status' = 'approved' AND (SELECT status_reason FROM invoicing.documents WHERE id = doc) IS NULL,
         'A failed document can be retried: ' || r::text;
  ASSERT (SELECT count(*) FROM invoicing.extraction_runs WHERE document_id = doc) = 3, 'Every attempt is kept';

  -- A file that will never be read (not an invoice, a blank page) is rejected so it leaves the queue
  r := invoicing.register_document('upload', 'test-unreadable', 'TEST blank.jpg', 'image/jpeg', repeat('e', 64), 'test/e.jpg');
  doc := (r->>'document_id')::bigint;
  r := invoicing.record_extraction_failure(doc, 'test-model', 'No invoice found', 1000);
  r := invoicing.reject_invoice(doc, 'test-reviewer', 'Not an invoice');
  ASSERT (r->>'ok')::boolean AND (SELECT status = 'rejected' AND status_reason = 'Not an invoice' FROM invoicing.documents WHERE id = doc),
         'A failed document can be rejected with a reason: ' || r::text;
  ASSERT (SELECT actor FROM invoicing.review_events WHERE document_id = doc AND action = 'reject') = 'test-reviewer',
         'The rejection records who did it';
  r := invoicing.record_extraction(doc, 'test-model', pg_temp.clean_invoice('INV-6002'));
  ASSERT (SELECT status FROM invoicing.documents WHERE id = doc) = 'rejected', 'A rejected document is not read again: ' || r::text;

  ---------------------------------------------------------------- invoice_app writes only through the functions
  BEGIN
    UPDATE invoicing.documents SET status = 'approved' WHERE id = copy;
    ASSERT false, 'invoice_app must not update documents directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO invoicing.review_events (document_id, actor, action) VALUES (copy, 'intruder', 'approve');
    ASSERT false, 'invoice_app must not write review events directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM invoicing.write_invoice(copy, pg_temp.clean_invoice());
    ASSERT false, 'invoice_app must not call the internal write_invoice';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM invoicing.validate_invoice(copy);
    ASSERT false, 'invoice_app must not call the internal validate_invoice';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  ASSERT (SELECT status FROM invoicing.documents WHERE id = copy) = 'rejected', 'Nothing above should have changed';

  RAISE NOTICE 'ALL TESTS PASSED';
END $$;

ROLLBACK;
