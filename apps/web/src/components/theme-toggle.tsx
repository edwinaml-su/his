"use client";

/**
 * ThemeToggle — botón compacto para alternar tema claro / oscuro / sistema.
 *
 * Persiste vía localStorage (manejado por next-themes). Render diferido hasta
 * que el cliente monta para evitar hydration mismatch (server no conoce el
 * tema preferido del usuario).
 */
import * as React from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@his/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@his/ui/components/dropdown-menu";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Placeholder durante SSR: ancho fijo igual al final, sin icono específico.
  if (!mounted) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-8 w-8 p-0"
        aria-label="Cambiar tema"
        disabled
      >
        <Sun className="h-4 w-4 opacity-50" aria-hidden />
      </Button>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={`Cambiar tema (actual: ${theme ?? "sistema"})`}
        >
          {isDark ? (
            <Moon className="h-4 w-4" aria-hidden />
          ) : (
            <Sun className="h-4 w-4" aria-hidden />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => setTheme("light")} className="gap-2">
          <Sun className="h-4 w-4" aria-hidden />
          <span>Claro</span>
          {theme === "light" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("dark")} className="gap-2">
          <Moon className="h-4 w-4" aria-hidden />
          <span>Oscuro</span>
          {theme === "dark" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTheme("system")} className="gap-2">
          <Monitor className="h-4 w-4" aria-hidden />
          <span>Sistema</span>
          {theme === "system" && <span className="ml-auto text-xs">✓</span>}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
