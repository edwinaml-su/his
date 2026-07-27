"use client";

/**
 * CC-0011 WS-C — Master: lista de paneles del catálogo LIS por área.
 *
 * Lectura híbrida (global + tenant) vía `trpc.lis.panel.list` (sin filtro de
 * área en el server — se filtra client-side, igual criterio que
 * `lis.test.listByArea` usa server-side para el wizard clínico). CRUD
 * (crear/editar/desactivar/reactivar) restringido a filas del tenant: las
 * globales (organizationId=null, seed AVT-*) muestran acciones deshabilitadas
 * con tooltip vía `<GlobalLockButton>`.
 */
import * as React from "react";
import { Plus } from "lucide-react";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Form, FormField, FormError } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { cn } from "@his/ui/lib/utils";
import { labPanelCreateInput, labPanelUpdateInput, labCatalogAreaEnum, type LabCatalogArea } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { GlobalLockButton } from "./global-lock-button";

export interface LabPanelRow {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  area: string;
  displayOrder: number;
  active: boolean;
}

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

export const AREA_LABEL: Record<LabCatalogArea, string> = {
  LABORATORIO: "Laboratorio",
  RADIOLOGIA: "Radiología",
  CARDIOLOGIA: "Cardiología",
};

const AREA_OPTIONS = labCatalogAreaEnum.options;

