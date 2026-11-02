// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RejectDocument } from "./reject-panel";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/app/actions", () => ({ rejectInvoice: vi.fn(async () => ({ ok: true })) }));
const actions = await import("@/app/actions");

beforeEach(() => vi.clearAllMocks());

// The page of an invoice the model could not read: the only thing left to do is take it out of the queue
describe("RejectDocument", () => {
  const setup = () => {
    render(<RejectDocument documentId={12} label="Reject this file" />);
    return userEvent.setup();
  };

  it("starts as a single button", () => {
    setup();
    expect(screen.getByRole("button", { name: "Reject this file" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Why is it rejected?")).not.toBeInTheDocument();
  });

  it("asks for a reason before rejecting", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Reject this file" }));
    expect(screen.getByLabelText("Why is it rejected?")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reject invoice" })).toBeDisabled();
    await user.type(screen.getByLabelText("Why is it rejected?"), "Not an invoice");
    await user.click(screen.getByRole("button", { name: "Reject invoice" }));
    expect(actions.rejectInvoice).toHaveBeenCalledWith(12, "Not an invoice");
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(screen.queryByLabelText("Why is it rejected?")).not.toBeInTheDocument();
  });

  it("shows the database's answer and keeps the reason when it refuses", async () => {
    vi.mocked(actions.rejectInvoice).mockResolvedValueOnce({ ok: false, message: "This document cannot be rejected (status rejected)." });
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Reject this file" }));
    await user.type(screen.getByLabelText("Why is it rejected?"), "Not an invoice");
    await user.click(screen.getByRole("button", { name: "Reject invoice" }));
    expect(await screen.findByText("This document cannot be rejected (status rejected).")).toBeInTheDocument();
    expect(screen.getByLabelText("Why is it rejected?")).toHaveValue("Not an invoice");
  });

  it("can be cancelled", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Reject this file" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Why is it rejected?")).not.toBeInTheDocument();
    expect(actions.rejectInvoice).not.toHaveBeenCalled();
  });
});
