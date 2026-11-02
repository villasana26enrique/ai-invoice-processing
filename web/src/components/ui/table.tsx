import { cn } from "./cn";

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn("w-full text-sm", className)} {...props} />;
}

// dense: no padding of its own, for a header above form inputs. numeric: right-aligned, like the amounts below it
export function Th({ dense, numeric, className, ...props }:
  React.ThHTMLAttributes<HTMLTableCellElement> & { dense?: boolean; numeric?: boolean }) {
  return (
    <th className={cn(numeric ? "text-right" : "text-left", "text-xs font-medium uppercase tracking-wide text-muted", dense ? "pb-2" : "px-4 py-3", className)}
        {...props} />
  );
}

export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-4 py-3", className)} {...props} />;
}

export function Tr({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("border-b border-line last:border-0 hover:bg-canvas", className)} {...props} />;
}

export function THead({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-line", className)} {...props} />;
}
