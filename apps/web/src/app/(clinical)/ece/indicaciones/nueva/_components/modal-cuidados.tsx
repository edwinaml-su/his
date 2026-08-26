"use client";

/**
 * CC-0026 Ola 2 — categoría "Cuidados de enfermería" (ESP-MOCKUP-0026
 * §CUI_SECTIONS, 19 subsecciones — ver cuidados-catalogo.ts).
 *
 * Regla dura del mockup: una sección "abierta" (expandida) SE REGISTRA; una
 * "contraída" no. TODAS deben resolverse (abierta o "No aplica") antes de
 * poder agregar al cuadro — las pendientes se marcan en rojo solo al
 * intentar agregar (no antes, para no ensuciar la vista inicial).
 *
 * Bloque respiratorio (16-19 del mockup, aire ambiente/O₂/VMNI/VMI): abrir
 * uno bloquea los otros tres (mutuamente excluyentes).
 *
 * "Tomar signos vitales" (sección 2) NO captura signos: registra la ORDEN de
 * tomarlos (frecuencia de monitoreo). La toma real la hace enfermería
 * después vía el capturador de CC-0012 (`SignosVitalesModal`), no esta
 * pantalla — ver nota inline más abajo.
 *
 * Desviación declarada (§Fidelidad CLAUDE.md): el recálculo bidireccional
 * en vivo de Flujo↔FiO₂ del mockup (p. ej. mover el flujo de la mascarilla
 * Venturi ajusta la válvula y viceversa) se simplifica a un `<select>` de
 * válvula que fija FiO₂+flujo recomendado y campos numéricos editables con
 * min/max — sin el auto-clamping ni las advertencias dinámicas del mockup.
 * El trigger de VMI (Flujo/Presión con su propio rango) tampoco se replica.
 * Se conserva toda la data clínica (rangos por grupo etario, tabla Venturi,
 * bloqueo mutuo, parámetros por modo) — lo simplificado es solo la
 * interacción de ajuste fino, no el contenido clínico capturado.
 */
import * as React from "react";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { Textarea } from "@his/ui/components/textarea";
import { Checkbox } from "@his/ui/components/checkbox";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { cn } from "@his/ui/lib/utils";
import {
  CUI_SECTIONS,
  INS_ROWS,
  O2_DEVICES,
  O2_NOTES,
  RESPIRATORY_BLOCK_INDICES,
  VENTURI,
  VMI_MODOS,
  VMI_META,
  VMI_R,
  VMNI_R,
  VM_GRUPOS,
  rangoMedio,
  vmiModeParams,
  type VmGrupo,
} from "./cuidados-catalogo";

interface SeccionState {
  open: boolean;
  na: boolean;
  fields: Record<string, string>;
  multi: string[];
}

function emptyState(): SeccionState {
  return { open: false, na: false, fields: {}, multi: [] };
}

export interface ModalCuidadosHandle {
  compose: () => { descripcion: string; detalle: Record<string, unknown> } | null;
}

