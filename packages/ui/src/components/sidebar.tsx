"use client";

/**
 * Primitivos Shadcn Sidebar — adaptados para @his/ui (Tarea 2b).
 * Referencia: https://ui.shadcn.com/docs/components/sidebar
 *
 * Diferencias respecto a la referencia oficial:
 * - `cn` importado desde ../lib/utils (no @/lib/utils).
 * - Tokens OKLCH: bg-sidebar (--sidebar), text-sidebar-foreground, etc.
 * - Sin persistencia de cookies propia — el estado defaultOpen se recibe
 *   como prop; la persistencia la gestiona el consumer (app-shell.tsx).
 */

import * as React from "react";
import * as CollapsiblePrimitive from "@radix-ui/react-collapsible";
import { PanelLeft } from "lucide-react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Sheet, SheetContent } from "./sheet";

// ── Mobile breakpoint hook ────────────────────────────────────────────────────

const MOBILE_BREAKPOINT = 768; // px — equivale a Tailwind `md`

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = React.useState(false);
  React.useEffect(() => {
    // Guard: jsdom y entornos SSR no implementan matchMedia.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    setIsMobile(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isMobile;
}

// ── Context ──────────────────────────────────────────────────────────────────

const SIDEBAR_COOKIE_NAME = "sidebar:state";
const SIDEBAR_WIDTH = "16rem";
const SIDEBAR_WIDTH_ICON = "3.5rem";

type SidebarContextValue = {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) throw new Error("useSidebar debe usarse dentro de <SidebarProvider>");
  return ctx;
}

// ── Provider ─────────────────────────────────────────────────────────────────

export function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange,
  className,
  style,
  children,
}: {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  // Mobile siempre arranca cerrado (es Sheet, no panel persistido).
  const [openState, setOpenState] = React.useState(isMobile ? false : defaultOpen);
  const open = openProp !== undefined ? openProp : openState;
  const setOpen = React.useCallback(
    (value: boolean) => {
      if (onOpenChange) {
        onOpenChange(value);
      } else {
        setOpenState(value);
      }
      // Solo persistir cookie en desktop — en mobile el Sheet no debe afectar
      // el estado colapsado desktop que sobrevive al refresh.
      if (!isMobile) {
        document.cookie = `${SIDEBAR_COOKIE_NAME}=${value}; path=/; max-age=${60 * 60 * 24 * 7}`;
      }
    },
    [onOpenChange, isMobile],
  );

  const toggleSidebar = React.useCallback(() => setOpen(!open), [open, setOpen]);

  // Atajo de teclado Ctrl+B / Cmd+B (estándar Shadcn).
  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSidebar]);

  return (
    <SidebarContext.Provider value={{ open, setOpen, toggleSidebar }}>
      <div
        data-sidebar-open={open}
        className={cn("group/sidebar-wrapper flex min-h-svh w-full", className)}
        style={
          {
            "--sidebar-width": SIDEBAR_WIDTH,
            "--sidebar-width-icon": SIDEBAR_WIDTH_ICON,
            ...style,
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

// ── Sidebar root ──────────────────────────────────────────────────────────────

export function Sidebar({
  side = "left",
  collapsible = "offcanvas",
  className,
  children,
}: {
  side?: "left" | "right";
  collapsible?: "offcanvas" | "icon" | "none";
  className?: string;
  children: React.ReactNode;
}) {
  const { open, setOpen } = useSidebar();
  const isMobile = useIsMobile();

  if (collapsible === "none") {
    return (
      <div
        className={cn(
          "flex h-full w-[--sidebar-width] flex-col bg-sidebar text-sidebar-foreground",
          className,
        )}
      >
        {children}
      </div>
    );
  }

  // En mobile: renderizar como Sheet desde el lado izquierdo.
  // El mismo `open` state de SidebarContext controla apertura/cierre.
  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          className={cn(
            "flex w-72 max-w-[85vw] flex-col border-r border-sidebar-border bg-sidebar p-0 text-sidebar-foreground",
            className,
          )}
        >
          <div
            data-state="expanded"
            data-collapsible={collapsible}
            className="group flex h-full flex-col"
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  // Desktop: panel fijo con transición de ancho.
  return (
    <div
      data-state={open ? "expanded" : "collapsed"}
      data-collapsible={collapsible}
      data-side={side}
      className={cn(
        "group hidden md:flex flex-col shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground",
        "transition-[width] duration-200 ease-standard will-change-[width]",
        collapsible === "icon"
          ? open
            ? "w-[--sidebar-width]"
            : "w-[--sidebar-width-icon]"
          : open
            ? "w-[--sidebar-width]"
            : "w-0 overflow-hidden border-0",
        className,
      )}
    >
      {children}
    </div>
  );
}

// ── SidebarTrigger ────────────────────────────────────────────────────────────

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("h-9 w-9 p-0", className)}
      onClick={(e) => {
        onClick?.(e);
        toggleSidebar();
      }}
      aria-label="Mostrar u ocultar menú lateral"
      {...props}
    >
      <PanelLeft className="h-5 w-5" aria-hidden />
    </Button>
  );
}

