"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { EASE_OUT, useReducedMotionSafe } from "@/lib/motion";

export interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
  /** Stagger delay in seconds, for revealing several sections in sequence. */
  delay?: number;
}

export function ScrollReveal({ children, className, as = "div", delay = 0 }: ScrollRevealProps) {
  const reduced = useReducedMotionSafe();
  const MotionTag = as === "section" ? motion.section : motion.div;

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: reduced ? 0 : 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: reduced ? 0.15 : 0.5, ease: EASE_OUT, delay: reduced ? 0 : delay }}
    >
      {children}
    </MotionTag>
  );
}
