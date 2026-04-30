import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combina clases Tailwind con resolución correcta de conflictos.
 *
 * - `clsx` permite condicionales y arrays.
 * - `tailwind-merge` colapsa clases que apuntan al mismo bucket
 *   (p. ej. `p-2 p-4` -> `p-4`), respetando overrides en composición.
 *
 * Convención Shadcn/ui — usar SIEMPRE en componentes con `className` prop.
 *
 * @example
 * cn("p-2 text-sm", isActive && "bg-primary", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
