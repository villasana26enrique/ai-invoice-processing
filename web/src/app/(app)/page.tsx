import { requireSession } from "@/lib/auth";
import { countByStatus, listDocuments, STATUSES, type Status } from "@/lib/invoices";
import { formatDate, formatDateTime, formatMoney, STATUS_LABELS } from "@/lib/format";
import { Card, Count, IssueList, Muted, Tab, Table, Tabs, Td, TextLink, Th, THead, Tr } from "@/components/ui";

// Server component: it runs on the server, reads the database and sends HTML. No API in between.
export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireSession();
  const requested = (await searchParams).status;
  const status: Status = STATUSES.includes(requested as Status) ? (requested as Status) : "needs_review";
  const [counts, rows] = await Promise.all([countByStatus(), listDocuments(status)]);

  return (
    <>
      <Tabs>
        {STATUSES.map((tab) => (
          <Tab key={tab} href={`/?status=${tab}`} active={tab === status}>
            {STATUS_LABELS[tab]}
            <Count>{counts[tab] ?? 0}</Count>
          </Tab>
        ))}
      </Tabs>

      {rows.length === 0 ? (
        <Muted className="block py-16 text-center">
          {status === "needs_review" ? "Nothing to review. Every invoice so far added up." : "No invoices here yet."}
        </Muted>
      ) : (
        <Card className="mt-4 overflow-x-auto">
          <Table className="min-w-[720px]">
            <THead>
              <tr>
                <Th>Supplier</Th>
                <Th>Invoice</Th>
                <Th>Date</Th>
                <Th numeric>Total</Th>
                <Th>{status === "needs_review" ? "Why it needs a look" : "Notes"}</Th>
                <Th>Received</Th>
              </tr>
            </THead>
            <tbody>
              {rows.map((row) => (
                <Tr key={row.id}>
                  <Td><TextLink href={`/invoices/${row.id}`}>{row.supplier ?? row.file_name}</TextLink></Td>
                  <Td>{row.invoice_number ?? "—"}</Td>
                  <Td>{formatDate(row.invoice_date)}</Td>
                  <Td className="text-right tabular-nums">{formatMoney(row.total, row.currency ?? "USD")}</Td>
                  <Td>{row.status_reason ? <Muted>{row.status_reason}</Muted> : <IssueList issues={row.issues} />}</Td>
                  <Td><Muted>{formatDateTime(row.received_at)}</Muted></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
