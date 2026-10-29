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

## Run it

```bash
cp .env.example .env    # set the passwords
docker compose up -d
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < database/tests/invoice_tests.sql
```

## License

MIT
