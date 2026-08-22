/**
 * Email templates.
 *
 * SECURITY NOTE: every interpolated value is HTML-escaped. Product titles
 * and merchant names originate from merchant feeds — data we did not author
 * — so treating them as trusted markup would let a hostile or malformed
 * feed inject content into an email we send under our own domain.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface PriceAlertEmailData {
  productTitle: string;
  productUrl: string;
  currentPrice: string;
  targetPrice: string;
  merchantName?: string;
  unsubscribeUrl: string;
  manageAlertsUrl: string;
}

export function renderPriceAlertEmail(data: PriceAlertEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const title = escapeHtml(data.productTitle);
  const merchant = data.merchantName ? escapeHtml(data.merchantName) : null;
  const current = escapeHtml(data.currentPrice);
  const target = escapeHtml(data.targetPrice);
  const url = escapeHtml(data.productUrl);
  const unsub = escapeHtml(data.unsubscribeUrl);
  const manage = escapeHtml(data.manageAlertsUrl);

  const subject = `${data.productTitle} is now ${data.currentPrice}`;

  // Table-based layout with inline styles: email clients strip <style>
  // blocks and have inconsistent flexbox support, so this is the format
  // that actually renders in Gmail and Outlook.
  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,Segoe UI,Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="padding:28px 24px 8px;">
          <p style="margin:0 0 6px;font-size:13px;color:#726e8a;">Price alert</p>
          <h1 style="margin:0;font-size:20px;line-height:1.35;color:#14131c;font-weight:600;">${title}</h1>
        </td></tr>
        <tr><td style="padding:16px 24px;">
          <p style="margin:0;font-size:32px;font-weight:700;color:#2e9e68;">${current}</p>
          <p style="margin:6px 0 0;font-size:14px;color:#524e6b;">
            ${merchant ? `at ${merchant} &middot; ` : ""}your target was ${target}
          </p>
        </td></tr>
        <tr><td style="padding:8px 24px 24px;">
          <a href="${url}" style="display:inline-block;background:#14131c;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:8px;font-size:15px;font-weight:600;">View offers</a>
        </td></tr>
        <tr><td style="padding:0 24px 24px;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#726e8a;">
            Prices are shown as of our last verified check and can change on the retailer's site.
            Some links are affiliate links, which may earn us a commission at no extra cost to you.
          </p>
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #e5e4ea;">
          <p style="margin:0;font-size:12px;color:#9e9bb0;">
            <a href="${manage}" style="color:#726e8a;">Manage your alerts</a>
            &nbsp;&middot;&nbsp;
            <a href="${unsub}" style="color:#726e8a;">Unsubscribe from price alerts</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // A plain-text alternative is not optional: multipart emails without one
  // score materially worse with spam filters.
  const text = [
    `Price alert: ${data.productTitle}`,
    ``,
    `Now ${data.currentPrice}${data.merchantName ? ` at ${data.merchantName}` : ""}`,
    `Your target was ${data.targetPrice}`,
    ``,
    `View offers: ${data.productUrl}`,
    ``,
    `Prices are shown as of our last verified check and can change on the retailer's site.`,
    `Some links are affiliate links.`,
    ``,
    `Manage alerts: ${data.manageAlertsUrl}`,
    `Unsubscribe: ${data.unsubscribeUrl}`,
  ].join("\n");

  return { subject, html, text };
}
