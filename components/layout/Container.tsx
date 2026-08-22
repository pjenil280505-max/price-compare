import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ContainerProps {
  children: ReactNode;
  className?: string;
  /** "wide" for grids/dashboards, "narrow" for reading-width content like forms. */
  size?: "wide" | "narrow";
}

export function Container({ children, className, size = "wide" }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        size === "wide" ? "max-w-7xl" : "max-w-2xl",
        className,
      )}
    >
      {children}
    </div>
  );
}
