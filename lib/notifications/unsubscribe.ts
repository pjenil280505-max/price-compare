import "server-only";

import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/**
 * UNSUBSCRIBE TOKENS
 *
 * Every notification email must carry a working one-click unsubscribe link
 * (RFC 8058 / List-Unsubscribe), and that link is followed by mail clients
 * and security scanners without the user's involvement. That drives two
 * requirements:
 *
 *   1. The link must be UNGUESSABLE. A sequential or user-id-derived link
 *      would let anyone unsubscribe anyone. Tokens are HMAC-signed with a
 *      server-only secret.
 *   2. Following the link must be SAFE to do repeatedly and must not
 *      require a session — the recipient may not be logged in, and may not
 *      even be the one clicking.
 *
 * Tokens are stateless: nothing is stored, so there is no table to leak and
 * no cleanup job. Revocation comes from rotating the secret or from the
 * salt stored on the profile (see `salt` below).
 */

export type NotificationChannel = "price_drop" | "back_in_stock" | "product_news" | "all";

const TOKEN_VERSION = "v1";

/**
 * The signing secret. Falls back to the service-role key ONLY so that a
 * deployment without a dedicated secret still produces unguessable tokens
 * rather than predictable ones — but a dedicated secret is strongly
 * preferred, because rotating the service role key to revoke unsubscribe
 * links would take the whole application down.
 */
function signingSecret(): string {
  const secret = process.env.NOTIFICATION_TOKEN_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error(
      "NOTIFICATION_TOKEN_SECRET is not set. Unsubscribe links cannot be signed, " +
        "so notification emails must not be sent.",
    );
  }
  return secret;
}

function sign(payload: string): string {
  return createHmac("sha256", signingSecret()).update(payload).digest("base64url");
}

/**
 * Builds a token for one user + channel.
 *
 * `salt` should be a per-user value (profiles.unsubscribe_salt). Changing
 * it invalidates every previously issued link for that user without
 * affecting anyone else — which is what makes revocation possible at all
 * for a stateless token.
 */
export function createUnsubscribeToken(params: {
  userId: string;
  channel: NotificationChannel;
  salt: string;
}): string {
  const payload = `${TOKEN_VERSION}.${params.userId}.${params.channel}.${params.salt}`;
  return `${TOKEN_VERSION}.${params.userId}.${params.channel}.${sign(payload)}`;
}

export interface VerifiedToken {
  userId: string;
  channel: NotificationChannel;
}

const VALID_CHANNELS: NotificationChannel[] = ["price_drop", "back_in_stock", "product_news", "all"];

/**
 * Verifies a token against the user's current salt.
 *
 * Returns null for anything malformed or mismatched — deliberately without
 * distinguishing the two, so the endpoint cannot be used to probe which
 * user ids exist.
 */
export function verifyUnsubscribeToken(token: string, salt: string): VerifiedToken | null {
  const parts = token.split(".");
  if (parts.length !== 4) return null;

  const [version, userId, channel, signature] = parts;
  if (version !== TOKEN_VERSION) return null;
  if (!VALID_CHANNELS.includes(channel as NotificationChannel)) return null;

  const expected = sign(`${version}.${userId}.${channel}.${salt}`);

  // Constant-time comparison. A plain === leaks timing information that,
  // over many requests, can be used to forge a signature byte by byte.
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;

  return { userId, channel: channel as NotificationChannel };
}

/** Extracts the user id without verifying — used only to look up the salt. */
export function peekTokenUserId(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== TOKEN_VERSION) return null;
  // Must look like a UUID before it is used in a database query.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parts[1])) return null;
  return parts[1];
}

export function generateUnsubscribeSalt(): string {
  return randomUUID();
}

export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}/unsubscribe?token=${encodeURIComponent(token)}`;
}
