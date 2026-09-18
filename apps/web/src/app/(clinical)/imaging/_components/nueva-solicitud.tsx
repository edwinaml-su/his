"use client";

/**
 * CC-0016 — Tab «➕ Nueva Solicitud» (mockup view-solicitud).
 * CC-0041 (mockup v2): dx CIE-11 desde el expediente (selector agrupado por
 * fuente + «Otro» con BuscadorCie11), prioridad segmentada con colores
 * (STAT rojo / Urgente amarillo / Rutina verde) + hook STAT, fecha visible
 * solo con Rutina, embarazo obligatorio con «No aplica» automático por sexo,
 * alergias solo lectura desde la Historia Clínica, creatinina con rótulo
 * dinámico si hay contraste, y «Buscar por Nombre» estandarizado con el
 * módulo de Laboratorio (insensible a tildes).
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
  SelectGroup,
  SelectItem,
  SelectLabel,
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
import { BuscadorCie11 } from "@/components/cie11/BuscadorCie11";
import type { ImagingCatalogoItem } from "@his/contracts";
import { FIELD_META, PRIO_LABEL_TO_VALUE, PRIO_SEGMENT } from "./field-rule-meta";

interface Seleccion {
  conContraste: boolean;
  nota: string;
}

/** CC-0041 RF-03 — dx elegido del expediente (o digitado con BuscadorCie11). */
interface DxSeleccion {
  codigo: string | null;
  descripcion: string;
  sistema: "CIE10" | "CIE11" | null;
  fuente: string;
  origenId: string | null;
}

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

/** Estándar Laboratorio — búsqueda insensible a mayúsculas y tildes (mockup v2 `norm`). */
const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase();

