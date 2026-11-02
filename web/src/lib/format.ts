const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatMoney(value: string | number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return String(value);
  return currency === "USD"
    ? money.format(amount)
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
}

// "2026-10-08" -> "Oct 8, 2026" (dates are stored without a time zone; never shift them)
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  });
}

export const STATUS_LABELS: Record<string, string> = {
  needs_review: "To review",
  approved: "Approved",
  rejected: "Rejected",
  failed: "Could not read",
  received: "Processing",
};
