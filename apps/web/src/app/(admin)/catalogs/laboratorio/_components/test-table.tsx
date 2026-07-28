"use client";

/**
 * CC-0011 WS-C — Detail: exámenes del panel seleccionado.
 *
 * Mismo criterio de solo-lectura para filas globales que `<PanelList>`. Un
 * examen nuevo puede crearse bajo un panel global (el examen creado queda con
 * organizationId=tenant — el server lo fuerza), solo la edición/desactivación
 * de exámenes ya-globales está bloqueada.
 *
 * Nota: el form omite `specimen`/`unit` (el schema los completa con default
 * "OTHER"/vacío) — no aportan al catálogo de solicitud de historia clínica
 * (Misceláneos), que solo consume nombre/orden. Ver `lis-catalogo.ts`.
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
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { EmptyState } from "@his/ui/components/states";
import { labTestCreateInput, labTestUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { GlobalLockButton } from "./global-lock-button";
import type { LabPanelRow } from "./panel-list";

interface LabTestRow {
  id: string;
  organizationId: string | null;
  panelId: string | null;
  code: string;
  name: string;
  displayOrder: number;
  active: boolean;
  /** CC-0013 — precio estándar del catálogo (Prisma Decimal → string en el wire). */
  standardPrice?: string | number | null;
}

/** CC-0013 — formatea standardPrice ($ 2 decimales) o "—" si no está definido. */
function formatPrecio(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return "—";
  return `$ ${n.toFixed(2)}`;
}

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

function extractFieldErrors(zodError: { errors: { path: (string | number)[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of zodError.errors) {
    const path = issue.path[0];
    if (typeof path === "string" && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

interface TestTableProps {
  panel: LabPanelRow | undefined;
}

export function TestTable({ panel }: TestTableProps) {
  const [showInactive, setShowInactive] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<LabTestRow | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);

  const utils = trpc.useUtils();
  const query = trpc.lis.test.list.useQuery(
    { panelId: panel?.id, activeOnly: !showInactive, limit: 200 },
    { enabled: Boolean(panel) },
  );

  const rows = React.useMemo(() => {
    const data = (query.data ?? []) as LabTestRow[];
    return [...data].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [query.data]);

  const deactivate = trpc.lis.test.deactivate.useMutation({
    onSuccess: () => {
      utils.lis.test.list.invalidate();
      setToast({ title: "Examen desactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const reactivate = trpc.lis.test.reactivate.useMutation({
    onSuccess: () => {
      utils.lis.test.list.invalidate();
      setToast({ title: "Examen reactivado", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openCreate = () => {
    setEditing(undefined);
    setDialogOpen(true);
  };
  const openEdit = (row: LabTestRow) => {
    setEditing(row);
    setDialogOpen(true);
  };

  if (!panel) {
    return (
      <Card>
        <CardContent className="pt-6">
          <EmptyState title="Selecciona un panel" description="Elige un panel de la lista para ver y administrar sus exámenes." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-base">Exámenes — {panel.name}</CardTitle>
          <p className="font-mono text-xs text-muted-foreground">{panel.code}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" aria-hidden="true" /> Nuevo examen
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
                <TableHead className="w-28">Código</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="w-16">Orden</TableHead>
                <TableHead className="w-24">Precio estándar</TableHead>
                <TableHead className="w-20">Origen</TableHead>
                <TableHead className="w-20">Estado</TableHead>
                <TableHead className="w-40 text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 && !query.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Sin exámenes en este panel.
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.map((row) => {
                const isGlobal = row.organizationId === null;
                return (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="tabular-nums">{row.displayOrder}</TableCell>
                    <TableCell className="tabular-nums">{formatPrecio(row.standardPrice)}</TableCell>
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

      <TestFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        panelId={panel.id}
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

interface TestFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panelId: string;
  initialValue?: LabTestRow;
  onToast: (t: ToastState) => void;
}

function TestFormDialog({ open, onOpenChange, panelId, initialValue, onToast }: TestFormDialogProps) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [displayOrder, setDisplayOrder] = React.useState("0");
  const [standardPrice, setStandardPrice] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCode(initialValue?.code ?? "");
    setName(initialValue?.name ?? "");
    setDisplayOrder(String(initialValue?.displayOrder ?? 0));
    setStandardPrice(
      initialValue?.standardPrice != null ? String(initialValue.standardPrice) : "",
    );
    setErrors({});
    setServerError(null);
  }, [open, initialValue]);

  const createMutation = trpc.lis.test.create.useMutation({
    onSuccess: () => {
      utils.lis.test.list.invalidate();
      onToast({ title: "Examen creado", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.test.update.useMutation({
    onSuccess: () => {
      utils.lis.test.list.invalidate();
      onToast({ title: "Examen actualizado", variant: "success" });
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
    // Campo vacío → sin cambio en create, limpia el precio en update (null).
    const standardPriceNum = standardPrice.trim() === "" ? undefined : Number(standardPrice);

    if (isEdit && initialValue) {
      const parsed = labTestUpdateInput.safeParse({
        id: initialValue.id,
        name,
        displayOrder: displayOrderNum,
        standardPrice: standardPriceNum ?? null,
      });
      if (!parsed.success) {
        setErrors(extractFieldErrors(parsed.error));
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labTestCreateInput.safeParse({
        panelId,
        code,
        name,
        displayOrder: displayOrderNum,
        ...(standardPriceNum !== undefined && { standardPrice: standardPriceNum }),
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
          <DialogTitle>{isEdit ? "Editar examen" : "Nuevo examen"}</DialogTitle>
          <DialogDescription>Examen del panel, disponible para solicitud desde historia clínica.</DialogDescription>
        </DialogHeader>

        <Form onSubmit={handleSubmit}>
          {!isEdit ? (
            <FormField>
              <Label htmlFor="test-code">
                Código <span className="text-destructive">*</span>
              </Label>
              <Input
                id="test-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="AVT-LAB-HEM-08"
                aria-invalid={Boolean(errors.code)}
              />
              <FormError>{errors.code}</FormError>
            </FormField>
          ) : null}

          <FormField>
            <Label htmlFor="test-name">
              Nombre <span className="text-destructive">*</span>
            </Label>
            <Input
              id="test-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Hemograma completo"
              aria-invalid={Boolean(errors.name)}
            />
            <FormError>{errors.name}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="test-order">Orden</Label>
            <Input
              id="test-order"
              type="number"
              min={0}
              max={999}
              value={displayOrder}
              onChange={(e) => setDisplayOrder(e.target.value)}
              aria-invalid={Boolean(errors.displayOrder)}
            />
            <FormError>{errors.displayOrder}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="test-price">
              Precio estándar{" "}
              <span className="text-xs text-muted-foreground">(opcional)</span>
            </Label>
            <Input
              id="test-price"
              type="number"
              min={0}
              step="0.01"
              value={standardPrice}
              onChange={(e) => setStandardPrice(e.target.value)}
              placeholder="0.00"
              aria-invalid={Boolean(errors.standardPrice)}
            />
            <FormError>{errors.standardPrice}</FormError>
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
