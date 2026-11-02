import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { getDocument, listSuppliers } from "@/lib/invoices";
import { formatDateTime, STATUS_LABELS } from "@/lib/format";
import { Alert, Badge, Card, Heading, Muted, SectionTitle, TextLink, type BadgeTone } from "@/components/ui";
import { InvoiceEditor } from "./invoice-editor";
import { RejectDocument } from "./reject-panel";

const STATUS_TONES: Record<string, BadgeTone> = {
  needs_review: "warning",
  approved: "success",
  rejected: "error",
  failed: "error",
  received: "primary",
};

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [document, suppliers] = await Promise.all([getDocument(id), listSuppliers()]);
  if (!document) notFound();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <TextLink href={`/?status=${document.status}`} subtle>← Inbox</TextLink>
        <Heading>{document.file_name}</Heading>
        <Badge tone={STATUS_TONES[document.status]}>{STATUS_LABELS[document.status]}</Badge>
        <Muted className="text-sm">
          Received {formatDateTime(document.received_at)} from {document.source === "google_drive" ? "Google Drive" : "upload"}
          {document.model && <> · read by {document.model}</>}
        </Muted>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* The original, served by an authenticated route */}
        <Card className="overflow-hidden lg:sticky lg:top-4 lg:self-start">
          {document.mime_type === "application/pdf" ? (
            <iframe src={`/files/${document.id}`} title="Invoice" className="h-[60vh] w-full lg:h-[85vh]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`/files/${document.id}`} alt="Invoice" className="w-full" />
          )}
        </Card>

        <section>
          {document.status_reason && (
            <Alert className="mb-4">
              {document.status === "rejected" ? "Rejected: " : "Could not be read: "}
              {document.status_reason}
            </Alert>
          )}
          {document.invoice ? (
            <InvoiceEditor documentId={document.id} status={document.status} initial={document.invoice}
                           initialIssues={document.issues} suppliers={suppliers} />
          ) : (
            <Muted className="block">The model could not read this file, so there is nothing to review.</Muted>
          )}
          {/* Not an invoice, or unreadable for good: rejecting takes it out of the "Could not read" tab */}
          {document.status === "failed" && (
            <div className="mt-4"><RejectDocument documentId={document.id} label="Reject this file" /></div>
          )}

          {document.events.length > 0 && (
            <Card className="mt-6 p-4">
              <SectionTitle>History</SectionTitle>
              <ul className="mt-2 space-y-1 text-sm">
                {document.events.map((event, i) => (
                  <li key={i}>
                    <Muted>{formatDateTime(event.created_at)} · </Muted>
                    {event.actor}{" "}
                    <Muted>
                      {event.action === "edit" ? "corrected the invoice" : event.action === "approve" ? "approved it" : "rejected it"}
                      {event.note && <>: “{event.note}”</>}
                    </Muted>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}
