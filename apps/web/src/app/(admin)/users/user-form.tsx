"use client";

/**
 * US-2.3 — Form crear/editar usuario.
 *
 * Crear:
 *   - Solo email + fullName.
 *   - El server crea User local (active=true, mfaEnabled=false). NO contacta
 *     Supabase Auth — el invitation flow real (magic-link) queda para
 *     Sprint 2 (ver TODOs en `user-admin.router.ts`).
 *
 * Editar:
 *   - Solo fullName + active. El email NO se cambia (es identidad y se
 *     reusará en el flujo de invitación). Si se necesitara cambiar, deberá
 *     usarse un endpoint específico que actualice también la identidad
 *     federada (Sprint 2).
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

export function UserForm({ open, onOpenChange, initial, onSuccess }: UserFormProps) {
  const isEdit = Boolean(initial?.id);

  const [email, setEmail] = React.useState(initial?.email ?? "");
  const [fullName, setFullName] = React.useState(initial?.fullName ?? "");
  const [active, setActive] = React.useState(initial?.active ?? true);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setEmail(initial?.email ?? "");
      setFullName(initial?.fullName ?? "");
      setActive(initial?.active ?? true);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createMut = (trpc as any).userAdmin.create.useMutation({
    onSuccess: () => {
      onSuccess?.();
      onOpenChange(false);
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

  const isSubmitting = createMut.isPending || updateMut.isPending;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!isEdit) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        next.email = "Email inválido.";
      }
    }
    if (fullName.trim().length < 2) next.fullName = "Mínimo 2 caracteres.";
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
        fullName: fullName.trim(),
        active,
      });
    } else {
      createMut.mutate({
        email: email.trim().toLowerCase(),
        fullName: fullName.trim(),
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar usuario" : "Nuevo usuario"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Edita el nombre y el estado activo del usuario."
              : "Crea un usuario local. El envío de invitación (magic-link) llegará en Sprint 2."}
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
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

          {isEdit ? (
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
              {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear usuario"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
