import "server-only";

import { buildUnsubscribeUrl, createUnsubscribeToken, type NotificationChannel } from "./unsubscribe";

/**
 * EMAIL DELIVERY via Resend.
 *
 * Degrades honestly: with no RESEND_API_KEY configured, send() returns a
 * "not configured" result rather than throwing or silently pretending to
 * have sent. The alert job reports that state, so a missing key is visible
 * in System Health instead of manifesting as users never hearing from us.
 *
 * Every email carries a working one-click unsubscribe (RFC 8058). That is
 * both a legal expectation and the single biggest factor in not being
 * marked as spam.
 */

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  userId: string;
  unsubscribeChannel: NotificationChannel;
  unsubscribeSalt: string;
  baseUrl: string;
}

export interface SendEmailResult {
  ok: boolean;
  providerMessageId?: string;
  errorCode?: string;
  httpStatus?: number;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL);
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  if (!isEmailConfigured()) {
    // Not an error and not a retryable failure — there is nothing to retry
    // until an operator configures the provider.
    return { ok: false, errorCode: "email_not_configured" };
  }

  const token = createUnsubscribeToken({
    userId: params.userId,
    channel: params.unsubscribeChannel,
    salt: params.unsubscribeSalt,
  });
  const unsubscribeUrl = buildUnsubscribeUrl(params.baseUrl, token);

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.NOTIFICATION_FROM_EMAIL,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        headers: {
          // RFC 8058 one-click unsubscribe. Mail clients surface this as a
          // native "unsubscribe" affordance, which users reach for instead
          // of "report spam".
          "List-Unsubscribe": `<${unsubscribeUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    });

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, providerMessageId: body.id };
    }

    // Map the provider's response to a short code. The raw body is
    // deliberately not returned: it commonly echoes the recipient address,
    // which must not end up in an operational table.
    const errorCode = await classifyProviderError(response);
    return { ok: false, errorCode, httpStatus: response.status };
  } catch (error) {
    // Network-level failure — retryable.
    return {
      ok: false,
      errorCode: error instanceof Error && error.name === "AbortError" ? "timeout" : "network_error",
    };
  }
}

async function classifyProviderError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { name?: string; message?: string };
    const name = (body.name ?? "").toLowerCase();
    const message = (body.message ?? "").toLowerCase();

    if (name.includes("validation") || message.includes("invalid") && message.includes("email")) {
      return "invalid_recipient";
    }
    if (response.status === 401 || response.status === 403) return "invalid_api_key";
    if (response.status === 429) return "rate_limited";
    if (message.includes("suppress")) return "suppressed";
    return `http_${response.status}`;
  } catch {
    return `http_${response.status}`;
  }
}

export function buildUnsubscribeLink(params: {
  userId: string;
  channel: NotificationChannel;
  salt: string;
  baseUrl: string;
}): string {
  return buildUnsubscribeUrl(
    params.baseUrl,
    createUnsubscribeToken({ userId: params.userId, channel: params.channel, salt: params.salt }),
  );
}
