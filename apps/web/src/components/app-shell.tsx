"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  Menu,
  Search as SearchIcon,
  X as XIcon,
} from "lucide-react";
import { cn } from "@his/ui/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@his/ui/components/sheet";
import { Button } from "@his/ui/components/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@his/ui/components/tooltip";
import {
  SidebarProvider,
  SidebarInset,
  SidebarTrigger,
} from "@his/ui/components/sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ChatWidget } from "./chat-widget";
import { AppSidebar } from "./app-sidebar";
import { isItemVisible } from "./nav-visibility";
import { SECTIONS, type NavItem, type NavSection } from "./nav-sections";
import { CommandPalette, CommandPaletteButton } from "./command-palette";

/** Input de búsqueda del menú. Filtra items por label/description. ESC limpia. */
function SidebarSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative mb-2">
      <SearchIcon
        className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50"
        aria-hidden="true"
      />
      <input
        type="search"
        role="searchbox"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onChange("");
        }}
        placeholder="Buscar en el menú…"
        aria-label="Buscar en el menú"
        className={cn(
          "w-full rounded-md border border-sidebar-border bg-sidebar-background",
          "py-1.5 pl-8 pr-7 text-sm text-sidebar-foreground",
          "placeholder:text-sidebar-foreground/50",
          "focus:outline-none focus:ring-2 focus:ring-sidebar-ring focus:border-transparent",
        )}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Limpiar búsqueda"
          className="absolute right-1.5 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Estado vacío global del menú cuando ninguna sección tiene matches. */
function SidebarNoResults({
  query,
  sections,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
}: {
  query: string;
  sections: NavSection[];
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  // Verifica si CUALQUIER sección tiene al menos un match (label o description)
  // considerando los filtros de rol + servicio. Si hay matches, no mostramos
  // este bloque (cada SectionGroup mostrará lo suyo).
  const hasAnyMatch = sections.some((s) =>
    s.items.some(
      (i) =>
        isItemVisible(i, roleCodes, assignedServiceUnitCodes, isCrossServiceRole) &&
        (i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q)),
    ),
  );
  if (hasAnyMatch) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="mt-2 rounded-md border border-dashed border-sidebar-border/60 px-3 py-3 text-center text-xs text-sidebar-foreground/70"
    >
      Sin resultados para <span className="font-semibold">&ldquo;{query}&rdquo;</span>
    </div>
  );
}

