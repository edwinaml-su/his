"use client";

/**
 * Wrappers ligeros para construir formularios accesibles sin react-hook-form
 * (no agregamos esa dependencia en MVP). Ofrece estructura `Field`, `Label`, `Hint`, `Error`.
 *
 * TODO(Sprint 2): integrar react-hook-form + zodResolver cuando se requiera
 * validación cliente compleja. Por ahora server actions + Zod en tRPC bastan.
 */
import * as React from "react";
import { cn } from "../lib/utils";

export const Form = React.forwardRef<HTMLFormElement, React.FormHTMLAttributes<HTMLFormElement>>(
  ({ className, ...props }, ref) => (
    <form ref={ref} className={cn("space-y-4", className)} {...props} />
  ),
);
Form.displayName = "Form";

export function FormField({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn("space-y-1.5", className)}>{children}</div>;
}

export function FormHint({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-xs text-muted-foreground", className)}>{children}</p>;
}

export function FormError({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  if (!children) return null;
  return <p className={cn("text-xs font-medium text-destructive", className)}>{children}</p>;
}
