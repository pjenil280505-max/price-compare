"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/SignupForm";

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(details: { name: string; email: string; password: string }) {
    setError(null);
    const supabase = createClient();

    const { error: signUpError } = await supabase.auth.signUp({
      email: details.email,
      password: details.password,
      options: {
        // Read by the handle_new_user() trigger (0002_identity_and_access.sql)
        // to seed profiles.display_name — never trust this for anything
        // security-sensitive, it's user-supplied at signup time.
        data: { full_name: details.name },
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (signUpError) {
      setError(signUpError.message);
      return;
    }

    setConfirmationSent(true);
  }

  async function handleGoogleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  if (confirmationSent) {
    return (
      <AuthShell title="Check your email" subtitle="We've sent a confirmation link to finish creating your account.">
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Click the link in that email, then come back and sign in.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Save products, track prices, and never miss a drop.">
      <SignupForm onSubmit={handleSubmit} onGoogleSignIn={handleGoogleSignIn} error={error} />
    </AuthShell>
  );
}
