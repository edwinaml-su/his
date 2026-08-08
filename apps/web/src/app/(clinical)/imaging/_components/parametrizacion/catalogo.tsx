"use client";

/**
 * CC-0016 — Parametrización › «🩻 Catálogo de exámenes».
 * Tabla filtrable + modal código/categoría/nombre/duración/sala-equipo/
 * contraste/ayuno/autorización/activo/preparación (corrige el hueco del
 * mockup: sala SÍ se persiste vía `ImagingTestAttrs.modalityId`).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { Badge } from "@his/ui/components/badge";
import { Checkbox } from "@his/ui/components/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import type { ImagingCatalogoItem } from "@his/contracts";

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

export function Catalogo() {
  const utils = trpc.useUtils();
  const catalogoQ = trpc.imagingRequest.catalogoImagen.list.useQuery();
  const catalogo = React.useMemo(() => catalogoQ.data ?? [], [catalogoQ.data]);

  const panels = React.useMemo(() => {
    const byId = new Map<string, string>();
    for (const item of catalogo) byId.set(item.panelId, item.panelNombre);
    return [...byId.entries()].map(([id, nombre]) => ({ id, nombre }));
  }, [catalogo]);

  const [filtroPanel, setFiltroPanel] = React.useState("");
  const [filtroTxt, setFiltroTxt] = React.useState("");
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<ImagingCatalogoItem | undefined>(undefined);
  const [toast, setToast] = React.useState<ToastState>(null);

  const filtered = React.useMemo(() => {
    const q = filtroTxt.trim().toUpperCase();
    return catalogo.filter(
      (i) =>
        (!filtroPanel || i.panelId === filtroPanel) &&
        (!q || i.name.includes(q) || i.code.includes(q)),
    );
  }, [catalogo, filtroPanel, filtroTxt]);

  const toggleActivo = trpc.lis.test.deactivate.useMutation({
    onSuccess: () => utils.imagingRequest.catalogoImagen.list.invalidate(),
  });
  const reactivar = trpc.lis.test.reactivate.useMutation({
    onSuccess: () => utils.imagingRequest.catalogoImagen.list.invalidate(),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtroPanel || "all"} onValueChange={(v) => setFiltroPanel(v === "all" ? "" : v)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Todas las categorías" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {panels.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="max-w-xs"
          placeholder="Filtrar por nombre o código…"
          value={filtroTxt}
          onChange={(e) => setFiltroTxt(e.target.value)}
        />
        <span className="text-xs text-muted-foreground">
          {filtered.length} de {catalogo.length} prestaciones
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto"
          onClick={() => {
            setEditing(undefined);
            setDialogOpen(true);
          }}
        >
          + Nueva prestación
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Código</TableHead>
              <TableHead>Prestación</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Contraste</TableHead>
              <TableHead>Ayuno</TableHead>
              <TableHead>Duración</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.slice(0, 100).map((item) => (
              <TableRow key={item.labTestId}>
                <TableCell className="font-mono text-xs">{item.code}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell>{item.panelNombre}</TableCell>
                <TableCell>{item.requiereContraste ? "Sí" : "—"}</TableCell>
                <TableCell>{item.requiereAyuno ? "Sí" : "—"}</TableCell>
                <TableCell>{item.duracionMin} min</TableCell>
                <TableCell>
                  <Badge variant={item.active ? "success" : "outline"}>{item.active ? "Activa" : "Inactiva"}</Badge>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setEditing(item);
                      setDialogOpen(true);
                    }}
                  >
                    Editar
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      item.active
                        ? toggleActivo.mutate({ id: item.labTestId })
                        : reactivar.mutate({ id: item.labTestId })
                    }
                  >
                    {item.active ? "Desactivar" : "Activar"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {filtered.length > 100 ? (
          <p className="p-2 text-center text-xs text-muted-foreground">
            … {filtered.length - 100} prestaciones más (use el filtro para acotar)
          </p>
        ) : null}
      </div>

      <PrestacionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        panels={panels}
        initialValue={editing}
        defaultPanelId={filtroPanel || panels[0]?.id}
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

function PrestacionDialog({
  open,
  onOpenChange,
  panels,
  initialValue,
  defaultPanelId,
  onToast,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panels: { id: string; nombre: string }[];
  initialValue?: ImagingCatalogoItem;
  defaultPanelId?: string;
  onToast: (t: ToastState) => void;
}) {
  const isEdit = Boolean(initialValue);
  const utils = trpc.useUtils();
  const modalidadesQ = trpc.imaging.modality.list.useQuery({ activeOnly: true });

  const [codigo, setCodigo] = React.useState("");
  const [panelId, setPanelId] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [duracion, setDuracion] = React.useState("20");
  const [modalityId, setModalityId] = React.useState("");
  const [contraste, setContraste] = React.useState(false);
  const [ayuno, setAyuno] = React.useState(false);
  const [autoriz, setAutoriz] = React.useState(false);
  const [activo, setActivo] = React.useState(true);
  const [prep, setPrep] = React.useState("");
  const [serverError, setServerError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCodigo(initialValue?.code ?? "");
    setPanelId(initialValue?.panelId ?? defaultPanelId ?? "");
    setNombre(initialValue?.name ?? "");
    setDuracion(String(initialValue?.duracionMin ?? 20));
    setModalityId(initialValue?.modalityId ?? "");
    setContraste(initialValue?.requiereContraste ?? false);
    setAyuno(initialValue?.requiereAyuno ?? false);
    setAutoriz(initialValue?.requiereAutorizacion ?? false);
    setActivo(initialValue?.active ?? true);
    setPrep(initialValue?.preparacionPaciente ?? "");
    setServerError(null);
  }, [open, initialValue, defaultPanelId]);

  const upsert = trpc.imagingRequest.catalogoImagen.upsert.useMutation({
    onSuccess: () => {
      utils.imagingRequest.catalogoImagen.list.invalidate();
      onToast({ title: isEdit ? "Prestación actualizada" : "Prestación agregada al catálogo", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setServerError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!nombre.trim() || (!isEdit && !codigo.trim()) || !panelId) {
      setServerError("Código, categoría y nombre son obligatorios.");
      return;
    }
    upsert.mutate({
      ...(isEdit ? { labTestId: initialValue!.labTestId } : { code: codigo.trim().toUpperCase() }),
      panelId,
      name: nombre.trim().toUpperCase(),
      displayOrder: initialValue?.displayOrder ?? 0,
      duracionMin: Number(duracion) || 20,
      modalityId: modalityId || null,
      requiereContraste: contraste,
      requiereAyuno: ayuno,
      requiereAutorizacion: autoriz,
      active: activo,
      ...(prep.trim() ? { preparacionPaciente: prep.trim() } : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar prestación" : "Nueva prestación"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-codigo">
                Código <span className="text-destructive">*</span>
              </Label>
              <Input id="m-codigo" value={codigo} disabled={isEdit} onChange={(e) => setCodigo(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-cat">
                Categoría <span className="text-destructive">*</span>
              </Label>
              <Select value={panelId} onValueChange={setPanelId}>
                <SelectTrigger id="m-cat">
                  <SelectValue placeholder="Seleccione categoría" />
                </SelectTrigger>
                <SelectContent>
                  {panels.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-nombre">
              Nombre de la prestación <span className="text-destructive">*</span>
            </Label>
            <Input id="m-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="m-dur">Duración estimada (min)</Label>
              <Input
                id="m-dur"
                type="number"
                min={5}
                step={5}
                value={duracion}
                onChange={(e) => setDuracion(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="m-sala">Sala / Equipo</Label>
              <Select value={modalityId || "none"} onValueChange={(v) => setModalityId(v === "none" ? "" : v)}>
                <SelectTrigger id="m-sala">
                  <SelectValue placeholder="Sin asignar" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {(modalidadesQ.data ?? []).map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={contraste} onCheckedChange={setContraste} />
              Requiere medio de contraste (habilita verificación de creatinina y alergias)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={ayuno} onCheckedChange={setAyuno} />
              Requiere ayuno
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={autoriz} onCheckedChange={setAutoriz} />
              Requiere autorización previa (jefatura / aseguradora)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={activo} onCheckedChange={setActivo} />
              Prestación activa (visible en la pantalla de solicitud)
            </label>
          </div>

          <div className="space-y-1">
            <Label htmlFor="m-prep">Indicaciones de preparación para el paciente</Label>
            <Textarea
              id="m-prep"
              rows={3}
              placeholder="Ej.: Ayuno de 8 horas. Suspender metformina 48 h antes si se usa contraste…"
              value={prep}
              onChange={(e) => setPrep(e.target.value)}
            />
          </div>

          {serverError ? (
            <p role="alert" className="text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={upsert.isPending}>
              {upsert.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
