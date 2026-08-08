"use client";

/**
 * CC-0016 — Tab «➕ Nueva Solicitud» (mockup view-solicitud).
 * Categorías + búsqueda (global opcional) + selección con chips (contraste/
 * nota/badges ayuno-autorización) + campos dinámicos según parametrización +
 * guardar (con modal PIN si la regla `firma` está habilitada).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import { Label } from "@his/ui/components/label";
import { Checkbox } from "@his/ui/components/checkbox";
import { Badge } from "@his/ui/components/badge";
import { Switch } from "@his/ui/components/switch";
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
import { FIELD_META, PRIO_LABEL_TO_VALUE } from "./field-rule-meta";

interface Seleccion {
  conContraste: boolean;
  nota: string;
}

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

export function NuevaSolicitud({
  cuentaId,
  onGuardado,
}: {
  cuentaId: string;
  onGuardado: (folio: string) => void;
}) {
  const utils = trpc.useUtils();
  const catalogoQ = trpc.imagingRequest.catalogoImagen.list.useQuery();
  const fieldConfigQ = trpc.imagingRequest.fieldConfig.list.useQuery();
  const rulesQ = trpc.imagingRequest.rules.list.useQuery();

  const catalogo = React.useMemo(() => catalogoQ.data ?? [], [catalogoQ.data]);
  const rulesMap = React.useMemo(
    () =>
      new Map<string, { enabled: boolean; valorNum: number | null }>(
        (rulesQ.data ?? []).map((r) => [r.ruleKey, r]),
      ),
    [rulesQ.data],
  );
  const fieldsOrdered = fieldConfigQ.data ?? [];

  const rule = (key: string) => rulesMap.get(key)?.enabled ?? false;
  const maxN = rulesMap.get("maxN")?.valorNum ?? 10;

  const panels = React.useMemo(() => {
    const byId = new Map<string, { panelId: string; nombre: string; displayOrder: number; count: number }>();
    for (const item of catalogo) {
      if (!item.panelActive) continue;
      const cur = byId.get(item.panelId);
      if (cur) cur.count++;
      else byId.set(item.panelId, { panelId: item.panelId, nombre: item.panelNombre, displayOrder: item.panelDisplayOrder, count: 1 });
    }
    return [...byId.values()].sort((a, b) => a.displayOrder - b.displayOrder);
  }, [catalogo]);

  const [activePanelId, setActivePanelId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!activePanelId && panels.length > 0) setActivePanelId(panels[0]!.panelId);
  }, [panels, activePanelId]);

  const [search, setSearch] = React.useState("");
  const [globalSearch, setGlobalSearch] = React.useState(false);
  const [seleccion, setSeleccion] = React.useState<Map<string, Seleccion>>(new Map());
  const [toast, setToast] = React.useState<ToastState>(null);
  const [pinModalOpen, setPinModalOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [fields, setFields] = React.useState<Record<string, string>>({});
  const [invalidFields, setInvalidFields] = React.useState<Set<string>>(new Set());

  const itemById = React.useMemo(() => new Map(catalogo.map((i) => [i.labTestId, i])), [catalogo]);

  const visibleItems: ImagingCatalogoItem[] = React.useMemo(() => {
    const q = search.trim().toUpperCase();
    const activos = catalogo.filter((i) => i.active && i.panelActive);
    if (globalSearch && q) return activos.filter((i) => i.name.includes(q));
    return activos.filter((i) => i.panelId === activePanelId && (!q || i.name.includes(q)));
  }, [catalogo, search, globalSearch, activePanelId]);

  function toggleSel(item: ImagingCatalogoItem, checked: boolean) {
    setSeleccion((prev) => {
      const next = new Map(prev);
      if (checked) {
        if (rule("maxN") && next.size >= maxN) {
          setToast({ title: `Límite de ${maxN} prestaciones por solicitud alcanzado`, variant: "destructive" });
          return prev;
        }
        if (!rule("multi")) {
          const otras = [...next.keys()].some((id) => itemById.get(id)?.panelId !== item.panelId);
          if (otras) {
            next.clear();
            setToast({ title: "Se limpió la selección: solo se permite una categoría por solicitud" });
          }
        }
        next.set(item.labTestId, { conContraste: item.requiereContraste, nota: "" });
      } else {
        next.delete(item.labTestId);
      }
      return next;
    });
  }

  function setChipField(id: string, patch: Partial<Seleccion>) {
    setSeleccion((prev) => {
      const cur = prev.get(id);
      if (!cur) return prev;
      const next = new Map(prev);
      next.set(id, { ...cur, ...patch });
      return next;
    });
  }

  function limpiar() {
    setSeleccion(new Map());
    setFields({});
    setInvalidFields(new Set());
  }

  const crear = trpc.imagingRequest.crear.useMutation({
    onSuccess: (data) => {
      utils.imagingRequest.listarPorCuenta.invalidate({ cuentaId });
      setToast({
        title: "Solicitud guardada correctamente",
        description: data.folio,
        variant: "success",
      });
      if (data.advertencias.length > 0) {
        // Se muestra como un segundo toast informativo (no bloqueante).
        setTimeout(() => setToast({ title: data.advertencias.join(" ") }), 50);
      }
      limpiar();
      setPinModalOpen(false);
      setPin("");
      onGuardado(data.folio);
    },
    onError: (err) => {
      setToast({ title: "No se pudo guardar la solicitud", description: err.message, variant: "destructive" });
      setPinModalOpen(false);
    },
  });

  function buildPayload(pinValue?: string) {
    const prestaciones = [...seleccion.entries()].map(([labTestId, s]) => ({
      labTestId,
      conContraste: s.conContraste,
      ...(s.nota.trim() ? { nota: s.nota.trim() } : {}),
    }));
    return {
      cuentaId,
      prestaciones,
      ...(fields.dx?.trim() ? { dx: fields.dx.trim() } : {}),
      ...(fields.just?.trim() ? { justificacion: fields.just.trim() } : {}),
      ...(fields.prio ? { prioridad: PRIO_LABEL_TO_VALUE[fields.prio] } : {}),
      ...(fields.fecha ? { fechaDeseada: new Date(fields.fecha) } : {}),
      ...(fields.embarazo?.trim() ? { embarazo: fields.embarazo.trim() } : {}),
      ...(fields.alergias?.trim() ? { alergias: fields.alergias.trim() } : {}),
      ...(fields.creat?.trim() ? { creatinina: fields.creat.trim() } : {}),
      ...(fields.obs?.trim() ? { observaciones: fields.obs.trim() } : {}),
      ...(pinValue ? { pin: pinValue } : {}),
    };
  }

  function onGuardar() {
    if (seleccion.size === 0) {
      setToast({ title: "Seleccione al menos una prestación", variant: "destructive" });
      return;
    }
    const faltantes = fieldsOrdered.filter((f) => f.estado === "obligatorio" && !fields[f.fieldKey]?.trim());
    if (faltantes.length > 0) {
      setInvalidFields(new Set(faltantes.map((f) => f.fieldKey)));
      setToast({ title: "Complete los campos obligatorios (*)", variant: "destructive" });
      return;
    }
    setInvalidFields(new Set());
    if (rule("firma")) {
      setPinModalOpen(true);
      return;
    }
    crear.mutate(buildPayload());
  }

  function confirmarFirma() {
    if (!pin.trim()) return;
    crear.mutate(buildPayload(pin.trim()));
  }

  const isLoadingCatalogo = catalogoQ.isLoading || fieldConfigQ.isLoading || rulesQ.isLoading;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm uppercase tracking-wide text-primary">
            Recepción / Tipo de estudio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {panels.map((p) => {
              const nSel = [...seleccion.keys()].filter((id) => itemById.get(id)?.panelId === p.panelId).length;
              return (
                <button
                  key={p.panelId}
                  type="button"
                  onClick={() => setActivePanelId(p.panelId)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                    activePanelId === p.panelId
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-input bg-background text-muted-foreground"
                  }`}
                >
                  {p.nombre} ({p.count}){nSel > 0 ? ` · ${nSel} ✓` : ""}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Input
              className="min-w-[260px] flex-1"
              placeholder="Buscar prestación… (ej. tórax, doppler, columna)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {rule("global") ? (
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={globalSearch} onCheckedChange={setGlobalSearch} aria-label="Buscar en todas las categorías" />
                Buscar en todas las categorías
              </label>
            ) : null}
          </div>

          {isLoadingCatalogo ? (
            <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
          ) : visibleItems.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Sin resultados.</p>
          ) : (
            <div className="grid max-h-[50vh] grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {visibleItems.map((item) => {
                const checked = seleccion.has(item.labTestId);
                return (
                  <label key={item.labTestId} className="flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox checked={checked} onCheckedChange={(c) => toggleSel(item, c)} className="mt-0.5" />
                    <span>
                      {rule("codigo") ? <span className="mr-1 font-mono text-xs text-muted-foreground">{item.code}</span> : null}
                      {item.name}
                      {globalSearch && search ? (
                        <Badge variant="outline" className="ml-1.5 text-[10px]">
                          {item.panelNombre}
                        </Badge>
                      ) : null}
                      {rule("flags") && item.requiereContraste ? (
                        <Badge variant="warning" className="ml-1 text-[10px]">
                          contraste
                        </Badge>
                      ) : null}
                      {rule("flags") && item.requiereAyuno ? (
                        <Badge variant="info" className="ml-1 text-[10px]">
                          ayuno
                        </Badge>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide text-primary">
              Solicitud actual {seleccion.size > 0 ? `— ${seleccion.size} prestación(es)` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {seleccion.size === 0 ? (
              <p className="text-sm text-muted-foreground">
                Aún no hay prestaciones seleccionadas. Marque los estudios en el listado.
              </p>
            ) : (
              [...seleccion.entries()].map(([id, s]) => {
                const item = itemById.get(id);
                if (!item) return null;
                return (
                  <div key={id} className="rounded-md border border-l-4 border-l-primary p-2 text-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{item.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.panelNombre} · {item.code} · {item.duracionMin} min
                        </p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Quitar ${item.name}`}
                        className="text-destructive"
                        onClick={() => toggleSel(item, false)}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {item.requiereContraste ? (
                        <label className="flex items-center gap-1 text-xs">
                          <Checkbox
                            checked={s.conContraste}
                            onCheckedChange={(c) => setChipField(id, { conContraste: c })}
                          />
                          con contraste
                        </label>
                      ) : null}
                      {item.requiereAyuno ? <Badge variant="info" className="text-[10px]">requiere ayuno</Badge> : null}
                      {item.requiereAutorizacion ? (
                        <Badge variant="warning" className="text-[10px]">requiere autorización</Badge>
                      ) : null}
                      <Input
                        className="h-7 flex-1 min-w-[120px] text-xs"
                        placeholder="Nota para este estudio…"
                        value={s.nota}
                        onChange={(e) => setChipField(id, { nota: e.target.value })}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm uppercase tracking-wide text-primary">Datos de la solicitud</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {fieldsOrdered
              .filter((f) => f.estado !== "oculto")
              .map((f) => {
                const meta = FIELD_META[f.fieldKey];
                const req = f.estado === "obligatorio";
                const invalid = invalidFields.has(f.fieldKey);
                const value = fields[f.fieldKey] ?? "";
                return (
                  <div key={f.fieldKey} className="space-y-1">
                    <Label htmlFor={`gf-${f.fieldKey}`}>
                      {meta.label} {req ? <span className="text-destructive">*</span> : null}
                    </Label>
                    {meta.tipo === "select" ? (
                      <Select
                        value={f.fieldKey === "prio" ? PRIO_LABEL_TO_VALUE[value] ? value : "" : value}
                        onValueChange={(v) => setFields((p) => ({ ...p, [f.fieldKey]: v }))}
                      >
                        <SelectTrigger id={`gf-${f.fieldKey}`} aria-invalid={invalid}>
                          <SelectValue placeholder="— Seleccione —" />
                        </SelectTrigger>
                        <SelectContent>
                          {meta.opts?.map((o) => (
                            <SelectItem key={o} value={o}>
                              {o}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : meta.tipo === "textarea" ? (
                      <Textarea
                        id={`gf-${f.fieldKey}`}
                        rows={2}
                        placeholder={meta.placeholder}
                        value={value}
                        aria-invalid={invalid}
                        onChange={(e) => setFields((p) => ({ ...p, [f.fieldKey]: e.target.value }))}
                      />
                    ) : (
                      <Input
                        id={`gf-${f.fieldKey}`}
                        type={meta.tipo === "date" ? "date" : "text"}
                        placeholder={meta.placeholder}
                        value={value}
                        aria-invalid={invalid}
                        onChange={(e) => setFields((p) => ({ ...p, [f.fieldKey]: e.target.value }))}
                      />
                    )}
                  </div>
                );
              })}

            <div className="flex items-center justify-between border-t pt-2 text-sm">
              <span>Prestaciones seleccionadas</span>
              <b>{seleccion.size}</b>
            </div>

            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={limpiar}>
                ✕ Cancelar
              </Button>
              <Button type="button" className="flex-1" onClick={onGuardar} disabled={crear.isPending}>
                {crear.isPending ? "Guardando…" : "💾 Guardar Prestaciones"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={pinModalOpen} onOpenChange={setPinModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firma electrónica</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Ingrese su PIN de firma electrónica para registrar la solicitud.
          </p>
          <div className="space-y-1">
            <Label htmlFor="pin-firma">PIN</Label>
            <Input
              id="pin-firma"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={8}
            />
          </div>
          {crear.error ? (
            <p role="alert" className="text-sm text-destructive">
              {crear.error.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPinModalOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirmarFirma} disabled={crear.isPending || !pin.trim()}>
              {crear.isPending ? "Firmando…" : "Firmar y guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
