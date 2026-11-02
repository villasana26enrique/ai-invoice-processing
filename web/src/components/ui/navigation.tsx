"use client";
// Client component: the header lives in a layout, which does not re-render on navigation, so it reads the URL itself

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "./cn";

const navItem = (active: boolean) =>
  cn("rounded-md px-3 py-1.5 text-sm font-medium transition",
    active ? "bg-primary-soft text-primary" : "text-muted hover:bg-canvas hover:text-ink");

// A header link, highlighted while the current path starts with one of `sections`
export function NavLink({ href, sections, children }: { href: string; sections: string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = sections.some((section) => (section === "/" ? pathname === "/" : pathname.startsWith(section)));
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={navItem(active)}>
      {children}
    </Link>
  );
}

// A header link to a file (the CSV): a plain <a>, so the browser downloads it instead of navigating
export function NavDownload({ href, children }: { href: string; children: React.ReactNode }) {
  return <a href={href} className={navItem(false)}>{children}</a>;
}

// A tab: underlined when it is the one being shown
export function Tab({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}
          className={cn("-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
            active ? "border-primary text-primary" : "border-transparent text-muted hover:text-ink")}>
      {children}
    </Link>
  );
}

export function Tabs({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2 border-b border-line">{children}</div>;
}

export function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-2 rounded-full bg-canvas px-2 py-0.5 text-xs text-muted">{children}</span>;
}

// An inline link inside content (table rows, back links)
export function TextLink({ href, subtle, className, children }:
  { href: string; subtle?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={cn(subtle ? "text-sm text-muted hover:text-ink" : "font-medium text-primary hover:underline", className)}>
      {children}
    </Link>
  );
}
