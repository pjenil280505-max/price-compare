import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { assertUuid, notFound, withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";

interface RouteParams {
  params: Promise<{ notificationId: string }>;
}

// Only is_read is accepted here. RLS scopes the row to its owner, but it
// can't stop an owner from rewriting their own notification's title/body —
// restricting the accepted fields at this layer is what does that (see the
// notifications_update_own policy comment in 0008_row_level_security.sql).
const patchSchema = z.object({ isRead: z.boolean() });

export const PATCH = withErrorHandling(async (request: Request, { params }: RouteParams) => {
  const { notificationId } = await params;
  assertUuid(notificationId, "notification id");
  const { isRead } = patchSchema.parse(await request.json());

  const supabase = await createClient();
  const user = await requireUser(supabase);

  const { data, error } = await supabase
    .from("notifications")
    .update({ is_read: isRead })
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .select("id, is_read")
    .single();

  if (error || !data) throw notFound("Notification not found");

  return NextResponse.json({ id: data.id, isRead: data.is_read });
});
