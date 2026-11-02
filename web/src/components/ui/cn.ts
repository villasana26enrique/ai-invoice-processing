// Joins class names, skipping empty ones: cn("a", isOn && "b", className)
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
