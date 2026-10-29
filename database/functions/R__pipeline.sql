-- What the extraction pipeline (n8n) calls: register a file, then record what the model read (or why it failed).
-- Statuses: received -> approved | needs_review (extraction worked) or failed (it did not; can be retried).
-- Callable by invoice_app: SECURITY DEFINER, so the role itself never writes the tables directly.

SET search_path TO invoicing;

-- First step for every file. The same bytes sent twice (from Drive and from the web, for example) are one document.
CREATE OR REPLACE FUNCTION register_document(p_source text, p_source_id text, p_file_name text, p_mime_type text,
                                             p_file_sha256 text, p_storage_path text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  existing documents%ROWTYPE;
  v_id     bigint;
BEGIN
  IF p_source NOT IN ('google_drive', 'upload') OR p_source IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown source: ' || coalesce(p_source, 'null'));
  END IF;
  IF p_mime_type NOT IN ('application/pdf', 'image/jpeg', 'image/png', 'image/webp') OR p_mime_type IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message',
                              'Unsupported file type: ' || coalesce(p_mime_type, 'null') || '. Send a PDF or a photo.');
  END IF;
  IF p_file_sha256 !~ '^[0-9a-f]{64}$' OR p_file_sha256 IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The file hash must be a lowercase sha256.');
  END IF;
  IF nullif(btrim(p_source_id), '') IS NULL OR nullif(btrim(p_file_name), '') IS NULL
     OR nullif(btrim(p_storage_path), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Source id, file name and storage path are required.');
  END IF;

  SELECT * INTO existing FROM documents WHERE file_sha256 = p_file_sha256;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'action', 'duplicate_file', 'document_id', existing.id,
                              'status', existing.status);
  END IF;

  IF EXISTS (SELECT FROM documents WHERE source = p_source AND source_id = p_source_id) THEN
    RETURN jsonb_build_object('ok', false, 'message',
                              'Another file was already received with this source id: ' || p_source_id);
  END IF;

  INSERT INTO documents (source, source_id, file_name, mime_type, file_sha256, storage_path)
  VALUES (p_source, btrim(p_source_id), btrim(p_file_name), p_mime_type, p_file_sha256, btrim(p_storage_path))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'action', 'registered', 'document_id', v_id, 'status', 'received');
END $$;

-- The model read the invoice: keep its raw answer, store the invoice, validate it and decide the status.
-- p_output is the structured output of the model (the shape of invoice_json, values may be null or unreadable).
CREATE OR REPLACE FUNCTION record_extraction(p_document_id bigint, p_model text, p_output jsonb,
                                             p_duration_ms int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_status     text;
  v_validation jsonb;
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown document: ' || coalesce(p_document_id::text, 'null'));
  END IF;
  -- A person may already be working on it, or it was decided: a late or repeated run must not overwrite that
  IF v_status NOT IN ('received', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The document was already extracted (status ' || v_status || ').');
  END IF;
  IF jsonb_typeof(p_output) IS DISTINCT FROM 'object' THEN
    RETURN record_extraction_failure(p_document_id, p_model, 'The model did not return a JSON object.', p_duration_ms);
  END IF;

  INSERT INTO extraction_runs (document_id, model, raw_output, duration_ms)
  VALUES (p_document_id, coalesce(p_model, 'unknown'), p_output, p_duration_ms);

  PERFORM write_invoice(p_document_id, p_output);
  v_validation := validate_invoice(p_document_id);

  -- Approved without a person only when nothing at all needs attention
  v_status := CASE WHEN jsonb_array_length(v_validation->'issues') = 0 THEN 'approved' ELSE 'needs_review' END;
  UPDATE documents SET status = v_status, status_reason = NULL, updated_at = now() WHERE id = p_document_id;

  RETURN jsonb_build_object('ok', true, 'document_id', p_document_id, 'status', v_status,
                            'issues', v_validation->'issues');
END $$;

-- The model could not read the file (timeout, quota, invalid answer). The file is kept; running again retries it.
CREATE OR REPLACE FUNCTION record_extraction_failure(p_document_id bigint, p_model text, p_error text,
                                                     p_duration_ms int DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = invoicing, pg_temp AS $$
DECLARE
  v_status text;
  v_error  text := coalesce(nullif(btrim(p_error), ''), 'Unknown error');
BEGIN
  SELECT status INTO v_status FROM documents WHERE id = p_document_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'message', 'Unknown document: ' || coalesce(p_document_id::text, 'null'));
  END IF;
  IF v_status NOT IN ('received', 'failed') THEN
    RETURN jsonb_build_object('ok', false, 'message', 'The document was already extracted (status ' || v_status || ').');
  END IF;

  INSERT INTO extraction_runs (document_id, model, error, duration_ms)
  VALUES (p_document_id, coalesce(p_model, 'unknown'), v_error, p_duration_ms);
  UPDATE documents SET status = 'failed', status_reason = v_error, updated_at = now() WHERE id = p_document_id;

  RETURN jsonb_build_object('ok', true, 'document_id', p_document_id, 'status', 'failed');
END $$;
