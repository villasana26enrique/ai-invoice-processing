// A cell that starts with = + - @ (or a tab or line break before them) would run as a formula in Excel: prefix it
// so it stays text. Plain numbers are left alone, so a negative amount still adds up.
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r\n]/.test(text) && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRows(columns: readonly string[], rows: Record<string, unknown>[]): string {
  return [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))]
    .join("\r\n") + "\r\n";
}
