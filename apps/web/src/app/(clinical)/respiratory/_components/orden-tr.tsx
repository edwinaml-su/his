"use client";

/**
 * CC-0042 — «Nueva orden de terapia respiratoria» (CPOE-TR).
 *
 * Fuente de COMPORTAMIENTO: docs/CC/CC0042/MOCK-HIS-TR-001.html (tab Orden
 * médica) — el estilo se materializa sobre Shadcn/@his/ui, precedente
 * documentado de lab-maintenance.tsx (CLAUDE.md §Fidelidad: el mockup de una
 * herramienta operativa define comportamiento, no design system paralelo).
 *
 * Reglas del mockup replicadas 1:1 (el server las re-valida — RN-TR-31..36):
 *  · 3 secciones con declaración obligatoria («No requiere…» / «No aplica»)
 *    que colapsa la sección (RF-TR-E111/E116).
 *  · Oxigenoterapia de selección única con pareo automático 01→02 / 03→04
 *    (RF-TR-E112) y meta de saturación con mensaje dinámico + «Otro» con
 *    rango 70–100 y justificación ≥15 (RF-TR-E103/E119, RN-TR-34).
 *  · Aerosolterapia de selección única con bloque de medicamento dependiente
 *    (RF-TR-E114/E117): unidades/diluyentes de lista cerrada, dosis
 *    paramétrica con bloqueo duro de «g» y rangos del catálogo (RN-TR-36);
 *    TR-AER-05 no despliega medicamento.
 *  · Conjuntos de órdenes (EPOC / asma / postoperatorio / preoperatorio).
 *  · Validación bloqueante al firmar con modal de error (RF-TR-E113).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import { Label } from "@his/ui/components/label";
import { Checkbox } from "@his/ui/components/checkbox";
import { Badge } from "@his/ui/components/badge";
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
import { BuscadorCie11 } from "@/components/cie11/BuscadorCie11";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CatalogoTr = RouterOutput["respiratory"]["tr"]["catalogo"]["list"];
type ProcedimientoTr = CatalogoTr["procedimientos"][number];
type MedicamentoTr = CatalogoTr["medicamentos"][number];

type ToastState = { title: string; description?: string; variant?: "default" | "success" | "destructive" } | null;

/** Mensajes dinámicos de la meta (constantes METAS del mockup, texto exacto). */
const METAS: Record<string, { tono: "info" | "warn"; tit: string; txt: string }> = {
  "94-98": {
    tono: "info",
    tit: "Meta estándar del adulto agudo",
    txt: "Rango 94–98 % para el paciente hospitalizado sin riesgo de retención de dióxido de carbono. Evitar saturaciones por encima del rango: la hiperoxia también se titula a la baja. Regla aplicable: Protocolo de titulación de oxígeno TR-O2-01.",
  },
  "88-92": {
    tono: "warn",
    tit: "Paciente con riesgo de hipercapnia",
    txt: "Meta 88–92 % en enfermedad pulmonar obstructiva crónica, obesidad con hipoventilación, enfermedad neuromuscular o intoxicación por depresores. Evitar saturaciones mayores de 92 %. Dispositivo de elección: mascarilla Venturi. Regla aplicable: Protocolo de titulación de oxígeno TR-O2-02.",
  },
  "88-93": {
    tono: "warn",
    tit: "Paciente crítico con fracción inspirada de oxígeno igual o mayor de 0.70",
    txt: "Meta 88–93 % cuando se requiere una fracción inspirada de oxígeno igual o mayor de 0.70 sin estrategia de presión positiva al final de la espiración elevada. Solicitar gasometría arterial de control. Regla aplicable: Protocolo de titulación de oxígeno TR-O2-03.",
  },
};

const META_LABEL: Record<string, string> = {
  "94-98": "94 – 98 % · adulto agudo",
  "88-92": "88 – 92 % · riesgo de hipercapnia",
  "88-93": "88 – 93 % · FiO₂ ≥ 0.70",
  OTRO: "Otro (con justificación)",
};

const FRECUENCIAS = ["Cada 8 horas", "Cada 6 horas", "Cada 4 horas", "Por razón necesaria"];

interface MedState {
  clave: string;
  dosis: string;
  unidad: string;
  diluyente: string;
  extraValor: string;
  frecuencia: string;
}

