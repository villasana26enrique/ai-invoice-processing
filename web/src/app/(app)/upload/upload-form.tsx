"use client";

import { useActionState } from "react";
import { uploadInvoice } from "@/app/actions";
import { Alert, Button, FileInput } from "@/components/ui";

export function UploadForm() {
  const [state, action, pending] = useActionState(uploadInvoice, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <FileInput name="file" required accept="application/pdf,image/jpeg,image/png,image/webp" />
      {state?.message && <Alert>{state.message}</Alert>}
      <Button disabled={pending}>{pending ? "Reading the invoice…" : "Upload"}</Button>
    </form>
  );
}
