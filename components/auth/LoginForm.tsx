"use client";

import { useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Mail, Lock } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export interface LoginFormProps {
  onSubmit: (email: string, password: string) => Promise<void>;
  onGoogleSignIn?: () => void;
  error?: string | null;
}

export function LoginForm({ onSubmit, onGoogleSignIn, error }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await onSubmit(email, password);
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
          type="email"
          label="Email"
          placeholder="you@example.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          leftIcon={<Mail className="h-4 w-4" aria-hidden="true" />}
        />
        <div>
          <Input
            type="password"
            label="Password"
            placeholder="••••••••"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
          />
          <Link href="/forgot-password" className="mt-1.5 inline-block text-sm text-ink-500 hover:text-ink dark:text-ink-400 dark:hover:text-paper">
            Forgot password?
          </Link>
        </div>

        {error && (
          <p role="alert" className="text-sm text-vermilion-600 dark:text-vermilion-400">
            {error}
          </p>
        )}

        <Button type="submit" size="lg" isLoading={isSubmitting} className="w-full justify-center">
          Sign in
        </Button>
      </form>

      <p className="text-center text-sm text-ink-500 dark:text-ink-400">
        New here?{" "}
        <Link href="/signup" className="font-medium text-ink hover:underline dark:text-paper">
          Create an account
        </Link>
      </p>
    </div>
  );
}
