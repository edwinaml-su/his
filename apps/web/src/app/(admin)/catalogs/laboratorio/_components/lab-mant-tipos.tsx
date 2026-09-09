"use client";

/**
 * Rediseño lab 2026-09 — sub-tab "Tipos de muestra" del mantenimiento de
 * catálogos. `sampleType.create/update`. La desactivación (`active:false`) la
 * bloquea el backend con PRECONDITION_FAILED si tiene subtipos/pruebas
 * activos — se muestra el mensaje del servidor, sin duplicar la validación.
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
import { labSampleTypeCreateInput, labSampleTypeUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import type { CascadaSubtipo, CascadaTipo } from "./lab-maintenance";

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

interface TiposTabProps {
  tipos: CascadaTipo[];
  subtipos: CascadaSubtipo[];
  search: string;
  newSignal: number;
}

export function TiposTab({ tipos, subtipos, search, newSignal }: TiposTabProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CascadaTipo | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);
  const utils = trpc.useUtils();

  const subCountByTipo = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const s of subtipos) map.set(s.sampleTypeId, (map.get(s.sampleTypeId) ?? 0) + 1);
    return map;
  }, [subtipos]);

  const rows = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return tipos;
    return tipos.filter((t) => t.name.toUpperCase().includes(q));
  }, [tipos, search]);

  const prevSignal = React.useRef(newSignal);
  React.useEffect(() => {
    if (newSignal !== prevSignal.current) {
      prevSignal.current = newSignal;
      setEditing(undefined);
      setDialogOpen(true);
    }
  }, [newSignal]);

  const deactivate = trpc.lis.sampleType.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      setToast({ title: "Tipo de muestra desactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDelete = (row: CascadaTipo) => {
    if (!window.confirm(`¿Desactivar el tipo de muestra "${row.name}"?`)) return;
    deactivate.mutate({ id: row.id, active: false });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Tipo de muestra</TableHead>
              <TableHead className="w-24 text-center">Subtipos</TableHead>
              <TableHead className="w-24 text-center">Pruebas</TableHead>
              <TableHead className="w-44 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                  Sin resultados.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row, i) => (
              <TableRow key={row.id} data-testid="lab-mant-row">
                <TableCell className="text-center tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-center tabular-nums">{subCountByTipo.get(row.id) ?? 0}</TableCell>
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

      <TipoFormDialog open={dialogOpen} onOpenChange={setDialogOpen} initialValue={editing} onToast={setToast} />

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

interface TipoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: CascadaTipo;
  onToast: (t: ToastState) => void;
}

function TipoFormDialog({ open, onOpenChange, initialValue, onToast }: TipoFormDialogProps) {
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

  const createMutation = trpc.lis.sampleType.create.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Tipo de muestra creado", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.sampleType.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Tipo de muestra actualizado", variant: "success" });
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
      const parsed = labSampleTypeUpdateInput.safeParse({ id: initialValue.id, name });
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Nombre inválido.");
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labSampleTypeCreateInput.safeParse({ name });
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
          <DialogTitle>{isEdit ? "Editar tipo de muestra" : "Nuevo tipo de muestra"}</DialogTitle>
          <DialogDescription>Tipo de muestra del catálogo de laboratorio.</DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="tipo-nombre">
              Nombre del tipo de muestra <span className="text-destructive">*</span>
            </Label>
            <Input
              id="tipo-nombre"
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
