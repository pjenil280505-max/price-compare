"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { AuthShell } from "@/components/auth/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } catch {
      // Deliberately ignored — see below.
    } finally {
      // Always show the same confirmation, whether or not the address has
      // an account and whether or not the request succeeded. Branching here
      // would turn this page into an account-enumeration oracle.
      setSubmitted(true);
      setIsSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <AuthShell title="Check your email" subtitle="If that address has an account, a reset link is on its way.">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          The link expires shortly for security. If it doesn&apos;t arrive, check your spam folder,
          then try again.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm font-medium text-ink underline underline-offset-4 dark:text-paper">
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to set a new one.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          type="email"
          name="email"
          label="Email"
          placeholder="you@example.com"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
        />
        <Button type="submit" size="lg" isLoading={isSubmitting} className="w-full justify-center">
          Send reset link
        </Button>
      </form>
      <Link href="/login" className="mt-6 inline-block text-sm text-ink-500 hover:text-ink dark:text-ink-400 dark:hover:text-paper">
        Back to sign in
      </Link>
    </AuthShell>
  );
}
