"use client";

/**
 * US-2.3 — Form crear/editar rol.
 * Patrón espejo de catalog-form (Dialog + Zod safeParse al submit).
 *
 * Notas:
 *  - El alcance (`organizationId`) lo resuelve el server por defecto a partir
 *    del tenant context. La opción "Global" sólo es visible en la UI; el
 *    server volverá a verificar que el usuario sea super_admin.
 *  - El `code` es único por organización ([organizationId, code] @@unique).
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

interface RoleInitial {
  id: string;
  code: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  active: boolean;
}

interface RoleFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: RoleInitial | null;
  onSuccess?: () => void;
}

export function RoleForm({ open, onOpenChange, initial, onSuccess }: RoleFormProps) {
  const isEdit = Boolean(initial?.id);

  const [code, setCode] = React.useState(initial?.code ?? "");
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [global, setGlobal] = React.useState(initial?.organizationId === null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setCode(initial?.code ?? "");
      setName(initial?.name ?? "");
      setDescription(initial?.description ?? "");
      setGlobal(initial?.organizationId === null);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMut = (trpc as any).rbac.createRole.useMutation({
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const updateMut = (trpc as any).rbac.updateRole.useMutation({
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const isSubmitting = createMut.isPending || updateMut.isPending;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!isEdit) {
      if (code.trim().length < 2) next.code = "Mínimo 2 caracteres.";
      if (!/^[a-zA-Z0-9_\-.]+$/.test(code.trim())) {
        next.code = "Solo letras, números, _, -, .";
      }
    }
    if (name.trim().length < 2) next.name = "Mínimo 2 caracteres.";
    if (description.length > 500) next.description = "Máximo 500.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    if (isEdit) {
      updateMut.mutate({
        id: initial!.id,
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
      });
    } else {
      createMut.mutate({
        code: code.trim(),
        name: name.trim(),
        description: description.trim() === "" ? null : description.trim(),
        organizationId: global ? null : undefined,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar rol" : "Nuevo rol"}</DialogTitle>
          <DialogDescription>
            Define el rol RBAC. La asignación de permisos se gestiona en la
            pantalla de detalle.
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="code">
              Código <span className="text-destructive">*</span>
            </Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={isEdit}
              placeholder="medico, admision…"
              aria-invalid={Boolean(errors.code)}
            />
            <FormHint>
              Identificador estable. No se puede cambiar después de creado.
            </FormHint>
            <FormError>{errors.code}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="name">
              Nombre visible <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Médico tratante"
              aria-invalid={Boolean(errors.name)}
            />
            <FormError>{errors.name}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="description">Descripción</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
              aria-invalid={Boolean(errors.description)}
            />
            <FormError>{errors.description}</FormError>
          </FormField>

          {!isEdit ? (
            <FormField>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={global}
                  onChange={(e) => setGlobal(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Rol global (sólo super_admin)
              </label>
              <FormHint>
                Si no marcas esta opción, el rol vivirá únicamente en tu
                organización actual.
              </FormHint>
            </FormField>
          ) : null}

          {serverError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear rol"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
