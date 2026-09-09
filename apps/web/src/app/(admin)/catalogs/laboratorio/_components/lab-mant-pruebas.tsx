"use client";

/**
 * Rediseño lab 2026-09 — sub-tab "Pruebas" del mantenimiento de catálogos.
 * Tabla + filtro por sección + formulario cascada (Sección→Tipo→Subtipo) +
 * modal de parámetros. Ver `lab-maintenance.tsx` para el contrato de props
 * (`newSignal` = señal de "+ Nueva prueba" del toolbar compartido).
 *
 * `code` no aparece en el formulario (el mockup no lo pide — solo nombre,
 * sección, tipo, subtipo, cantidad). `LabTest.code` no tiene constraint unique
 * en schema.prisma (solo índice), así que se autogenera client-side con
 * prefijo `LABMANT-`, mismo criterio que `LABIMP-`/`SECIMP-` de `catalogo.import`.
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
import { labTestCreateInput, labTestUpdateInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { LabParamModal } from "./lab-param-modal";
import type { CascadaData, CascadaPrueba } from "./lab-maintenance";

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

function extractFieldErrors(zodError: { errors: { path: (string | number)[]; message: string }[] }) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of zodError.errors) {
    const path = issue.path[0];
    if (typeof path === "string" && !fieldErrors[path]) fieldErrors[path] = issue.message;
  }
  return fieldErrors;
}

/** CC-0013 — formatea standardPrice ($ 2 decimales) o "—" (mismo criterio que test-table.tsx). */
function formatPrecio(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$ ${Number(v).toFixed(2)}`;
}

function genCode(prefix: string): string {
  const rand = globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`.toUpperCase().slice(0, 20);
}

interface PruebasTabProps {
  data: CascadaData;
  search: string;
  newSignal: number;
}

