import "server-only";

import { z } from "zod";

/**
 * WEB PUSH — architecture and validation.
 *
 * Subscription storage, validation and lifecycle are implemented. ACTUAL
 * SENDING IS NOT, and deliberately so: dispatching a Web Push message
 * requires VAPID key generation plus JWT signing and AES-128-GCM payload
 * encryption per RFC 8291. Writing that against a spec I cannot test
 * end-to-end here would produce code that looks complete and silently
 * fails against real push services.
 *
 * TO COMPLETE:
 *   1. Generate a VAPID keypair (`npx web-push generate-vapid-keys`).
 *   2. Set VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (a mailto:
 *      or https: URL identifying you to the push service).
 *   3. Add the `web-push` package and implement sendPush() below with it —
 *      do not hand-roll the encryption.
 *   4. Add a service worker at /public/sw.js handling the `push` event.
 *
 * Until then the sender marks push deliveries as permanently failed with
 * `push_not_implemented`, which surfaces in the admin rather than silently
 * accumulating pending rows.
 */

export function isPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT,
  );
}

/** The public key is safe to expose — the browser needs it to subscribe. */
export function getPublicVapidKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY ?? null;
}

/**
 * Shape of a browser PushSubscription. Validated rather than trusted: this
 * arrives from client JavaScript, and the endpoint becomes a URL our server
 * will later make requests to.
 */
export const pushSubscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((v) => v.startsWith("https://"), "Push endpoint must use https"),
  keys: z.object({
    p256dh: z.string().min(20).max(200),
    auth: z.string().min(10).max(100),
  }),
});

export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

/**
 * Known push service hosts. An endpoint pointing anywhere else would turn
 * the sender into a server-side request forgery primitive — we would be
 * making authenticated outbound requests to an attacker-chosen URL.
 */
const ALLOWED_PUSH_HOSTS = [
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "wns2-*.notify.windows.com",
  "web.push.apple.com",
];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:") return false;
    host = url.hostname.toLowerCase();
  } catch {
    return false;
  }

  return ALLOWED_PUSH_HOSTS.some((pattern) => {
    if (pattern.includes("*")) {
      const [prefix, suffix] = pattern.split("*");
      return host.startsWith(prefix) && host.endsWith(suffix);
    }
    return host === pattern || host.endsWith(`.${pattern}`);
  });
}

export interface PushSendResult {
  ok: boolean;
  errorCode?: string;
  httpStatus?: number;
}

/**
 * Not implemented — see the module comment. Returns a clear code rather
 * than throwing, so the sender records it and moves on.
 */
export async function sendPush(): Promise<PushSendResult> {
  return { ok: false, errorCode: "push_not_implemented" };
}
