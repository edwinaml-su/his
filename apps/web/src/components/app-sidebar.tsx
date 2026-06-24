"use client";

/**
 * AppSidebar — navegación lateral desktop construida con primitivos Shadcn Sidebar.
 * Consume SECTIONS de nav-sections.ts sin modificarlos.
 *
 * Comportamiento:
 *  - Sidebar EXPANDIDO: cada sección es un acordeón (Radix Collapsible). La sección
 *    que contiene la ruta activa se abre por defecto; las demás quedan contraídas.
 *    El usuario contrae/expande cualquiera con clic en el encabezado (chevron rota).
 *    Al navegar a otra sección, esa sección se abre automáticamente.
 *  - Sidebar COLAPSADO a iconos: render plano, todos los iconos visibles + tooltip.
 *
 * Mobile Sheet sigue en app-shell.tsx.
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarCollapsible,
  SidebarCollapsibleTrigger,
  SidebarCollapsibleContent,
  useSidebar,
} from "@his/ui/components/sidebar";
import { isItemVisible } from "./nav-visibility";
import { SECTIONS, TOP_PINNED } from "./nav-sections";
import { CommandPaletteButton } from "./command-palette";

interface AppSidebarProps {
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
}

export function AppSidebar({
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
}: AppSidebarProps) {
  const pathname = usePathname();
  const { open: sidebarExpanded } = useSidebar();
  const PinnedIcon = TOP_PINNED.icon;

  const isItemActive = React.useCallback(
    (href: string) => pathname === href || pathname.startsWith(href + "/"),
    [pathname],
  );

  // Secciones visibles según rol/unidad (no mutamos SECTIONS).
  const sections = React.useMemo(
    () =>
      SECTIONS.map((section) => ({
        label: section.label,
        items: section.items.filter((item) =>
          isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
        ),
      })).filter((section) => section.items.length > 0),
    [roleCodes, assignedServiceUnitCodes, isCrossServiceRole],
  );

  // Sección que contiene la ruta activa (fallback: primera sección visible).
  const activeSectionLabel = React.useMemo(
    () =>
      sections.find((section) => section.items.some((i) => isItemActive(i.href)))
        ?.label ?? null,
    [sections, isItemActive],
  );
  const defaultOpenLabel = activeSectionLabel ?? sections[0]?.label ?? null;

  // Estado del acordeón. undefined para una sección = "sin tocar" → se usa el
  // default (abierta sólo si es la sección activa).
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({});

  // Al navegar, garantiza que la sección destino quede abierta aunque el usuario
  // la hubiera contraído antes.
  React.useEffect(() => {
    if (!defaultOpenLabel) return;
    setOpenSections((prev) =>
      prev[defaultOpenLabel] ? prev : { ...prev, [defaultOpenLabel]: true },
    );
  }, [defaultOpenLabel]);

  const isSectionOpen = (label: string) =>
    openSections[label] ?? label === defaultOpenLabel;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className="h-8 w-auto brightness-0 invert"
        />
        {/* Buscador Ctrl+K — solo visible cuando el sidebar está expandido.
            En modo iconos (collapsed) no hay espacio para el texto "Buscar…"; el
            usuario sigue teniendo el botón en el top bar + el atajo Ctrl+K global. */}
        {sidebarExpanded && (
          <CommandPaletteButton
            className="flex w-full items-center gap-1.5 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2.5 py-1.5 text-sm text-sidebar-foreground/80 shadow-sm hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
          />
        )}
      </SidebarHeader>

      <SidebarContent>
        {/* Ítem fijado arriba de todo (Orientación táctil) — fuera del acordeón,
            siempre visible. En tablets/kioskos el landing ya arranca en kiosko. */}
        {isItemVisible(TOP_PINNED, roleCodes, assignedServiceUnitCodes, isCrossServiceRole) && (
          <>
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={isItemActive(TOP_PINNED.href)}
                      tooltip={TOP_PINNED.label}
                    >
                      <Link
                        href={TOP_PINNED.href}
                        aria-label={`${TOP_PINNED.label} — ${TOP_PINNED.description}`}
                      >
                        <PinnedIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate group-data-[state=collapsed]:hidden">
                          {TOP_PINNED.label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarSeparator />
          </>
        )}
        {sections.map((section, idx) => {
          const menu = (
            <SidebarMenu>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      asChild
                      isActive={isItemActive(item.href)}
                      tooltip={item.label}
                    >
                      <Link
                        href={item.href}
                        aria-label={`${item.label} — ${item.description}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="truncate group-data-[state=collapsed]:hidden">
                          {item.label}
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          );

          return (
            <React.Fragment key={section.label}>
              {idx > 0 && <SidebarSeparator />}
              {sidebarExpanded ? (
                <SidebarCollapsible
                  open={isSectionOpen(section.label)}
                  onOpenChange={(v) =>
                    setOpenSections((p) => ({ ...p, [section.label]: v }))
                  }
                  className="group/collapsible"
                >
                  <SidebarGroup>
                    <SidebarCollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 transition-colors hover:bg-sidebar-accent/40 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                      <span className="truncate">{section.label}</span>
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90 motion-reduce:transition-none"
                        aria-hidden="true"
                      />
                    </SidebarCollapsibleTrigger>
                    <SidebarCollapsibleContent>
                      <SidebarGroupContent className="pt-1">{menu}</SidebarGroupContent>
                    </SidebarCollapsibleContent>
                  </SidebarGroup>
                </SidebarCollapsible>
              ) : (
                <SidebarGroup>
                  <SidebarGroupLabel>{section.label}</SidebarGroupLabel>
                  <SidebarGroupContent>{menu}</SidebarGroupContent>
                </SidebarGroup>
              )}
            </React.Fragment>
          );
        })}
      </SidebarContent>

      {/* Footer vacío — user menu permanece en top bar */}
      <SidebarFooter />
    </Sidebar>
  );
}