/** Validación de dosis — espejo exacto de valDosis() del mockup (el server la repite). */
function validarDosis(
  med: MedicamentoTr,
  dosis: number,
  unidad: string,
): string | null {
  const nombre = med.nombre.split(" — ")[0]!;
  if (unidad === "g") {
    return `Unidad no válida para un medicamento inhalado. Use miligramos o microgramos. Dosis habitual de ${nombre}: ${med.dosisMax} mg (${med.dosisMax * 1000} µg).`;
  }
  if (unidad !== med.unidadBase && !(med.unidadBase === "mg" && unidad === "µg")) {
    return `${nombre} se dosifica en ${med.unidadBase}. Cambie la unidad a ${med.unidadBase}.`;
  }
  if (Number.isNaN(dosis) || dosis <= 0) return "Capture una dosis numérica mayor que cero.";
  const eq = med.unidadBase === "mg" && unidad === "µg" ? dosis / 1000 : dosis;
  if (eq < med.dosisMin * 0.5) {
    return `Dosis por debajo del rango habitual de ${nombre} (${med.dosisMin} a ${med.dosisMax} ${med.unidadBase}). Requiere justificación del prescriptor.`;
  }
  if (eq > med.dosisMax * 2) {
    return `Dosis por encima del máximo permitido de ${nombre} (${med.dosisMax} ${med.unidadBase}). No es posible firmar la orden.`;
  }
  return null;
}

