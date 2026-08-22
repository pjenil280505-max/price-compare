import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Audit logging for sensitive admin actions.
 *
 * Writes go through the service-role client because audit_log grants no
 * client role INSERT — an admin must not be able to edit or delete their
 * own trail.
 *
 * `details` is redacted before it is written. An audit log is exactly the
 * wrong place for a token or an email address, and the easiest way for one
 * to end up there is a well-meaning `details: requestBody`.
 */

export type AuditAction =
  | "connector.sync_now"
  | "connector.enabled"
  | "connector.disabled"
  | "connector.config_updated"
  | "match.approved"
  | "match.rejected"
  | "product.merged"
  | "product.unmerged"
  | "affiliate.config_viewed";

/** Keys whose values are never written, at any nesting depth. */
const REDACT_KEYS = [
  "password", "token", "secret", "key", "apikey", "api_key", "credential",
  "authorization", "cookie", "session", "email", "phone",
];

const MAX_DETAIL_CHARS = 2000;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[nested]";
  if (value == null) return value;

  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACT_KEYS.some((needle) => key.toLowerCase().includes(needle))
        ? "[redacted]"
        : redact(v, depth + 1);
    }
    return out;
  }

  if (typeof value === "string" && value.length > 200) return `${value.slice(0, 200)}…`;
  return value;
}

export async function recordAuditLog(
  admin: SupabaseClient,
  params: {
    actorId: string | null;
    action: AuditAction;
    targetTable?: string;
    targetId?: string;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    let details = redact(params.details ?? {}) as Record<string, unknown>;

    const serialized = JSON.stringify(details);
    if (serialized.length > MAX_DETAIL_CHARS) {
      details = { truncated: true, preview: serialized.slice(0, MAX_DETAIL_CHARS) };
    }

    await admin.from("audit_log").insert({
      actor_id: params.actorId,
      action: params.action,
      target_table: params.targetTable ?? null,
      target_id: params.targetId ?? null,
      details,
    });
  } catch (error) {
    // An audit-write failure must not abort the action being audited —
    // that would let a logging outage become a denial of service on admin
    // work. The failure itself is logged for operators.
    console.error("[audit]", params.action, error instanceof Error ? error.message : "unknown");
  }
}
