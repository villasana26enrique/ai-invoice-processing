"use client";
// Rejecting asks for a reason: the database refuses an empty one and keeps it in the history

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { rejectInvoice } from "@/app/actions";
import { Alert, Button, Card, Field, Input } from "@/components/ui";

// onClose runs on Cancel and after a successful rejection
export function RejectPanel({ documentId, onClose }: { documentId: number; onClose: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const reject = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await rejectInvoice(documentId, reason);
      if (!result.ok) setMessage(result.message ?? "Something went wrong.");
      else onClose();
      router.refresh();
    });
  };

  return (
    <Card tone="danger" className="space-y-3 p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Why is it rejected?" className="min-w-48 flex-1">
          <Input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus
                 placeholder="e.g. Duplicate of an invoice already paid" />
        </Field>
        <Button variant="danger" onClick={reject} disabled={pending || !reason.trim()}>Reject invoice</Button>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
      </div>
      {message && <Alert>{message}</Alert>}
    </Card>
  );
}

// A button that opens the panel: for the pages that have nothing else to do (a file the model could not read)
export function RejectDocument({ documentId, label }: { documentId: number; label: string }) {
  const [open, setOpen] = useState(false);
  return open
    ? <RejectPanel documentId={documentId} onClose={() => setOpen(false)} />
    : <Button variant="outline-danger" onClick={() => setOpen(true)}>{label}</Button>;
}
