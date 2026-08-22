"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  error?: string;
  label?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, leftIcon, rightIcon, error, label, id, ...props }, ref) => {
    const inputId = id ?? props.name;
    const errorId = error && inputId ? `${inputId}-error` : undefined;

    return (
      <div className="w-full">
        {label && (
          <label htmlFor={inputId} className="mb-1.5 block text-sm font-medium text-ink-700 dark:text-ink-200">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="pointer-events-none absolute left-3 flex text-ink-400" aria-hidden="true">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={errorId}
            className={cn(
              "h-11 w-full rounded-md border border-ink-200 bg-paper px-3.5 text-sm text-ink placeholder:text-ink-400",
              "transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-saffron focus-visible:border-saffron",
              "dark:border-ink-700 dark:bg-ink-900 dark:text-paper",
              leftIcon && "pl-10",
              rightIcon && "pr-10",
              error && "border-vermilion focus-visible:ring-vermilion",
              className,
            )}
            {...props}
          />
          {rightIcon && <span className="absolute right-3 flex text-ink-400">{rightIcon}</span>}
        </div>
        {error && (
          <p id={errorId} role="alert" className="mt-1.5 text-sm text-vermilion-600 dark:text-vermilion-400">
            {error}
          </p>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";