// ── SidebarInset ──────────────────────────────────────────────────────────────

export function SidebarInset({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex min-w-0 flex-1 flex-col", className)}
      {...props}
    >
      {children}
    </div>
  );
}

// ── SidebarSeparator ──────────────────────────────────────────────────────────

export function SidebarSeparator({ className }: { className?: string }) {
  return (
    <hr
      className={cn("my-1 border-t border-sidebar-border/60", className)}
    />
  );
}

// ── SidebarHeader / Footer ────────────────────────────────────────────────────

export function SidebarHeader({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2 p-2 border-b border-sidebar-border", className)}>
      {children}
    </div>
  );
}

export function SidebarFooter({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("mt-auto p-2 border-t border-sidebar-border", className)}>
      {children}
    </div>
  );
}

// ── SidebarContent ────────────────────────────────────────────────────────────

export function SidebarContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-1 flex-col overflow-y-auto overflow-x-hidden", className)}>
      {children}
    </div>
  );
}

// ── SidebarGroup ──────────────────────────────────────────────────────────────

export function SidebarGroup({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("relative flex flex-col w-full min-w-0 p-2", className)}>
      {children}
    </div>
  );
}

export function SidebarGroupLabel({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  // Ocultamos el label en modo collapsed usando el data-state del ancestro.
  // group-data-[state=collapsed]:hidden — evita llamar useSidebar() aquí,
  // lo que previene errores SSR si el componente se renderiza sin provider.
  return (
    <div
      className={cn(
        "px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/60",
        "group-data-[state=collapsed]:hidden",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SidebarGroupContent({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("", className)}>{children}</div>;
}

// ── SidebarMenu ───────────────────────────────────────────────────────────────

export function SidebarMenu({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <ul className={cn("flex flex-col gap-0.5", className)} role="menu">
      {children}
    </ul>
  );
}

export function SidebarMenuItem({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <li className={cn("", className)} role="none">
      {children}
    </li>
  );
}

// ── SidebarMenuButton ─────────────────────────────────────────────────────────

export interface SidebarMenuButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  isActive?: boolean;
  /** Texto del tooltip — visible cuando el sidebar está collapsed (solo icono). */
  tooltip?: string;
  size?: "default" | "sm" | "lg";
}

export const SidebarMenuButton = React.forwardRef<
  HTMLButtonElement,
  SidebarMenuButtonProps
>(function SidebarMenuButton(
  { asChild, isActive, tooltip: _tooltip, size = "default", className, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";

  // Usa data-state del grupo ancestro vía CSS group para manejar collapsed
  // sin llamar useSidebar() (previene errores SSR en páginas de error Next.js).
  // Clases group-data-[state=collapsed]:* ajustan layout cuando está colapsado.
  return (
    <Comp
      ref={ref}
      role="menuitem"
      data-active={isActive}
      title={_tooltip}
      className={cn(
        "flex w-full items-center gap-2 rounded-md text-sm transition-colors",
        "text-sidebar-foreground/90 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
        "disabled:pointer-events-none disabled:opacity-50",
        isActive && "bg-sidebar-primary text-sidebar-primary-foreground font-medium shadow-sm",
        // Tamaño expandido
        size === "sm" ? "h-8 px-3 py-1" : size === "lg" ? "h-12 px-3 py-2" : "h-9 px-3 py-1.5",
        // En collapsed: centrar icono y ocultar label-span via CSS
        "group-data-[state=collapsed]:justify-center group-data-[state=collapsed]:px-0 group-data-[state=collapsed]:overflow-hidden",
        className,
      )}
      {...props}
    >
      {children}
    </Comp>
  );
});

// ── Collapsible re-export (por compatibilidad con patrones Shadcn avanzados) ──

export const SidebarCollapsible = CollapsiblePrimitive.Root;
export const SidebarCollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const SidebarCollapsibleContent = CollapsiblePrimitive.Content;