export function PruebasTab({ data, search, newSignal }: PruebasTabProps) {
  const [filtroSeccion, setFiltroSeccion] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CascadaPrueba | undefined>(undefined);
  const [paramTest, setParamTest] = React.useState<CascadaPrueba | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);
  const utils = trpc.useUtils();

  const seccionById = React.useMemo(() => new Map(data.secciones.map((s) => [s.id, s])), [data.secciones]);
  const tipoById = React.useMemo(() => new Map(data.tipos.map((t) => [t.id, t])), [data.tipos]);
  const subtipoById = React.useMemo(() => new Map(data.subtipos.map((s) => [s.id, s])), [data.subtipos]);

  const rows = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    return data.pruebas.filter((p) => {
      if (filtroSeccion && p.panelId !== filtroSeccion) return false;
      if (!q) return true;
      const tipoName = (p.sampleTypeId && tipoById.get(p.sampleTypeId)?.name) || "";
      const subtipoName = (p.sampleSubtypeId && subtipoById.get(p.sampleSubtypeId)?.name) || "";
      return (
        p.name.toUpperCase().includes(q) ||
        tipoName.toUpperCase().includes(q) ||
        subtipoName.toUpperCase().includes(q)
      );
    });
  }, [data.pruebas, search, filtroSeccion, tipoById, subtipoById]);

  const prevSignal = React.useRef(newSignal);
  React.useEffect(() => {
    if (newSignal !== prevSignal.current) {
      prevSignal.current = newSignal;
      setEditing(undefined);
      setDialogOpen(true);
    }
  }, [newSignal]);

  const deactivate = trpc.lis.test.deactivate.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      setToast({ title: "Prueba desactivada", variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const openEdit = (row: CascadaPrueba) => {
    setEditing(row);
    setDialogOpen(true);
  };

  const handleDelete = (row: CascadaPrueba) => {
    if (
      !window.confirm(
        `¿Desactivar la prueba "${row.name}"? Se desactiva, no se elimina: el historial clínico la conserva.`,
      )
    )
      return;
    deactivate.mutate({ id: row.id });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor="lab-mant-filtro-seccion" className="text-xs text-muted-foreground">
          Sección
        </Label>
        <Select value={filtroSeccion || "ALL"} onValueChange={(v) => setFiltroSeccion(v === "ALL" ? "" : v)}>
          <SelectTrigger id="lab-mant-filtro-seccion" className="w-56">
            <SelectValue placeholder="Todas las secciones" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todas las secciones</SelectItem>
            {data.secciones.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead>Prueba</TableHead>
              <TableHead>Sección</TableHead>
              <TableHead>Tipo de muestra</TableHead>
              <TableHead>Subtipo de muestra</TableHead>
              <TableHead className="w-36 text-center">Parámetros</TableHead>
              <TableHead className="w-20 text-center">Cant. def.</TableHead>
              <TableHead className="w-28 text-right">Precio estándar</TableHead>
              <TableHead className="w-44 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                  Sin resultados.
                </TableCell>
              </TableRow>
            ) : null}
            {rows.map((row, i) => (
              <TableRow key={row.id} data-testid="lab-mant-row">
                <TableCell className="text-center tabular-nums">{i + 1}</TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>{row.panelId ? (seccionById.get(row.panelId)?.name ?? "—") : "—"}</TableCell>
                <TableCell>{row.sampleTypeId ? (tipoById.get(row.sampleTypeId)?.name ?? "—") : "—"}</TableCell>
                <TableCell>
                  {row.sampleSubtypeId ? (subtipoById.get(row.sampleSubtypeId)?.name ?? "—") : "—"}
                </TableCell>
                <TableCell className="text-center">
                  <Button size="sm" variant="outline" onClick={() => setParamTest(row)}>
                    {row.paramCount} · Configurar
                  </Button>
                </TableCell>
                <TableCell className="text-center tabular-nums">{row.defaultQty}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPrecio(row.standardPrice)}</TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEdit(row)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      title="Se desactiva, no se elimina."
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

      <PruebaFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        data={data}
        initialValue={editing}
        onToast={setToast}
      />

      {paramTest ? (
        <LabParamModal
          open={Boolean(paramTest)}
          onOpenChange={(open) => !open && setParamTest(undefined)}
          testId={paramTest.id}
          testName={paramTest.name}
        />
      ) : null}

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

interface PruebaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: CascadaData;
  initialValue?: CascadaPrueba;
  onToast: (t: ToastState) => void;
}

function PruebaFormDialog({ open, onOpenChange, data, initialValue, onToast }: PruebaFormDialogProps) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();

  const [name, setName] = React.useState("");
  const [seccionId, setSeccionId] = React.useState("");
  const [tipoId, setTipoId] = React.useState("");
  const [subtipoId, setSubtipoId] = React.useState("");
  const [cant, setCant] = React.useState("1");
  const [precio, setPrecio] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const defaultSeccion = initialValue?.panelId ?? data.secciones[0]?.id ?? "";
    const defaultTipo = initialValue?.sampleTypeId ?? data.tipos[0]?.id ?? "";
    const subtiposDeTipo = data.subtipos.filter((s) => s.sampleTypeId === defaultTipo);
    const defaultSubtipo = initialValue?.sampleSubtypeId ?? subtiposDeTipo[0]?.id ?? "";
    setName(initialValue?.name ?? "");
    setSeccionId(defaultSeccion);
    setTipoId(defaultTipo);
    setSubtipoId(defaultSubtipo);
    setCant(String(initialValue?.defaultQty ?? 1));
    setPrecio(initialValue?.standardPrice != null ? String(initialValue.standardPrice) : "");
    setErrors({});
    setServerError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialValue]);

  const subtipoOptions = React.useMemo(
    () => data.subtipos.filter((s) => s.sampleTypeId === tipoId),
    [data.subtipos, tipoId],
  );

  const handleTipoChange = (value: string) => {
    setTipoId(value);
    const options = data.subtipos.filter((s) => s.sampleTypeId === value);
    setSubtipoId(options[0]?.id ?? "");
  };

  const createMutation = trpc.lis.test.create.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Prueba creada", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });
  const updateMutation = trpc.lis.test.update.useMutation({
    onSuccess: () => {
      utils.lis.catalog.cascada.invalidate();
      onToast({ title: "Prueba actualizada", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    setErrors({});

    // Igual que el mockup (`guardarPrueba`): cantidad inválida se corrige a 1
    // en vez de bloquear el guardado.
    let cantNum = Number.parseInt(cant, 10);
    if (Number.isNaN(cantNum) || cantNum < 1) cantNum = 1;

    // Precio estándar (CC-0013, requerimiento 2026-09-09): vacío = sin precio.
    // En edición, vaciar el campo LIMPIA el precio (null); el contrato de
    // update lo acepta nullable.
    const precioTrim = precio.trim();
    const precioNum = precioTrim === "" ? null : Number(precioTrim);
    if (precioNum !== null && (Number.isNaN(precioNum) || precioNum < 0)) {
      setErrors({ standardPrice: "Precio inválido — número ≥ 0 o vacío." });
      return;
    }

    if (isEdit && initialValue) {
      const parsed = labTestUpdateInput.safeParse({
        id: initialValue.id,
        name,
        panelId: seccionId || undefined,
        sampleTypeId: tipoId || undefined,
        sampleSubtypeId: subtipoId || undefined,
        defaultQty: cantNum,
        standardPrice: precioNum,
      });
      if (!parsed.success) {
        setErrors(extractFieldErrors(parsed.error));
        return;
      }
      updateMutation.mutate(parsed.data);
    } else {
      const parsed = labTestCreateInput.safeParse({
        panelId: seccionId,
        code: genCode("LABMANT"),
        name,
        sampleTypeId: tipoId || undefined,
        sampleSubtypeId: subtipoId || undefined,
        defaultQty: cantNum,
        standardPrice: precioNum ?? undefined,
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
          <DialogTitle>{isEdit ? "Editar prueba" : "Nueva prueba"}</DialogTitle>
          <DialogDescription>Prueba del catálogo de laboratorio.</DialogDescription>
        </DialogHeader>

        <Form onSubmit={handleSubmit}>
          <FormField>
            <Label htmlFor="prueba-nombre">
              Nombre de la prueba <span className="text-destructive">*</span>
            </Label>
            <Input
              id="prueba-nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: GLUCOSA"
              aria-invalid={Boolean(errors.name)}
            />
            <FormError>{errors.name}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="prueba-seccion">
              Sección <span className="text-destructive">*</span>
            </Label>
            <Select value={seccionId} onValueChange={setSeccionId}>
              <SelectTrigger id="prueba-seccion" aria-invalid={Boolean(errors.panelId)}>
                <SelectValue placeholder="Seleccione sección" />
              </SelectTrigger>
              <SelectContent>
                {data.secciones.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormError>{errors.panelId}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="prueba-tipo">Tipo de muestra</Label>
            <Select value={tipoId} onValueChange={handleTipoChange}>
              <SelectTrigger id="prueba-tipo">
                <SelectValue placeholder="Seleccione tipo" />
              </SelectTrigger>
              <SelectContent>
                {data.tipos.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField>
            <Label htmlFor="prueba-subtipo">Subtipo de muestra</Label>
            <Select value={subtipoId} onValueChange={setSubtipoId} disabled={subtipoOptions.length === 0}>
              <SelectTrigger id="prueba-subtipo">
                <SelectValue placeholder="Seleccione subtipo" />
              </SelectTrigger>
              <SelectContent>
                {subtipoOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField>
            <Label htmlFor="prueba-cant">Cantidad por defecto</Label>
            <Input
              id="prueba-cant"
              type="number"
              min={1}
              step={1}
              value={cant}
              onChange={(e) => setCant(e.target.value)}
              aria-invalid={Boolean(errors.defaultQty)}
            />
            <FormError>{errors.defaultQty}</FormError>
          </FormField>

          <FormField>
            <Label htmlFor="prueba-precio">Precio estándar (US$)</Label>
            <Input
              id="prueba-precio"
              type="number"
              min={0}
              step="0.01"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder="Ej.: 12.50 — vacío = sin precio"
              aria-invalid={Boolean(errors.standardPrice)}
              data-no-uppercase
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
              {isSubmitting ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