/** Extrae el primer mensaje de error por campo de un ZodError (path[0] string). */
function extractFieldErrors(zodError: { errors: { path: (string | number)[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of zodError.errors) {
    const path = issue.path[0];
    if (typeof path === "string" && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

interface PanelListProps {
  area: LabCatalogArea;
  selectedPanelId: string | null;
  onSelect: (panel: LabPanelRow) => void;
}

export function PanelList({ area, selectedPanelId, onSelect }: PanelListProps) {
  const [showInactive, setShowInactive] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LabPanelRow | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);

  const utils = trpc.useUtils();
  const query = trpc.lis.panel.list.useQuery({ activeOnly: !showInactive, limit: 200 });

  const rows = React.useMemo(() => {
    const data = (query.data ?? []) as LabPanelRow[];
    return data.filter((p) => p.area === area).sort((a, b) => a.displayOrder - b.displayOrder);
  }, [query.data, area]);

  // Auto-selecciona el primer panel del área cuando cambia el área activa
  // o cuando la selección actual deja de existir en la lista filtrada.
  React.useEffect(() => {
    const [first] = rows;
    if (!first) return;
    if (!rows.some((p) => p.id === selectedPanelId)) {
      onSelect(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedPanelId]);

  const deactivate = trpc.lis.panel.deactivate.useMutation({
    onSuccess: () => {
      utils.lis.panel.list.invalidate();
      setToast({ title: "Panel desactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const reactivate = trpc.lis.panel.reactivate.useMutation({
    onSuccess: () => {
      utils.lis.panel.list.invalidate();
      setToast({ title: "Panel reactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (row: LabPanelRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-base">Paneles — {AREA_LABEL[area]}</CardTitle>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Nuevo panel
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Mostrar inactivos
        </label>

        {query.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Error: {query.error.message}
          </p>
        ) : null}

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24">Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-16">Orden</TableHead>
                <TableHead className="w-20">Origen</TableHead>
                <TableHead className="w-20">Estado</TableHead>
                <TableHead className="w-40 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Sin paneles en esta área.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => {
                const isGlobal = row.organizationId === null;
                const isSelected = row.id === selectedPanelId;
                return (
                  <TableRow
                    key={row.id}
                    aria-current={isSelected ? "true" : undefined}
                    className={cn(isSelected && "bg-accent/50")}
                  >
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>
                      <button
                        type="button"
                        onClick={() => onSelect(row)}
                        className="text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {row.name}
                      </button>
                    </TableCell>
                    <TableCell className="tabular-nums">{row.displayOrder}</TableCell>
                    <TableCell>
                      {isGlobal ? <Badge variant="outline">Global</Badge> : <Badge variant="secondary">Propio</Badge>}
                    </TableCell>
                    <TableCell>
                      {row.active ? <Badge variant="success">Activo</Badge> : <Badge variant="outline">Inactivo</Badge>}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-2">
                        <GlobalLockButton isGlobal={isGlobal} size="sm" variant="outline" onClick={() => openEdit(row)}>
                          Editar
                        </GlobalLockButton>
                        {row.active ? (
                          <GlobalLockButton
                            isGlobal={isGlobal}
                            size="sm"
                            variant="outline"
                            onClick={() => deactivate.mutate({ id: row.id })}
                            disabled={deactivate.isPending}
                          >
                            Desactivar
                          </GlobalLockButton>
                        ) : (
                          <GlobalLockButton
                            isGlobal={isGlobal}
                            size="sm"
                            variant="outline"
                            onClick={() => reactivate.mutate({ id: row.id })}
                            disabled={reactivate.isPending}
                          >
                            Reactivar
                          </GlobalLockButton>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>

      <PanelFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        area={area}
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
    </Card>
  );
}

interface PanelFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: LabCatalogArea;
  initialValue?: LabPanelRow;
  onToast: (t: ToastState) => void;
}

function PanelFormDialog({ open, onOpenChange, area, initialValue, onToast }: PanelFormDialogProps) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [selectedArea, setSelectedArea] = React.useState<LabCatalogArea>(area);
  const [displayOrder, setDisplayOrder] = React.useState("0");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode(initialValue?.code ?? "");
    setName(initialValue?.name ?? "");
    setSelectedArea((initialValue?.area as LabCatalogArea | undefined) ?? area);
    setDisplayOrder(String(initialValue?.displayOrder ?? 0));
    setErrors({});
    setServerError(null);
  }, [open, initialValue, area]);

  const createMutation = trpc.lis.panel.create.useMutation({
    onSuccess: () => {
      utils.lis.panel.list.invalidate();
      onToast({ title: "Panel creado", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.panel.update.useMutation({
    onSuccess: () => {
      utils.lis.panel.list.invalidate();
      onToast({ title: "Panel actualizado", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    const displayOrderNum = Number(displayOrder);

    if (isEdit && initialValue) {
      const parsed = labPanelUpdateInput.safeParse({
        id: initialValue.id,
        name,
        area: selectedArea,
        displayOrder: displayOrderNum,
      });
      if (!parsed.success) {
        setErrors(extractFieldErrors(parsed.error));
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labPanelCreateInput.safeParse({
        code,
        name,
        area: selectedArea,
        displayOrder: displayOrderNum,
      });
      if (!parsed.success) {
        setErrors(extractFieldErrors(parsed.error));
        return;
      }
      createMutation.mutate(parsed.data);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar panel" : "Nuevo panel"}</DialogTitle>
          <DialogDescription>
            Panel del catálogo de exámenes (Misceláneos, historia clínica).
          </DialogDescription>
        </DialogHeader>

        <Form onSubmit={handleSubmit}>
          {!isEdit ? (
            <FormField>
              <Label htmlFor="panel-code">
                Código <span className="text-destructive">*</span>
              </Label>
              <Input
                id="panel-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="AVT-LAB-HEM"
                aria-invalid={Boolean(errors.code)}
              />
              <FormError>{errors.code}</FormError>
            </FormField>
          ) : null}

          <FormField>
            <Label htmlFor="panel-name">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="panel-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hematología y coagulación"
              aria-invalid={Boolean(errors.name)}
            />
            <FormError>{errors.name}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="panel-area">
              Área <span className="text-destructive">*</span>
            </Label>
            <Select value={selectedArea} onValueChange={(v) => setSelectedArea(v as LabCatalogArea)}>
              <SelectTrigger id="panel-area" aria-invalid={Boolean(errors.area)}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AREA_OPTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {AREA_LABEL[a]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormError>{errors.area}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="panel-order">Orden</Label>
            <Input
              id="panel-order"
              type="number"
              min={0}
              max={999}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              aria-invalid={Boolean(errors.displayOrder)}
            />
            <FormError>{errors.displayOrder}</FormError>
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
              {isSubmitting ? "Guardando…" : isEdit ? "Guardar cambios" : "Crear"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