export function OrdenTr({ cuentaId, onGuardado }: { cuentaId: string; onGuardado: () => void }) {
  const utils = trpc.useUtils();
  const catalogoQ = trpc.respiratory.tr.catalogo.list.useQuery();
  const procedimientos = React.useMemo(
    () => (catalogoQ.data?.procedimientos ?? []).filter((p) => p.activo),
    [catalogoQ.data],
  );
  const medicamentos = React.useMemo(
    () => (catalogoQ.data?.medicamentos ?? []).filter((m) => m.activo),
    [catalogoQ.data],
  );
  const medByClave = React.useMemo(() => new Map(medicamentos.map((m) => [m.clave, m])), [medicamentos]);
  const procByCodigo = React.useMemo(() => new Map(procedimientos.map((p) => [p.codigo, p])), [procedimientos]);

  const seccion1 = procedimientos.filter((p) => p.seccionOrden === 1);
  const seccion2 = procedimientos.filter((p) => p.seccionOrden === 2);
  const seccion3 = procedimientos.filter((p) => p.seccionOrden === 3);
  const subSecciones3 = [...new Set(seccion3.map((p) => p.subSeccion ?? ""))];

  // ── Estado del formulario ────────────────────────────────────────────────
  const [dx, setDx] = React.useState<{ codigo: string; descripcion: string } | null>(null);
  const [prioridad, setPrioridad] = React.useState<"ROUTINE" | "URGENT" | "STAT">("ROUTINE");
  const [vigencia, setVigencia] = React.useState<"72" | "24" | "egreso">("72");
  const [noOxi, setNoOxi] = React.useState(false);
  const [noAer, setNoAer] = React.useState(false);
  const [noFis, setNoFis] = React.useState(false);
  const [oxiSel, setOxiSel] = React.useState<Set<string>>(new Set());
  const [aerSel, setAerSel] = React.useState<string | null>(null);
  const [fisSel, setFisSel] = React.useState<Set<string>>(new Set());
  const [meta, setMeta] = React.useState<"94-98" | "88-92" | "88-93" | "OTRO" | null>(null);
  const [metaMin, setMetaMin] = React.useState("");
  const [metaMax, setMetaMax] = React.useState("");
  const [metaJust, setMetaJust] = React.useState("");
  const [med, setMed] = React.useState<MedState | null>(null);
  const [observaciones, setObservaciones] = React.useState("");
  const [modalError, setModalError] = React.useState<string | null>(null);
  const [avisoInfo, setAvisoInfo] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<ToastState>(null);

  const aerProc = aerSel ? procByCodigo.get(aerSel) : null;
  const aerCfg = aerProc?.aerosolConfig ?? null;
  const medSeleccionado = med ? medByClave.get(med.clave) : null;
  const dosisError =
    med && medSeleccionado ? validarDosis(medSeleccionado, Number.parseFloat(med.dosis), med.unidad) : null;

  // ── Sección 1: selección única con pareo automático (RF-TR-E112) ────────
  function toggleOxi(p: ProcedimientoTr, checked: boolean) {
    if (!checked) {
      setOxiSel(new Set());
      return;
    }
    setNoOxi(false);
    const next = new Set<string>([p.codigo]);
    if (p.pareoCon) next.add(p.pareoCon);
    // Si el elegido ES un acompañante (p. ej. click directo en OXI-02), agrega su inicio.
    const inicio = seccion1.find((s) => s.pareoCon === p.codigo);
    if (inicio) next.add(inicio.codigo);
    setOxiSel(next);
  }

  function toggleNoOxi(checked: boolean) {
    setNoOxi(checked);
    if (checked) {
      setOxiSel(new Set());
      setMeta(null);
      setMetaMin("");
      setMetaMax("");
      setMetaJust("");
    }
  }

  // ── Sección 2: selección única + bloque de medicamento dependiente ──────
  function seleccionarAer(codigo: string | null) {
    setAerSel(codigo);
    if (codigo) setNoAer(false);
    const cfg = codigo ? procByCodigo.get(codigo)?.aerosolConfig : null;
    if (!cfg) {
      setMed(null);
      return;
    }
    const primeraClave = cfg.meds.find((k: string) => medByClave.has(k)) ?? cfg.meds[0]!;
    const m = medByClave.get(primeraClave);
    setMed({
      clave: primeraClave,
      dosis: m ? String(m.dosisDefault) : "",
      unidad: m?.unidadBase ?? cfg.unidades[0]!,
      diluyente: cfg.diluyentes[cfg.diluyenteDefault ?? 0] ?? cfg.diluyentes[0]!,
      extraValor: cfg.extra?.opciones[cfg.extra.default ?? 0] ?? "",
      frecuencia: "Cada 6 horas",
    });
  }

  function cambiarMed(clave: string) {
    if (!aerCfg) return;
    const m = medByClave.get(clave);
    setMed((prev) =>
      prev
        ? {
            ...prev,
            clave,
            dosis: m ? String(m.dosisDefault) : prev.dosis,
            unidad: m?.unidadBase ?? prev.unidad,
          }
        : prev,
    );
  }

  // ── Conjuntos de órdenes (orderSet del mockup) ───────────────────────────
  function limpiarTodo() {
    setNoOxi(false);
    setNoAer(false);
    setNoFis(false);
    setOxiSel(new Set());
    seleccionarAer(null);
    setFisSel(new Set());
    setMeta(null);
  }
  function aplicarConjunto(k: "epoc" | "asma" | "post" | "preop") {
    limpiarTodo();
    const dxMap: Record<string, { codigo: string; descripcion: string }> = {
      epoc: { codigo: "CA22.0", descripcion: "EPOC con exacerbación aguda, no especificada" },
      asma: { codigo: "CA23", descripcion: "Asma" },
      post: { codigo: "CB40.2", descripcion: "Colapso pulmonar (atelectasia)" },
    };
    if (dxMap[k]) setDx(dxMap[k]!);
    const bajoFlujo = procByCodigo.get("TR-OXI-01");
    if (k === "epoc") {
      if (bajoFlujo) toggleOxi(bajoFlujo, true);
      seleccionarAer("TR-AER-01");
      cambiarMed("ipratropio");
      setFisSel(new Set(["TR-FIS-01"]));
      setMeta("88-92");
    } else if (k === "asma") {
      if (bajoFlujo) toggleOxi(bajoFlujo, true);
      seleccionarAer("TR-AER-01");
      cambiarMed("salbutamol");
      setNoFis(true);
      setMeta("94-98");
    } else if (k === "post") {
      if (bajoFlujo) toggleOxi(bajoFlujo, true);
      setNoAer(true);
      seleccionarAer(null);
      setFisSel(new Set(["TR-FIS-01", "TR-FIS-03"]));
      setMeta("94-98");
    } else {
      // Preoperatorio: no fija diagnóstico (RF-TR-E104).
      toggleNoOxi(true);
      seleccionarAer("TR-AER-05");
      setFisSel(new Set(["TR-FIS-03", "TR-FIS-06"]));
      setAvisoInfo(
        "El conjunto preoperatorio no fija diagnóstico: conserva el diagnóstico quirúrgico del paciente. Incluye educación de técnica inhalatoria y entrenamiento con espirómetro incentivo antes de la cirugía.",
      );
    }
  }

  // ── Firma (validación bloqueante RF-TR-E113 — el server re-valida) ──────
  const crear = trpc.respiratory.tr.orden.crear.useMutation({
    onSuccess: (data) => {
      utils.respiratory.tr.supervision.invalidate();
      setToast({
        title: "Orden firmada",
        description: `Se generaron ${data.items.length} tarea(s) en el worklist del turno y se notificó a la Jefatura de Terapia Respiratoria.`,
        variant: "success",
      });
      limpiarTodo();
      setDx(null);
      setObservaciones("");
      onGuardado();
    },
    onError: (err) => setModalError(err.message),
  });

  function firmar() {
    if (!dx) {
      setModalError("El diagnóstico CIE-11 es obligatorio: sin diagnóstico no hay firma ni cargo (RN-TR-31).");
      return;
    }
    if (!noOxi && oxiSel.size === 0) {
      setModalError(
        "Debe seleccionar al menos una opción válida en la sección de «Oxigenoterapia», o bien marcar la casilla No requiere oxigenoterapia para dejar constancia de la decisión del prescriptor.",
      );
      return;
    }
    if (!noAer && !aerSel) {
      setModalError("Debe seleccionar al menos una opción válida en la sección de «Aerosolterapia», o bien marcar la casilla No aplica.");
      return;
    }
    if (!noFis && fisSel.size === 0) {
      setModalError(
        "Debe seleccionar al menos una opción válida en la sección de «Fisioterapia respiratoria · Vía aérea · Pruebas funcionales», o bien marcar la casilla No aplica.",
      );
      return;
    }
    if (!noOxi && !meta) {
      setModalError("La meta de saturación es obligatoria en oxigenoterapia.");
      return;
    }
    if (!noOxi && meta === "OTRO") {
      const min = Number.parseInt(metaMin, 10);
      const max = Number.parseInt(metaMax, 10);
      if (Number.isNaN(min) || Number.isNaN(max) || min < 70 || max > 100 || min >= max) {
        setModalError("Capture un rango válido de saturación (mínimo menor que máximo, entre 70 % y 100 %).");
        return;
      }
      if (metaJust.trim().length < 15) {
        setModalError("La justificación clínica es obligatoria cuando la meta se aparta de las metas institucionales.");
        return;
      }
    }
    if (dosisError) {
      setModalError("Corrija la dosis del medicamento antes de firmar la orden.");
      return;
    }

    const items: { codigo: string; medicamento?: NonNullable<Parameters<typeof crear.mutate>[0]>["items"][number]["medicamento"] }[] = [];
    for (const codigo of oxiSel) items.push({ codigo });
    if (aerSel) {
      items.push({
        codigo: aerSel,
        ...(aerCfg && med
          ? {
              medicamento: {
                clave: med.clave,
                dosis: Number.parseFloat(med.dosis),
                unidad: med.unidad as "mg" | "µg" | "g" | "mL" | "disparos",
                diluyente: med.diluyente,
                extraLabel: aerCfg.extra?.label,
                extraValor: med.extraValor || undefined,
                frecuencia: med.frecuencia,
              },
            }
          : {}),
      });
    }
    for (const codigo of fisSel) items.push({ codigo });

    crear.mutate({
      cuentaId,
      dxCodigo: dx.codigo,
      dxDescripcion: dx.descripcion,
      prioridad,
      vigenciaHoras: vigencia === "egreso" ? null : Number.parseInt(vigencia, 10),
      declaraciones: {
        oxigenoterapia: noOxi ? "NO_REQUIERE" : "SELECCIONADA",
        aerosolterapia: noAer ? "NO_REQUIERE" : "SELECCIONADA",
        seccion3: noFis ? "NO_REQUIERE" : "SELECCIONADA",
      },
      ...(noOxi || !meta
        ? {}
        : {
            meta: {
              tipo: meta,
              ...(meta === "OTRO"
                ? {
                    min: Number.parseInt(metaMin, 10),
                    max: Number.parseInt(metaMax, 10),
                    justificacion: metaJust.trim(),
                  }
                : {}),
            },
          }),
      items,
      ...(observaciones.trim() ? { observaciones: observaciones.trim() } : {}),
    });
  }

  const metaMsg = meta && meta !== "OTRO" ? METAS[meta] : null;

  if (catalogoQ.isLoading) return <p className="text-sm text-muted-foreground">Cargando catálogo…</p>;
  if (catalogoQ.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {catalogoQ.error.message}
      </p>
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-sm uppercase tracking-wide text-primary">
            Nueva orden de terapia respiratoria
          </CardTitle>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarConjunto("epoc")}>
              Conjunto: EPOC exacerbada
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarConjunto("asma")}>
              Conjunto: Crisis asmática
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarConjunto("post")}>
              Conjunto: Postoperatorio de tórax
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => aplicarConjunto("preop")}>
              Conjunto: Preoperatorio
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Diagnóstico + prioridad + vigencia */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr]">
            <div className="space-y-1">
              <Label>
                Diagnóstico (CIE-11) — obligatorio{" "}
                <Badge variant="outline" className="text-[10px]">
                  🔗 OMS
                </Badge>
              </Label>
              {dx ? (
                <div className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                  <span data-testid="tr-dx-sel">
                    <b>{dx.codigo}</b> — {dx.descripcion}
                  </span>
                  <button type="button" className="text-destructive" onClick={() => setDx(null)} aria-label="Quitar diagnóstico">
                    ✕
                  </button>
                </div>
              ) : (
                <BuscadorCie11 id="tr-dx" onSelect={(s) => setDx({ codigo: s.codigo, descripcion: s.titulo })} />
              )}
              <p className="text-xs text-muted-foreground">
                El diagnóstico sustenta la indicación de la terapia y viaja al cargo de la cuenta.
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tr-prio">Prioridad</Label>
              <Select value={prioridad} onValueChange={(v) => setPrioridad(v as typeof prioridad)}>
                <SelectTrigger id="tr-prio">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ROUTINE">Rutina</SelectItem>
                  <SelectItem value="URGENT">Urgente</SelectItem>
                  <SelectItem value="STAT">Inmediata (STAT)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="tr-vig">Vigencia</Label>
              <Select value={vigencia} onValueChange={(v) => setVigencia(v as typeof vigencia)}>
                <SelectTrigger id="tr-vig">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="72">72 h (terapia continua)</SelectItem>
                  <SelectItem value="24">24 h (protocolo delegado)</SelectItem>
                  <SelectItem value="egreso">Hasta el egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Meta de saturación — colapsa con «No requiere oxigenoterapia» */}
          {!noOxi ? (
            <div className="space-y-2 rounded-md border p-3">
              <Label>Meta de saturación (obligatoria en oxigenoterapia)</Label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Meta de saturación">
                {(["94-98", "88-92", "88-93", "OTRO"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`tr-meta-${m}`}
                    aria-pressed={meta === m}
                    onClick={() => setMeta(m)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                      meta === m
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-background text-muted-foreground"
                    }`}
                  >
                    {META_LABEL[m]}
                  </button>
                ))}
              </div>
              {meta === "OTRO" ? (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-[160px_160px_1fr]">
                  <div className="space-y-1">
                    <Label htmlFor="tr-meta-min">Rango: mínimo (%)</Label>
                    <Input id="tr-meta-min" placeholder="Ej. 90" value={metaMin} onChange={(e) => setMetaMin(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-meta-max">Rango: máximo (%)</Label>
                    <Input id="tr-meta-max" placeholder="Ej. 94" value={metaMax} onChange={(e) => setMetaMax(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-meta-just">Justificación clínica de la meta (obligatoria)</Label>
                    <Textarea
                      id="tr-meta-just"
                      rows={2}
                      placeholder="Explique por qué este paciente requiere una meta distinta de las metas institucionales."
                      value={metaJust}
                      onChange={(e) => setMetaJust(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Queda registrada en la orden con el nombre del prescriptor y la hora de la firma.
                    </p>
                  </div>
                </div>
              ) : metaMsg ? (
                <div
                  data-testid="tr-meta-hint"
                  className={`rounded-md border p-3 text-sm ${
                    metaMsg.tono === "warn"
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : "border-sky-300 bg-sky-50 text-sky-900"
                  }`}
                >
                  <b>{metaMsg.tit}.</b> {metaMsg.txt}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Sección 1: Oxigenoterapia */}
          <SeccionCpoe
            titulo="Sección 1: Oxigenoterapia"
            noLabel="No requiere oxigenoterapia"
            no={noOxi}
            onNo={toggleNoOxi}
            leyendaColapsada="Sección colapsada: el prescriptor declara que este paciente no requiere oxigenoterapia. La declaración queda registrada en la orden."
            leyenda="Selección única: al elegir el inicio de oxigenoterapia el sistema agrega automáticamente su supervisión y cuidado."
          >
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {seccion1.map((p) => (
                <ProcedimientoCheck
                  key={p.codigo}
                  proc={p}
                  checked={oxiSel.has(p.codigo)}
                  onChange={(c) => toggleOxi(p, c)}
                />
              ))}
            </div>
          </SeccionCpoe>

          {/* Sección 2: Aerosolterapia */}
          <SeccionCpoe
            titulo="Sección 2: Aerosolterapia"
            noLabel="No aplica"
            no={noAer}
            onNo={(c) => {
              setNoAer(c);
              if (c) seleccionarAer(null);
            }}
            leyendaColapsada="Sección colapsada: el prescriptor declara que este paciente no requiere aerosolterapia."
            leyenda="Selección única: la orden admite un procedimiento de aerosolterapia a la vez. Los parámetros de dosificación cambian según el procedimiento elegido."
          >
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {seccion2.map((p) => (
                <ProcedimientoCheck
                  key={p.codigo}
                  proc={p}
                  checked={aerSel === p.codigo}
                  onChange={(c) => seleccionarAer(c ? p.codigo : null)}
                />
              ))}
            </div>
          </SeccionCpoe>

          {/* Bloque de medicamento dependiente (RF-TR-E117) */}
          {!noAer && aerCfg && med ? (
            <Card className="border-dashed shadow-none">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm" data-testid="tr-med-titulo">
                  Medicamento para {aerSel} · {aerProc?.nombre}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{aerCfg.hint}</p>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
                  <div className="space-y-1 md:col-span-2">
                    <Label htmlFor="tr-med">Principio activo</Label>
                    <Select value={med.clave} onValueChange={cambiarMed}>
                      <SelectTrigger id="tr-med">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aerCfg.meds
                          .filter((k: string) => medByClave.has(k))
                          .map((k: string) => (
                            <SelectItem key={k} value={k}>
                              {medByClave.get(k)!.nombre}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-dosis">Dosis</Label>
                    <Input
                      id="tr-dosis"
                      value={med.dosis}
                      aria-invalid={Boolean(dosisError)}
                      onChange={(e) => setMed((p) => (p ? { ...p, dosis: e.target.value } : p))}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-unidad">Unidad</Label>
                    <Select value={med.unidad} onValueChange={(v) => setMed((p) => (p ? { ...p, unidad: v } : p))}>
                      <SelectTrigger id="tr-unidad" data-testid="tr-unidad">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aerCfg.unidades.map((u: string) => (
                          <SelectItem key={u} value={u}>
                            {u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-dil">Diluyente</Label>
                    <Select value={med.diluyente} onValueChange={(v) => setMed((p) => (p ? { ...p, diluyente: v } : p))}>
                      <SelectTrigger id="tr-dil">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aerCfg.diluyentes.map((d: string) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="tr-frec">Frecuencia</Label>
                    <Select value={med.frecuencia} onValueChange={(v) => setMed((p) => (p ? { ...p, frecuencia: v } : p))}>
                      <SelectTrigger id="tr-frec">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FRECUENCIAS.map((f) => (
                          <SelectItem key={f} value={f}>
                            {f}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {aerCfg.extra ? (
                  <div className="space-y-1 md:max-w-md">
                    <Label htmlFor="tr-extra">{aerCfg.extra.label}</Label>
                    <Select value={med.extraValor} onValueChange={(v) => setMed((p) => (p ? { ...p, extraValor: v } : p))}>
                      <SelectTrigger id="tr-extra">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {aerCfg.extra.opciones.map((o: string) => (
                          <SelectItem key={o} value={o}>
                            {o}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                {dosisError ? (
                  <p role="alert" data-testid="tr-dosis-err" className="text-sm font-medium text-destructive">
                    {dosisError}
                  </p>
                ) : medSeleccionado ? (
                  <div
                    data-testid="tr-dosis-ok"
                    className={`rounded-md border p-3 text-sm ${
                      medSeleccionado.precaucion || medSeleccionado.altoRiesgo
                        ? "border-amber-300 bg-amber-50 text-amber-900"
                        : "border-emerald-300 bg-emerald-50 text-emerald-900"
                    }`}
                  >
                    <b>
                      {medSeleccionado.precaucion || medSeleccionado.altoRiesgo
                        ? "Dosis dentro del rango habitual · requiere precaución adicional"
                        : "Dosis dentro del rango habitual"}
                      .
                    </b>{" "}
                    {medSeleccionado.mensaje}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          {/* Sección 3 */}
          <SeccionCpoe
            titulo="Sección 3: Fisioterapia respiratoria · Vía aérea · Pruebas funcionales"
            noLabel="No aplica"
            no={noFis}
            onNo={(c) => {
              setNoFis(c);
              if (c) setFisSel(new Set());
            }}
            leyendaColapsada="Sección colapsada: el prescriptor declara que este paciente no requiere fisioterapia respiratoria, manejo de vía aérea ni pruebas funcionales."
            leyenda="Selección múltiple. Si el paciente no requiere ninguno de estos procedimientos, márquelo en la casilla de la derecha."
          >
            {subSecciones3.map((sub) => (
              <div key={sub} className="space-y-1">
                <p className="pt-1 text-xs font-semibold text-muted-foreground">{sub}</p>
                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                  {seccion3
                    .filter((p) => (p.subSeccion ?? "") === sub)
                    .map((p) => (
                      <ProcedimientoCheck
                        key={p.codigo}
                        proc={p}
                        checked={fisSel.has(p.codigo)}
                        onChange={(c) => {
                          setNoFis(false);
                          setFisSel((prev) => {
                            const next = new Set(prev);
                            if (c) next.add(p.codigo);
                            else next.delete(p.codigo);
                            return next;
                          });
                        }}
                      />
                    ))}
                </div>
              </div>
            ))}
          </SeccionCpoe>

          <div className="space-y-1">
            <Label htmlFor="tr-obs">Observaciones</Label>
            <Textarea id="tr-obs" rows={2} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={limpiarTodo}>
              Limpiar
            </Button>
            <Button type="button" data-testid="tr-firmar" onClick={firmar} disabled={crear.isPending}>
              {crear.isPending ? "Firmando…" : "Firmar orden"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Modal de error (RF-TR-E113) */}
      <Dialog open={modalError !== null} onOpenChange={(o) => !o && setModalError(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>No es posible firmar la orden</DialogTitle>
          </DialogHeader>
          <p className="text-sm" data-testid="tr-modal-error">
            {modalError}
          </p>
          <DialogFooter>
            <Button type="button" onClick={() => setModalError(null)}>
              Entendido
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Aviso informativo (conjunto preoperatorio) */}
      <Dialog open={avisoInfo !== null} onOpenChange={(o) => !o && setAvisoInfo(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conjunto de órdenes aplicado</DialogTitle>
          </DialogHeader>
          <p className="text-sm">{avisoInfo}</p>
          <DialogFooter>
            <Button type="button" onClick={() => setAvisoInfo(null)}>
              Entendido
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

function SeccionCpoe({
  titulo,
  noLabel,
  no,
  onNo,
  leyenda,
  leyendaColapsada,
  children,
}: {
  titulo: string;
  noLabel: string;
  no: boolean;
  onNo: (checked: boolean) => void;
  leyenda: string;
  leyendaColapsada: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{titulo}</p>
        <label className={`flex cursor-pointer items-center gap-1.5 text-xs font-semibold ${no ? "text-destructive" : "text-muted-foreground"}`}>
          <Checkbox checked={no} onCheckedChange={(c) => onNo(Boolean(c))} />
          <span aria-hidden="true" className="text-destructive">
            ✕
          </span>{" "}
          {noLabel}
        </label>
      </div>
      {!no ? children : null}
      <p className={`text-xs ${no ? "font-medium text-destructive" : "text-muted-foreground"}`}>
        {no ? `${leyendaColapsada} Desmarque la casilla para volver a desplegarla.` : leyenda}
      </p>
    </div>
  );
}

function ProcedimientoCheck({
  proc,
  checked,
  onChange,
}: {
  proc: ProcedimientoTr;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={`flex items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted ${checked ? "font-semibold" : ""}`}
    >
      <Checkbox checked={checked} onCheckedChange={(c) => onChange(Boolean(c))} className="mt-0.5" />
      <span>
        <span className="mr-1 font-mono text-xs text-muted-foreground">{proc.codigo}</span>
        {proc.nombre}
        {proc.requiereConsentimiento ? (
          <Badge variant="warning" className="ml-1 text-[10px]">
            consentimiento
          </Badge>
        ) : null}
      </span>
    </label>
  );
}
