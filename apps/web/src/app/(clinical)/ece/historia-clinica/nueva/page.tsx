"use client";

/**
 * §ECE — Historia Clínica Electrónica — Formulario de creación.
 *
 * CC-0001 (Requerimiento_HC_Avante_v1.0.md, NTEC Art. 7). Orden de pantalla §7:
 *   1. Datos del episodio   2. Antecedentes (Patológicos / No Patológicos + FPP)
 *   3. Signos vitales (N tomas por episodio)  4. Examen físico
 *   5. Diagnósticos CIE-11  6. Análisis clínico  7. Plan + Destino
 *
 * Reglas (§6): RN-03 ≥1 diagnóstico Complementario (se exige al firmar, no al
 * guardar borrador); RN-04/05 FUM obligatoria si calcular_fpp y ∈[hoy−300,hoy];
 * RN-07 IMC derivado; RN-08 Destino de catálogo cerrado.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Form, FormField, FormHint } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
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
import {
  DESTINO_OPTIONS,
  DESTINO_LABELS,
  TIPO_DIAGNOSTICO,
  TIPO_DIAGNOSTICO_LABELS,
  CIE11_CODE_REGEX,
  tieneComplementario,
  type Cie11Diagnostico,
  type Destino,
  type TipoDiagnostico,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

// ── Constantes ────────────────────────────────────────────────────────────────

// CHECK historia_clinica_tipo_consulta_check: primera_vez | subsecuente
const TIPO_CONSULTA_OPTIONS = [
  { value: "primera_vez", label: "Primera vez" },
  { value: "subsecuente", label: "Subsecuente" },
] as const;

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (s: string) => UUID_REGEX.test(s.trim());

// ── Helpers de cálculo (derivados, nunca persistidos a mano) ────────────────────

/** Naegele: FPP = FUM + 280 días; EG = diferencia(hoy, FUM) en semanas + días. */
function calcularFppEg(fumIso: string): { fpp: string; egTexto: string } | null {
  if (!fumIso) return null;
  const fum = new Date(`${fumIso}T00:00:00Z`);
  if (Number.isNaN(fum.getTime())) return null;
  const fppDate = new Date(fum);
  fppDate.setUTCDate(fppDate.getUTCDate() + 280);
  const fpp = fppDate.toISOString().slice(0, 10);

  const now = new Date();
  const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const dias = Math.floor((hoy.getTime() - fum.getTime()) / 86_400_000);
  if (dias < 0) return { fpp, egTexto: "—" };
  return { fpp, egTexto: `${Math.floor(dias / 7)} sem ${dias % 7} d` };
}

/** RN-05 — FUM ∈ [hoy − 300 días, hoy]. */
function fumFueraDeRango(fumIso: string): boolean {
  if (!fumIso) return false;
  const fum = new Date(`${fumIso}T00:00:00Z`);
  if (Number.isNaN(fum.getTime())) return true;
  const now = new Date();
  const hoy = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const min = new Date(hoy);
  min.setUTCDate(min.getUTCDate() - 300);
  return fum > hoy || fum < min;
}

