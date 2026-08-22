import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";
import { notificationPreferencesSchema, profileUpdateSchema } from "@/lib/validation/user";
import { z } from "zod";

/**
 * The signed-in user's own profile. There is deliberately no route that
 * fetches another user's profile: RLS restricts rows to auth.uid(), and the
 * explicit .eq("id", user.id) below is defence in depth, not the only
 * control.
 *
 * The email is read from the auth session rather than stored again in
 * profiles — one copy, owned by Supabase Auth.
 */
export const GET = withErrorHandling(async () => {
  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("profiles")
    .select(
      `display_name, avatar_url, notify_email, notify_push,
       notify_price_drop, notify_back_in_stock, notify_product_news, created_at`,
    )
    .eq("id", user.id)
    .limit(1);

  if (error) throw error;
  const row = data?.[0];

  return NextResponse.json({
    id: user.id,
    email: user.email ?? null,
    displayName: row?.display_name ?? null,
    avatarUrl: row?.avatar_url ?? null,
    createdAt: row?.created_at ?? null,
    preferences: {
      notifyEmail: row?.notify_email ?? true,
      notifyPush: row?.notify_push ?? false,
      notifyPriceDrop: row?.notify_price_drop ?? true,
      notifyBackInStock: row?.notify_back_in_stock ?? false,
      notifyProductNews: row?.notify_product_news ?? false,
    },
  });
});

const patchSchema = z.object({
  profile: profileUpdateSchema.optional(),
  preferences: notificationPreferencesSchema.optional(),
});

export const PATCH = withErrorHandling(async (request: Request) => {
  const body = patchSchema.parse(await request.json());

  const supabase = await createClient();
  const user = await requireUser(supabase);

  // Whitelist of writable columns. Anything not listed here — id, created_at,
  // and any future column — cannot be set by a client, even if included in
  // the request body.
  const update: Record<string, unknown> = {};
  if (body.profile?.displayName !== undefined) update.display_name = body.profile.displayName || null;
  if (body.profile?.avatarUrl !== undefined) update.avatar_url = body.profile.avatarUrl || null;
  if (body.preferences?.notifyEmail !== undefined) update.notify_email = body.preferences.notifyEmail;
  if (body.preferences?.notifyPush !== undefined) update.notify_push = body.preferences.notifyPush;
  if (body.preferences?.notifyPriceDrop !== undefined) update.notify_price_drop = body.preferences.notifyPriceDrop;
  if (body.preferences?.notifyBackInStock !== undefined) update.notify_back_in_stock = body.preferences.notifyBackInStock;
  if (body.preferences?.notifyProductNews !== undefined) update.notify_product_news = body.preferences.notifyProductNews;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ message: "Nothing to update" }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(update).eq("id", user.id);
  if (error) throw error;

  return NextResponse.json({ updated: true });
});
