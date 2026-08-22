import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withErrorHandling } from "@/lib/server/errors";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import { peekTokenUserId, verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";

/**
 * One-click unsubscribe (RFC 8058).
 *
 * Deliberate properties:
 *   - NO SESSION REQUIRED. The recipient may not be signed in, and mail
 *     clients invoke this on their behalf.
 *   - POST is the RFC 8058 one-click target; GET is handled by the page at
 *     /unsubscribe so a human clicking the link sees a confirmation.
 *   - IDEMPOTENT. Mail scanners follow links automatically, sometimes
 *     repeatedly; unsubscribing twice must be harmless.
 *   - UNIFORM RESPONSE. An invalid token returns the same shape as a valid
 *     one, so this cannot be used to test whether a user id exists.
 */
async function processUnsubscribe(request: Request, token: string | null) {
  enforceRateLimit(request, { key: "unsubscribe", limit: 30, windowMs: 60_000 });

  const generic = { ok: true, message: "You've been unsubscribed." };
  if (!token) return generic;

  const userId = peekTokenUserId(token);
  if (!userId) return generic;

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("profiles")
    .select("unsubscribe_salt")
    .eq("id", userId)
    .limit(1);

  if (error || !data || data.length === 0) return generic;

  const verified = verifyUnsubscribeToken(token, data[0].unsubscribe_salt as string);
  if (!verified) return generic;

  const { error: applyError } = await admin.rpc("apply_unsubscribe", {
    p_user_id: verified.userId,
    p_channel: verified.channel,
  });

  // Even a write failure returns the generic success: the alternative
  // leaks that the token was valid. The failure is logged for operators.
  if (applyError) {
    console.error("[unsubscribe] apply failed", applyError.message);
  }

  return generic;
}

export const POST = withErrorHandling(async (request: Request) => {
  const url = new URL(request.url);
  let token = url.searchParams.get("token");

  // RFC 8058 clients POST `List-Unsubscribe=One-Click` as a form body; the
  // token stays in the URL, but accept a body token too for robustness.
  if (!token) {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("form")) {
      const form = await request.formData().catch(() => null);
      token = (form?.get("token") as string | null) ?? null;
    }
  }

  return NextResponse.json(await processUnsubscribe(request, token));
});

export const GET = withErrorHandling(async (request: Request) => {
  const token = new URL(request.url).searchParams.get("token");
  return NextResponse.json(await processUnsubscribe(request, token));
});
