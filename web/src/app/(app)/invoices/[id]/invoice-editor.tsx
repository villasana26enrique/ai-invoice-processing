"use client";
// Client component: it keeps the form state in the browser. Saving, approving and rejecting call server actions,
// and the database decides whether the invoice is valid.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveInvoice, saveInvoice, type ActionResult } from "@/app/actions";
import type { InvoiceData, Issue, Line } from "@/lib/invoices";
import { formatMoney } from "@/lib/format";
import { RejectPanel } from "./reject-panel";
import { Alert, Button, Card, Field, Input, IssueList, Muted, SectionTitle, Select, Strong, Th, type Tone } from "@/components/ui";

type Props = {
  documentId: number;
  status: string;
  initial: InvoiceData;
  initialIssues: Issue[];
  suppliers: { id: number; name: string }[];
};

// "20.000" -> "20": the database keeps 3-4 decimals, people type fewer
const plain = (value: string | number | null) => (value === null || value === "" ? "" : String(Number(value)));

function normalize(invoice: InvoiceData): InvoiceData {
  return {
    ...invoice,
    lines: invoice.lines.map((line) => ({
      description: line.description ?? "",
      quantity: plain(line.quantity),
      unit_price: plain(line.unit_price),
      amount: line.amount ?? "",
    })),
  };
}

export function InvoiceEditor({ documentId, status, initial, initialIssues, suppliers }: Props) {
  const router = useRouter();
  const [invoice, setInvoice] = useState(() => normalize(initial));
  const [issues, setIssues] = useState(initialIssues);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [pending, startTransition] = useTransition();

  const editable = status === "needs_review";
  const errors = issues.filter((issue) => issue.severity === "error").length;

  const toneFor = (field: string): Tone => {
    const found = issues.filter((issue) => issue.field === field);
    return found.some((issue) => issue.severity === "error") ? "error" : found.length ? "warning" : null;
  };

  function update<K extends keyof InvoiceData>(field: K, value: InvoiceData[K]) {
    setInvoice((current) => ({ ...current, [field]: value }));
    setDirty(true);
  }

  function updateLine(index: number, field: keyof Line, value: string) {
    update("lines", invoice.lines.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  }

  function run(action: () => Promise<ActionResult>, after?: (result: ActionResult) => void) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (result.issues) setIssues(result.issues);
      if (!result.ok) setMessage(result.message ?? "Something went wrong.");
      else after?.(result);
      router.refresh();
    });
  }

  const save = () => run(() => saveInvoice(documentId, invoice), () => setDirty(false));
  const approve = () => run(() => approveInvoice(documentId, note));

  const field = (name: keyof InvoiceData, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <Field label={label}>
      <Input value={(invoice[name] as string | number | null) ?? ""} tone={toneFor(name)} disabled={!editable}
             onChange={(event) => update(name, event.target.value as never)} {...props} />
    </Field>
  );

  const lineSum = invoice.lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);

  return (
    <div className="space-y-4">
      {issues.length > 0 && (
        <Card className="p-4">
          <SectionTitle className="mb-2">{errors ? "Fix these before approving" : "Check these, then approve"}</SectionTitle>
          <IssueList issues={issues} />
        </Card>
      )}

      <Card className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Known supplier" className="sm:col-span-2">
          <Select value={invoice.supplier_id ?? ""} disabled={!editable}
                  onChange={(event) => update("supplier_id", event.target.value ? Number(event.target.value) : null)}>
            <option value="">Not a known supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </Select>
        </Field>
        {field("supplier_name", "Supplier (as printed)")}
        {field("supplier_tax_id", "Supplier EIN", { placeholder: "12-3456789" })}
        {field("invoice_number", "Invoice number")}
        {field("currency", "Currency")}
        {field("invoice_date", "Invoice date", { type: "date" })}
        {field("due_date", "Due date", { type: "date" })}
      </Card>

      <Card className="overflow-x-auto p-4">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr>
              <Th dense>Description</Th>
              <Th dense numeric className="w-20">Qty</Th>
              <Th dense numeric className="w-28">Unit price</Th>
              <Th dense numeric className="w-28">Amount</Th>
              {editable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((line, index) => (
              <tr key={index}>
                <td className="py-1 pr-2">
                  <Input compact value={line.description ?? ""} disabled={!editable}
                         onChange={(event) => updateLine(index, "description", event.target.value)} />
                </td>
                <td className="py-1 pr-2">
                  <Input compact value={line.quantity ?? ""} disabled={!editable} inputMode="decimal" className="text-right"
                         onChange={(event) => updateLine(index, "quantity", event.target.value)} />
                </td>
                <td className="py-1 pr-2">
                  <Input compact value={line.unit_price ?? ""} disabled={!editable} inputMode="decimal" className="text-right"
                         onChange={(event) => updateLine(index, "unit_price", event.target.value)} />
                </td>
                <td className="py-1">
                  <Input compact value={line.amount ?? ""} disabled={!editable} inputMode="decimal" className="text-right"
                         tone={toneFor(`lines.${index + 1}.amount`)}
                         onChange={(event) => updateLine(index, "amount", event.target.value)} />
                </td>
                {editable && (
                  <td className="py-1 pl-2">
                    <Button type="button" variant="link-danger" aria-label="Remove line"
                            onClick={() => update("lines", invoice.lines.filter((_, i) => i !== index))}>✕</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-center justify-between text-sm">
          {editable ? (
            <Button type="button" variant="link"
                    onClick={() => update("lines", [...invoice.lines, { description: "", quantity: "", unit_price: "", amount: "" }])}>
              + Add line
            </Button>
          ) : <span />}
          <Muted>Lines add up to <Strong className="tabular-nums">{formatMoney(lineSum)}</Strong></Muted>
        </div>
      </Card>

      <Card className="grid gap-3 p-4 sm:grid-cols-4">
        {field("subtotal", "Subtotal", { inputMode: "decimal" })}
        {field("tax", "Sales tax", { inputMode: "decimal" })}
        {field("shipping", "Shipping", { inputMode: "decimal" })}
        {field("total", "Total", { inputMode: "decimal" })}
      </Card>

      {message && <Alert>{message}</Alert>}

      {editable && (
        <Card className="p-4">
          {dirty ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={save} disabled={pending}>{pending ? "Checking…" : "Save and check again"}</Button>
              <Muted className="text-sm">Save your changes to check the invoice again before approving.</Muted>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Note (optional)" className="min-w-48 flex-1">
                <Input value={note} onChange={(event) => setNote(event.target.value)}
                       placeholder="e.g. New supplier, confirmed by phone" />
              </Field>
              <Button variant="success" onClick={approve} disabled={pending || errors > 0}
                      title={errors > 0 ? "Fix the errors first" : undefined}>
                Approve
              </Button>
              <Button variant="outline-danger" onClick={() => setRejecting(true)} disabled={pending}>Reject</Button>
            </div>
          )}
        </Card>
      )}

      {status === "approved" && !rejecting && (
        <Button variant="link-danger" onClick={() => setRejecting(true)}>Reject this invoice before it is paid</Button>
      )}

      {rejecting && <RejectPanel documentId={documentId} onClose={() => setRejecting(false)} />}
    </div>
  );
}
