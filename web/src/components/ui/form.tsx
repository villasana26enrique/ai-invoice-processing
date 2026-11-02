import { cn } from "./cn";

// Errors in red, warnings in amber: the reviewer sees at a glance which field the database complained about
export type Tone = "error" | "warning" | null;

const control = "w-full rounded-md border text-ink focus:border-primary focus:outline-none disabled:bg-canvas";
const tones = {
  none: "border-line bg-surface",
  error: "border-error bg-error-soft",
  warning: "border-warning bg-warning-soft",
} as const;

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { tone?: Tone; compact?: boolean };

export function Input({ tone = null, compact = false, className, ...props }: InputProps) {
  return <input className={cn(control, compact ? "px-2 py-1" : "px-3 py-1.5", tones[tone ?? "none"], className)} {...props} />;
}

export function Select({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(control, "px-3 py-1.5", tones.none, className)} {...props} />;
}

// A label above its control
export function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1 block text-muted">{label}</span>
      {children}
    </label>
  );
}

export function FileInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input type="file"
           className="block w-full text-sm text-ink file:mr-4 file:rounded-md file:border-0 file:bg-primary-soft file:px-4 file:py-2 file:text-primary"
           {...props} />
  );
}
