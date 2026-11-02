"use client";

import { useActionState } from "react";
import { Alert, Button, Field, Input } from "@/components/ui";
import { login } from "../actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <Field label="User name">
        <Input name="username" autoComplete="username" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.message && <Alert>{state.message}</Alert>}
      <Button disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
