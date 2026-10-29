-- What the review page calls. A person corrects the invoice, then approves or rejects it.
-- Every change is revalidated here, and every action is recorded in review_events with who did it.
-- The actor comes from the page's session, never from what the user typed.

SET search_path TO invoicing;

-- Saves the corrected invoice (all fields and lines, in the shape of invoice_json) and validates it again.
-- The document stays in review: approving is a separate, explicit step.
CREATE OR REPLACE FUNCTION save_review(p_document_id bigint, p_actor text, p_invoice jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_status     text;
  v_before     jsonb;
  v_after      jsonb;
  v_validation jsonb;
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown document.');
  END IF;
  IF v_status <> 'needs_review' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only invoices waiting for review can be edited.');
  END IF;
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Who is reviewing is required.');
  END IF;
  IF jsonb_typeof(p_invoice) IS DISTINCT FROM 'object' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The invoice must be a JSON object.');
  END IF;

  v_before := invoice_json(p_document_id);
  PERFORM write_invoice(p_document_id, p_invoice);
  v_after := invoice_json(p_document_id);

  -- Saving without changing anything is not a correction
  IF v_after IS DISTINCT FROM v_before THEN
    INSERT INTO review_events (document_id, actor, action, changes)
    VALUES (p_document_id, btrim(p_actor), 'edit', jsonb_build_object('before', v_before, 'after', v_after));
  END IF;
  UPDATE documents SET updated_at = now() WHERE id = p_document_id;

  v_validation := validate_invoice(p_document_id);
  RETURN jsonb_build_object('ok', true, 'invoice', v_after, 'issues', v_validation->'issues');
END $$;

-- Approves an invoice in review. Errors block it (the data must be fixed first); warnings are what the person checked.
CREATE OR REPLACE FUNCTION approve_invoice(p_document_id bigint, p_actor text, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_status     text;
  v_validation jsonb;
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown document.');
  END IF;
  IF v_status <> 'needs_review' THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Only invoices waiting for review can be approved.');
  END IF;
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Who is reviewing is required.');
  END IF;

  -- Validate again: another invoice may have been approved since (a duplicate, for example)
  v_validation := validate_invoice(p_document_id);
  IF (v_validation->>'errors')::int > 0 THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Fix the errors before approving.',
                              'issues', v_validation->'issues');
  END IF;

  UPDATE documents SET status = 'approved', status_reason = NULL, updated_at = now() WHERE id = p_document_id;
  INSERT INTO review_events (document_id, actor, action, note)
  VALUES (p_document_id, btrim(p_actor), 'approve', nullif(btrim(p_note), ''));

  RETURN jsonb_build_object('ok', true, 'status', 'approved', 'issues', v_validation->'issues');
END $$;

-- Rejects an invoice (not ours, a real duplicate, unreadable). Also an automatically approved one, if a person
-- spots a problem before it is paid.
CREATE OR REPLACE FUNCTION reject_invoice(p_document_id bigint, p_actor text, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown document.');
  END IF;
  IF v_status NOT IN ('needs_review', 'approved', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'This document cannot be rejected (status ' || v_status || ').');
  END IF;
  IF nullif(btrim(p_actor), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Who is reviewing is required.');
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Say why it is rejected.');
  END IF;

  UPDATE documents SET status = 'rejected', status_reason = btrim(p_reason), updated_at = now()
  WHERE id = p_document_id;
  INSERT INTO review_events (document_id, actor, action, note)
  VALUES (p_document_id, btrim(p_actor), 'reject', btrim(p_reason));

  RETURN jsonb_build_object('ok', true, 'status', 'rejected');
END $$;
