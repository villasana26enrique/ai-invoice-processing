# AI Invoice Processing

> Work in progress. The database rules, the extraction pipeline and the review page are done; evaluations come next.

Supplier invoices arrive as PDFs or photos. A model reads them, **the database checks the numbers**, and only what
does not add up goes to a person, who fixes it in seconds on a review page.

You do not have to trust the model blindly: an invoice is approved without a person only when every check passes.

## How an invoice flows

```
Google Drive folder ─┐
                     ├─► n8n: sha256 ─► register ─► save the original ─► Gemini (JSON with a fixed schema) ─► PostgreSQL checks
Upload API (POST) ───┘                                                                                        │
                                                                     approved (nothing to look at) ◄──────────┤
                                                                     needs_review (with the reasons) ◄────────┘
                                                                                │
                                         review page (Next.js): fix, approve or reject ─► export approved (CSV)
```

The model only reads: it returns what is printed, and null for what it cannot read. Every check is done by the
database, so the same rules apply to what the model read and to what a person corrected.

## What is checked

| Check | Severity |
|---|---|
| Line items: quantity × unit price = amount | error |
| Line items add up to the subtotal; subtotal + tax + shipping = total (2-cent tolerance) | error |
| Required fields present and readable (supplier, number, date, subtotal, tax, total) | error |
| Invoice date not in the future; due date not before the invoice date | error |
| Same supplier and invoice number already received (paying twice) | error |
| Unknown supplier, invoice older than a year, currency other than USD | warning |

Errors block approval until they are fixed. Warnings need a reviewer's approval. No issues at all: approved
automatically.

## Review page

A Next.js app (App Router, TypeScript, Tailwind CSS) at http://localhost:3010, for one reviewer:

- **Inbox** by status (to review, approved, rejected, could not read), with why each invoice needs a look.
- **Invoice page**: the original (PDF or photo) next to the editable fields and line items, with the fields the
  database complained about marked in red (errors) or amber (warnings). Saving checks the invoice again.
- **Approve** (blocked while there are errors), **reject** with a reason (also an approved invoice before it is
  paid, or a file that could not be read), **upload** an invoice and **export** the approved ones as CSV.

Pages read the database on the server, as `invoice_app`; saving, approving and rejecting call the same database
functions as the pipeline, which record who did what. The reviewer signs in with a hashed password and a signed,
`httpOnly` session cookie.

## Demo data

30 invoices from the suppliers of a fictional dental clinic, each supplier with its own layout: PDFs, phone
photos (tilted, shadowed) and scans. Six are traps: a total that does not add up, a line with wrong math, an old
invoice, a date covered by a stain, an unknown supplier and a duplicate sent again as a photo. Each one comes with
its ground truth, used by the evaluations.

```bash
docker build -t invoice-demo-tools demo
docker run --rm -v "$PWD/demo:/demo" invoice-demo-tools python /demo/generate_invoices.py   # -> demo/build/
```

## Run it

```bash
cp .env.example .env    # passwords, Gemini API key, service account key path, Drive folder
node web/scripts/hash-password.mjs   # asks for the reviewer password; paste the result as REVIEWER_PASSWORD_HASH
docker compose up -d
./scripts/setup-n8n.sh
python scripts/upload-invoice.py demo/build/invoices/*     # after building the demo invoices
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/tests/invoice_tests.sql
(cd web && npm ci && npm test)       # review page tests (Vitest)
```

Then open http://localhost:3010 and sign in as the reviewer.

## License

MIT
