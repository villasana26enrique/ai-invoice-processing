# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Cursor, …) working in this repository.
Read `README.md` first for what the project does and how it is structured.

## Project in one paragraph

Supplier invoices (PDFs or photos) arrive from a Google Drive folder or a web upload. A model extracts their data,
**PostgreSQL validates it** (lines add up, totals match, required fields, dates, duplicates, known supplier) and
decides: approved automatically when nothing needs attention, otherwise waiting for a person on the review page,
who corrects, approves or rejects it. Every correction is recorded. Schema `invoicing`.

## Conventions

- **Everything technical is in English**: tables, columns, functions, files, comments, commit messages, docs.
  Validation messages are English too: the review page shows them as they are.
- **Business rules live in the database**, not in n8n Code nodes, prompts or the web page. Callers stay thin:
  call a function, branch on `ok`, show `message` and `issues`.
- Functions return `jsonb` with `ok` (and `message` when something is wrong) instead of raising errors for
  business cases.
- Every function declares `SET search_path = invoicing, pg_temp`.
- Plain PostgreSQL 15+, no extensions and nothing that needs a superuser: the same schema must run on Supabase.

## Statuses and validation (read before touching `R__validation.sql` or the statuses)

- `received` → `approved` | `needs_review` (extraction worked) or `failed` (retryable). A person moves
  `needs_review` → `approved` | `rejected`, and may reject an `approved` or `failed` one. `rejected` is final.
- Issues are `{code, severity, field, message}`. `error`: the data is wrong; nobody can approve it until fixed.
  `warning`: the data adds up but needs a person's eye; a reviewer may approve it.
- **Automatic approval only with no issues at all**, warnings included. Never loosen this: the selling point is
  that what is approved without a person is right.
- Duplicates (same supplier and number) are checked only against earlier or approved invoices that were not
  rejected, so the original is never blocked by a later copy.
- Amount tolerance: `amount_tolerance()` (2 cents). New check = new issue code + a test.

## invoice_app (who can write what)

- The pipeline and the review page connect as **`invoice_app`**: `SELECT` on the tables, no direct writes.
- Data only changes through the `SECURITY DEFINER` functions: `register_document`, `record_extraction`,
  `record_extraction_failure`, `save_review`, `approve_invoice`, `reject_invoice`.
- Internal functions (`write_invoice`, `validate_invoice`) are **not** `SECURITY DEFINER`, so invoice_app cannot
  call them successfully. Keep it that way: making one a definer would let the app skip the checks.
- The reviewer (`p_actor`) comes from the page's session, never from a form field.

## Database changes (Flyway)

- New tables, columns or data: add `database/migrations/V<next>__short_description.sql`.
  **Never modify a versioned migration that has already been applied.**
- Functions and views: edit or add `database/functions/R__*.sql` (re-runnable, `CREATE OR REPLACE`).
  Flyway runs them in alphabetical order; grants on a view go in the view's own file.
- Apply: `docker compose run --rm flyway` (also runs on `docker compose up`).
- Run the tests after any database change and keep them green:

  ```bash
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/tests/invoice_tests.sql
  ```

  They run in a rolled-back transaction, **as `invoice_app`**, and print `ALL TESTS PASSED`. Add a test for new
  behavior, and check it fails when the rule is broken on purpose. In assertion messages concatenate `r::text`,
  not `r`.

## n8n pipeline (`n8n/workflows/`)

- `Extract: Process invoice` (sub-workflow, called by both entries) fingerprints the file (sha256), registers it,
  saves the original to `/data/invoices/<sha256>.<ext>`, asks Gemini for the invoice as JSON (structured output:
  `responseSchema`, file sent inline) and records the result or the failure. It always ends in one result item:
  `{ok, action, document_id, status, issues, message, file_name}`.
- `Ingest: Upload API` (`POST /webhook/invoices`, `X-API-Key`, multipart field `file`) answers with that result:
  200, or 422 when the extraction failed; 400 for a bad request.
- `Ingest: Sync Google Drive` (every 5 minutes) processes the files of `DRIVE_FOLDER_ID` it has never received.
  A Drive file is processed once, even if edited later; the same bytes from both entries are one document.
- The prompt asks for **what is printed, never corrected or inferred**: the database does the math. A value the
  model cannot read must be null (a person fixes a null in seconds; a guess may get paid). Keep that rule when
  editing the prompt, and run the evaluations after.
- Primary model `gemini-3.1-flash-lite`, fallback `gemini-flash-lite-latest` on error. Every attempt that reaches
  the database is in `extraction_runs` with its raw answer.
- Workflows are generated, imported and exported like the other repos: `./scripts/reload-workflows.sh` after
  editing the JSON, `./scripts/export-workflows.sh` after editing in n8n. Workflow ids are fixed (the upload API
  and the sync call the sub-workflow by id).
- `DRIVE_FOLDER_ID` is filled in at import (`prepare-import.js`) and put back as `__DRIVE_FOLDER_ID__` on export.
- n8n can only touch files under `/data/invoices` (`N8N_RESTRICT_FILE_ACCESS_TO`).

## Demo invoices (`demo/`)

- `demo/generate_invoices.py` builds 30 invoices of the fictional Maple Grove Dental Studio into `demo/build/`
  (not committed): PDFs, phone photos and scans, one layout per supplier, plus `ground-truth.json` with what is
  printed on each one and what the validation should decide.
- Deterministic: a fixed seed per invoice and dates relative to `--as-of`. Same `--as-of`, same bytes.
- The known suppliers are seeded by `V2__seed_demo_suppliers.sql`; keep names and tax ids in sync with the
  generator. Riverbend Promotional Goods stays out on purpose (unknown supplier trap).
- Traps: `wrong_total`, `line_math`, `old_date`, `illegible_date`, `unknown_supplier`, `duplicate` (invoice 01
  photographed: different bytes, same number). A new trap needs its expected issues in `EXPECTED_ISSUES`.
- After changing the generator or the rules, run the ground truth through the database as a perfect extraction:
  every invoice must get its `expected_status` and `expected_issues`.

## Secrets

- The Google service account key is a file outside the repository; `.env` only has its path. `setup-n8n.sh` reads it
  and hands it to n8n, which stores it encrypted.
- Never commit `.env`. Document every new variable in `.env.example` with a fake value.
- Test with fake data (`TEST ...` suppliers and files) and remove it afterwards.
- Before committing, check that no token, API key, password, phone number or email appears in the diff.

## Useful commands

| Task | Command |
|---|---|
| Start everything | `docker compose up -d` |
| Apply migrations | `docker compose run --rm flyway` |
| Database tests | see above |
| Build the demo invoices | `docker build -t invoice-demo-tools demo && docker run --rm -v "$PWD/demo:/demo" invoice-demo-tools python /demo/generate_invoices.py` |
| Set up a fresh n8n (credentials + workflows) | `./scripts/setup-n8n.sh` |
| Load workflow changes into n8n | `./scripts/reload-workflows.sh` |
| Export workflows | `./scripts/export-workflows.sh` |
| Send invoices to the upload API | `python scripts/upload-invoice.py demo/build/invoices/*` |
| Sync Drive now | `docker compose exec -T -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=sY6nC2gD8rV4eQwT` |
| Database shell (owner) | `docker compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` |
