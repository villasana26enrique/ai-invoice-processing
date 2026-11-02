import { Card, Heading, Muted } from "@/components/ui";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-sm p-8">
        <Heading size="lg">Invoice Review</Heading>
        <Muted className="mt-1 block text-sm">Sign in to review supplier invoices.</Muted>
        <LoginForm />
      </Card>
    </main>
  );
}
