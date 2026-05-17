"use client";

/**
 * Checkbox — control accesible WCAG 2.2 AA sin dependencias externas.
 *
 * Implementa `role="checkbox"` + `aria-checked` nativamente con un <button>.
 * Equivalente funcional al componente Shadcn/Radix pero sin @radix-ui/react-checkbox.
 *
 * API compatible con el patrón Shadcn: `checked`, `onCheckedChange`, `disabled`, `id`.
 */
import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";

export interface CheckboxProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
}

export const Checkbox = React.forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, checked = false, onCheckedChange, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onCheckedChange?.(!checked)}
        className={cn(
          "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          checked ? "bg-primary text-primary-foreground" : "bg-background",
          "flex items-center justify-center",
          className,
        )}
        {...props}
      >
        {checked && <Check className="h-3 w-3" aria-hidden="true" />}
      </button>
    );
  },
);
Checkbox.displayName = "Checkbox";