export const ModalCuidados = React.forwardRef<ModalCuidadosHandle, Record<never, never>>(
  function ModalCuidados(_props, ref) {
    const [estados, setEstados] = React.useState<Record<number, SeccionState>>({});
    const [showPending, setShowPending] = React.useState(false);
    const [obsFinal, setObsFinal] = React.useState("");

    const get = React.useCallback(
      (i: number): SeccionState => estados[i] ?? emptyState(),
      [estados],
    );
    const set = (i: number, patch: Partial<SeccionState>) =>
      setEstados((prev) => ({ ...prev, [i]: { ...emptyState(), ...prev[i], ...patch } }));
    const setField = (i: number, key: string, value: string) =>
      set(i, { fields: { ...get(i).fields, [key]: value } });

    // ── bloque respiratorio: abrir 16-19 bloquea los otros 3 ──────────────────
    const activoRespiratorio = RESPIRATORY_BLOCK_INDICES.find((i) => get(i).open && !get(i).na);
    const bloqueado = (i: number) =>
      RESPIRATORY_BLOCK_INDICES.includes(i) && activoRespiratorio !== undefined && activoRespiratorio !== i;

    function toggleOpen(i: number) {
      if (bloqueado(i)) return;
      set(i, { open: !get(i).open });
    }
    function toggleNa(i: number, checked: boolean) {
      set(i, { na: checked, open: checked ? false : get(i).open });
    }

    function seccionResuelta(i: number): boolean {
      return get(i).open || get(i).na || bloqueado(i);
    }
    const pendientes = CUI_SECTIONS.map((_, i) => i).filter((i) => !seccionResuelta(i));

    // ── prosa por sección (equivalente funcional de cuiCompose del mockup) ───
    function lineaSeccion(i: number): { texto: string; detalle: Record<string, unknown> } | null {
      const s = CUI_SECTIONS[i]!;
      const st = get(i);
      if (!st.open || st.na) return null;
      const titulo = s.openName ?? s.name;
      switch (s.kind) {
        case "tipo": {
          const v = st.fields.opt ?? s.opts![0]!;
          return { texto: `${s.pre ? s.pre + " " : ""}${titulo} ${v}`, detalle: { opcion: v } };
        }
        case "sv": {
          const monitorNa = st.fields.quitarMonitoreo === "1";
          const frec = st.fields.frecuencia ?? "Hora";
          const texto = monitorNa
            ? `${titulo} y anotar cada ${frec}`
            : `${titulo} monitorizados y anotar cada ${frec}`;
          return { texto, detalle: { monitorizados: !monitorNa, frecuencia: frec } };
        }
        case "anotar": {
          const v = st.fields.opt ?? s.opts![0]!;
          return { texto: `${titulo} y anotar cada ${v}`, detalle: { frecuencia: v } };
        }
        case "movilidad": {
          const modo = st.fields.modo ?? "reposo";
          const dep = st.fields.dep ?? (modo === "reposo" ? "Absoluto" : "Libre");
          return { texto: `${titulo} ${modo} ${dep}`, detalle: { modo, dependiente: dep } };
        }
        case "respaldo": {
          const modo = st.fields.modo ?? "sin respaldo";
          const angulo = st.fields.angulo;
          const texto = modo === "con respaldo" && angulo ? `${titulo} ${modo} a ${angulo}` : `${titulo} ${modo}`;
          return { texto, detalle: { modo, angulo: angulo || undefined } };
        }
        case "multi": {
          const items = st.multi;
          const texto = items.length ? items.map((v) => `${s.name} ${v}`).join("\n") : s.name;
          return { texto, detalle: { elementos: items } };
        }
        case "gluco": {
          const frec = st.fields.frecuencia ?? "Hora";
          const insulina = st.fields.insulina === "1";
          const texto = `${titulo} y anotar cada ${frec}${insulina ? " y cumplir insulina subcutánea según esquema" : ""}`;
          return { texto, detalle: { frecuencia: frec, cumplirInsulina: insulina } };
        }
        case "o2": {
          const dev = st.fields.dispositivo ?? O2_DEVICES[0]!;
          const fio2 = st.fields.fio2 ?? "";
          const flujo = st.fields.flujo ?? "";
          const valvula = st.fields.valvula;
          const texto =
            dev === "Mascarilla Venturi"
              ? `${titulo} mediante ${dev} con válvula ${valvula} (FiO₂ ${fio2}%) a ${flujo} L/min`
              : `${titulo} mediante ${dev} a ${flujo} L/min con FiO₂ ${fio2}%`;
          return { texto, detalle: { dispositivo: dev, valvula, fio2: Number(fio2), flujoLmin: Number(flujo) } };
        }
        case "vmni": {
          const grupo = (st.fields.grupo ?? "Adulto") as VmGrupo;
          const modo = st.fields.modo ?? "CPAP";
          const cpap = st.fields.cpap;
          const texto =
            modo === "BiPAP"
              ? `${titulo} para paciente ${grupo} en modalidad BiPAP — IPAP ${st.fields.ipap} cmH₂O · EPAP ${st.fields.epap} cmH₂O · FiO₂ ${st.fields.fio2}% · FR respaldo ${st.fields.frr} rpm`
              : `${titulo} para paciente ${grupo} en modalidad CPAP — presión ${cpap} cmH₂O · FiO₂ ${st.fields.fio2}%`;
          return { texto, detalle: { grupo, modo, ...st.fields } };
        }
        case "vmi": {
          const grupo = (st.fields.grupo ?? "Adulto") as VmGrupo;
          const modo = st.fields.modo ?? VMI_MODOS[grupo]![0]!;
          const params = vmiModeParams(modo);
          const texto = `${titulo} para paciente ${grupo} en modo ${modo} — ${params
            .map((k) => `${VMI_META[k]!.pre} ${st.fields[k] ?? ""} ${VMI_META[k]!.unit}`)
            .join(" · ")}`;
          return { texto, detalle: { grupo, modo, ...st.fields } };
        }
        default:
          return { texto: titulo, detalle: {} };
      }
    }

    React.useImperativeHandle(ref, () => ({
      compose: () => {
        if (pendientes.length > 0) {
          setShowPending(true);
          return null;
        }
        const lineas: string[] = [];
        const detalleSecciones: Record<string, unknown>[] = [];
        CUI_SECTIONS.forEach((s, i) => {
          const l = lineaSeccion(i);
          if (l) {
            lineas.push(l.texto);
            detalleSecciones.push({ seccion: s.name, ...l.detalle });
          }
        });
        if (obsFinal.trim()) lineas.push(`Obs: ${obsFinal.trim()}`);
        if (lineas.length === 0) return null;
        return {
          descripcion: lineas.join("\n"),
          detalle: { secciones: detalleSecciones, indicacionesEspecificas: obsFinal.trim() || undefined },
        };
      },
    }));

    return (
      <div className="space-y-3">
        <p className="rounded-md border border-violet-200 bg-violet-50 p-3 text-xs text-violet-900">
          Expandí los apartados que apliquen (lo abierto es lo que se registra); lo contraído no
          se anota. Al agregar, el conjunto completo se registra como una sola indicación médica.
        </p>

        <div className="divide-y rounded-md border">
          {CUI_SECTIONS.map((s, i) => {
            const st = get(i);
            const blocked = bloqueado(i);
            const pending = showPending && !seccionResuelta(i);
            return (
              <div
                key={s.name}
                className={cn(
                  "p-3",
                  pending && "rounded-md outline outline-2 outline-offset-[-2px] outline-destructive",
                  blocked && "opacity-50",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-sm"
                    onClick={() => toggleOpen(i)}
                    disabled={blocked || st.na}
                    aria-expanded={st.open}
                  >
                    <span className={cn("inline-block w-3 text-muted-foreground transition-transform", st.open && "rotate-90 text-blue-600")}>
                      ▸
                    </span>
                    <span className="w-5 text-right text-xs text-muted-foreground">{i + 1}</span>
                    <span className={cn(st.open && "font-semibold")}>{st.open && s.openName ? s.openName : s.name}</span>
                  </button>

                  {s.kind === "sv" && st.open ? (
                    <>
                      {st.fields.quitarMonitoreo !== "1" ? (
                        <Select value="Monitorizados" onValueChange={() => undefined}>
                          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="Monitorizados">Monitorizados</SelectItem></SelectContent>
                        </Select>
                      ) : null}
                      <span className="text-xs text-muted-foreground">y anotar cada</span>
                      <Select value={st.fields.frecuencia ?? "Hora"} onValueChange={(v) => setField(i, "frecuencia", v)}>
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Hora", "2 Horas", "4 Horas", "6 Horas", "8 Horas", "12 Horas", "Día"].map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                        <Checkbox
                          checked={st.fields.quitarMonitoreo === "1"}
                          onCheckedChange={(c) => setField(i, "quitarMonitoreo", c ? "1" : "0")}
                        />
                        Quitar Monitoreo
                      </label>
                    </>
                  ) : null}

                  {(s.kind === "anotar" || (s.kind === "tipo" && s.opts)) && st.open ? (
                    <>
                      {s.kind === "anotar" ? <span className="text-xs text-muted-foreground">y anotar cada</span> : null}
                      <Select value={st.fields.opt ?? s.opts![0]!} onValueChange={(v) => setField(i, "opt", v)}>
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {s.opts!.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : null}

                  {s.kind === "movilidad" && st.open ? (
                    <>
                      <Select value={st.fields.modo ?? "reposo"} onValueChange={(v) => setField(i, "modo", v)}>
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="reposo">reposo</SelectItem>
                          <SelectItem value="deambulación">deambulación</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={st.fields.dep ?? ((st.fields.modo ?? "reposo") === "reposo" ? "Absoluto" : "Libre")}
                        onValueChange={(v) => setField(i, "dep", v)}
                      >
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {((st.fields.modo ?? "reposo") === "reposo" ? ["Absoluto", "Relativo"] : ["Libre", "Asistida"]).map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </>
                  ) : null}

                  {s.kind === "respaldo" && st.open ? (
                    <>
                      <Select value={st.fields.modo ?? "sin respaldo"} onValueChange={(v) => setField(i, "modo", v)}>
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="sin respaldo">sin respaldo</SelectItem>
                          <SelectItem value="con respaldo">con respaldo</SelectItem>
                        </SelectContent>
                      </Select>
                      {st.fields.modo === "con respaldo" ? (
                        <Select value={st.fields.angulo ?? "30°"} onValueChange={(v) => setField(i, "angulo", v)}>
                          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {["30°", "45°", "60°", "75°", "90°"].map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </>
                  ) : null}

                  {s.na ? (
                    <label className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      <Checkbox checked={st.na} onCheckedChange={(c) => toggleNa(i, c)} disabled={blocked} />
                      No aplica
                    </label>
                  ) : null}
                </div>

                {/* Bloques con contenido debajo (multi/gluco/o2/vmni/vmi) */}
                {st.open && s.kind === "multi" ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
                    <Select value={st.fields.selMulti ?? s.opts![0]!} onValueChange={(v) => setField(i, "selMulti", v)}>
                      <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {s.opts!.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      className="rounded-md border bg-muted px-3 py-1 text-xs font-semibold"
                      onClick={() => {
                        const v = st.fields.selMulti ?? s.opts![0]!;
                        if (!st.multi.includes(v)) set(i, { multi: [...st.multi, v] });
                      }}
                    >
                      Agregar +
                    </button>
                    {st.multi.map((v) => (
                      <Badge key={v} variant="secondary" className="gap-1">
                        {v}
                        <button
                          type="button"
                          aria-label={`Quitar ${v}`}
                          onClick={() => set(i, { multi: st.multi.filter((x) => x !== v) })}
                        >
                          ✕
                        </button>
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {st.open && s.kind === "gluco" ? (
                  <div className="mt-2 space-y-2 pl-9">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">y anotar cada</span>
                      <Select value={st.fields.frecuencia ?? "Hora"} onValueChange={(v) => setField(i, "frecuencia", v)}>
                        <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["Hora", "2 Horas", "4 Horas", "6 Horas", "8 Horas", "12 Horas", "Día", "Postprandial y 10 pm"].map((o) => (
                            <SelectItem key={o} value={o}>{o}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex items-center gap-2 text-xs">
                      <Checkbox
                        checked={st.fields.insulina === "1"}
                        onCheckedChange={(c) => setField(i, "insulina", c ? "1" : "0")}
                      />
                      Cumplir insulina subcutánea según esquema
                    </label>
                    {st.fields.insulina === "1" ? (
                      <div className="overflow-x-auto rounded-md border bg-white text-xs">
                        <table className="w-full border-collapse text-center">
                          <tbody>
                            <tr className="border-b">
                              <th className="border-r bg-indigo-50 p-1 text-left">Glucemia (mg/dL)</th>
                              {INS_ROWS.map(([g]) => (<td key={g} className="border-r p-1">{g}</td>))}
                            </tr>
                            <tr>
                              <th className="border-r bg-indigo-50 p-1 text-left">Unidades SC</th>
                              {INS_ROWS.map(([g, u]) => (<td key={g} className="border-r p-1">{u}</td>))}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {st.open && s.kind === "o2" ? (
                  <O2Fields fields={st.fields} onChange={(k, v) => setField(i, k, v)} />
                ) : null}
                {st.open && s.kind === "vmni" ? (
                  <VmniFields fields={st.fields} onChange={(k, v) => setField(i, k, v)} />
                ) : null}
                {st.open && s.kind === "vmi" ? (
                  <VmiFields fields={st.fields} onChange={(k, v) => setField(i, k, v)} />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="space-y-1">
          <Label htmlFor="cui-obs">20 · Indicaciones específicas (opcional)</Label>
          <Textarea
            id="cui-obs"
            value={obsFinal}
            onChange={(e) => setObsFinal(e.target.value)}
            disabled={pendientes.length > 0}
            placeholder="Ej. vigilar signos de sangrado, avisar si fiebre > 38.5°…"
            onClick={() => pendientes.length > 0 && setShowPending(true)}
          />
          {pendientes.length > 0 && showPending ? (
            <p className="text-xs text-destructive">
              Hay {pendientes.length} sección(es) sin resolver: expandila o marcá &quot;No aplica&quot;.
            </p>
          ) : null}
        </div>
      </div>
    );
  },
);

// ─── sub-renderers de O2/VMNI/VMI (rangos y tabla Venturi del mockup) ────────

function NumField({
  label,
  unit,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  unit: string;
  value: string;
  min: number;
  max: number;
  step?: number;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="number"
        className="h-8 w-20"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-muted-foreground">{unit}</span>
    </div>
  );
}

function O2Fields({
  fields,
  onChange,
}: {
  fields: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  const dev = fields.dispositivo ?? O2_DEVICES[0]!;
  const valvula = fields.valvula ?? VENTURI[0]!.color;
  const v = VENTURI.find((x) => x.color === valvula) ?? VENTURI[0]!;
  return (
    <div className="mt-2 space-y-2 pl-9">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">mediante</span>
        <Select
          value={dev}
          onValueChange={(val) => {
            onChange("dispositivo", val);
            if (val === "Mascarilla Venturi") {
              onChange("valvula", VENTURI[0]!.color);
              onChange("fio2", String(VENTURI[0]!.fio2));
              onChange("flujo", String(VENTURI[0]!.rec));
            }
          }}
        >
          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>
            {O2_DEVICES.map((o) => (<SelectItem key={o} value={o}>{o}</SelectItem>))}
          </SelectContent>
        </Select>

        {dev === "Mascarilla Venturi" ? (
          <>
            <span className="text-xs text-muted-foreground">con válvula</span>
            <Select
              value={valvula}
              onValueChange={(val) => {
                const sel = VENTURI.find((x) => x.color === val)!;
                onChange("valvula", val);
                onChange("fio2", String(sel.fio2));
                onChange("flujo", String(sel.rec));
              }}
            >
              <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
              <SelectContent>
                {VENTURI.map((x) => (<SelectItem key={x.color} value={x.color}>{x.color}</SelectItem>))}
              </SelectContent>
            </Select>
            <NumField label="FiO₂" unit="%" value={fields.fio2 ?? String(v.fio2)} min={21} max={100} onChange={(val) => onChange("fio2", val)} />
            <NumField label="a" unit="L/min" value={fields.flujo ?? String(v.rec)} min={v.min} max={v.max} onChange={(val) => onChange("flujo", val)} />
          </>
        ) : (
          <NumField label="a" unit="L/min" value={fields.flujo ?? "2"} min={1} max={60} onChange={(val) => onChange("flujo", val)} />
        )}
      </div>
      <p className="text-xs text-muted-foreground">{O2_NOTES[dev]}</p>
    </div>
  );
}

function VmniFields({
  fields,
  onChange,
}: {
  fields: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  const grupo = (fields.grupo ?? "Adulto") as VmGrupo;
  const modo = fields.modo ?? "CPAP";
  const modos = grupo === "Neonato" ? ["CPAP"] : ["CPAP", "BiPAP"];
  return (
    <div className="mt-2 space-y-2 pl-9">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">para paciente</span>
        <Select value={grupo} onValueChange={(v) => onChange("grupo", v)}>
          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>{VM_GRUPOS.map((g) => (<SelectItem key={g} value={g}>{g}</SelectItem>))}</SelectContent>
        </Select>
        <span className="text-muted-foreground">en modalidad</span>
        <Select value={modo} onValueChange={(v) => onChange("modo", v)}>
          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>{modos.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
        </Select>
        {modo === "BiPAP" ? (
          <>
            <NumField label="con IPAP" unit="cmH₂O" value={fields.ipap ?? String(rangoMedio(VMNI_R.ipap[grupo]!, 1))} min={VMNI_R.ipap[grupo]![0]} max={VMNI_R.ipap[grupo]![1]} onChange={(v) => onChange("ipap", v)} />
            <NumField label="EPAP" unit="cmH₂O" value={fields.epap ?? String(rangoMedio(VMNI_R.epap[grupo]!, 1))} min={VMNI_R.epap[grupo]![0]} max={VMNI_R.epap[grupo]![1]} onChange={(v) => onChange("epap", v)} />
            <NumField label="FiO₂" unit="%" value={fields.fio2 ?? "40"} min={21} max={100} onChange={(v) => onChange("fio2", v)} />
            <NumField label="FR respaldo" unit="rpm" value={fields.frr ?? String(rangoMedio(VMNI_R.frr[grupo]!, 1))} min={VMNI_R.frr[grupo]![0]} max={VMNI_R.frr[grupo]![1]} onChange={(v) => onChange("frr", v)} />
            <NumField label="Ti" unit="s" value={fields.ti ?? String(rangoMedio(VMNI_R.ti[grupo]!, 0.1))} min={VMNI_R.ti[grupo]![0]} max={VMNI_R.ti[grupo]![1]} step={0.1} onChange={(v) => onChange("ti", v)} />
          </>
        ) : (
          <>
            <NumField label="con CPAP" unit="cmH₂O" value={fields.cpap ?? String(rangoMedio(VMNI_R.cpap[grupo]!, 1))} min={VMNI_R.cpap[grupo]![0]} max={VMNI_R.cpap[grupo]![1]} onChange={(v) => onChange("cpap", v)} />
            <NumField label="FiO₂" unit="%" value={fields.fio2 ?? "40"} min={21} max={100} onChange={(v) => onChange("fio2", v)} />
          </>
        )}
      </div>
    </div>
  );
}

function VmiFields({
  fields,
  onChange,
}: {
  fields: Record<string, string>;
  onChange: (k: string, v: string) => void;
}) {
  const grupo = (fields.grupo ?? "Adulto") as VmGrupo;
  const modos = VMI_MODOS[grupo];
  const modo = modos.includes(fields.modo ?? "") ? fields.modo! : modos[0]!;
  const params = vmiModeParams(modo);
  return (
    <div className="mt-2 space-y-2 pl-9">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">para paciente</span>
        <Select value={grupo} onValueChange={(v) => onChange("grupo", v)}>
          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>{VM_GRUPOS.map((g) => (<SelectItem key={g} value={g}>{g}</SelectItem>))}</SelectContent>
        </Select>
        <span className="text-muted-foreground">en modo</span>
        <Select value={modo} onValueChange={(v) => onChange("modo", v)}>
          <SelectTrigger className="h-8 w-auto"><SelectValue /></SelectTrigger>
          <SelectContent>{modos.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
        </Select>
        {params.map((k) => {
          const meta = VMI_META[k]!;
          const r = VMI_R[k]![grupo];
          return (
            <NumField
              key={k}
              label={meta.pre}
              unit={meta.unit}
              value={fields[k] ?? String(rangoMedio(r, meta.step))}
              min={r[0]}
              max={r[1]}
              step={meta.step}
              onChange={(v) => onChange(k, v)}
            />
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        Vt objetivo 6–8 mL/kg de peso predicho · Pplat &lt; 30 cmH₂O · presión de conducción ≤ 15
        cmH₂O.
      </p>
    </div>
  );
}
