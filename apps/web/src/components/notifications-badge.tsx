"use client";

/**
 * NotificationsBadge — Beta.15 (US.B15.3.2).
 *
 * Badge global del navbar que muestra el contador de notificaciones sin leer
 * del usuario autenticado. Consume `trpc.notifications.unreadCount` (PR #57)
 * con polling cada 30s. No usa WebSocket/SSE — fuera de scope MVP.
 *
 * - Si `count === 0`: solo se muestra el icono Bell (sin pill numérico).
 * - Si `count > 99`: muestra "99+" para no romper el layout.
 * - Wrapper en <Link href="/notifications"> → click navega al inbox.
 * - `aria-label` dinámico para lectores de pantalla.
 *
 * Visualmente: bell icon de `lucide-react` con un pill rojo absoluto encima
 * (top-right) usando el variant `destructive` del Badge del design system.
 */
import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc/react";

/** Cap visual del contador: > 99 → "99+". */
export function formatBadgeCount(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

/** Construye el aria-label localizado (es-SV). Singular vs plural. */
export function buildAriaLabel(count: number): string {
  if (count === 0) return "Sin notificaciones sin leer";
  if (count === 1) return "1 notificación sin leer";
  return `${count} notificaciones sin leer`;
}

export function NotificationsBadge() {
  // Polling cada 30s. `staleTime` igual al interval para que un re-mount
  // (p.ej. navegación entre rutas) no dispare un fetch innecesario.
  const { data } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 30_000,
  });

  const count = data?.count ?? 0;
  const label = buildAriaLabel(count);

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {count > 0 ? (
        <span
          data-testid="notifications-badge-count"
          className="absolute -right-1 -top-1 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
        >
          {formatBadgeCount(count)}
        </span>
      ) : null}
    </Link>
  );
}
