"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Search, Users, Navigation, LogOut } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@his/ui/components/command";
import { trpc } from "../lib/trpc/react";
import { SECTIONS } from "./nav-sections";
import { isItemVisible } from "./nav-visibility";

// ---------------------------------------------------------------------------
// Context — permite al botón del top bar abrir la paleta sin prop drilling
// ---------------------------------------------------------------------------

interface CommandPaletteContextValue {
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

export const CommandPaletteContext =
  React.createContext<CommandPaletteContextValue | null>(null);

export function useCommandPalette(): CommandPaletteContextValue {
  const ctx = React.useContext(CommandPaletteContext);
  if (!ctx) throw new Error("useCommandPalette debe usarse dentro de <CommandPalette>");
  return ctx;
}

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface CommandPaletteProps {
  roleCodes: string[];
  assignedServiceUnitCodes: string[];
  isCrossServiceRole: boolean;
  /** Si se pasan children, el Context Provider los envuelve — permite que
   *  CommandPaletteButton consuma el Context desde cualquier parte del árbol. */
  children?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Hook de debounce simple — evita disparar tRPC en cada keystroke
// ---------------------------------------------------------------------------

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------
// Componente principal
// ---------------------------------------------------------------------------

export function CommandPalette({
  roleCodes,
  assignedServiceUnitCodes,
  isCrossServiceRole,
  children,
}: CommandPaletteProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebounce(query, 300);
  const router = useRouter();

  // Atajo de teclado global — Ctrl+K (Windows/Linux) o Cmd+K (Mac).
  // No dispara si el foco está en un campo editable.
  React.useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        const target = e.target as HTMLElement;
        const editable =
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable;
        if (editable) return;
        e.preventDefault();
        setOpen((v) => !v);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Limpia la búsqueda al cerrar para que la próxima apertura empiece limpia.
  function handleOpenChange(value: boolean) {
    setOpen(value);
    if (!value) setQuery("");
  }

  // Navega y cierra el dialog.
  function navigate(href: string) {
    router.push(href);
    handleOpenChange(false);
  }

  // tRPC — busca pacientes solo cuando hay query debounced y el dialog está abierto.
  const patientSearch = trpc.patient.search.useQuery(
    { query: debouncedQuery, limit: 5 },
    {
      enabled: open && debouncedQuery.trim().length >= 2,
      staleTime: 30_000,
    },
  );

  // Items de navegación filtrados por visibilidad.
  const navItems = SECTIONS.flatMap((section) =>
    section.items
      .filter((item) =>
        isItemVisible(item, roleCodes, assignedServiceUnitCodes, isCrossServiceRole),
      )
      .map((item) => ({ ...item, sectionLabel: section.label })),
  );

  // Acciones rápidas — hardcoded, solo 3 esenciales.
  const quickActions = [
    { label: "Nuevo paciente", href: "/patients/new", icon: Users },
    { label: "Ir a triage", href: "/triage", icon: Navigation },
    { label: "Cerrar sesión", href: "/api/auth/signout", icon: LogOut },
  ];

  return (
    <CommandPaletteContext.Provider value={{ setOpen }}>
      {children}
      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput
          placeholder="Buscar paciente, navegar, acciones… (Ctrl+K)"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          <CommandEmpty>Sin resultados.</CommandEmpty>

          {/* Grupo Pacientes — aparece cuando hay query y resultados */}
          {debouncedQuery.trim().length >= 2 && (
            <CommandGroup heading="Pacientes">
              {patientSearch.isPending && (
                <CommandItem disabled value="__loading__">
                  Buscando…
                </CommandItem>
              )}
              {patientSearch.data?.map((patient) => {
                const name = [patient.firstName, patient.lastName, patient.secondLastName]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <CommandItem
                    key={patient.id}
                    value={`paciente-${patient.id}`}
                    onSelect={() => navigate(`/patients/${patient.id}`)}
                  >
                    <Users className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>{name}</span>
                    {patient.mrn && (
                      <span className="ml-1.5 text-xs text-muted-foreground">
                        #{patient.mrn}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
              {patientSearch.data?.length === 0 && !patientSearch.isPending && (
                <CommandItem disabled value="__no-patients__">
                  Sin pacientes para &ldquo;{debouncedQuery}&rdquo;
                </CommandItem>
              )}
            </CommandGroup>
          )}

          {debouncedQuery.trim().length >= 2 && <CommandSeparator />}

          {/* Grupo Navegación — filtra por label/description si hay query */}
          <CommandGroup heading="Navegación">
            {navItems
              .filter((item) => {
                const q = query.trim().toLowerCase();
                if (!q) return true;
                return (
                  item.label.toLowerCase().includes(q) ||
                  item.description.toLowerCase().includes(q)
                );
              })
              .slice(0, 8) // máx 8 items para no saturar la lista
              .map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.href}
                    value={`nav-${item.href}`}
                    onSelect={() => navigate(item.href)}
                  >
                    <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                    <span>{item.label}</span>
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      {item.sectionLabel}
                    </span>
                  </CommandItem>
                );
              })}
          </CommandGroup>

          <CommandSeparator />

          {/* Grupo Acciones rápidas */}
          <CommandGroup heading="Acciones rápidas">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <CommandItem
                  key={action.href}
                  value={`action-${action.href}`}
                  onSelect={() => navigate(action.href)}
                >
                  <Icon className="mr-2 h-4 w-4" aria-hidden="true" />
                  <span>{action.label}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </CommandPaletteContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Botón top bar — consume el Context; se puede renderizar en cualquier parte
// del árbol bajo <CommandPalette>
// ---------------------------------------------------------------------------

export function CommandPaletteButton({ className }: { className?: string }) {
  const { setOpen } = useCommandPalette();
  return (
    <button
      type="button"
      aria-label="Paleta de comandos"
      onClick={() => setOpen(true)}
      className={
        className ??
        "inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-sm text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      <Search className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="hidden sm:inline">Buscar…</span>
      <CommandShortcut>Ctrl+K</CommandShortcut>
    </button>
  );
}
