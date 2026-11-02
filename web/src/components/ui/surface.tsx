import { cn } from "./cn";

// Variants instead of overriding classes: two utilities for the same property (border-line and border-error) would
// be decided by the order of the generated CSS, not by the order they are written in.

export function Card({ tone = "default", className, ...props }:
  React.HTMLAttributes<HTMLDivElement> & { tone?: "default" | "danger" }) {
  return (
    <div className={cn("rounded-xl border bg-surface shadow-sm", tone === "danger" ? "border-error" : "border-line", className)}
         {...props} />
  );
}

const tones = {
  neutral: "bg-canvas text-muted",
  primary: "bg-primary-soft text-primary",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  error: "bg-error-soft text-error",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: BadgeTone }) {
  return <span className={cn("rounded-full px-3 py-0.5 text-sm font-medium", tones[tone], className)} {...props} />;
}

export function Alert({ tone = "error", className, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { tone?: "error" | "warning" }) {
  return <p className={cn("rounded-lg px-4 py-3 text-sm", tones[tone], className)} {...props} />;
}

// Small helper texts: hints, timestamps, empty states
export function Muted({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-muted", className)} {...props} />;
}

export function Heading({ size = "md", className, ...props }: React.HTMLAttributes<HTMLHeadingElement> & { size?: "md" | "lg" }) {
  return <h1 className={cn("font-semibold text-ink", size === "lg" ? "text-xl" : "text-lg", className)} {...props} />;
}

export function SectionTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold text-ink", className)} {...props} />;
}

// Text that stands out inside muted text (the line sum, a name)
export function Strong({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn("text-ink", className)} {...props} />;
}

export function TopBar({ className, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <header className={cn("border-b border-line bg-surface", className)} {...props} />;
}
