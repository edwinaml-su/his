"use client";

/**
 * Rediseño lab 2026-09 — sub-tab "Secciones" del mantenimiento de catálogos.
 * `panel.create/update` (área LABORATORIO forzada). `code` no lo pide el
 * mockup (solo Nombre) — se autogenera client-side (`SECMANT-`), igual
 * criterio que `PruebasTab` (ver ese archivo para el porqué).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Form, FormField, FormError } from "@his/ui/components/form";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { labPanelCreateInput, labPanelUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import type { CascadaSeccion } from "./lab-maintenance";

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

function genCode(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`.toUpperCase().slice(0, 20);
}

interface SeccionesTabProps {
  secciones: CascadaSeccion[];
  search: string;
  newSignal: number;
}

export function SeccionesTab({ secciones, search, newSignal }: SeccionesTabProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CascadaSeccion | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);
  const utils = trpc.useUtils();

  const rows = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return secciones;
    return secciones.filter((s) => s.name.toUpperCase().includes(q));
  }, [secciones, search]);

  const prevSignal = React.useRef(newSignal);
  React.useEffect(() => {
    if (newSignal !== prevSignal.current) {
      prevSignal.current = newSignal;
      setEditing(undefined);
      setDialogOpen(true);
    }
  }, [newSignal]);

  const deactivate = trpc.lis.panel.deactivate.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      setToast({ title: "Sección desactivada", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDelete = (row: CascadaSeccion) => {
    // `panel.deactivate` no bloquea por uso (a diferencia de sampleType/sampleSubtype)
    // — se advierte el conteo client-side y se procede igual, sin tocar el router.
    const usoMsg = row.testCount > 0 ? ` Tiene ${row.testCount} prueba(s) activa(s) usando esta sección.` : "";
    if (!window.confirm(`¿Desactivar la sección "${row.name}"?${usoMsg}`)) return;
    deactivate.mutate({ id: row.id });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Sección</TableHead>
              <TableHead className="w-24 text-center">Pruebas</TableHead>
              <TableHead className="w-44 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  Sin resultados.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row, i) => (
              <TableRow key={row.id} data-testid="lab-mant-row">
                <TableCell className="text-center tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-center tabular-nums">{row.testCount}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(row);
                        setDialogOpen(true);
                      }}
                    >
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDelete(row)}
                      disabled={deactivate.isPending}
                    >
                      Eliminar
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <SeccionFormDialog open={dialogOpen} onOpenChange={setDialogOpen} initialValue={editing} onToast={setToast} />

      {toast ? (
        <Toast variant={toast.variant ?? "default"} open onOpenChange={(o) => !o && setToast(null)}>
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}

interface SeccionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: CascadaSeccion;
  onToast: (t: ToastState) => void;
}

function SeccionFormDialog({ open, onOpenChange, initialValue, onToast }: SeccionFormDialogProps) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initialValue?.name ?? "");
    setError(null);
    setServerError(null);
  }, [open, initialValue]);

  const createMutation = trpc.lis.panel.create.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Sección creada", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.panel.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Sección actualizada", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setError(null);

    if (isEdit && initialValue) {
      const parsed = labPanelUpdateInput.safeParse({ id: initialValue.id, name });
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Nombre inválido.");
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labPanelCreateInput.safeParse({
        code: genCode("SECMANT"),
        name,
        area: "LABORATORIO",
      });
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Nombre inválido.");
        return;
      }
      createMutation.mutate(parsed.data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar sección" : "Nueva sección"}</DialogTitle>
          <DialogDescription>Sección del catálogo de laboratorio.</DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="seccion-nombre">
              Nombre de la sección <span className="text-destructive">*</span>
            </Label>
            <Input
              id="seccion-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(error)}
            />
            <FormError>{error}</FormError>
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
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
