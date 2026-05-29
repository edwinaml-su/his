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
import { SidebarProvider, SidebarTrigger } from "@his/ui/components/sidebar";
import { Breadcrumbs } from "./breadcrumbs";
import { ChatWidget } from "./chat-widget";
import { isItemVisible } from "./nav-visibility";
import { SECTIONS } from "./nav-sections";
import type { NavSection } from "./nav-sections";
import { AppSidebar } from "./app-sidebar";

// ─── Helpers usados SOLO en el Sheet mobile (Tarea 2c los migrará) ──────────

/** Input de búsqueda del menú mobile. */
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

/** Estado vacío global del menú mobile cuando ninguna sección tiene matches. */
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

/** Grupo de sección para el Sheet mobile (expandido siempre). */
function MobileSectionGroup({
  section,
  pathname,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
  searchQuery = "",
}: {
  section: NavSection;
  pathname: string | null;
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
  searchQuery?: string;
}) {
  const visibleItems = section.items.filter((item) =>
    isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
  );

  const q = searchQuery.trim().toLowerCase();
  const filteredItems = q
    ? visibleItems.filter(
        (i) =>
          i.label.toLowerCase().includes(q) ||
          i.description.toLowerCase().includes(q),
      )
    : visibleItems;

  const sectionHasActive = visibleItems.some((i) => pathname?.startsWith(i.href));
  const [open, setOpen] = React.useState(sectionHasActive);

  React.useEffect(() => {
    if (sectionHasActive) setOpen(true);
  }, [sectionHasActive]);

  const effectiveOpen = q ? filteredItems.length > 0 : open;

  if (filteredItems.length === 0) return null;

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

// ─── AppShell ─────────────────────────────────────────────────────────────────

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
  /** Búsqueda en el Sheet mobile — solo existe aquí hasta Tarea 2c. */
  const [mobileSearchQuery, setMobileSearchQuery] = React.useState("");

  // Cierra el drawer mobile + limpia búsqueda al navegar.
  React.useEffect(() => {
    setMobileNavOpen(false);
    setMobileSearchQuery("");
  }, [pathname]);

  /** Cuerpo del Sheet mobile — se mantendrá hasta Tarea 2c. */
  const renderMobileNav = () => (
    <>
      <div className="border-b border-sidebar-border p-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className="h-10 w-auto brightness-0 invert"
        />
        <p className="mt-2 text-xs uppercase tracking-wide opacity-70">
          Sistema de Información Hospitalaria · El Salvador
        </p>
      </div>
      <nav className="flex-1 overflow-y-auto p-2" aria-label="Principal">
        <SidebarSearch
          value={mobileSearchQuery}
          onChange={setMobileSearchQuery}
        />
        {SECTIONS.map((section) => (
          <MobileSectionGroup
            key={section.label}
            section={section}
            pathname={pathname}
            roleCodes={roleCodes}
            assignedServiceUnitCodes={assignedServiceUnitCodes}
            isCrossServiceRole={isCrossServiceRole}
            searchQuery={mobileSearchQuery}
          />
        ))}
        {mobileSearchQuery.trim() && (
          <SidebarNoResults
            query={mobileSearchQuery}
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
    // SidebarProvider gestiona el estado open/collapsed del sidebar desktop.
    // La cookie `sidebar:state` persiste entre sesiones (7 días).
    <SidebarProvider>
      {/* Sidebar desktop — Shadcn sidebar con collapsible="icon" */}
      <AppSidebar
        roleCodes={roleCodes}
        assignedServiceUnitCodes={assignedServiceUnitCodes}
        isCrossServiceRole={isCrossServiceRole}
      />

      {/* Área derecha: header + contenido */}
      <div className="flex min-w-0 flex-1 flex-col min-h-svh">
        {/* TooltipProvider para los tooltips del Sheet mobile */}
        <TooltipProvider delayDuration={200} skipDelayDuration={100}>
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
          >
            Saltar al contenido principal
          </a>

          <header className="flex h-14 items-center gap-2 border-b bg-background px-2 shadow-sm sm:px-4">
            {/* Hamburguesa mobile (< md) abre Sheet — intacto hasta Tarea 2c */}
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
                {renderMobileNav()}
              </SheetContent>
            </Sheet>

            {/* Toggle desktop collapse — SidebarTrigger de Shadcn (≥ md) */}
            <SidebarTrigger
              className="hidden md:inline-flex"
              aria-label="Mostrar/ocultar menú lateral"
            />

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
        </TooltipProvider>
      </div>

      {/* Asistente HIS — copiloto flotante context-aware. */}
      <ChatWidget roleCodes={roleCodes} chatAuth={chatAuth} />
    </SidebarProvider>
  );
}
