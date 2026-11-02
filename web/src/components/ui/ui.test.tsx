// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Button, Input, IssueList, NavLink, Tab } from ".";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("NavLink", () => {
  const header = () => render(
    <nav>
      <NavLink href="/?status=needs_review" sections={["/", "/invoices"]}>Inbox</NavLink>
      <NavLink href="/upload" sections={["/upload"]}>Upload</NavLink>
    </nav>,
  );

  beforeEach(() => { pathname.current = "/"; });

  it.each([
    ["/", "Inbox"],
    ["/invoices/12", "Inbox"],
    ["/upload", "Upload"],
  ])("on %s only %s is marked as the current page", (path, expected) => {
    pathname.current = path;
    header();
    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("aria-current") === "page").toBe(link.textContent === expected);
    }
  });

  it("takes the inbox link to the invoices waiting for review", () => {
    header();
    expect(screen.getByRole("link", { name: "Inbox" })).toHaveAttribute("href", "/?status=needs_review");
  });
});

describe("Tab", () => {
  it("marks only the active tab", () => {
    render(<><Tab href="/?status=approved" active>Approved</Tab><Tab href="/?status=failed" active={false}>Failed</Tab></>);
    expect(screen.getByRole("link", { name: "Approved" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Failed" })).not.toHaveAttribute("aria-current");
  });
});

describe("IssueList", () => {
  it("shows each message, errors and warnings apart", () => {
    render(<IssueList issues={[
      { code: "total_mismatch", severity: "error", field: "total", message: "Total does not add up" },
      { code: "old_date", severity: "warning", field: "invoice_date", message: "Invoice is old" },
    ]} />);
    expect(screen.getByText("Total does not add up")).toHaveClass("text-error");
    expect(screen.getByText("Invoice is old")).toHaveClass("text-warning");
  });

  it("shows a dash when there is nothing to report", () => {
    render(<IssueList issues={[]} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

// Each variant must carry exactly one color per property: two (border-line + border-error) would be decided by
// the order of the generated CSS, not by what we meant
describe("variants never stack two colors for the same property", () => {
  const colorClasses = (element: HTMLElement, prefix: string) =>
    [...element.classList].filter((c) => new RegExp(`^${prefix}-(primary|success|warning|error|muted|ink|line|canvas|surface|white)`).test(c));

  it.each(["primary", "success", "danger", "outline", "outline-danger", "link", "link-danger"] as const)("Button %s", (variant) => {
    render(<Button variant={variant}>Go</Button>);
    const button = screen.getByRole("button");
    for (const prefix of ["bg", "text", "border"]) expect(colorClasses(button, prefix).length).toBeLessThanOrEqual(1);
  });

  it.each([null, "error", "warning"] as const)("Input tone %s", (tone) => {
    render(<Input tone={tone} aria-label="field" />);
    const input = screen.getByLabelText("field");
    for (const prefix of ["bg", "border"]) expect(colorClasses(input, prefix)).toHaveLength(1);
  });
});
