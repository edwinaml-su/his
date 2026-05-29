"use client";

/**
 * AppSidebar — sidebar desktop del HIS Multipaís.
 *
 * Usa los primitivos Shadcn de packages/ui/src/components/sidebar.tsx para
 * renderizar los grupos de navegación de SECTIONS con:
 *   - Colapsado por sección (Collapsible de Radix).
 *   - Colapsado global icon-mode (collapsible="icon" en Sidebar).
 *   - Estado persistido en cookie `sidebar:state` vía SidebarProvider.
 *   - Tooltips automáticos en modo icon (label + descripción).
 *   - Item activo resaltado vía usePathname().
 *   - Filtrado por rol y servicio (isItemVisible de nav-visibility.ts).
 *
 * Tarea 2b — Rediseño v2.0. Mobile sheet: intacto en app-shell.tsx (Tarea 2c).
 */

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { ChevronRight, X as XIcon, Search as SearchIcon } from "lucide-react";
import { cn } from "@his/ui/lib/utils";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
  useSidebar,
} from "@his/ui/components/sidebar";
import { SECTIONS } from "./nav-sections";
import { isItemVisible } from "./nav-visibility";

// ─── Buscador ────────────────────────────────────────────────────────────────

function NavSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { state } = useSidebar();
  // Solo visible en modo expandido. En modo icon no hay espacio.
  if (state === "collapsed") return null;

  return (
    <div className="relative px-2 pb-1">
      <SearchIcon
        className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-sidebar-foreground/50"
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
          "w-full rounded-md border border-sidebar-border bg-sidebar",
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
          className="absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground"
        >
          <XIcon className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

// ─── SectionGroup ────────────────────────────────────────────────────────────

function SectionGroup({
  label,
  items,
  pathname,
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
  searchQuery,
}: {
  label: string;
  items: (typeof SECTIONS)[number]["items"];
  pathname: string | null;
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
  searchQuery: string;
}) {
  const { state } = useSidebar();
  const isIconMode = state === "collapsed";

  const visibleItems = items.filter((item) =>
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

  const sectionHasActive = visibleItems.some((i) =>
    pathname?.startsWith(i.href),
  );
  const [open, setOpen] = React.useState(sectionHasActive);

  React.useEffect(() => {
    if (sectionHasActive) setOpen(true);
  }, [sectionHasActive]);

  // Cuando hay búsqueda activa con resultados, forzamos la sección abierta.
  const effectiveOpen = q ? filteredItems.length > 0 : open;

  if (filteredItems.length === 0) return null;

  if (isIconMode) {
    // Modo icon: renderiza items directamente sin encabezado de sección.
    // SidebarMenuButton con tooltip maneja la descripción visible.
    return (
      <SidebarGroup className="py-0">
        <SidebarMenu>
          {filteredItems.map((item) => {
            const Icon = item.icon;
            const active = !!pathname?.startsWith(item.href);
            return (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={{
                    children: (
                      <>
                        <div className="text-xs font-semibold uppercase text-muted-foreground">
                          {label}
                        </div>
                        <div className="font-semibold">{item.label}</div>
                        <div className="mt-0.5 text-xs leading-snug">
                          {item.description}
                        </div>
                      </>
                    ),
                    className: "max-w-xs",
                  }}
                  className="min-h-[44px] justify-center"
                >
                  <Link
                    href={item.href}
                    aria-label={`${item.label} — ${item.description}`}
                  >
                    <Icon className="h-5 w-5" aria-hidden="true" />
                    <span className="sr-only">{item.label}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroup>
    );
  }

  // Modo expandido: sección colapsable con etiqueta.
  return (
    <CollapsiblePrimitive.Root
      open={effectiveOpen}
      onOpenChange={q ? undefined : setOpen}
    >
      <SidebarGroup className="py-0">
        <CollapsiblePrimitive.Trigger asChild disabled={!!q}>
          <SidebarGroupLabel
            className={cn(
              "cursor-pointer select-none hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              "flex items-center justify-between",
              q && "cursor-default",
            )}
          >
            <span>{label}</span>
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 shrink-0 transition-transform duration-200",
                effectiveOpen && "rotate-90",
              )}
              aria-hidden="true"
            />
          </SidebarGroupLabel>
        </CollapsiblePrimitive.Trigger>
        <CollapsiblePrimitive.Content>
          <SidebarMenu>
            {filteredItems.map((item) => {
              const Icon = item.icon;
              const active = !!pathname?.startsWith(item.href);
              return (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    className="min-h-[44px]"
                  >
                    <Link
                      href={item.href}
                      aria-label={`${item.label} — ${item.description}`}
                      title={item.description}
                    >
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </CollapsiblePrimitive.Content>
      </SidebarGroup>
    </CollapsiblePrimitive.Root>
  );
}

// ─── AppSidebar ───────────────────────────────────────────────────────────────

export function AppSidebar({
  roleCodes = [],
  assignedServiceUnitCodes = [],
  isCrossServiceRole = false,
}: {
  roleCodes?: string[];
  assignedServiceUnitCodes?: string[];
  isCrossServiceRole?: boolean;
}) {
  const pathname = usePathname();
  const { state } = useSidebar();
  const [searchQuery, setSearchQuery] = React.useState("");

  // Limpia la búsqueda al navegar.
  React.useEffect(() => {
    setSearchQuery("");
  }, [pathname]);

  const hasAnyMatch =
    searchQuery.trim().length > 0 &&
    SECTIONS.some((s) =>
      s.items.some(
        (i) =>
          isItemVisible(
            i,
            roleCodes,
            assignedServiceUnitCodes,
            isCrossServiceRole,
          ) &&
          (i.label
            .toLowerCase()
            .includes(searchQuery.trim().toLowerCase()) ||
            i.description
              .toLowerCase()
              .includes(searchQuery.trim().toLowerCase())),
      ),
    );

  const showNoResults =
    searchQuery.trim().length > 0 && !hasAnyMatch && state === "expanded";

  return (
    <Sidebar collapsible="icon">
      {/* Logo / branding */}
      <SidebarHeader
        className={cn(
          "border-b border-sidebar-border",
          state === "collapsed" ? "items-center" : "",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/avante-logo.svg"
          alt="AVANTE Complejo Hospitalario"
          className={cn(
            "w-auto brightness-0 invert",
            state === "collapsed" ? "h-7" : "h-10",
          )}
        />
        {state === "expanded" && (
          <p className="text-xs uppercase tracking-wide opacity-70 text-sidebar-foreground leading-tight">
            Sistema de Información Hospitalaria · El Salvador
          </p>
        )}
      </SidebarHeader>

      {/* Buscador */}
      <NavSearch value={searchQuery} onChange={setSearchQuery} />

      {/* Grupos de navegación */}
      <SidebarContent>
        {SECTIONS.map((section, idx) => (
          <React.Fragment key={section.label}>
            {idx > 0 && state === "collapsed" && (
              <SidebarSeparator className="my-0.5" />
            )}
            <SectionGroup
              label={section.label}
              items={section.items}
              pathname={pathname}
              roleCodes={roleCodes}
              assignedServiceUnitCodes={assignedServiceUnitCodes}
              isCrossServiceRole={isCrossServiceRole}
              searchQuery={state === "collapsed" ? "" : searchQuery}
            />
          </React.Fragment>
        ))}

        {/* Estado vacío búsqueda */}
        {showNoResults && (
          <div
            role="status"
            aria-live="polite"
            className="mx-2 mt-2 rounded-md border border-dashed border-sidebar-border/60 px-3 py-3 text-center text-xs text-sidebar-foreground/70"
          >
            Sin resultados para{" "}
            <span className="font-semibold">&ldquo;{searchQuery}&rdquo;</span>
          </div>
        )}
      </SidebarContent>

      <SidebarFooter />

      {/* Rail clickable para colapsar/expandir arrastrando el borde */}
      <SidebarRail />
    </Sidebar>
  );
}
