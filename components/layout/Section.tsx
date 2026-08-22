import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Container } from "./Container";
import { ScrollReveal } from "@/components/motion/ScrollReveal";

export interface SectionProps {
  children: ReactNode;
  className?: string;
  containerSize?: "wide" | "narrow";
  /** Animate the section into view on scroll. Off by default for above-the-fold content. */
  reveal?: boolean;
  as?: "section" | "div";
}

export function Section({ children, className, containerSize = "wide", reveal = false, as = "section" }: SectionProps) {
  const Tag = as;
  const content = (
    <Tag className={cn("py-12 sm:py-16 lg:py-20", className)}>
      <Container size={containerSize}>{children}</Container>
    </Tag>
  );

  if (!reveal) return content;

  return (
    <ScrollReveal as={Tag} className={cn("py-12 sm:py-16 lg:py-20", className)}>
      <Container size={containerSize}>{children}</Container>
    </ScrollReveal>
  );
}
