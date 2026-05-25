"use client";

/**
 * OrgRoleSwitcher — selector dual organización + roles activos.
 *
 * Multi-select por checkbox en ambos dropdowns:
 *   - Organización: cambia la org activa (cookie `his.org`). Por simplicidad
 *     UX la org es exclusiva — un click en otra reemplaza la activa.
 *   - Roles: subconjunto del catálogo del usuario en la org activa. Múltiples
 *     a la vez (cookie `his.roles` CSV). Restrictivo: el motor solo permite
 *     acciones cubiertas por los roles marcados.
 *
 * Ubicación: esquina superior derecha del app-shell.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Building2, ChevronDown, ShieldCheck, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
} from "@his/ui/components/dropdown-menu";
import { Button } from "@his/ui/components/button";
import { setOrganization } from "@/app/actions/set-organization";
import { setActiveRoles } from "@/app/actions/set-active-roles";

interface OrgWithRoles {
  id: string;
  name: string;
  code: string;
  roles: Array<{ code: string; name: string }>;
}

interface SessionContext {
  user: { id: string; email: string; fullName: string };
  organizations: OrgWithRoles[];
  activeOrgId: string | null;
  activeRoles: string[];
}

export function OrgRoleSwitcher() {
  const router = useRouter();
  const [data, setData] = React.useState<SessionContext | null>(null);
  const [pending, startTransition] = React.useTransition();

  // Carga inicial del contexto del usuario.
  React.useEffect(() => {
    fetch("/api/session/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json))
      .catch(() => setData(null));
  }, []);

  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Cargando…</span>
      </div>
    );
  }

  const activeOrg = data.organizations.find((o) => o.id === data.activeOrgId);
  const availableRoles = activeOrg?.roles ?? [];

  // Default UX: si el usuario no ha hecho selección explícita, mostramos todos
  // marcados (representa "actúo con todos mis roles").
  const effectiveActive =
    data.activeRoles.length > 0
      ? data.activeRoles
      : availableRoles.map((r) => r.code);

  // ───────────────────────────────────────────────────────────────────────
  // Handlers
  // ───────────────────────────────────────────────────────────────────────

  function handleOrgChange(organizationId: string) {
    startTransition(async () => {
      await setOrganization(organizationId);
      router.refresh();
      // Recarga el contexto para reflejar el nuevo catálogo de roles.
      const fresh = await fetch("/api/session/context").then((r) => r.json());
      setData(fresh);
    });
  }

  function toggleRole(code: string) {
    const next = effectiveActive.includes(code)
      ? effectiveActive.filter((c) => c !== code)
      : [...effectiveActive, code];

    // Evitar dejar al usuario sin ningún rol (queda inhabilitado para todo).
    if (next.length === 0) return;

    startTransition(async () => {
      await setActiveRoles(next);
      router.refresh();
      setData({ ...data!, activeRoles: next });
    });
  }

  function handleSelectAllRoles() {
    const all = availableRoles.map((r) => r.code);
    startTransition(async () => {
      await setActiveRoles(all);
      router.refresh();
      setData({ ...data!, activeRoles: all });
    });
  }

  function handleClearRoles() {
    // "Limpiar" deja exactamente 1 rol (el primero alfabético) — nunca cero.
    const first = [...availableRoles.map((r) => r.code)].sort()[0];
    if (!first) return;
    startTransition(async () => {
      await setActiveRoles([first]);
      router.refresh();
      setData({ ...data!, activeRoles: [first] });
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {/* Selector de Organización — compacto en mobile (solo icono) */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 max-w-[220px] justify-between gap-2 px-2 sm:px-3"
            disabled={pending}
            aria-label="Cambiar organización activa"
          >
            <span className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden truncate sm:inline">{activeOrg?.name ?? "Sin organización"}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[320px] w-[280px] overflow-y-auto">
          <DropdownMenuLabel>Organizaciones</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {data.organizations.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Sin organizaciones asignadas.
            </div>
          )}
          {data.organizations.map((org) => (
            <DropdownMenuCheckboxItem
              key={org.id}
              checked={org.id === data.activeOrgId}
              onCheckedChange={(checked) => {
                if (checked) handleOrgChange(org.id);
              }}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex flex-col">
                <span className="font-medium leading-tight">{org.name}</span>
                <span className="text-xs text-muted-foreground">
                  {org.roles.length} rol{org.roles.length === 1 ? "" : "es"}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selector de Roles activos — compacto en mobile */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 max-w-[220px] justify-between gap-2 px-2 sm:px-3"
            disabled={pending || availableRoles.length === 0}
            aria-label="Seleccionar roles activos para esta sesión"
          >
            <span className="flex items-center gap-2 truncate">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden truncate sm:inline">
                {effectiveActive.length === availableRoles.length
                  ? `Todos los roles (${effectiveActive.length})`
                  : `${effectiveActive.length} de ${availableRoles.length} roles`}
              </span>
              <span className="sm:hidden text-xs font-medium tabular-nums">
                {effectiveActive.length}/{availableRoles.length}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[360px] w-[280px] overflow-y-auto">
          <DropdownMenuLabel>Responsabilidad (rol activo)</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {availableRoles.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Sin roles en esta organización.
            </div>
          )}
          {availableRoles.map((role) => (
            <DropdownMenuCheckboxItem
              key={role.code}
              checked={effectiveActive.includes(role.code)}
              onCheckedChange={() => toggleRole(role.code)}
              onSelect={(e) => e.preventDefault()}
            >
              <span className="flex flex-col">
                <span className="font-medium leading-tight">{role.name}</span>
                <span className="text-xs text-muted-foreground">{role.code}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          {availableRoles.length > 1 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleSelectAllRoles} className="text-xs">
                Seleccionar todos
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleClearRoles} className="text-xs">
                Dejar solo el primero
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
