"use client";

/**
 * OrgRoleSwitcher — selector dual organización + roles activos.
 *
 * Comportamiento por defecto (RESTRICTIVO, sin traslapes):
 *   - Organización: SINGLE-select (radio). El usuario opera en UNA org a la vez.
 *   - Roles: MULTI-select (checkboxes). Puede activar varios roles
 *     simultáneamente dentro de la org activa.
 *
 * Excepción multi-org (solo si el usuario tiene rol DIR / ADM / JEFE / GERENTE
 * activo): el selector de Org pasa a MULTI-select. Las orgs adicionales se
 * guardan en cookie `his.orgs` y solo afectan a dashboards/reports que opt-in
 * a getVisibleOrgIds(). Las queries transaccionales siguen usando la org
 * primaria de cookie `his.org` para mantener trazabilidad clara.
 *
 * Defensa robusta: server actions retornan { ok, error } en lugar de throw.
 * El switcher se deshabilita gracefully cuando no hay org seleccionada.
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
import { setActiveOrgs } from "@/app/actions/set-active-orgs";

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
  additionalOrgIds: string[];
  isMultiOrgActive: boolean;
  multiOrgRoleCodes: readonly string[];
}

export function OrgRoleSwitcher() {
  const router = useRouter();
  const [data, setData] = React.useState<SessionContext | null>(null);
  const [pending, startTransition] = React.useTransition();

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

  const effectiveActiveRoles =
    data.activeRoles.length > 0
      ? data.activeRoles
      : availableRoles.map((r) => r.code);

  // Orgs visibles = primaria + adicionales (validadas server-side).
  const visibleOrgIds = new Set<string>();
  if (data.activeOrgId) visibleOrgIds.add(data.activeOrgId);
  data.additionalOrgIds.forEach((id) => visibleOrgIds.add(id));

  // ───────────────────────────────────────────────────────────────────────
  // Handlers
  // ───────────────────────────────────────────────────────────────────────

  function handleOrgSingleSelect(organizationId: string) {
    if (organizationId === data!.activeOrgId) return;
    startTransition(async () => {
      await setOrganization(organizationId);
      router.refresh();
      const fresh = await fetch("/api/session/context").then((r) => r.json());
      setData(fresh);
    });
  }

  function toggleOrgInMulti(organizationId: string) {
    // En modo multi-org: la org primaria NO se puede destildar (es el ancla
    // para queries transaccionales). El usuario solo añade/quita adicionales.
    if (organizationId === data!.activeOrgId) return;

    const current = new Set(data!.additionalOrgIds);
    if (current.has(organizationId)) {
      current.delete(organizationId);
    } else {
      current.add(organizationId);
    }
    const next = Array.from(current);
    startTransition(async () => {
      await setActiveOrgs(next);
      router.refresh();
      setData({ ...data!, additionalOrgIds: next });
    });
  }

  async function toggleRole(code: string) {
    if (!data!.activeOrgId) return; // guard: no operar sin org
    const next = effectiveActiveRoles.includes(code)
      ? effectiveActiveRoles.filter((c) => c !== code)
      : [...effectiveActiveRoles, code];
    if (next.length === 0) return;

    startTransition(async () => {
      const result = await setActiveRoles(next);
      if (!result.ok) return;
      router.refresh();
      // Recargar contexto: el cambio de roles activos puede haber cambiado
      // el flag isMultiOrgActive y por tanto el modo del selector de org.
      const fresh = await fetch("/api/session/context").then((r) => r.json());
      setData(fresh);
    });
  }

  function handleSelectAllRoles() {
    if (!data!.activeOrgId) return;
    const all = availableRoles.map((r) => r.code);
    startTransition(async () => {
      const result = await setActiveRoles(all);
      if (!result.ok) return;
      router.refresh();
      const fresh = await fetch("/api/session/context").then((r) => r.json());
      setData(fresh);
    });
  }

  function handleClearRoles() {
    if (!data!.activeOrgId) return;
    const first = [...availableRoles.map((r) => r.code)].sort()[0];
    if (!first) return;
    startTransition(async () => {
      const result = await setActiveRoles([first]);
      if (!result.ok) return;
      router.refresh();
      const fresh = await fetch("/api/session/context").then((r) => r.json());
      setData(fresh);
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  // Labels dinámicos
  // ───────────────────────────────────────────────────────────────────────

  const orgTriggerLabel = data.isMultiOrgActive && visibleOrgIds.size > 1
    ? `${visibleOrgIds.size} orgs`
    : activeOrg?.name ?? "Sin organización";

  // ───────────────────────────────────────────────────────────────────────
  // Render
  // ───────────────────────────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-1 sm:gap-2">
      {/* Selector de Organización */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 max-w-[220px] justify-between gap-2 px-2 sm:px-3"
            disabled={pending || data.organizations.length === 0}
            aria-label="Cambiar organización activa"
          >
            <span className="flex items-center gap-2 truncate">
              <Building2 className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden truncate sm:inline">{orgTriggerLabel}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-[320px] w-[300px] overflow-y-auto">
          <DropdownMenuLabel>
            {data.isMultiOrgActive ? (
              <span>
                Organizaciones
                <span className="ml-2 inline-flex items-center rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium uppercase text-primary">
                  Multi-org
                </span>
              </span>
            ) : (
              "Organización (una a la vez)"
            )}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {data.isMultiOrgActive && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Tu rol directivo te permite visibilidad cross-org. La organización
              principal se mantiene para operaciones; las adicionales solo
              afectan dashboards y reportes.
            </p>
          )}
          {data.organizations.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">
              Sin organizaciones asignadas.
            </div>
          )}
          {data.organizations.map((org) => {
            const isPrimary = org.id === data.activeOrgId;
            const isAdditional = data.additionalOrgIds.includes(org.id);
            const checked = data.isMultiOrgActive
              ? (isPrimary || isAdditional)
              : isPrimary;
            return (
              <DropdownMenuCheckboxItem
                key={org.id}
                checked={checked}
                onCheckedChange={() => {
                  if (data.isMultiOrgActive) {
                    if (isPrimary) {
                      // La primaria no se destilda; sirve como "ancla". Si el
                      // usuario quiere cambiar la primaria, debe click en otra
                      // org no-primaria (no se destilda esta).
                      return;
                    }
                    toggleOrgInMulti(org.id);
                  } else {
                    handleOrgSingleSelect(org.id);
                  }
                }}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex flex-col">
                  <span className="font-medium leading-tight">
                    {org.name}
                    {isPrimary && (
                      <span className="ml-2 text-[10px] font-medium uppercase text-primary">
                        principal
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {org.roles.length} rol{org.roles.length === 1 ? "" : "es"}
                  </span>
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Selector de Roles activos — multi-select dentro de la org primaria */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 max-w-[220px] justify-between gap-2 px-2 sm:px-3"
            disabled={pending || availableRoles.length === 0 || !data.activeOrgId}
            aria-label="Seleccionar roles activos para esta sesión"
          >
            <span className="flex items-center gap-2 truncate">
              <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden />
              <span className="hidden truncate sm:inline">
                {effectiveActiveRoles.length === availableRoles.length
                  ? `Todos los roles (${effectiveActiveRoles.length})`
                  : `${effectiveActiveRoles.length} de ${availableRoles.length} roles`}
              </span>
              <span className="sm:hidden text-xs font-medium tabular-nums">
                {effectiveActiveRoles.length}/{availableRoles.length}
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
              {data.activeOrgId
                ? "Sin roles en esta organización."
                : "Selecciona una organización primero."}
            </div>
          )}
          {availableRoles.map((role) => {
            const isMultiOrgRole = data.multiOrgRoleCodes.includes(role.code);
            return (
              <DropdownMenuCheckboxItem
                key={role.code}
                checked={effectiveActiveRoles.includes(role.code)}
                onCheckedChange={() => toggleRole(role.code)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex flex-col">
                  <span className="font-medium leading-tight">
                    {role.name}
                    {isMultiOrgRole && (
                      <span className="ml-2 text-[10px] font-medium uppercase text-primary">
                        multi-org
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">{role.code}</span>
                </span>
              </DropdownMenuCheckboxItem>
            );
          })}
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