function parseNum(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** IMC visual (RN-07: el router lo persiste; aquí solo se muestra). */
function calcImc(pesoRaw: string, tallaRaw: string): string | null {
  const peso = parseNum(pesoRaw);
  const talla = parseNum(tallaRaw);
  if (!peso || !talla) return null;
  const m = talla / 100;
  return String(Math.round((peso / (m * m)) * 10) / 10);
}

function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const fmt = (v: unknown): string => (v === null || v === undefined ? "—" : String(v));

// ── Estado del formulario ───────────────────────────────────────────────────────

interface FormState {
  episodioId: string;
  tipoConsulta: string;
  motivoConsulta: string;
  enfermedadActual: string;
  // Antecedentes patológicos
  alergias: string;
  personales: string;
  familiares: string;
  // Antecedentes no patológicos
  ocupacion: string;
  habitosPersonales: string;
  obstetricos: string;
  // Examen / análisis / plan
  hallazgosExamen: string;
  analisisClinico: string;
  planManejo: string;
  destino: string;
}

const INITIAL: FormState = {
  episodioId: "",
  tipoConsulta: "",
  motivoConsulta: "",
  enfermedadActual: "",
  alergias: "",
  personales: "",
  familiares: "",
  ocupacion: "",
  habitosPersonales: "",
  obstetricos: "",
  hallazgosExamen: "",
  analisisClinico: "",
  planManejo: "",
  destino: "",
};

// ── Bloque obstétrico FPP (RF-02) ──────────────────────────────────────────────

function BloqueObstetricoFPP({
  obstetricos,
  onObstetricos,
  calcularFpp,
  onCalcularFpp,
  fum,
  onFum,
  disabled,
}: {
  obstetricos: string;
  onObstetricos: (v: string) => void;
  calcularFpp: boolean;
  onCalcularFpp: (v: boolean) => void;
  fum: string;
  onFum: (v: string) => void;
  disabled?: boolean;
}) {
  const derivado = React.useMemo(() => (calcularFpp ? calcularFppEg(fum) : null), [calcularFpp, fum]);
  const fueraRango = calcularFpp && fum !== "" && fumFueraDeRango(fum);

  return (
    <FormField>
      <Label htmlFor="obstetricos">Obstétricos</Label>
      <Textarea
        id="obstetricos"
        name="obstetricos"
        rows={3}
        placeholder="Gestas, partos, abortos, cesáreas, planificación…"
        value={obstetricos}
        onChange={(e) => onObstetricos(e.target.value)}
        disabled={disabled}
      />

      <div className="mt-2 flex items-center gap-2">
        <Checkbox
          id="calcularFpp"
          checked={calcularFpp}
          onCheckedChange={(v) => {
            onCalcularFpp(v);
            if (!v) onFum(""); // RF-02: al desactivar, limpiar FUM/FPP/EG
          }}
          disabled={disabled}
        />
        <Label htmlFor="calcularFpp" className="cursor-pointer font-normal">
          ¿Desea calcular fecha probable de parto?
        </Label>
      </div>

      {calcularFpp && (
        <div className="mt-2 grid grid-cols-1 gap-3 rounded-md border bg-muted/30 p-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fum">
              FUM{" "}
              <span aria-hidden="true" className="text-destructive">*</span>
            </Label>
            <Input
              id="fum"
              name="fum"
              type="date"
              value={fum}
              onChange={(e) => onFum(e.target.value)}
              disabled={disabled}
              aria-invalid={fueraRango}
            />
            {fueraRango && (
              <p role="alert" className="text-xs text-destructive">
                FUM debe estar entre hoy y hace 300 días.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fppOut">FPP (Naegele)</Label>
            <Input id="fppOut" value={derivado?.fpp ?? ""} readOnly tabIndex={-1} placeholder="—" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="egOut">Edad gestacional</Label>
            <Input id="egOut" value={derivado?.egTexto ?? ""} readOnly tabIndex={-1} placeholder="—" />
          </div>
        </div>
      )}
    </FormField>
  );
}

// ── Tabla de signos vitales (RF-04) ────────────────────────────────────────────

interface TomaForm {
  presionSistolica: string;
  presionDiastolica: string;
  frecuenciaCardiaca: string;
  frecuenciaRespiratoria: string;
  temperatura: string;
  saturacionO2: string;
  pesoKg: string;
  tallaCm: string;
  escalaDolor: string;
  glucometriaMgdl: string;
  observaciones: string;
}

const INITIAL_TOMA: TomaForm = {
  presionSistolica: "",
  presionDiastolica: "",
  frecuenciaCardiaca: "",
  frecuenciaRespiratoria: "",
  temperatura: "",
  saturacionO2: "",
  pesoKg: "",
  tallaCm: "",
  escalaDolor: "",
  glucometriaMgdl: "",
  observaciones: "",
};

const TOMA_FIELDS: ReadonlyArray<{
  key: keyof Omit<TomaForm, "observaciones">;
  label: string;
  unit: string;
  step: string;
}> = [
  { key: "presionSistolica", label: "TA sistólica", unit: "mmHg", step: "1" },
  { key: "presionDiastolica", label: "TA diastólica", unit: "mmHg", step: "1" },
  { key: "frecuenciaCardiaca", label: "FC", unit: "lpm", step: "1" },
  { key: "frecuenciaRespiratoria", label: "FR", unit: "rpm", step: "1" },
  { key: "temperatura", label: "Temperatura", unit: "°C", step: "0.1" },
  { key: "saturacionO2", label: "SpO₂", unit: "%", step: "1" },
  { key: "pesoKg", label: "Peso", unit: "kg", step: "0.1" },
  { key: "tallaCm", label: "Talla", unit: "cm", step: "0.1" },
  { key: "escalaDolor", label: "Dolor (EVA)", unit: "0–10", step: "1" },
  { key: "glucometriaMgdl", label: "Glucemia", unit: "mg/dL", step: "1" },
];

function TablaSignosVitales({ episodioId }: { episodioId: string }) {
  const enabled = isUuid(episodioId);
  const [showForm, setShowForm] = React.useState(false);
  const [toma, setToma] = React.useState<TomaForm>(INITIAL_TOMA);
  const [error, setError] = React.useState<string | null>(null);

  const listQ = trpc.eceSignosVitales.list.useQuery(
    { episodioId, limit: 50 },
    { enabled },
  );

  const create = trpc.eceSignosVitales.create.useMutation({
    onSuccess: () => {
      setToma(INITIAL_TOMA);
      setShowForm(false);
      setError(null);
      void listQ.refetch();
    },
    onError: (e) => setError(e.message),
  });

  const imc = calcImc(toma.pesoKg, toma.tallaCm);
  const setField = (k: keyof TomaForm, v: string) => setToma((t) => ({ ...t, [k]: v }));

  function guardarToma() {
    setError(null);
    create.mutate({
      episodioId,
      presionSistolica: parseNum(toma.presionSistolica),
      presionDiastolica: parseNum(toma.presionDiastolica),
      frecuenciaCardiaca: parseNum(toma.frecuenciaCardiaca),
      frecuenciaRespiratoria: parseNum(toma.frecuenciaRespiratoria),
      temperatura: parseNum(toma.temperatura),
      saturacionO2: parseNum(toma.saturacionO2),
      escalaDolor: parseNum(toma.escalaDolor),
      pesoKg: parseNum(toma.pesoKg),
      tallaCm: parseNum(toma.tallaCm),
      glucometriaMgdl: parseNum(toma.glucometriaMgdl),
      observaciones: toma.observaciones.trim() || undefined,
    });
  }

  const items = listQ.data?.items ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle>Signos vitales</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setShowForm((s) => !s)}
          disabled={!enabled}
        >
          {showForm ? "Cerrar" : "Agregar toma"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!enabled && (
          <FormHint>
            Ingrese un Episodio (ID) válido en la sección anterior para ver y registrar tomas.
          </FormHint>
        )}

        {showForm && enabled && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {TOMA_FIELDS.map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`toma-${f.key}`} className="text-xs">
                    {f.label} <span className="text-muted-foreground">({f.unit})</span>
                  </Label>
                  <Input
                    id={`toma-${f.key}`}
                    type="number"
                    inputMode="decimal"
                    step={f.step}
                    value={toma[f.key]}
                    onChange={(e) => setField(f.key, e.target.value)}
                    disabled={create.isPending}
                  />
                </div>
              ))}
              <div className="space-y-1.5">
                <Label className="text-xs">IMC (kg/m²)</Label>
                <Input value={imc ?? ""} readOnly tabIndex={-1} placeholder="—" />
              </div>
            </div>
            <FormField>
              <Label htmlFor="toma-observaciones" className="text-xs">
                Observaciones
              </Label>
              <Textarea
                id="toma-observaciones"
                rows={2}
                value={toma.observaciones}
                onChange={(e) => setField("observaciones", e.target.value)}
                disabled={create.isPending}
              />
            </FormField>
            {error && (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={guardarToma} disabled={create.isPending}>
                {create.isPending ? "Guardando…" : "Guardar toma"}
              </Button>
            </div>
          </div>
        )}

        {enabled && (
          <div className="overflow-x-auto">
            {listQ.isLoading ? (
              <p className="text-sm text-muted-foreground">Cargando tomas…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sin tomas registradas para este episodio.</p>
            ) : (
              <table className="w-full min-w-[760px] text-sm" aria-label="Tomas de signos vitales">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="px-2 py-1.5 font-medium">Fecha/hora</th>
                    <th className="px-2 py-1.5 font-medium">TA</th>
                    <th className="px-2 py-1.5 font-medium">FC</th>
                    <th className="px-2 py-1.5 font-medium">FR</th>
                    <th className="px-2 py-1.5 font-medium">T°</th>
                    <th className="px-2 py-1.5 font-medium">SpO₂</th>
                    <th className="px-2 py-1.5 font-medium">IMC</th>
                    <th className="px-2 py-1.5 font-medium">Dolor</th>
                    <th className="px-2 py-1.5 font-medium">Glu</th>
                    <th className="px-2 py-1.5 font-medium">Obs.</th>
                    <th className="px-2 py-1.5 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-2 py-1.5">
                        {r.fecha_hora_toma ? new Date(r.fecha_hora_toma).toLocaleString("es-SV") : "—"}
                      </td>
                      <td className="px-2 py-1.5">
                        {fmt(r.presion_sistolica)}/{fmt(r.presion_diastolica)}
                      </td>
                      <td className="px-2 py-1.5">{fmt(r.frecuencia_cardiaca)}</td>
                      <td className="px-2 py-1.5">{fmt(r.frecuencia_respiratoria)}</td>
                      <td className="px-2 py-1.5">{fmt(r.temperatura)}</td>
                      <td className="px-2 py-1.5">{fmt(r.saturacion_o2)}</td>
                      <td className="px-2 py-1.5">{fmt(r.imc)}</td>
                      <td className="px-2 py-1.5">{fmt(r.escala_dolor)}</td>
                      <td className="px-2 py-1.5">{fmt(r.glucometria_mgdl)}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5" title={r.observaciones ?? ""}>
                        {fmt(r.observaciones)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Badge variant="outline" className="text-[10px]">
                          {r.estado_registro}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Buscador CIE-11 (RF-03 + §8.5) ─────────────────────────────────────────────

function BuscadorCIE11({
  onSelect,
  disabled,
}: {
  onSelect: (d: { codigo: string; descripcion: string }) => void;
  disabled?: boolean;
}) {
  const [term, setTerm] = React.useState("");
  const dterm = useDebounced(term, 300);

  const estadoQ = trpc.cie11.estado.useQuery(undefined, { staleTime: 300_000 });
  const buscarQ = trpc.cie11.buscar.useQuery(
    { q: dterm.trim(), limit: 10 },
    { enabled: dterm.trim().length >= 2, staleTime: 60_000 },
  );

  const items = buscarQ.data?.items ?? [];
  const configured = estadoQ.data?.configured ?? true;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="cie11-buscar">Buscar diagnóstico CIE-11</Label>
      <div className="relative">
        <Input
          id="cie11-buscar"
          placeholder="Escriba ≥2 caracteres (ej. neumonía, diabetes)…"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          disabled={disabled || !configured}
          autoComplete="off"
        />
        {dterm.trim().length >= 2 && (items.length > 0 || buscarQ.isFetching) && (
          <ul
            className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover shadow-md"
            aria-label="Resultados CIE-11"
          >
            {buscarQ.isFetching && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Buscando…</li>
            )}
            {items.map((it) => (
              <li key={it.uri || it.codigo}>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onSelect({ codigo: it.codigo, descripcion: it.titulo });
                    setTerm("");
                  }}
                >
                  {it.codigo && (
                    <span className="font-mono text-xs text-muted-foreground">{it.codigo}</span>
                  )}
                  <span>{it.titulo}</span>
                </button>
              </li>
            ))}
            {!buscarQ.isFetching && items.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">Sin resultados.</li>
            )}
          </ul>
        )}
      </div>
      {!configured && (
        <FormHint>
          Catálogo CIE-11 en línea no configurado — ingrese el código y descripción manualmente.
        </FormHint>
      )}
    </div>
  );
}

// ── Lista de diagnósticos CIE-11 (RF-03) ───────────────────────────────────────

function ListaDiagnosticosCIE11({
  diagnosticos,
  onChange,
  disabled,
}: {
  diagnosticos: Cie11Diagnostico[];
  onChange: (next: Cie11Diagnostico[]) => void;
  disabled?: boolean;
}) {
  const [codigo, setCodigo] = React.useState("");
  const [descripcion, setDescripcion] = React.useState("");
  const [tipo, setTipo] = React.useState<TipoDiagnostico>("PRESUNTIVO");
  const [error, setError] = React.useState<string | null>(null);

  function agregar() {
    const cod = codigo.trim().toUpperCase();
    if (!cod || !descripcion.trim()) {
      setError("Código y descripción son requeridos.");
      return;
    }
    if (!CIE11_CODE_REGEX.test(cod)) {
      setError(`Código CIE-11 inválido: '${cod}'.`);
      return;
    }
    setError(null);
    onChange([...diagnosticos, { codigo: cod, descripcion: descripcion.trim(), tipo }]);
    setCodigo("");
    setDescripcion("");
    setTipo("PRESUNTIVO");
  }

  const faltaComplementario = diagnosticos.length > 0 && !tieneComplementario(diagnosticos);

  return (
    <div className="space-y-4">
      <BuscadorCIE11
        disabled={disabled}
        onSelect={(d) => {
          setCodigo(d.codigo);
          setDescripcion(d.descripcion);
        }}
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="space-y-1.5 sm:w-40">
          <Label htmlFor="dxCodigo">Código CIE-11</Label>
          <Input
            id="dxCodigo"
            placeholder="Ej. CA40.0"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.toUpperCase())}
            disabled={disabled}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="dxDescripcion">Descripción</Label>
          <Input
            id="dxDescripcion"
            placeholder="Descripción del diagnóstico"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            disabled={disabled}
          />
        </div>
        <div className="space-y-1.5 sm:w-44">
          <Label htmlFor="dxTipo">Tipo</Label>
          <Select value={tipo} onValueChange={(v) => setTipo(v as TipoDiagnostico)} disabled={disabled}>
            <SelectTrigger id="dxTipo">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIPO_DIAGNOSTICO.map((t) => (
                <SelectItem key={t} value={t}>
                  {TIPO_DIAGNOSTICO_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={agregar}
          disabled={disabled || !codigo.trim() || !descripcion.trim()}
        >
          Agregar
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      {diagnosticos.length > 0 && (
        <ul className="divide-y rounded-md border" aria-label="Diagnósticos agregados">
          {diagnosticos.map((dx, i) => (
            <li key={`${dx.codigo}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">{dx.codigo}</span>
                <span>{dx.descripcion}</span>
                <Badge
                  variant={dx.tipo === "COMPLEMENTARIO" ? "default" : "secondary"}
                  className="text-[10px]"
                >
                  {TIPO_DIAGNOSTICO_LABELS[dx.tipo]}
                </Badge>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onChange(diagnosticos.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label={`Eliminar diagnóstico ${dx.codigo}`}
              >
                Eliminar
              </Button>
            </li>
          ))}
        </ul>
      )}

      {faltaComplementario && (
        <p className="text-xs text-amber-600 dark:text-amber-400" role="status">
          RN-03: se requiere al menos un diagnóstico de tipo <strong>Complementario</strong> antes de firmar.
        </p>
      )}
    </div>
  );
}

// ── Página ──────────────────────────────────────────────────────────────────────

export default function NuevaHistoriaClinicaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [calcularFpp, setCalcularFpp] = React.useState(false);
  const [fum, setFum] = React.useState("");
  const [diagnosticos, setDiagnosticos] = React.useState<Cie11Diagnostico[]>([]);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.eceHistoriaClinica.create.useMutation({
    onSuccess: () => router.push("/ece/historia-clinica"),
  });

  const isSubmitting = create.isPending;
  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!isUuid(form.episodioId)) {
      setClientError("Episodio (ID) debe ser un UUID válido.");
      return;
    }
    if (!form.tipoConsulta) {
      setClientError("Tipo de consulta es requerido.");
      return;
    }
    if (calcularFpp && !fum) {
      setClientError("RN-04: FUM es obligatoria cuando se calcula la FPP.");
      return;
    }
    if (calcularFpp && fum && fumFueraDeRango(fum)) {
      setClientError("RN-05: FUM debe estar entre hoy y hace 300 días.");
      return;
    }
    setClientError(null);

    const fpp = calcularFpp && fum ? calcularFppEg(fum)?.fpp : undefined;
    const antecedentesRaw = {
      alergias: form.alergias.trim() || undefined,
      personales: form.personales.trim() || undefined,
      familiares: form.familiares.trim() || undefined,
      ocupacion: form.ocupacion.trim() || undefined,
      habitosPersonales: form.habitosPersonales.trim() || undefined,
      obstetricos: form.obstetricos.trim() || undefined,
      calcularFpp: calcularFpp || undefined,
      fum: calcularFpp && fum ? fum : undefined,
      fpp,
    };
    const tieneAntecedentes = Object.values(antecedentesRaw).some((v) => v !== undefined);

    create.mutate({
      episodioId: form.episodioId.trim(),
      tipoConsulta: form.tipoConsulta as "primera_vez" | "subsecuente",
      motivoConsulta: form.motivoConsulta.trim() || undefined,
      enfermedadActual: form.enfermedadActual.trim() || undefined,
      destino: (form.destino as Destino) || undefined,
      analisisClinico: form.analisisClinico.trim() || undefined,
      planManejo: form.planManejo.trim() || undefined,
      antecedentes: tieneAntecedentes ? antecedentesRaw : undefined,
      examenFisico: form.hallazgosExamen.trim()
        ? { sistemas: [{ sistema: "General", hallazgo: form.hallazgosExamen.trim() }] }
        : undefined,
      diagnosticos: diagnosticos.length > 0 ? diagnosticos : undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva Historia Clínica</h1>
        <p className="text-sm text-muted-foreground">
          Registra la Historia Clínica Electrónica del paciente — NTEC Art. 7 (CC-0001).
        </p>
      </div>

      <Form onSubmit={onSubmit} noValidate aria-label="Formulario nueva historia clínica">
        {/* 1 ── Datos del episodio ──────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Datos del episodio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="episodioId">
                Episodio (ID) <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Input
                id="episodioId"
                name="episodioId"
                required
                aria-required="true"
                placeholder="UUID del episodio de atención"
                value={form.episodioId}
                onChange={(e) => updateField("episodioId", e.target.value)}
                disabled={isSubmitting}
              />
              <FormHint>UUID del episodio_atencion al que pertenece esta HC.</FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="tipoConsulta">
                Tipo de consulta <span aria-hidden="true" className="text-destructive">*</span>
              </Label>
              <Select
                value={form.tipoConsulta}
                onValueChange={(v) => updateField("tipoConsulta", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="tipoConsulta" aria-required="true">
                  <SelectValue placeholder="Seleccione tipo de consulta" />
                </SelectTrigger>
                <SelectContent>
                  {TIPO_CONSULTA_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField>
              <Label htmlFor="motivoConsulta">Motivo de consulta</Label>
              <Textarea
                id="motivoConsulta"
                name="motivoConsulta"
                rows={3}
                placeholder="Motivo principal de la consulta"
                value={form.motivoConsulta}
                onChange={(e) => updateField("motivoConsulta", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>

            <FormField>
              <Label htmlFor="enfermedadActual">Enfermedad actual</Label>
              <Textarea
                id="enfermedadActual"
                name="enfermedadActual"
                rows={4}
                placeholder="Descripción cronológica de la enfermedad actual…"
                value={form.enfermedadActual}
                onChange={(e) => updateField("enfermedadActual", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* 2 ── Antecedentes ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Antecedentes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-foreground">Patológicos</legend>
              <FormField>
                <Label htmlFor="alergias">Alergias</Label>
                <Textarea
                  id="alergias"
                  rows={2}
                  placeholder="Medicamentos, alimentos, látex…"
                  value={form.alergias}
                  onChange={(e) => updateField("alergias", e.target.value)}
                  disabled={isSubmitting}
                />
              </FormField>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField>
                  <Label htmlFor="personales">Personales</Label>
                  <Textarea
                    id="personales"
                    rows={3}
                    placeholder="Enfermedades previas, cirugías…"
                    value={form.personales}
                    onChange={(e) => updateField("personales", e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
                <FormField>
                  <Label htmlFor="familiares">Familiares</Label>
                  <Textarea
                    id="familiares"
                    rows={3}
                    placeholder="Diabetes, HTA, cáncer familiar…"
                    value={form.familiares}
                    onChange={(e) => updateField("familiares", e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>
            </fieldset>

            <fieldset className="space-y-4">
              <legend className="text-sm font-semibold text-foreground">No Patológicos</legend>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField>
                  <Label htmlFor="ocupacion">Ocupación</Label>
                  <Input
                    id="ocupacion"
                    placeholder="Ocupación / oficio"
                    value={form.ocupacion}
                    onChange={(e) => updateField("ocupacion", e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
                <FormField>
                  <Label htmlFor="habitosPersonales">Hábitos Personales</Label>
                  <Textarea
                    id="habitosPersonales"
                    rows={3}
                    placeholder="Tabaquismo, alcohol, actividad física…"
                    value={form.habitosPersonales}
                    onChange={(e) => updateField("habitosPersonales", e.target.value)}
                    disabled={isSubmitting}
                  />
                </FormField>
              </div>
              <BloqueObstetricoFPP
                obstetricos={form.obstetricos}
                onObstetricos={(v) => updateField("obstetricos", v)}
                calcularFpp={calcularFpp}
                onCalcularFpp={setCalcularFpp}
                fum={fum}
                onFum={setFum}
                disabled={isSubmitting}
              />
            </fieldset>
          </CardContent>
        </Card>

        {/* 3 ── Signos vitales ──────────────────────────────────────────────── */}
        <TablaSignosVitales episodioId={form.episodioId} />

        {/* 4 ── Examen físico ───────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Examen físico</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField>
              <Label htmlFor="hallazgosExamen">Hallazgos por aparato</Label>
              <Textarea
                id="hallazgosExamen"
                rows={5}
                placeholder="Cardiovascular, respiratorio, digestivo, neurológico…"
                value={form.hallazgosExamen}
                onChange={(e) => updateField("hallazgosExamen", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* 5 ── Diagnósticos CIE-11 ─────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-11)</CardTitle>
          </CardHeader>
          <CardContent>
            <ListaDiagnosticosCIE11
              diagnosticos={diagnosticos}
              onChange={setDiagnosticos}
              disabled={isSubmitting}
            />
          </CardContent>
        </Card>

        {/* 6 ── Análisis clínico ────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Análisis clínico</CardTitle>
          </CardHeader>
          <CardContent>
            <FormField>
              <Label htmlFor="analisisClinico">Razonamiento / correlación clínica</Label>
              <Textarea
                id="analisisClinico"
                rows={5}
                placeholder="Análisis y correlación clínica del caso…"
                value={form.analisisClinico}
                onChange={(e) => updateField("analisisClinico", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>
          </CardContent>
        </Card>

        {/* 7 ── Plan + Destino ──────────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <CardTitle>Plan</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField>
              <Label htmlFor="planManejo">Plan de manejo</Label>
              <Textarea
                id="planManejo"
                rows={5}
                placeholder="Medicamentos, procedimientos, indicaciones, seguimiento…"
                value={form.planManejo}
                onChange={(e) => updateField("planManejo", e.target.value)}
                disabled={isSubmitting}
              />
            </FormField>

            <FormField>
              <Label htmlFor="destino">Destino</Label>
              <Select
                value={form.destino}
                onValueChange={(v) => updateField("destino", v)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="destino">
                  <SelectValue placeholder="Seleccione destino" />
                </SelectTrigger>
                <SelectContent>
                  {DESTINO_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DESTINO_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </CardContent>
        </Card>

        {/* Error + acciones */}
        {errorMessage && (
          <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
            {errorMessage}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button type="submit" disabled={isSubmitting} aria-label="Guardar historia clínica como borrador">
            {isSubmitting ? "Guardando…" : "Guardar borrador"}
          </Button>
        </div>
      </Form>
    </div>
  );
}
