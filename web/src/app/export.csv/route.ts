import { requireSession } from "@/lib/auth";
import { csvRows } from "@/lib/csv";
import { pool } from "@/lib/db";

const COLUMNS = ["document_id", "supplier", "invoice_number", "invoice_date", "due_date", "currency", "subtotal", "tax",
  "shipping", "total", "approved_at", "approved_by", "file_name"] as const;

export async function GET() {
  await requireSession();
  const { rows } = await pool.query(
    // Dates as text: node-postgres would turn them into JavaScript dates at midnight, shifted by the time zone
    `SELECT ${COLUMNS.map((c) => (c.endsWith("_date") ? `${c}::text AS ${c}` : c)).join(", ")}
     FROM invoicing.approved_invoices ORDER BY approved_at, document_id`,
  );
  const today = new Date().toISOString().slice(0, 10);
  return new Response(csvRows(COLUMNS, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="approved-invoices-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
