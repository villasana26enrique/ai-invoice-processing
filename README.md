# AI Invoice Processing

> Work in progress. The database and its rules are done; the extraction pipeline and the review page come next.

Supplier invoices arrive as PDFs or photos. A model reads them, **the database checks the numbers**, and only what
does not add up goes to a person, who fixes it in seconds on a review page.

You do not have to trust the model blindly: an invoice is approved without a person only when every check passes.

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
cp .env.example .env    # set the passwords
docker compose up -d
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/tests/invoice_tests.sql
```

## License

MIT
