"use client";

/**
 * NotificationsBadge — Beta.15 (US.B15.3.2) + CC-0031 Fase 2.
 *
 * Badge global del navbar. Antes de CC-0031 mostraba SOLO
 * `trpc.notifications.unreadCount` (siempre 0 en prod — el puente
 * tarea→notificación no existía, ver docs/audit/2026-09-15_cobertura/00-*.md
 * §0). Ahora combina:
 *   - `notifications.unreadCount` — notificaciones entregadas (INBOX).
 *   - `workflowInbox.contadorBadge` — tareas pendientes del rol del usuario
 *     en la Bandeja BPM (`/tareas`), que hasta CC-0031 no tenía ningún
 *     consumidor en la UI (00 §4, hallazgo P1).
 *
 * El pill muestra la SUMA; el desglose "X notificaciones · Y tareas de tu
 * rol" aparece en un menú desplegable con links a `/notifications` y
 * `/tareas`. Mantiene el polling de 30s (mismo intervalo para ambas queries,
 * sin WebSocket/SSE — fuera de scope, ver 00 §6).
 */
import * as React from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { trpc } from "@/lib/trpc/react";
import { Button } from "@his/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@his/ui/components/dropdown-menu";

const POLL_INTERVAL_MS = 30_000;

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

/** Texto de desglose del menú: "X notificaciones · Y tareas de tu rol". */
export function buildBreakdownLabel(notificationsCount: number, tasksCount: number): string {
  const notifLabel = notificationsCount === 1 ? "1 notificación" : `${notificationsCount} notificaciones`;
  const taskLabel = tasksCount === 1 ? "1 tarea de tu rol" : `${tasksCount} tareas de tu rol`;
  return `${notifLabel} · ${taskLabel}`;
}

export function NotificationsBadge() {
  const { data: notifData } = trpc.notifications.unreadCount.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
  });
  const { data: taskData } = trpc.workflowInbox.contadorBadge.useQuery(undefined, {
    refetchInterval: POLL_INTERVAL_MS,
    staleTime: POLL_INTERVAL_MS,
  });

  const notificationsCount = notifData?.count ?? 0;
  const tasksCount = taskData?.total ?? 0;
  const total = notificationsCount + tasksCount;
  const label = buildAriaLabel(total);
  const breakdown = buildBreakdownLabel(notificationsCount, tasksCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={label}
          title={breakdown}
          className="relative inline-flex h-8 w-8 items-center justify-center p-0 text-foreground"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {total > 0 ? (
            <span
              data-testid="notifications-badge-count"
              className="absolute -right-1 -top-1 inline-flex min-w-[1.125rem] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground"
            >
              {formatBadgeCount(total)}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
          {breakdown}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications">
            Notificaciones{notificationsCount > 0 ? ` (${formatBadgeCount(notificationsCount)})` : ""}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/tareas">
            Mis tareas{tasksCount > 0 ? ` (${formatBadgeCount(tasksCount)})` : ""}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
