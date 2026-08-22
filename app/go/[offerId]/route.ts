import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/server/errors";
import { resolveAffiliateLink } from "@/lib/affiliate/resolver";
import { isSafeUrl } from "@/lib/affiliate/linkBuilder";
import {
  buildClickContext,
  buildSubId,
  generateSessionToken,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
} from "@/lib/affiliate/tracking";

interface RouteParams {
  params: Promise<{ offerId: string }>;
}

/** Host + path, discarding query/fragment, for click logging. */
function stripQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.slice(0, 500);
  } catch {
    return url.slice(0, 500);
  }
}

/**
 * THE BUY NOW DESTINATION.
 *
 * Every outbound click passes through here. The affiliate URL is derived at
 * click time from (merchant configuration + the destination URL the feed
 * supplied) — there is no per-product link stored anywhere.
 *
 * Ordering is deliberate: resolve the link, log the click, then redirect.
 * Logging never blocks the redirect — a failed insert must not cost the
 * user their purchase.
 */
export async function GET(request: Request, { params }: RouteParams) {
  const { offerId } = await params;
  const origin = new URL(request.url).origin;

  if (!isUuid(offerId)) {
    return NextResponse.redirect(new URL("/not-found", request.url));
  }

  const supabase = await createClient();

  const { data: offerRows, error } = await supabase
    .from("merchant_offers")
    .select("id, destination_url, is_active, merchant_id")
    .eq("id", offerId)
    .limit(1)
    .returns<{ id: string; destination_url: string; is_active: boolean; merchant_id: string }[]>();

  const offer = offerRows?.[0];

  if (error || !offer || !offer.is_active || !isSafeUrl(offer.destination_url)) {
    return NextResponse.redirect(new URL("/not-found", request.url));
  }

  // --- Session token: opaque, rotating, not tied to an account ----------
  const cookieStore = await cookies();
  let sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  let isNewSession = false;
  if (!sessionToken || !/^[a-f0-9]{24}$/.test(sessionToken)) {
    sessionToken = generateSessionToken();
    isNewSession = true;
  }

  const clickContext = buildClickContext(request, origin);

  // --- Resolve the affiliate destination -------------------------------
  const resolved = await resolveAffiliateLink(supabase, {
    merchantId: offer.merchant_id,
    destinationUrl: offer.destination_url,
    context: {
      subId: buildSubId(sessionToken, clickContext.referrerPath?.split("/")[1]),
      campaign: clickContext.referrerPath?.split("/")[1],
    },
  });

  const finalUrl = isSafeUrl(resolved.url) ? resolved.url : offer.destination_url;

  // --- Log the click (service role: anonymous visitors have no auth.uid) --
  const {
    data: { user },
  } = await supabase.auth.getUser();

  try {
    const admin = createAdminClient();
    await admin.from("affiliate_clicks").insert({
      merchant_offer_id: offer.id,
      user_id: user?.id ?? null,
      session_id: sessionToken,
      // Host + path only. The full URL would embed tracking/sub-ID params
      // on every row for no diagnostic benefit — link_outcome and
      // fallback_reason already explain what happened, without duplicating
      // identifiers into a second table.
      destination_url: stripQuery(finalUrl),
      referrer_path: clickContext.referrerPath,
      device_type: clickContext.deviceType,
      platform: clickContext.platform,
      link_outcome: resolved.outcome,
      link_strategy: resolved.strategy,
      fallback_reason: resolved.reason ?? null,
      campaign: clickContext.referrerPath?.split("/")[1]?.slice(0, 64) ?? null,
    });
  } catch (logError) {
    // Never block the purchase on analytics.
    console.error("[affiliate-click-log]", logError instanceof Error ? logError.message : logError);
  }

  const response = NextResponse.redirect(finalUrl, { status: 302 });

  if (isNewSession) {
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    });
  }

  return response;
}
