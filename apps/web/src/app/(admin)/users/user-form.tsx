"use client";

/**
 * US-2.3 — Form crear/editar usuario.
 *
 * EDITAR (initial con id): un solo paso — fullName + active. El email NO se
 * cambia (es identidad).
 *
 * CREAR (sin initial): wizard de 3 pasos en el mismo diálogo —
 *   1. Datos        → `userAdmin.create` (email + fullName)
 *   2. Acceso       → org + rol → `userAdmin.assignRole`
 *                     (org "holding" Avante Holding o una operadora)
 *   3. Unidades     → (opcional) una/varias unidades operativas de la org
 *                     ACTIVA → `userServiceUnit.assign` por unidad
 *
 * Nota de modelo: `userServiceUnit.assign` solo acepta unidades de la org
 * ACTIVA del admin (valida `serviceUnit.organizationId === ctx.tenant`). Por
 * eso el paso 3 ofrece las unidades de tu org activa (`catalog.list`). Para
 * roles ADMIN/directivos no es necesario asignar unidades — ya ven todas
 * (bypass cross-servicio).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

interface UserInitial {
  id: string;
  email: string;
  fullName: string;
  active: boolean;
}

interface UserFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: UserInitial | null;
  onSuccess?: () => void;
}

type WizardStep = 1 | 2 | 3;

export function UserForm({ open, onOpenChange, initial, onSuccess }: UserFormProps) {
  const isEdit = Boolean(initial?.id);

  // ── Estado compartido ───────────────────────────────────────────────────
  const [email, setEmail] = React.useState(initial?.email ?? "");
  const [fullName, setFullName] = React.useState(initial?.fullName ?? "");
  const [active, setActive] = React.useState(initial?.active ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  // ── Estado del wizard (solo crear) ──────────────────────────────────────
  const [step, setStep] = React.useState<WizardStep>(1);
  const [createdUserId, setCreatedUserId] = React.useState<string | null>(null);
  const [orgId, setOrgId] = React.useState<string>("");
  const [roleId, setRoleId] = React.useState<string>("");
  const [selectedUnits, setSelectedUnits] = React.useState<Set<string>>(new Set());
  const [unitsBusy, setUnitsBusy] = React.useState(false);

  const utils = trpc.useUtils();

  React.useEffect(() => {
    if (open) {
      setEmail(initial?.email ?? "");
      setFullName(initial?.fullName ?? "");
      setActive(initial?.active ?? true);
      setErrors({});
      setServerError(null);
      setStep(1);
      setCreatedUserId(null);
      setOrgId("");
      setRoleId("");
      setSelectedUnits(new Set());
      setUnitsBusy(false);
    }
  }, [open, initial]);

  // ── Mutations ───────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMut = (trpc as any).userAdmin.create.useMutation({
    onSuccess: (u: { id: string }) => {
      setCreatedUserId(u.id);
      setStep(2); // avanza al paso de acceso (NO cierra)
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMut = (trpc as any).userAdmin.update.useMutation({
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignRoleMut = (trpc as any).userAdmin.assignRole.useMutation({
    onSuccess: () => setStep(3), // avanza a unidades
    onError: (err: { message: string }) => setServerError(err.message),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const assignUnitMut = (trpc as any).userServiceUnit.assign.useMutation();

  // ── Queries del wizard ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orgsQ = (trpc as any).organization.listAll.useQuery(undefined, {
    enabled: open && !isEdit && step === 2,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rolesQ = (trpc as any).rbac.listRoles.useQuery(
    { activeOnly: true, includeGlobal: true, organizationId: orgId || undefined },
    { enabled: open && !isEdit && step === 2 && !!orgId },
  );
  // Unidades de la ORG ACTIVA del admin (catalog.list ya filtra por tenant).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const unitsQ = (trpc as any).catalog.list.useQuery(
    { catalog: "serviceUnit", activeOnly: true },
    { enabled: open && !isEdit && step === 3 },
  );

  const orgs = (orgsQ.data ?? []) as { id: string; tradeName: string | null; legalName: string }[];
  const allRoles = (rolesQ.data ?? []) as {
    id: string;
    code: string;
    name: string;
    organizationId: string | null;
  }[];
  const availableRoles = allRoles.filter(
    (r) => r.organizationId === null || r.organizationId === orgId,
  );
  const units = (unitsQ.data ?? []) as { id: string; code?: string; name: string }[];

  const isSubmitting = createMut.isPending || updateMut.isPending;

  // ── Handlers ──────────────────────────────────────────────────────────────
  function validateStep1(): boolean {
    const next: Record<string, string> = {};
    if (!isEdit && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      next.email = "Email inválido.";
    }
    if (fullName.trim().length < 2) next.fullName = "Mínimo 2 caracteres.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submitStep1(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validateStep1()) return;
    if (isEdit) {
      updateMut.mutate({ id: initial!.id, fullName: fullName.trim(), active });
    } else {
      createMut.mutate({ email: email.trim().toLowerCase(), fullName: fullName.trim() });
    }
  }

  function submitStep2(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!orgId || !roleId) {
      setServerError("Selecciona organización y rol.");
      return;
    }
    assignRoleMut.mutate({ userId: createdUserId, organizationId: orgId, roleId });
  }

  function toggleUnit(id: string) {
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function finishWithUnits() {
    setServerError(null);
    if (selectedUnits.size === 0) {
      finishWizard();
      return;
    }
    setUnitsBusy(true);
    try {
      // Asigna cada unidad en loop (mutateAsync; el endpoint es idempotente).
      // roleId null = aplica con cualquier rol.
      for (const serviceUnitId of selectedUnits) {
        await assignUnitMut.mutateAsync({
          userId: createdUserId,
          serviceUnitId,
          roleId: null,
        });
      }
      finishWizard();
    } catch (err) {
      setServerError(
        (err as { message?: string })?.message ??
          "No se pudieron asignar algunas unidades. El usuario y su rol ya quedaron creados.",
      );
    } finally {
      setUnitsBusy(false);
    }
  }

  function finishWizard() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (utils as any).userAdmin.listAll.invalidate();
    onSuccess?.();
    onOpenChange(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const title = isEdit ? "Editar usuario" : `Nuevo usuario — paso ${step} de 3`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Edita el nombre y el estado activo del usuario."
              : step === 1
                ? "Datos básicos del usuario."
                : step === 2
                  ? "Asigna organización y rol. La org puede ser el holding o una operadora."
                  : "Opcional: asigna una o varias unidades operativas de tu organización activa."}
          </DialogDescription>
        </DialogHeader>

        {/* ── PASO 1 / EDIT ── */}
        {(isEdit || step === 1) && (
          <Form onSubmit={submitStep1}>
            <FormField>
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isEdit}
                placeholder="usuario@dominio.com"
                aria-invalid={Boolean(errors.email)}
              />
              <FormHint>
                {isEdit
                  ? "El email no se modifica desde esta pantalla."
                  : "Será el identificador único del usuario."}
              </FormHint>
              <FormError>{errors.email}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="fullName">
                Nombre completo <span className="text-destructive">*</span>
              </Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Nombre y apellidos"
                aria-invalid={Boolean(errors.fullName)}
              />
              <FormError>{errors.fullName}</FormError>
            </FormField>

            {isEdit && (
              <FormField>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={active}
                    onChange={(e) => setActive(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span>{active ? "Activo" : "Inactivo (no podrá iniciar sesión)"}</span>
                </label>
              </FormField>
            )}

            {serverError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear y continuar"}
              </Button>
            </DialogFooter>
          </Form>
        )}

        {/* ── PASO 2: org + rol ── */}
        {!isEdit && step === 2 && (
          <Form onSubmit={submitStep2}>
            <FormField>
              <Label htmlFor="orgId">
                Organización <span className="text-destructive">*</span>
              </Label>
              <select
                id="orgId"
                value={orgId}
                onChange={(e) => {
                  setOrgId(e.target.value);
                  setRoleId("");
                }}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Selecciona —</option>
                {orgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.tradeName ?? o.legalName}
                  </option>
                ))}
              </select>
              <FormHint>Holding (consolidado) u operadora (operativo). Solo orgs donde tienes membresía.</FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="roleId">
                Rol <span className="text-destructive">*</span>
              </Label>
              <select
                id="roleId"
                value={roleId}
                onChange={(e) => setRoleId(e.target.value)}
                disabled={!orgId}
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="">— Selecciona —</option>
                {availableRoles.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.code}) {r.organizationId === null ? "· Global" : ""}
                  </option>
                ))}
              </select>
              <FormHint>Roles ADMIN/directivos ven todas las unidades sin asignación individual.</FormHint>
            </FormField>

            {serverError && <FormError>{serverError}</FormError>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={finishWizard} disabled={assignRoleMut.isPending}>
                Omitir (sin rol)
              </Button>
              <Button type="submit" disabled={assignRoleMut.isPending}>
                {assignRoleMut.isPending ? "Asignando…" : "Asignar rol y continuar"}
              </Button>
            </DialogFooter>
          </Form>
        )}

        {/* ── PASO 3: unidades operativas (opcional) ── */}
        {!isEdit && step === 3 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Selecciona las unidades operativas (de tu organización activa) a las que el usuario
              tendrá acceso. Déjalo vacío si el rol ya ve todo (ADMIN/directivo) o si lo asignarás
              después en <code className="text-xs">/asignaciones-servicio</code>.
            </p>

            <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-md border p-2">
              {unitsQ.isPending && <p className="p-2 text-sm text-muted-foreground">Cargando unidades…</p>}
              {!unitsQ.isPending && units.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  No hay unidades en tu organización activa. (El holding no tiene unidades operativas
                  propias — están en las operadoras.)
                </p>
              )}
              {units.map((u) => (
                <label key={u.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                  <input
                    type="checkbox"
                    checked={selectedUnits.has(u.id)}
                    onChange={() => toggleUnit(u.id)}
                    className="h-4 w-4 rounded border-input"
                  />
                  <span className="font-medium">{u.name}</span>
                  {u.code && <span className="text-xs text-muted-foreground">({u.code})</span>}
                </label>
              ))}
            </div>

            {selectedUnits.size > 0 && (
              <p className="text-xs text-muted-foreground">{selectedUnits.size} unidad(es) seleccionada(s).</p>
            )}

            {serverError && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={finishWizard} disabled={unitsBusy}>
                Finalizar sin unidades
              </Button>
              <Button type="button" onClick={finishWithUnits} disabled={unitsBusy}>
                {unitsBusy ? "Asignando…" : selectedUnits.size > 0 ? `Asignar ${selectedUnits.size} y finalizar` : "Finalizar"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
