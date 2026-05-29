"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  TooltipProvider,
} from "@his/ui/components/tooltip";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
  useIsMobile,
} from "@his/ui/components/sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ChatWidget } from "./chat-widget";
import { AppSidebar } from "./app-sidebar";
import { CommandPalette, CommandPaletteButton } from "./command-palette";

export function AppShell({
  children,
  topbar,
  roleCodes = [],
  assignedServiceUnitCodes = [],
  isCrossServiceRole = false,
  chatAuth,
}: {
  children: React.ReactNode;
  topbar?: React.ReactNode;
  /** Roles del usuario activo — usados para filtrar items con requiredRoles. */
  roleCodes?: string[];
  /**
   * Nivel A — `code`s de los `ServiceUnit` a los que el usuario está asignado.
   * Default `[]` = sin restricción (backward compat). Items con
   * `requiredServiceUnits` se ocultan si NO hay intersección y el usuario
   * tampoco es cross-service.
   */
  assignedServiceUnitCodes?: string[];
  /**
   * `true` si el usuario tiene rol cross-servicio (ADMIN, DIR, COO, CFO,
   * CEO, MEDICAL_DIRECTOR, AUDITOR). Bypassea el filtro de servicio.
   */
  isCrossServiceRole?: boolean;
  /** Identidad del usuario para tools tenant-scoped del chatbot. */
  chatAuth?: { userId: string; organizationId?: string };
}) {
  const pathname = usePathname();
  const isMobile = useIsMobile();

  // Estado collapse desktop (persiste en localStorage para sobrevivir refresh).
  // Hidratación diferida para evitar mismatch SSR.
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  React.useEffect(() => {
    const stored = window.localStorage.getItem("his.sidebar.collapsed");
    if (stored === "true") setDesktopCollapsed(true);
  }, []);

  return (
    // delayDuration corto: 200ms para tooltips aparezcan rápido al pasar el
    // cursor por items del sidebar. skipDelayDuration default permite que al
    // mover entre items vecinos el tooltip cambie sin re-esperar el delay.
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <SidebarProvider defaultOpen={!desktopCollapsed} onOpenChange={(open) => {
        // Solo persistir el estado en desktop — el Sheet mobile no debe
        // sobreescribir la preferencia de colapso del panel desktop.
        if (!isMobile) {
          setDesktopCollapsed(!open);
          window.localStorage.setItem("his.sidebar.collapsed", String(!open));
        }
      }}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Saltar al contenido principal
        </a>

        {/* AppSidebar gestiona desktop (panel) y mobile (Sheet) automáticamente
            via useIsMobile en el primitivo Sidebar de @his/ui. */}
        <AppSidebar
          roleCodes={roleCodes}
          assignedServiceUnitCodes={assignedServiceUnitCodes}
          isCrossServiceRole={isCrossServiceRole}
        />

        <SidebarInset>
          {/* CommandPalette provee Context (Ctrl+K) + el botón opcional del top bar.
              El dialog se renderiza una sola vez y CommandPaletteButton consume el Context. */}
          <CommandPalette
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
          >
            <header className="flex h-14 items-center gap-2 border-b bg-background px-2 shadow-sm sm:px-4">
              {/* SidebarTrigger cubre desktop (colapsa panel) y mobile (abre Sheet).
                  Shadcn Sidebar detecta breakpoint internamente via useIsMobile. */}
              <SidebarTrigger aria-label="Mostrar u ocultar menú" />

              {/* Botón paleta de comandos — abre dialog Ctrl+K. */}
              <CommandPaletteButton />

              <div className="min-w-0 flex-1 text-sm text-muted-foreground">{topbar}</div>
            </header>

            {/* Breadcrumbs (barra de navegabilidad) */}
            <Breadcrumbs pathname={pathname} />

            <main
              id="main-content"
              tabIndex={-1}
              className="flex-1 bg-muted/30 p-3 sm:p-4 lg:p-6"
            >
              {children}
            </main>
          </CommandPalette>
        </SidebarInset>
      </SidebarProvider>
      {/* Asistente HIS — copiloto flotante context-aware. */}
      <ChatWidget roleCodes={roleCodes} chatAuth={chatAuth} />
    </TooltipProvider>
  );
}
