import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { passwordResetRequestSchema } from "@/lib/validation/user";

/**
 * Password reset request.
 *
 * Security properties, all deliberate:
 *
 *   1. NO ACCOUNT ENUMERATION. The response is identical whether or not the
 *      address has an account. An attacker must not be able to use this
 *      endpoint to discover who is registered.
 *   2. RATE LIMITED. Unthrottled, this is both an enumeration oracle and an
 *      email-bombing tool aimed at a third party's inbox.
 *   3. NO TOKEN HANDLING HERE. Supabase Auth generates, signs, expires and
 *      single-uses the reset token. Hand-rolling that is the classic way
 *      password reset gets broken.
 *   4. NOTHING SENSITIVE LOGGED. The email address is never written to a
 *      log line, and any provider error is swallowed rather than returned.
 */
export const POST = withErrorHandling(async (request: Request) => {
  enforceRateLimit(request, { key: "password-reset", limit: 5, windowMs: 15 * 60_000 });

  const body = await request.json().catch(() => ({}));
  const parsed = passwordResetRequestSchema.safeParse(body);

  // Even a malformed address returns the same generic success, so the shape
  // of the response never signals anything about the account.
  if (parsed.success) {
    const supabase = await createClient();
    const origin = new URL(request.url).origin;

    try {
      await supabase.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      });
    } catch {
      // Intentionally swallowed: surfacing provider errors would leak
      // whether the address exists.
    }
  }

  return NextResponse.json({
    message: "If that email has an account, a reset link is on its way.",
  });
});
