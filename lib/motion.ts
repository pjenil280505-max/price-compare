"use client";

import { useReducedMotion } from "framer-motion";
import type { Variants } from "framer-motion";

/** Wraps framer-motion's hook so the rest of the app imports one stable name. */
export function useReducedMotionSafe(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * Cubic-bezier control points. Typed as an explicit tuple rather than
 * Transition["ease"] — framer-motion no longer exposes that member, and a
 * bezier is a 4-number tuple regardless of library version.
 */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: EASE_OUT } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.2, ease: "easeOut" } },
};

export const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};

/**
 * Collapses any variant set to a near-instant fade when the user prefers
 * reduced motion, so every animated component can stay written the same
 * way (`variants={withMotionPreference(fadeUp, reduced)}`) instead of
 * branching logic in each component.
 */
export function withMotionPreference(variants: Variants, reduced: boolean): Variants {
  if (!reduced) return variants;
  const result: Variants = {};
  for (const key of Object.keys(variants)) {
    const state = variants[key];
    const opacity =
      typeof state === "object" && state !== null && "opacity" in state
        ? (state as { opacity?: number }).opacity
        : undefined;
    result[key] = { opacity: opacity ?? 1, transition: { duration: 0.12 } };
  }
  return result;
}
