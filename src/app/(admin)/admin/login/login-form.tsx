"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

import { signInAction } from "@/app/(admin)/admin/login/actions";
import { GENERIC_SIGN_IN_ERROR } from "@/lib/validation/auth";

type LoginFormProps = {
  /** Validated on the server before being passed in; safe to navigate to. */
  redirectTo: string;
};

/**
 * Admin sign-in form.
 *
 * Client-side state exists only for pending feedback and error display. The
 * credential check, validation, and session creation all happen in the Server
 * Action; this component is never the security boundary.
 */
export function LoginForm({ redirectTo }: LoginFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    startTransition(async () => {
      try {
        const result = await signInAction({ email, password });

        if (!result.ok) {
          setError(result.message);
          return;
        }

        router.replace(redirectTo);
        router.refresh();
      } catch {
        setError(GENERIC_SIGN_IN_ERROR);
      }
    });
  }

  return (
    <form className="flex flex-col gap-6" noValidate onSubmit={handleSubmit}>
      <div className="flex flex-col gap-2">
        <label
          className="text-xs font-semibold tracking-[0.12em] uppercase"
          htmlFor={emailId}
        >
          Email address
        </label>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="username"
          className="min-h-12 border border-border bg-background px-4 text-sm text-foreground transition-colors duration-200 placeholder:text-muted-foreground hover:border-muted-foreground disabled:opacity-60"
          disabled={isPending}
          id={emailId}
          inputMode="email"
          name="email"
          placeholder="you@studio.example"
          required
          type="email"
        />
      </div>

      <div className="flex flex-col gap-2">
        <label
          className="text-xs font-semibold tracking-[0.12em] uppercase"
          htmlFor={passwordId}
        >
          Password
        </label>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          autoComplete="current-password"
          className="min-h-12 border border-border bg-background px-4 text-sm text-foreground transition-colors duration-200 hover:border-muted-foreground disabled:opacity-60"
          disabled={isPending}
          id={passwordId}
          name="password"
          required
          type="password"
        />
      </div>

      {/* Announced to assistive technology when it appears, without stealing focus. */}
      <p
        aria-live="polite"
        className="flex items-start gap-2 text-sm text-foreground"
        id={errorId}
        role="status"
      >
        {error ? (
          <>
            <AlertCircle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-accent"
              strokeWidth={1.5}
            />
            <span>{error}</span>
          </>
        ) : null}
      </p>

      <button
        className="inline-flex min-h-12 items-center justify-center gap-2 border border-accent bg-accent px-5 text-xs font-semibold tracking-[0.12em] text-accent-foreground uppercase transition-colors duration-200 hover:border-foreground hover:bg-foreground disabled:cursor-not-allowed disabled:opacity-70"
        disabled={isPending}
        type="submit"
      >
        {isPending ? (
          <>
            <Loader2
              aria-hidden="true"
              className="size-4 animate-spin"
              strokeWidth={2}
            />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
      </button>
    </form>
  );
}
