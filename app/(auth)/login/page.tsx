"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(email: string, password: string) {
    setError(null);
    const supabase = createClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Supabase's own message is safe to show as-is for auth errors
      // ("Invalid login credentials", etc.) — it never leaks anything
      // beyond what a login form is expected to reveal.
      setError(signInError.message);
      return;
    }

    const next = searchParams.get("next") ?? "/account";
    router.push(next);
    router.refresh();
  }

  async function handleGoogleSignIn() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to see your wishlist and price alerts.">
      <LoginForm onSubmit={handleSubmit} onGoogleSignIn={handleGoogleSignIn} error={error} />
    </AuthShell>
  );
}
