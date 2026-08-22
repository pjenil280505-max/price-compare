import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { badRequest, withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";
import { enforceRateLimit } from "@/lib/server/rateLimit";
import {
  getPublicVapidKey, isAllowedPushEndpoint, isPushConfigured, pushSubscriptionSchema,
} from "@/lib/notifications/push";

/** Tells the client whether push is available and supplies the public key. */
export const GET = withErrorHandling(async () => {
  return NextResponse.json({
    configured: isPushConfigured(),
    publicKey: getPublicVapidKey(),
  });
});

export const POST = withErrorHandling(async (request: Request) => {
  enforceRateLimit(request, { key: "push-subscribe", limit: 10, windowMs: 60_000 });

  const body = pushSubscriptionSchema.parse(await request.json());

  // The endpoint becomes a URL this server later makes outbound requests
  // to. Restricting it to known push services prevents that being used as
  // an SSRF primitive.
  if (!isAllowedPushEndpoint(body.endpoint)) {
    throw badRequest("Unrecognised push service endpoint.");
  }

  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) throw error;
  return NextResponse.json({ subscribed: true });
});

export const DELETE = withErrorHandling(async (request: Request) => {
  const endpoint = new URL(request.url).searchParams.get("endpoint");
  if (!endpoint) throw badRequest("endpoint is required");

  const supabase = await createClient();
  const user = await requireUser(supabase);

  // RLS restricts to the caller's rows; the explicit user_id filter is
  // defence in depth.
  const { error } = await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);

  if (error) throw error;
  return new NextResponse(null, { status: 204 });
});
