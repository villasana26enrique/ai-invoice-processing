import type { Issue } from "@/lib/invoices";
import { cn } from "./cn";

// What the database found: red for errors (must be fixed), amber for warnings (a person decides)
export function IssueList({ issues }: { issues: Issue[] }) {
  if (!issues.length) return <span className="text-muted">—</span>;
  return (
    <ul className="space-y-1">
      {issues.map((issue, i) => (
        <li key={i} className={cn("rounded px-2 py-0.5",
          issue.severity === "error" ? "bg-error-soft text-error" : "bg-warning-soft text-warning")}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}
