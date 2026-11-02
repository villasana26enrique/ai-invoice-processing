"use server";
// Server actions: the browser calls them like functions, but they run on the server.
// Each one checks the session and calls a database function, which validates and records who did what.

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { checkCredentials, requireSession } from "@/lib/auth";
import { callFunction } from "@/lib/db";
import { SESSION_COOKIE, SESSION_HOURS, signSession } from "@/lib/session";
import type { InvoiceData, Issue } from "@/lib/invoices";

export type ActionResult = { ok: boolean; message?: string; issues?: Issue[] };

export async function login(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!username || !password || !(await checkCredentials(username, password))) {
    return { ok: false, message: "Wrong user name or password." };
  }
  (await cookies()).set(SESSION_COOKIE, await signSession(username), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_HOURS * 3600,
  });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

export async function saveInvoice(documentId: number, invoice: InvoiceData): Promise<ActionResult> {
  const session = await requireSession();
  const result = await callFunction<ActionResult>("SELECT invoicing.save_review($1, $2, $3::jsonb) AS r", [
    documentId,
    session.user,
    JSON.stringify(invoice),
  ]);
  revalidatePath(`/invoices/${documentId}`);
  return result;
}

export async function approveInvoice(documentId: number, note: string): Promise<ActionResult> {
  const session = await requireSession();
  const result = await callFunction<ActionResult>("SELECT invoicing.approve_invoice($1, $2, $3) AS r", [
    documentId,
    session.user,
    note,
  ]);
  revalidatePath("/");
  return result;
}

export async function rejectInvoice(documentId: number, reason: string): Promise<ActionResult> {
  const session = await requireSession();
  const result = await callFunction<ActionResult>("SELECT invoicing.reject_invoice($1, $2, $3) AS r", [
    documentId,
    session.user,
    reason,
  ]);
  revalidatePath("/");
  return result;
}

// The file goes to the same n8n webhook as any other upload: one way in for every invoice
export async function uploadInvoice(_: ActionResult | null, form: FormData): Promise<ActionResult> {
  await requireSession();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, message: "Choose a PDF or a photo first." };

  const body = new FormData();
  body.append("file", file, file.name);
  let result: { ok?: boolean; document_id?: number | null; status?: string; message?: string };
  try {
    const response = await fetch(process.env.N8N_UPLOAD_URL ?? "http://n8n:5678/webhook/invoices", {
      method: "POST",
      headers: { "X-API-Key": process.env.UPLOAD_API_KEY ?? "" },
      body,
      signal: AbortSignal.timeout(180_000),
    });
    result = await response.json();
  } catch {
    return { ok: false, message: "The invoice could not be sent. Try again in a minute." };
  }

  if (!result.document_id) return { ok: false, message: result.message || "The invoice could not be processed." };
  revalidatePath("/");
  redirect(`/invoices/${result.document_id}`);
}
