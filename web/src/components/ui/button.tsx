import { cn } from "./cn";

const variants = {
  primary: "bg-primary text-white hover:bg-primary-strong",
  success: "bg-success text-white hover:opacity-90",
  danger: "bg-error text-white hover:opacity-90",
  outline: "border border-line bg-surface text-ink hover:bg-canvas",
  "outline-danger": "border border-error text-error hover:bg-error-soft",
  link: "text-primary hover:underline",
  "link-danger": "text-error hover:underline",
} as const;

const sizes = {
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2",
} as const;

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
};

export function Button({ variant = "primary", size = "md", className, ...props }: Props) {
  const isLink = variant.startsWith("link");
  return (
    <button
      className={cn(
        "font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        !isLink && "rounded-md",
        !isLink && sizes[size],
        isLink && "text-sm",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
