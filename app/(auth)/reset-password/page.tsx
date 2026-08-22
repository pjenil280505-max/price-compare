"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/**
 * Sets a new password. Reached only via the emailed link, which
 * /auth/callback exchanges for a short-lived recovery session before
 * redirecting here.
 *
 * The token is never handled by this code: Supabase Auth issues, expires
 * and single-uses it. This page only calls updateUser on the resulting
 * session.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    // Without a recovery session the form cannot work, so say so up front
    // rather than failing on submit.
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => setHasSession(Boolean(data.user)));
  }, []);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (password !== confirm) {
      setError("Both passwords must match.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setIsSubmitting(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setIsSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    // Sign out everywhere so any session an attacker may hold is
    // invalidated by the reset, then send the user to sign in fresh.
    await supabase.auth.signOut({ scope: "global" });
    router.push("/login?reset=1");
    router.refresh();
  }

  if (hasSession === false) {
    return (
      <AuthShell title="Link expired" subtitle="That reset link is no longer valid.">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Reset links are single-use and expire quickly. Request a new one to continue.
        </p>
        <Button size="lg" className="mt-6 w-full justify-center" onClick={() => router.push("/forgot-password")}>
          Request a new link
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set a new password" subtitle="Choose something you don't use elsewhere.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        <Input
          type="password"
          name="password"
          label="New password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
        />
        <Input
          type="password"
          name="confirm"
          label="Confirm new password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          leftIcon={<Lock className="h-4 w-4" aria-hidden="true" />}
          error={error ?? undefined}
        />
        <Button type="submit" size="lg" isLoading={isSubmitting} className="w-full justify-center">
          Update password
        </Button>
      </form>
    </AuthShell>
  );
}