function SectionGroup({
  section,
  pathname,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
  collapsed = false,
  searchQuery = "",
}: {
  section: NavSection;
  pathname: string | null;
  roleCodes: string[];
  /** Nivel A — codes de los servicios a los que el usuario está asignado. */
  assignedServiceUnitCodes: string[];
  /** Bypass del filtro de servicio para ADMIN/DIR/COO/etc. */
  isCrossServiceRole: boolean;
  /** Si true, renderiza solo iconos (modo rail desktop). */
  collapsed?: boolean;
  /** Filtra items por label / description (case-insensitive). */
  searchQuery?: string;
}) {
  const visibleItems = section.items.filter((item) =>
    isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
  );

  // Filtrado por búsqueda — case-insensitive sobre label y description.
  const q = searchQuery.trim().toLowerCase();
  const filteredItems = q
    ? visibleItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q),
      )
    : visibleItems;

  // ENFOQUE VISUAL: solo la sección que contiene el item activo arranca abierta.
  // Las demás están colapsadas para reducir ruido. El usuario puede expandirlas
  // manualmente y la elección persiste hasta que cambie de ruta.
  const sectionHasActive = visibleItems.some((i) => pathname?.startsWith(i.href));
  const [open, setOpen] = React.useState(sectionHasActive);

  // Si el usuario navega a otra sección, re-evaluamos: la nueva sección con
  // item activo se auto-expande; las demás vuelven a su estado por defecto
  // (cerradas) — pero si el usuario las había abierto manualmente, conservamos
  // esa elección sólo durante esa sesión de ruta. Compromiso pragmático:
  // forzamos a la sección activa a abrirse al cambiar de ruta.
  React.useEffect(() => {
    if (sectionHasActive) setOpen(true);
  }, [sectionHasActive]);

  // Cuando hay búsqueda activa con resultados, forzamos la sección abierta
  // para que el usuario vea los matches sin tener que expandir manualmente.
  const effectiveOpen = q ? filteredItems.length > 0 : open;

  // Sin items tras filtros (rol + búsqueda) → no renderizar la sección.
  if (filteredItems.length === 0) return null;

  // Modo rail (collapsed): renderiza solo los iconos directamente, sin
  // botón de sección. Tooltip Radix con label + descripción a la derecha.
  if (collapsed) {
    return (
      <ul className="mb-2 space-y-0.5 border-b border-sidebar-border/40 pb-2 last:border-0">
        {filteredItems.map((item) => {
          const Icon = item.icon;
          const active = pathname?.startsWith(item.href);
          return (
            <li key={item.href}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    href={item.href}
                    aria-label={`${item.label} — ${item.description}`}
                    className={cn(
                      "flex h-10 items-center justify-center rounded-md transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                        : "text-sidebar-foreground/80 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                    )}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="right" align="center" className="max-w-xs">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {section.label}
                  </div>
                  <div className="font-semibold">{item.label}</div>
                  <div className="mt-0.5 text-xs leading-snug text-popover-foreground/80">
                    {item.description}
                  </div>
                </TooltipContent>
              </Tooltip>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={effectiveOpen}
        disabled={!!q}
        className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:opacity-100 disabled:cursor-default"
      >
        <span>{section.label}</span>
        {effectiveOpen ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
      </button>
      {effectiveOpen && (
        <ul className="mt-0.5 space-y-0.5">
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const active = pathname?.startsWith(item.href);
            return (
              <li key={item.href}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href={item.href}
                      aria-label={`${item.label} — ${item.description}`}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                          : "text-sidebar-foreground/90 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" align="center" className="max-w-xs">
                    <div className="font-semibold">{item.label}</div>
                    <div className="mt-0.5 text-xs leading-snug text-popover-foreground/80">
                      {item.description}
                    </div>
                  </TooltipContent>
                </Tooltip>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

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
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);
  /** Búsqueda en el menú lateral — filtra items por label / description. */
  const [searchQuery, setSearchQuery] = React.useState("");

  // Estado collapse desktop (persiste en localStorage para sobrevivir refresh).
  // Hidratación diferida para evitar mismatch SSR.
  const [desktopCollapsed, setDesktopCollapsed] = React.useState(false);
  React.useEffect(() => {
    const stored = window.localStorage.getItem("his.sidebar.collapsed");
    if (stored === "true") setDesktopCollapsed(true);
  }, []);
  // El colapso desktop ahora lo gestiona SidebarProvider (onOpenChange abajo).

  // Cierra el drawer mobile + limpia la búsqueda al navegar (los items son
  // <Link>; el cambio de pathname implica que el usuario tocó uno).
  React.useEffect(() => {
    setMobileNavOpen(false);
    setSearchQuery("");
  }, [pathname]);

  // Nav body reutilizado entre sidebar desktop y sheet mobile.
  // `collapsed` solo aplica en desktop; mobile siempre renderiza expandido.
  const renderNavBody = (collapsed: boolean) => (
    <>
      <div className={cn(
        "border-b border-sidebar-border",
        collapsed ? "flex items-center justify-center p-2" : "p-4",
      )}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className={cn(
            "w-auto brightness-0 invert",
            collapsed ? "h-7" : "h-10",
          )}
        />
        {!collapsed && (
          <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
            Sistema de Información Hospitalaria · El Salvador
          </p>
        )}
      </div>
      <nav
        className={cn("flex-1 overflow-y-auto", collapsed ? "p-1.5" : "p-2")}
        aria-label="Principal"
      >
        {/* Buscador del menú — solo en modo expandido. Filtra items por
            label / description. Forza apertura de las secciones con matches. */}
        {!collapsed && (
          <SidebarSearch
            value={searchQuery}
            onChange={setSearchQuery}
          />
        )}
        {SECTIONS.map((section) => (
          <SectionGroup
            key={section.label}
            section={section}
            pathname={pathname}
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
            collapsed={collapsed}
            searchQuery={collapsed ? "" : searchQuery}
          />
        ))}
        {/* Estado vacío global cuando hay query sin matches en ninguna sección. */}
        {!collapsed && searchQuery.trim() && (
          <SidebarNoResults
            query={searchQuery}
            sections={SECTIONS}
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
          />
        )}
      </nav>
    </>
  );

  return (
    // delayDuration corto: 200ms para tooltips aparezcan rápido al pasar el
    // cursor por items del sidebar. skipDelayDuration default permite que al
    // mover entre items vecinos el tooltip cambie sin re-esperar el delay.
    <TooltipProvider delayDuration={200} skipDelayDuration={100}>
      <SidebarProvider defaultOpen={!desktopCollapsed} onOpenChange={(open) => {
        setDesktopCollapsed(!open);
        window.localStorage.setItem("his.sidebar.collapsed", String(!open));
      }}>
        {/* CommandPalette actúa como Context Provider. Sus children son todo
            el contenido del shell — esto permite que CommandPaletteButton
            (en el topbar) consuma el Context sin prop drilling. El dialog
            modal se renderiza dentro de CommandPalette. */}
        <CommandPalette
          roleCodes={roleCodes}
          assignedServiceUnitCodes={assignedServiceUnitCodes}
          isCrossServiceRole={isCrossServiceRole}
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Saltar al contenido principal
          </a>

          {/* Sidebar desktop (≥ md) — Shadcn sidebar collapsible="icon" */}
          <AppSidebar
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
          />

          <SidebarInset>
            <header className="flex h-14 items-center gap-2 border-b bg-background px-2 shadow-sm sm:px-4">
              {/* Hamburguesa mobile (< md) abre Sheet */}
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-9 w-9 p-0 md:hidden"
                    aria-label="Abrir menú de navegación"
                  >
                    <Menu className="h-5 w-5" aria-hidden />
                  </Button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="flex w-72 max-w-[85vw] flex-col border-r-sidebar-border bg-sidebar-background p-0 text-sidebar-foreground"
                >
                  {renderNavBody(false)}
                </SheetContent>
              </Sheet>

              {/* Toggle desktop collapse (≥ md) — delegado al SidebarProvider */}
              <SidebarTrigger className="hidden md:inline-flex" />

              {/* Paleta de comandos — botón visual + atajo Ctrl+K en el topbar */}
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
          </SidebarInset>
        </CommandPalette>
      </SidebarProvider>
      {/* Asistente HIS — copiloto flotante context-aware. */}
      <ChatWidget roleCodes={roleCodes} chatAuth={chatAuth} />
    </TooltipProvider>
  );
}
