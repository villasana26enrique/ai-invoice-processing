import "server-only";
import { pool } from "./db";

export const STATUSES = ["needs_review", "approved", "rejected", "failed"] as const;
export type Status = (typeof STATUSES)[number];

export type Issue = { code: string; severity: "error" | "warning"; field: string; message: string };

export type Line = {
  line_number?: number;
  description: string | null;
  quantity: string | number | null;
  unit_price: string | number | null;
  amount: string | number | null;
};

// The shape of invoicing.invoice_json: what the review page edits and save_review receives
export type InvoiceData = {
  supplier_id: number | null;
  supplier_name: string | null;
  supplier_tax_id: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal: string | number | null;
  tax: string | number | null;
  shipping: string | number | null;
  total: string | number | null;
  lines: Line[];
};

export type InboxRow = {
  id: number;
  status: Status;
  file_name: string;
  source: string;
  received_at: Date;
  status_reason: string | null;
  supplier: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total: string | null;
  currency: string | null;
  issues: Issue[];
};

export type ReviewEvent = { actor: string; action: string; note: string | null; created_at: Date };

export type DocumentDetail = {
  id: number;
  status: Status | "received";
  status_reason: string | null;
  file_name: string;
  mime_type: string;
  source: string;
  received_at: Date;
  invoice: InvoiceData | null;
  issues: Issue[];
  model: string | null;
  events: ReviewEvent[];
};

export async function countByStatus(): Promise<Record<string, number>> {
  const { rows } = await pool.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM invoicing.documents GROUP BY status",
  );
  return Object.fromEntries(rows.map((row) => [row.status, row.n]));
}

export async function listDocuments(status: Status): Promise<InboxRow[]> {
  const { rows } = await pool.query<InboxRow>(
    `SELECT d.id, d.status, d.file_name, d.source, d.created_at AS received_at, d.status_reason,
            coalesce(s.name, i.supplier_name) AS supplier, i.invoice_number, i.invoice_date::text,
            i.total::text, i.currency, coalesce(i.issues, '[]') AS issues
     FROM invoicing.documents d
     LEFT JOIN invoicing.invoices i ON i.document_id = d.id
     LEFT JOIN invoicing.suppliers s ON s.id = i.supplier_id
     WHERE d.status = $1
     ORDER BY d.created_at DESC
     LIMIT 200`,
    [status],
  );
  return rows;
}

export async function getDocument(id: number): Promise<DocumentDetail | null> {
  const { rows } = await pool.query<DocumentDetail>(
    `SELECT d.id, d.status, d.status_reason, d.file_name, d.mime_type, d.source, d.created_at AS received_at,
            invoicing.invoice_json(d.id) AS invoice,
            coalesce(i.issues, '[]') AS issues,
            (SELECT r.model FROM invoicing.extraction_runs r
             WHERE r.document_id = d.id AND r.raw_output IS NOT NULL ORDER BY r.created_at DESC LIMIT 1) AS model,
            coalesce((SELECT jsonb_agg(jsonb_build_object('actor', e.actor, 'action', e.action, 'note', e.note,
                                                          'created_at', e.created_at) ORDER BY e.created_at)
                      FROM invoicing.review_events e WHERE e.document_id = d.id), '[]') AS events
     FROM invoicing.documents d
     LEFT JOIN invoicing.invoices i ON i.document_id = d.id
     WHERE d.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

export async function listSuppliers(): Promise<{ id: number; name: string }[]> {
  const { rows } = await pool.query<{ id: number; name: string }>(
    "SELECT id, name FROM invoicing.suppliers ORDER BY name",
  );
  return rows;
}

export async function getStoredFile(id: number) {
  const { rows } = await pool.query<{ storage_path: string; mime_type: string; file_name: string }>(
    "SELECT storage_path, mime_type, file_name FROM invoicing.documents WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}