const DX_OTRO = "__OTRO__";

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
  // CC-0041 RF-03/06/07 — sexo, alergias y diagnósticos del expediente.
  const expedienteQ = trpc.imagingRequest.contextoExpediente.useQuery({ cuentaId });

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

  const sexoM = expedienteQ.data?.sexo === "M";
  const alergiasHc = expedienteQ.data?.alergias ?? null;
  const diagnosticos = React.useMemo(() => expedienteQ.data?.diagnosticos ?? [], [expedienteQ.data]);
  const dxFuentes = React.useMemo(() => [...new Set(diagnosticos.map((d) => d.fuente))], [diagnosticos]);

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
  const [dxSel, setDxSel] = React.useState<DxSeleccion | null>(null);
  const [dxOtroActivo, setDxOtroActivo] = React.useState(false);

  // RF-06 — paciente masculino: «No aplica» automático y bloqueado.
  React.useEffect(() => {
    if (sexoM) setFields((p) => (p.embarazo === "No aplica" ? p : { ...p, embarazo: "No aplica" }));
  }, [sexoM]);

  const itemById = React.useMemo(() => new Map(catalogo.map((i) => [i.labTestId, i])), [catalogo]);

  const visibleItems: ImagingCatalogoItem[] = React.useMemo(() => {
    const q = norm(search.trim());
    const activos = catalogo.filter((i) => i.active && i.panelActive);
    // RF-02 — «Buscar por Nombre» activo: busca en TODAS las categorías,
    // insensible a tildes; sin query no lista nada (mensaje guía abajo).
    if (globalSearch) return q ? activos.filter((i) => norm(i.name).includes(q)) : [];
    return activos.filter((i) => i.panelId === activePanelId && (!q || norm(i.name).includes(q)));
  }, [catalogo, search, globalSearch, activePanelId]);

  // RF-08 — hay al menos una prestación con contraste en la solicitud.
  const hayContraste = [...seleccion.values()].some((s) => s.conContraste);

  const prioActual = fields.prio ?? "";
  const fechaCfg = fieldsOrdered.find((f) => f.fieldKey === "fecha");
  // RF-05 — la fecha solo existe con prioridad Rutina (y no oculta).
  const fechaVisible = prioActual === "Rutina" && fechaCfg?.estado !== "oculto";

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
    setFields(sexoM ? { embarazo: "No aplica" } : {});
    setDxSel(null);
    setDxOtroActivo(false);
    setInvalidFields(new Set());
  }

  // RF-04/RF-05 — prioridad segmentada; al salir de Rutina se limpia la fecha.
  function setPrio(label: "Rutina" | "Urgente" | "STAT") {
    setFields((p) => {
      // Al salir de Rutina la fecha se descarta (RF-05).
      const { fecha: _descartada, ...rest } = p;
      return label === "Rutina" ? { ...p, prio: label } : { ...rest, prio: label };
    });
    setInvalidFields((prev) => {
      if (!prev.has("prio")) return prev;
      const next = new Set(prev);
      next.delete("prio");
      return next;
    });
    if (label === "STAT") {
      setToast({ title: "🔴 Prioridad STAT: se notificará de inmediato a Imagenología" });
    }
  }

  function onDxChange(value: string) {
    if (value === DX_OTRO) {
      setDxOtroActivo(true);
      setDxSel(null);
      return;
    }
    setDxOtroActivo(false);
    const idx = Number.parseInt(value, 10);
    const d = diagnosticos[idx];
    if (d) setDxSel({ ...d });
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
    const dxTexto = dxSel ? `${dxSel.codigo ? `${dxSel.codigo} — ` : ""}${dxSel.descripcion}` : "";
    return {
      cuentaId,
      prestaciones,
      // RF-03 — dx copiado del expediente con trazabilidad (o «Otro» manual).
      ...(dxTexto ? { dx: dxTexto.slice(0, 300) } : {}),
      ...(dxSel?.sistema ? { dxSistema: dxSel.sistema } : {}),
      ...(dxSel ? { dxFuente: dxSel.fuente } : {}),
      ...(dxSel?.origenId ? { dxOrigenId: dxSel.origenId } : {}),
      ...(fields.just?.trim() ? { justificacion: fields.just.trim() } : {}),
      ...(fields.prio ? { prioridad: PRIO_LABEL_TO_VALUE[fields.prio] } : {}),
      // RF-05 — solo Rutina lleva fecha (el server también lo valida).
      ...(fechaVisible && fields.fecha ? { fechaDeseada: new Date(`${fields.fecha}T00:00:00`) } : {}),
      ...(fields.embarazo?.trim()
        ? { embarazo: fields.embarazo.trim() as "No aplica" | "No" | "Sí" | "Se desconoce" }
        : {}),
      // RF-07 — alergias NO se envían: el server toma el snapshot de la HC.
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
    // Campos obligatorios según parametrización. `alergias` se satisface con
    // el snapshot de HC (server-side); `fecha` no aplica fuera de Rutina;
    // `dx` se valida contra la selección del expediente.
    const faltantes = fieldsOrdered.filter((f) => {
      if (f.estado !== "obligatorio") return false;
      if (f.fieldKey === "alergias") return false;
      if (f.fieldKey === "fecha" && prioActual !== "Rutina") return false;
      if (f.fieldKey === "dx") return !dxSel;
      return !fields[f.fieldKey]?.trim();
    });
    if (faltantes.length > 0) {
      setInvalidFields(new Set(faltantes.map((f) => f.fieldKey)));
      setToast({ title: "Complete los campos obligatorios (*)", variant: "destructive" });
      return;
    }
    // RF-08 — creatinina obligatoria si hay contraste, aunque esté Opcional.
    // Con el campo OCULTO en parametrización el input no existe: el mensaje
    // señala la parametrización (hallazgo pre-PR: no pedir llenar un campo
    // invisible). El server valida lo mismo.
    if (hayContraste && !fields.creat?.trim()) {
      const creatOculta = fieldsOrdered.find((f) => f.fieldKey === "creat")?.estado === "oculto";
      setInvalidFields(creatOculta ? new Set<string>() : new Set(["creat"]));
      setToast({
        title: creatOculta
          ? "⚠ Hay estudios con contraste pero el campo creatinina está oculto en parametrización"
          : "La creatinina sérica es obligatoria: hay estudios con medio de contraste",
        variant: "destructive",
      });
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
  // Fecha local del navegador (NO toISOString: en UTC-6 bloqueaba "hoy"
  // desde las 18:00 — lección HH-07). en-CA ⇒ YYYY-MM-DD.
  const hoyIso = new Date().toLocaleDateString("en-CA");

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
            {rule("global") ? (
              <label
                className="flex items-center gap-2 text-xs text-muted-foreground"
                title="Búsqueda estandarizada — idéntica al módulo de Laboratorio Clínico"
              >
                <Switch checked={globalSearch} onCheckedChange={setGlobalSearch} aria-label="Buscar por Nombre" />
                <b>Buscar por Nombre</b>
              </label>
            ) : null}
            <Input
              className="min-w-[260px] flex-1"
              placeholder="Escriba el nombre de la prestación… (ej. torax, doppler, columna)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoadingCatalogo ? (
            <p className="text-sm text-muted-foreground">Cargando catálogo…</p>
          ) : globalSearch && !search.trim() ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              ✒ Escriba el nombre de la prestación para buscar en todas las categorías
              <br />
              (búsqueda estandarizada con el módulo de Laboratorio).
            </p>
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
              .filter((f) => f.fieldKey !== "fecha" || fechaVisible)
              .map((f) => {
                const meta = FIELD_META[f.fieldKey];
                const req = f.estado === "obligatorio";
                const invalid = invalidFields.has(f.fieldKey);
                const value = fields[f.fieldKey] ?? "";

                // --- RF-03: dx desde el expediente + «Otro» (BuscadorCie11) ---
                if (f.fieldKey === "dx") {
                  return (
                    <div key="dx" className="space-y-1">
                      <Label htmlFor="gf-dx">
                        {meta.label} {req ? <span className="text-destructive">*</span> : null}{" "}
                        <Badge variant="outline" className="text-[10px]">🔗 del Expediente</Badge>
                      </Label>
                      <Select
                        value={
                          dxOtroActivo
                            ? DX_OTRO
                            : dxSel
                              ? String(diagnosticos.findIndex(
                                  (d) => d.descripcion === dxSel.descripcion && d.fuente === dxSel.fuente,
                                ))
                              : ""
                        }
                        onValueChange={onDxChange}
                      >
                        <SelectTrigger id="gf-dx" aria-invalid={invalid} data-testid="img-dx-select">
                          <SelectValue placeholder="— Seleccione diagnóstico del expediente —" />
                        </SelectTrigger>
                        <SelectContent>
                          {dxFuentes.map((fuente) => (
                            <SelectGroup key={fuente}>
                              <SelectLabel>{fuente}</SelectLabel>
                              {diagnosticos.map((d, i) =>
                                d.fuente === fuente ? (
                                  <SelectItem key={i} value={String(i)}>
                                    {d.codigo ? `${d.codigo} — ` : ""}
                                    {d.descripcion}
                                  </SelectItem>
                                ) : null,
                              )}
                            </SelectGroup>
                          ))}
                          <SelectGroup>
                            <SelectLabel>Otro</SelectLabel>
                            <SelectItem value={DX_OTRO}>✎ Otro diagnóstico (digitar manualmente)…</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      {dxOtroActivo ? (
                        <div className="pt-1">
                          <BuscadorCie11
                            id="gf-dx-otro"
                            onSelect={(sel) =>
                              setDxSel({
                                codigo: sel.codigo,
                                descripcion: sel.titulo,
                                sistema: "CIE11",
                                fuente: "Manual",
                                origenId: null,
                              })
                            }
                          />
                          {dxSel?.fuente === "Manual" ? (
                            <p className="pt-1 text-xs text-muted-foreground">
                              Seleccionado: <b>{dxSel.codigo} — {dxSel.descripcion}</b>
                            </p>
                          ) : null}
                        </div>
                      ) : dxSel ? (
                        <p className="text-xs text-muted-foreground">
                          Fuente: {dxSel.fuente}
                          {dxSel.sistema ? ` · ${dxSel.sistema}` : " · sin código"}
                        </p>
                      ) : null}
                    </div>
                  );
                }

                // --- RF-04: prioridad segmentada con patrón de colores ---
                if (f.fieldKey === "prio") {
                  return (
                    <div key="prio" className="space-y-1">
                      <Label>
                        {meta.label} {req ? <span className="text-destructive">*</span> : null}
                      </Label>
                      <div
                        className={`flex gap-1.5 ${invalid ? "rounded-md outline outline-2 outline-offset-2 outline-destructive" : ""}`}
                        role="group"
                        aria-label="Prioridad de la solicitud"
                      >
                        {(["Rutina", "Urgente", "STAT"] as const).map((p) => {
                          const seg = PRIO_SEGMENT[p];
                          const on = prioActual === p;
                          return (
                            <button
                              key={p}
                              type="button"
                              data-testid={`img-prio-${p}`}
                              onClick={() => setPrio(p)}
                              className="flex flex-1 items-center justify-center gap-1.5 rounded-md border px-1 py-2 text-xs font-bold"
                              style={
                                on
                                  ? { backgroundColor: seg.onBg, borderColor: seg.dot, color: seg.onColor }
                                  : { color: "#64748b" }
                              }
                            >
                              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: seg.dot }} />
                              {p}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                }

                // --- RF-06: embarazo — bloqueado con «No aplica» si sexo M ---
                if (f.fieldKey === "embarazo") {
                  return (
                    <div key="embarazo" className="space-y-1">
                      <Label htmlFor="gf-embarazo">
                        {meta.label} <span className="text-destructive">*</span>{" "}
                        {sexoM ? <Badge variant="outline" className="text-[10px]">🔒 automático por sexo</Badge> : null}
                      </Label>
                      <Select
                        value={sexoM ? "No aplica" : value}
                        disabled={sexoM}
                        onValueChange={(v) => setFields((p) => ({ ...p, embarazo: v }))}
                      >
                        <SelectTrigger id="gf-embarazo" aria-invalid={invalid} data-testid="img-embarazo-select">
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
                      {sexoM ? (
                        <p className="text-xs text-muted-foreground">
                          Paciente masculino — el sistema asigna «No aplica» por defecto.
                        </p>
                      ) : null}
                    </div>
                  );
                }

                // --- RF-07: alergias — solo lectura desde la Historia Clínica ---
                if (f.fieldKey === "alergias") {
                  return (
                    <div key="alergias" className="space-y-1">
                      <Label htmlFor="gf-alergias">
                        {meta.label} <Badge variant="outline" className="text-[10px]">🔗 Historia Clínica</Badge>
                      </Label>
                      <Input
                        id="gf-alergias"
                        readOnly
                        value={alergiasHc ?? "Sin alergias registradas en Historia Clínica"}
                        title="Dato obtenido de la Historia Clínica del paciente"
                        className="bg-muted/50"
                      />
                    </div>
                  );
                }

                // --- RF-08: creatinina — rótulo dinámico si hay contraste ---
                if (f.fieldKey === "creat") {
                  return (
                    <div key="creat" className="space-y-1">
                      <Label htmlFor="gf-creat">
                        {meta.label}{" "}
                        {hayContraste ? (
                          <span className="text-xs font-bold text-destructive" data-testid="img-creat-req">
                            * obligatoria — hay estudio(s) con contraste
                          </span>
                        ) : req ? (
                          <span className="text-destructive">*</span>
                        ) : null}
                      </Label>
                      <Input
                        id="gf-creat"
                        placeholder={meta.placeholder}
                        value={value}
                        aria-invalid={invalid}
                        onChange={(e) => setFields((p) => ({ ...p, creat: e.target.value }))}
                      />
                    </div>
                  );
                }

                // --- RF-05: fecha — visible solo con Rutina (filtro arriba) ---
                if (f.fieldKey === "fecha") {
                  return (
                    <div key="fecha" className="space-y-1">
                      <Label htmlFor="gf-fecha">
                        {meta.label} {req ? <span className="text-destructive">*</span> : null}
                      </Label>
                      <Input
                        id="gf-fecha"
                        type="date"
                        min={hoyIso}
                        value={value}
                        aria-invalid={invalid}
                        onChange={(e) => setFields((p) => ({ ...p, fecha: e.target.value }))}
                      />
                      <p className="text-xs text-muted-foreground">
                        📅 Disponible porque la prioridad es <b className="text-emerald-700">Rutina</b>. Urgente y
                        STAT se programan de inmediato.
                      </p>
                    </div>
                  );
                }

                // --- Genéricos (just / obs) ---
                return (
                  <div key={f.fieldKey} className="space-y-1">
                    <Label htmlFor={`gf-${f.fieldKey}`}>
                      {meta.label} {req ? <span className="text-destructive">*</span> : null}
                    </Label>
                    {meta.tipo === "textarea" ? (
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
                        type="text"
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
