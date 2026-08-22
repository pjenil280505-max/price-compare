import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { withErrorHandling } from "@/lib/server/errors";
import { requireUser } from "@/lib/server/auth";
import type { Notification } from "@/lib/types";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  is_read: boolean;
  created_at: string;
  products: { slug: string } | null;
}

export const GET = withErrorHandling(async (request: Request) => {
  const unreadOnly = new URL(request.url).searchParams.get("unread") === "1";

  const supabase = await createClient();
  const user = await requireUser(supabase);

  let query = supabase
    .from("notifications")
    .select("id, type, title, body, is_read, created_at, products ( slug )")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (unreadOnly) query = query.eq("is_read", false);

  const { data, error } = await query.returns<NotificationRow[]>();
  if (error) throw error;

  const notifications: Notification[] = (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as Notification["type"],
    title: row.title,
    body: row.body ?? undefined,
    relatedProductSlug: row.products?.slug,
    isRead: row.is_read,
    createdAt: row.created_at,
  }));

  return NextResponse.json(notifications);
});
