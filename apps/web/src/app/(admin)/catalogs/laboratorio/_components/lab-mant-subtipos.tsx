"use client";

/**
 * Rediseño lab 2026-09 — sub-tab "Subtipos de muestra" del mantenimiento de
 * catálogos. Tabla plana (# / Subtipo / Tipo / Pruebas / Acciones).
 * `sampleSubtype.create/update`, formulario con select de Tipo dependiente.
 * La desactivación la bloquea el backend (PRECONDITION_FAILED) si tiene
 * pruebas activas — se muestra el mensaje del servidor.
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { labSampleSubtypeCreateInput, labSampleSubtypeUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import type { CascadaSubtipo, CascadaTipo } from "./lab-maintenance";

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

interface SubtiposTabProps {
  tipos: CascadaTipo[];
  subtipos: CascadaSubtipo[];
  search: string;
  newSignal: number;
}

export function SubtiposTab({ tipos, subtipos, search, newSignal }: SubtiposTabProps) {
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CascadaSubtipo | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);
  const utils = trpc.useUtils();

  const tipoById = React.useMemo(() => new Map(tipos.map((t) => [t.id, t])), [tipos]);

  const rows = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return subtipos;
    return subtipos.filter(
      (s) => s.name.toUpperCase().includes(q) || (tipoById.get(s.sampleTypeId)?.name ?? "").toUpperCase().includes(q),
    );
  }, [subtipos, search, tipoById]);

  const prevSignal = React.useRef(newSignal);
  React.useEffect(() => {
    if (newSignal !== prevSignal.current) {
      prevSignal.current = newSignal;
      setEditing(undefined);
      setDialogOpen(true);
    }
  }, [newSignal]);

  const deactivate = trpc.lis.sampleSubtype.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      setToast({ title: "Subtipo desactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleDelete = (row: CascadaSubtipo) => {
    if (!window.confirm(`¿Desactivar el subtipo "${row.name}"?`)) return;
    deactivate.mutate({ id: row.id, active: false });
  };

  return (
    <div className="space-y-3">
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Subtipo de muestra</TableHead>
              <TableHead>Tipo de muestra</TableHead>
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
                <TableCell>{tipoById.get(row.sampleTypeId)?.name ?? "—"}</TableCell>
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

      <SubtipoFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tipos={tipos}
        initialValue={editing}
        onToast={setToast}
      />

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

interface SubtipoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tipos: CascadaTipo[];
  initialValue?: CascadaSubtipo;
  onToast: (t: ToastState) => void;
}

function SubtipoFormDialog({ open, onOpenChange, tipos, initialValue, onToast }: SubtipoFormDialogProps) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();
  const [name, setName] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(initialValue?.name ?? "");
    setTipoId(initialValue?.sampleTypeId ?? tipos[0]?.id ?? "");
    setError(null);
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValue]);

  const createMutation = trpc.lis.sampleSubtype.create.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Subtipo creado", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.sampleSubtype.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Subtipo actualizado", variant: "success" });
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
      const parsed = labSampleSubtypeUpdateInput.safeParse({ id: initialValue.id, name, sampleTypeId: tipoId });
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Datos inválidos.");
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labSampleSubtypeCreateInput.safeParse({ sampleTypeId: tipoId, name });
      if (!parsed.success) {
        setError(parsed.error.errors[0]?.message ?? "Datos inválidos.");
        return;
      }
      createMutation.mutate(parsed.data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar subtipo de muestra" : "Nuevo subtipo de muestra"}</DialogTitle>
          <DialogDescription>Subtipo de muestra, dependiente de un tipo.</DialogDescription>
        </DialogHeader>
        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="subtipo-nombre">
              Nombre del subtipo de muestra <span className="text-destructive">*</span>
            </Label>
            <Input
              id="subtipo-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={Boolean(error)}
            />
          </FormField>
          <FormField>
            <Label htmlFor="subtipo-tipo">
              Tipo de muestra <span className="text-destructive">*</span>
            </Label>
            <Select value={tipoId} onValueChange={setTipoId}>
              <SelectTrigger id="subtipo-tipo">
                <SelectValue placeholder="Seleccione tipo" />
              </SelectTrigger>
              <SelectContent>
                {tipos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
