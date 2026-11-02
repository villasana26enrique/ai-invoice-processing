// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvoiceData, Issue } from "@/lib/invoices";
import { InvoiceEditor } from "./invoice-editor";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions", () => ({
  saveInvoice: vi.fn(async () => ({ ok: true, issues: [] })),
  approveInvoice: vi.fn(async () => ({ ok: true })),
  rejectInvoice: vi.fn(async () => ({ ok: true })),
}));
const actions = await import("@/app/actions");

// Invoice 08 of the demo: the second line is 3 x 12.50 but says 40.00
const invoice = (): InvoiceData => ({
  supplier_id: 1,
  supplier_name: "Summit Dental Supply, Inc.",
  supplier_tax_id: "00-4417821",
  invoice_number: "SDS-1008",
  invoice_date: "2026-10-08",
  due_date: "2026-11-07",
  currency: "USD",
  subtotal: "60.00",
  tax: "0.00",
  shipping: "0.00",
  total: "60.00",
  lines: [
    { line_number: 1, description: "Gloves", quantity: "2.000", unit_price: "10.0000", amount: "20.00" },
    { line_number: 2, description: "Masks", quantity: "3.000", unit_price: "12.5000", amount: "40.00" },
  ],
});

const lineError: Issue = { code: "line_amount_mismatch", severity: "error", field: "lines.2.amount", message: "Line 2 does not add up" };
const oldDate: Issue = { code: "old_date", severity: "warning", field: "invoice_date", message: "Invoice is old" };

const setup = (props: Partial<React.ComponentProps<typeof InvoiceEditor>> = {}) => {
  render(<InvoiceEditor documentId={8} status="needs_review" initial={invoice()} initialIssues={[]}
                        suppliers={[{ id: 1, name: "Summit Dental Supply, Inc." }]} {...props} />);
  return userEvent.setup();
};

const amountOfLine = (n: number) => within(screen.getAllByRole("row")[n]).getAllByRole("textbox")[3];

beforeEach(() => vi.clearAllMocks());

describe("InvoiceEditor", () => {
  it("shows quantities and prices the way people type them", () => {
    setup();
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("textbox");
    expect(cells.map((cell) => (cell as HTMLInputElement).value)).toEqual(["Gloves", "2", "10", "20.00"]);
  });

  it("blocks approval while there are errors, and points at the field", () => {
    setup({ initialIssues: [lineError] });
    expect(screen.getByText("Fix these before approving")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(amountOfLine(2)).toHaveClass("border-error");
    expect(amountOfLine(1)).not.toHaveClass("border-error");
  });

  it("lets a person approve with only warnings", async () => {
    const user = setup({ initialIssues: [oldDate] });
    expect(screen.getByText("Check these, then approve")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice date")).toHaveClass("border-warning");
    await user.type(screen.getByLabelText("Note (optional)"), "Late invoice, confirmed");
    await user.click(screen.getByRole("button", { name: "Approve" }));
    expect(actions.approveInvoice).toHaveBeenCalledWith(8, "Late invoice, confirmed");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("asks to check again after an edit, then sends the corrected invoice", async () => {
    const user = setup({ initialIssues: [lineError] });
    await user.clear(amountOfLine(2));
    await user.type(amountOfLine(2), "37.50");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save and check again" }));
    const sent = vi.mocked(actions.saveInvoice).mock.calls[0][1];
    expect(sent.lines[1]).toMatchObject({ quantity: "3", unit_price: "12.5", amount: "37.50" });
    expect(sent.invoice_number).toBe("SDS-1008");

    // The database answered with no issues: the error is gone and approval is back
    await waitFor(() => expect(screen.getByRole("button", { name: "Approve" })).toBeEnabled());
    expect(screen.queryByText("Line 2 does not add up")).not.toBeInTheDocument();
  });

  it("keeps the form and shows the database's answer when saving fails", async () => {
    vi.mocked(actions.saveInvoice).mockResolvedValueOnce({ ok: false, message: "This invoice was already reviewed." });
    const user = setup();
    await user.type(screen.getByLabelText("Invoice number"), "X");
    await user.click(screen.getByRole("button", { name: "Save and check again" }));
    expect(await screen.findByText("This invoice was already reviewed.")).toBeInTheDocument();
    expect(screen.getByLabelText("Invoice number")).toHaveValue("SDS-1008X");
    expect(screen.getByRole("button", { name: "Save and check again" })).toBeInTheDocument();
  });

  it("adds and removes lines, and keeps the running sum", async () => {
    const user = setup();
    expect(screen.getByText("$60.00")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "+ Add line" }));
    expect(screen.getAllByRole("row")).toHaveLength(4);
    await user.click(screen.getAllByRole("button", { name: "Remove line" })[0]);
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("$40.00")).toBeInTheDocument();
  });

  it("changes the supplier from the list of known ones", async () => {
    const user = setup({ initial: { ...invoice(), supplier_id: null } });
    await user.selectOptions(screen.getByLabelText("Known supplier"), "Summit Dental Supply, Inc.");
    await user.click(screen.getByRole("button", { name: "Save and check again" }));
    expect(vi.mocked(actions.saveInvoice).mock.calls[0][1].supplier_id).toBe(1);
  });

  it("needs a reason to reject", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Reject" }));
    const confirm = screen.getByRole("button", { name: "Reject invoice" });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Why is it rejected?"), "   ");
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText("Why is it rejected?"), "Duplicate");
    await user.click(confirm);
    expect(actions.rejectInvoice).toHaveBeenCalledWith(8, "   Duplicate");
    await waitFor(() => expect(screen.queryByLabelText("Why is it rejected?")).not.toBeInTheDocument());
  });

  it("shows an approved invoice read-only, with a way to reject it", async () => {
    const user = setup({ status: "approved" });
    expect(screen.getByLabelText("Invoice number")).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Add line" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reject this invoice before it is paid" }));
    expect(screen.getByLabelText("Why is it rejected?")).toBeInTheDocument();
  });

  it.each(["rejected", "failed"])("offers nothing to do on a %s invoice", (status) => {
    setup({ status });
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
