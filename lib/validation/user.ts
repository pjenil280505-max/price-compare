import { z } from "zod";

/**
 * Validation for every user-supplied input in the account system.
 *
 * Two things this layer is responsible for:
 *   - bounding everything (length, range, type) so a hostile payload can't
 *     reach the database or an email template
 *   - stripping control characters from free-text that gets rendered back,
 *     which is defence-in-depth behind React's own escaping
 */

/**
 * Removes control characters and zero-width/bidi overrides. React escapes
 * HTML already, so this is not the XSS defence — it exists because these
 * characters can spoof display names in notification emails and admin
 * lists (a right-to-left override can make "evil.com" render as "moc.live").
 */
export function sanitizeDisplayText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    .trim();
}

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254) // RFC 5321 maximum
  .email();

/**
 * Password rules are enforced here for a clear error message, but the
 * actual hashing, storage, and breach handling are Supabase Auth's job —
 * this codebase never sees, stores, or logs a password.
 */
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(72, "Password must be 72 characters or fewer") // bcrypt truncation boundary
  .refine((v) => !/^\s+$/.test(v), "Password cannot be only whitespace");

export const profileUpdateSchema = z.object({
  displayName: z
    .string()
    .max(80)
    .transform(sanitizeDisplayText)
    .refine((v) => v.length === 0 || v.length >= 2, "Name must be at least 2 characters")
    .optional(),
  avatarUrl: z
    .string()
    .max(2048)
    .url()
    .refine((v) => v.startsWith("https://"), "Avatar URL must use https")
    .optional()
    .or(z.literal("")),
});

export const notificationPreferencesSchema = z.object({
  notifyEmail: z.boolean().optional(),
  notifyPush: z.boolean().optional(),
  notifyPriceDrop: z.boolean().optional(),
  notifyBackInStock: z.boolean().optional(),
  notifyProductNews: z.boolean().optional(),
});

export const priceAlertSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  // Upper bound guards against a typo creating an alert that can never be
  // meaningfully evaluated, and against numeric overflow in numeric(12,2).
  targetPrice: z.number().positive().max(99_999_999).finite(),
  active: z.boolean().default(true),
});

export const priceAlertUpdateSchema = z.object({
  targetPrice: z.number().positive().max(99_999_999).finite().optional(),
  active: z.boolean().optional(),
});

export const recentlyViewedSchema = z.object({
  productId: z.string().uuid(),
});

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
});

export const passwordUpdateSchema = z.object({
  password: passwordSchema,
});
