"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Mail, Lock, User } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export interface SignupFormProps {
  onSubmit: (details: { name: string; email: string; password: string }) => Promise<void>;
  onGoogleSignIn?: () => void;
  error?: string | null;
}

export function SignupForm({ onSubmit, onGoogleSignIn, error }: SignupFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!agreed) return;
    setIsSubmitting(true);
    try {
      await onSubmit({ name, email, password });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {onGoogleSignIn && (
        <>
          <Button variant="outline" size="lg" onClick={onGoogleSignIn} className="w-full justify-center">
            Continue with Google
          </Button>
          <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ink-400">
            <span className="h-px flex-1 bg-ink-100 dark:bg-ink-800" />
            or
            <span className="h-px flex-1 bg-ink-100 dark:bg-ink-800" />
          </div>
        </>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          type="text"
          label="Name"
          placeholder="Your name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          leftIcon={<User className="h-4 w-4" aria-hidden="true" />}
        />
        <Input
          type="email"
          label="Email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
        />
        <Input
          type="password"
          label="Password"
          placeholder="At least 8 characters"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
        />

        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-500 dark:text-ink-400">
          <input
            type="checkbox"
            required
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-ink-300 text-saffron focus-visible:ring-2 focus-visible:ring-saffron"
          />
          <span>
            I agree to the{" "}
            <Link href="/terms" className="font-medium text-ink hover:underline dark:text-paper">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="font-medium text-ink hover:underline dark:text-paper">
              Privacy Policy
            </Link>
          </span>
        </label>

        {error && (
          <p role="alert" className="text-sm text-vermilion-600 dark:text-vermilion-400">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" isLoading={isSubmitting} disabled={!agreed} className="w-full justify-center">
          Create account
        </Button>
      </form>

      <p className="text-center text-sm text-ink-500 dark:text-ink-400">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-ink hover:underline dark:text-paper">
          Sign in
        </Link>
      </p>
    </div>
  );
}
