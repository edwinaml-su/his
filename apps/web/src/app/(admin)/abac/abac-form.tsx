"use client";

/**
 * CC-0017 F2 — form crear/editar AbacRule. Patrón espejo de roles/role-form.tsx
 * (Dialog + validación cliente simple + mutation tRPC).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import type { AbacRuleRecord } from "@his/contracts";
import {
  AbacConditionEditor,
  condicionesAFilas,
  filasACondiciones,
  type FilaCondicion,
} from "./abac-condition-editor";

const RECURSOS = ["patient", "prescription", "dispensation", "service", "signature"] as const;
const ACCIONES = ["access", "prescribe", "dispense", "sign"] as const;

interface AbacFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: AbacRuleRecord | null;
  onSuccess?: () => void;
}

export function AbacForm({ open, onOpenChange, initial, onSuccess }: AbacFormProps) {
  const isEdit = Boolean(initial?.id);

  const [recurso, setRecurso] = React.useState<(typeof RECURSOS)[number]>(initial?.recurso ?? "patient");
  const [accion, setAccion] = React.useState<(typeof ACCIONES)[number]>(initial?.accion ?? "access");
  const [effect, setEffect] = React.useState<"ALLOW" | "DENY">(initial?.effect ?? "ALLOW");
  const [prioridad, setPrioridad] = React.useState(String(initial?.prioridad ?? 100));
  const [descripcion, setDescripcion] = React.useState(initial?.descripcion ?? "");
  const [filas, setFilas] = React.useState<FilaCondicion[]>(
    initial ? condicionesAFilas(initial.condiciones) : [],
  );
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setRecurso(initial?.recurso ?? "patient");
      setAccion(initial?.accion ?? "access");
      setEffect(initial?.effect ?? "ALLOW");
      setPrioridad(String(initial?.prioridad ?? 100));
      setDescripcion(initial?.descripcion ?? "");
      setFilas(initial ? condicionesAFilas(initial.condiciones) : []);
      setErrors({});
      setServerError(null);
    }
  }, [open, initial]);

  const utils = trpc.useUtils();

  const createMut = trpc.abac.create.useMutation({
    onSuccess: () => {
      utils.abac.list.invalidate();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMut = trpc.abac.update.useMutation({
    onSuccess: () => {
      utils.abac.list.invalidate();
      onSuccess?.();
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMut.isPending || updateMut.isPending;

  function validate(): boolean {
    const next: Record<string, string> = {};
    const prioridadNum = Number(prioridad);
    if (!Number.isInteger(prioridadNum) || prioridadNum < 0 || prioridadNum > 10_000) {
      next.prioridad = "Entero entre 0 y 10000.";
    }
    if (descripcion.length > 500) next.descripcion = "Máximo 500 caracteres.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    const condiciones = filasACondiciones(filas);
    const prioridadNum = Number(prioridad);
    const descripcionTrim = descripcion.trim() === "" ? null : descripcion.trim();

    if (isEdit) {
      updateMut.mutate({
        id: initial!.id,
        recurso,
        accion,
        effect,
        prioridad: prioridadNum,
        descripcion: descripcionTrim,
        condiciones,
      });
    } else {
      createMut.mutate({
        recurso,
        accion,
        effect,
        prioridad: prioridadNum,
        descripcion: descripcionTrim ?? undefined,
        condiciones,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar regla ABAC" : "Nueva regla ABAC"}</DialogTitle>
          <DialogDescription>
            Reglas por organización. DENY siempre gana sobre ALLOW; sin regla
            que aplique, el acceso se permite (fail-safe).
          </DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <div className="grid grid-cols-2 gap-3">
            <FormField>
              <Label>Recurso</Label>
              <Select value={recurso} onValueChange={(v) => setRecurso(v as typeof recurso)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RECURSOS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label>Acción</Label>
              <Select value={accion} onValueChange={(v) => setAccion(v as typeof accion)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACCIONES.map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label>Efecto</Label>
              <Select value={effect} onValueChange={(v) => setEffect(v as "ALLOW" | "DENY")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALLOW">ALLOW</SelectItem>
                  <SelectItem value="DENY">DENY</SelectItem>
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="prioridad">Prioridad</Label>
              <Input
                id="prioridad"
                type="number"
                min={0}
                max={10_000}
                value={prioridad}
                onChange={(e) => setPrioridad(e.target.value)}
                aria-invalid={Boolean(errors.prioridad)}
              />
              <FormHint>Mayor prioridad se reporta primero entre reglas del mismo efecto.</FormHint>
              <FormError>{errors.prioridad}</FormError>
            </FormField>
          </div>

          <FormField>
            <Label htmlFor="descripcion">Descripción</Label>
            <Input
              id="descripcion"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Explica por qué existe esta regla"
              aria-invalid={Boolean(errors.descripcion)}
            />
            <FormError>{errors.descripcion}</FormError>
          </FormField>

          <FormField>
            <Label>Condiciones (AND)</Label>
            <AbacConditionEditor filas={filas} onChange={setFilas} />
          </FormField>

          {serverError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear regla"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
