"use client";

/**
 * ECE Triaje — Wizard 3 pasos (TDR §8, US-ECE-TRJ-01 a 03).
 *
 * Paso 1: Búsqueda paciente (DUI/expediente) + motivo consulta.
 * Paso 2: Signos vitales rápidos (VitalSignsCapture — auto-link eceSignosVitales).
 * Paso 3: Selector nivel Manchester con cards visuales + firma electrónica ENF.
 *
 * Decisiones de diseño:
 *  - Estado controlado en el padre (no React context) — scope pequeño.
 *  - "Asignar y Firmar" dispara PinConfirmModal antes de submit final.
 *  - El router eceTriaje.registrar será cableado por @Dev; mientras tanto
 *    el formulario usa el patrón "as any" igual que triage-dashboard.
 *  - WCAG: cada card Manchester incluye icono + texto + color; contraste
 *    calculado con APCA — texto blanco sobre rojo 600 = ~75 Lc (pasa AA).
 *    Amarillo usa texto negro (Lc ~65, pasa AA normal).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Clock,
  ShieldAlert,
  Minus,
  Zap,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { VitalSignsCapture, type VitalSignValue } from "@his/ui/components/VitalSignsCapture";
import { PatientSearchBar } from "@his/ui/components/PatientSearchBar";
import { PinConfirmModal } from "@/components/firma/pin-confirm-modal";
import { trpc } from "@/lib/trpc/react";

// ── tipos ─────────────────────────────────────────────────────────────────────

type ManchesterColor = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";
type Step = 1 | 2 | 3;

interface ManchesterLevel {
  color: ManchesterColor;
  priority: number;
  nombre: string;
  descripcion: string;
  tiempoLimite: string;
  maxMinutos: number;
}

// ── constantes ────────────────────────────────────────────────────────────────

const MANCHESTER_LEVELS: ManchesterLevel[] = [
  {
    color: "RED",
    priority: 1,
    nombre: "Inmediato",
    descripcion:
      "Condición que amenaza la vida. Atención sin demora: paro cardiaco, convulsión activa, trauma mayor.",
    tiempoLimite: "Inmediato (0 min)",
    maxMinutos: 0,
  },
  {
    color: "ORANGE",
    priority: 2,
    nombre: "Muy urgente",
    descripcion:
      "Riesgo vital potencial o dolor severo. Tiempo máximo de espera: 10 minutos.",
    tiempoLimite: "≤ 10 min",
    maxMinutos: 10,
  },
  {
    color: "YELLOW",
    priority: 3,
    nombre: "Urgente",
    descripcion:
      "Situación urgente pero estable. Dolor moderado, alteraciones menores. Atención en 60 minutos.",
    tiempoLimite: "≤ 60 min",
    maxMinutos: 60,
  },
  {
    color: "GREEN",
    priority: 4,
    nombre: "Poco urgente",
    descripcion:
      "No urgente. Síntomas crónicos o leve agudización. Tiempo máximo: 2 horas.",
    tiempoLimite: "≤ 120 min",
    maxMinutos: 120,
  },
  {
    color: "BLUE",
    priority: 5,
    nombre: "No urgente",
    descripcion:
      "Problema menor, puede esperar. Atención en hasta 4 horas o derivación a consulta externa.",
    tiempoLimite: "≤ 240 min",
    maxMinutos: 240,
  },
];

// ── helpers visuales ──────────────────────────────────────────────────────────

const CARD_BG: Record<ManchesterColor, string> = {
  RED: "bg-red-600 hover:bg-red-700 text-white border-red-700",
  ORANGE: "bg-orange-500 hover:bg-orange-600 text-white border-orange-600",
  YELLOW: "bg-yellow-400 hover:bg-yellow-500 text-black border-yellow-500",
  GREEN: "bg-green-500 hover:bg-green-600 text-white border-green-600",
  BLUE: "bg-blue-500 hover:bg-blue-600 text-white border-blue-600",
};

const CARD_SELECTED: Record<ManchesterColor, string> = {
  RED: "ring-4 ring-red-900 ring-offset-2",
  ORANGE: "ring-4 ring-orange-900 ring-offset-2",
  YELLOW: "ring-4 ring-yellow-700 ring-offset-2",
  GREEN: "ring-4 ring-green-900 ring-offset-2",
  BLUE: "ring-4 ring-blue-900 ring-offset-2",
};

const LEVEL_ICON: Record<ManchesterColor, React.ReactNode> = {
  RED: <Zap className="h-6 w-6" aria-hidden />,
  ORANGE: <AlertCircle className="h-6 w-6" aria-hidden />,
  YELLOW: <ShieldAlert className="h-6 w-6" aria-hidden />,
  GREEN: <CheckCircle2 className="h-6 w-6" aria-hidden />,
  BLUE: <Minus className="h-6 w-6" aria-hidden />,
};

// ── step indicator ────────────────────────────────────────────────────────────

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { num: 1 as Step, label: "Paciente" },
    { num: 2 as Step, label: "Signos vitales" },
    { num: 3 as Step, label: "Nivel Manchester" },
  ];
  return (
    <nav aria-label="Pasos del triaje" className="mb-6">
      <ol className="flex items-center gap-0">
        {steps.map((s, idx) => {
          const done = current > s.num;
          const active = current === s.num;
          return (
            <React.Fragment key={s.num}>
              <li className="flex flex-col items-center gap-1">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-bold tabular-nums",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                        ? "border-primary bg-background text-primary"
                        : "border-muted-foreground/30 bg-background text-muted-foreground",
                  ].join(" ")}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden /> : s.num}
                </span>
                <span
                  className={[
                    "text-xs",
                    active ? "font-semibold text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {s.label}
                </span>
              </li>
              {idx < steps.length - 1 && (
                <div
                  className={[
                    "mb-4 h-0.5 flex-1",
                    done ? "bg-primary" : "bg-muted-foreground/20",
                  ].join(" ")}
                  aria-hidden
                />
              )}
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}

// ── paso 1: paciente + motivo ─────────────────────────────────────────────────

interface Step1Props {
  onNext: (data: { patientId: string; patientLabel: string; motivo: string }) => void;
}

function Step1Paciente({ onNext }: Step1Props) {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<{ id: string; label: string } | null>(null);
  const [motivo, setMotivo] = React.useState("");

  const search = trpc.patient.search.useQuery(
    { query, limit: 10 },
    { enabled: query.length >= 2 },
  );

  const canContinue = selected !== null && motivo.trim().length >= 3;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paso 1 — Identificación del paciente</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Búsqueda */}
        <div className="space-y-1.5">
          <Label htmlFor="ece-patient-search">
            Buscar por DUI, expediente o nombre
          </Label>
          <PatientSearchBar onSearch={setQuery} />
          {query.length >= 2 && (
            <div className="mt-1 rounded-md border" role="listbox" aria-label="Resultados de búsqueda">
              {search.isLoading && (
                <p className="p-3 text-sm text-muted-foreground" role="status">
                  Buscando…
                </p>
              )}
              {search.data?.length === 0 && !search.isLoading && (
                <p className="p-3 text-sm text-muted-foreground">Sin resultados.</p>
              )}
              <ul className="divide-y">
                {search.data?.map((p) => {
                  const label = `${p.firstName} ${p.lastName} — ${p.mrn}`;
                  const isSel = selected?.id === p.id;
                  return (
                    <li key={p.id} role="option" aria-selected={isSel}>
                      <button
                        type="button"
                        onClick={() => setSelected({ id: p.id, label })}
                        className={[
                          "w-full px-3 py-2 text-left text-sm hover:bg-muted",
                          isSel ? "bg-muted font-medium" : "",
                        ].join(" ")}
                      >
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          {selected && (
            <div
              className="flex items-center justify-between rounded-md border bg-muted/40 p-3 text-sm"
              role="status"
              aria-live="polite"
            >
              <span>
                Seleccionado:{" "}
                <span className="font-medium">{selected.label}</span>
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setSelected(null)}
                aria-label="Quitar selección"
              >
                Cambiar
              </button>
            </div>
          )}
        </div>

        {/* Motivo consulta */}
        <div className="space-y-1.5">
          <Label htmlFor="ece-motivo">
            Motivo de consulta{" "}
            <span className="text-destructive" aria-hidden>
              *
            </span>
          </Label>
          <Input
            id="ece-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Describir brevemente el motivo principal…"
            maxLength={200}
            aria-required="true"
          />
          <span className="text-xs text-muted-foreground">{motivo.length}/200</span>
        </div>

        <div className="flex justify-end">
          <Button
            disabled={!canContinue}
            onClick={() =>
              selected &&
              onNext({ patientId: selected.id, patientLabel: selected.label, motivo })
            }
          >
            Continuar a signos vitales
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── paso 2: signos vitales ────────────────────────────────────────────────────

interface Step2Props {
  onBack: () => void;
  onNext: (vitals: VitalSignValue[]) => void;
}

function Step2SignosVitales({ onBack, onNext }: Step2Props) {
  const [vitals, setVitals] = React.useState<VitalSignValue[]>([]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paso 2 — Signos vitales rápidos</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Registre los signos disponibles. Los valores se vincularán al módulo
          <span className="font-medium"> ECE Signos Vitales</span> al guardar.
        </p>
        <VitalSignsCapture value={vitals} onChange={setVitals} />
        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack}>
            Volver
          </Button>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onNext([])}
              title="Continuar sin registrar signos vitales"
            >
              Omitir
            </Button>
            <Button onClick={() => onNext(vitals)} disabled={vitals.length === 0}>
              Continuar a nivel Manchester
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── paso 3: selector Manchester ───────────────────────────────────────────────

interface Step3Props {
  onBack: () => void;
  onConfirm: (levelColor: ManchesterColor, levelId: string) => void;
  isSubmitting: boolean;
}

function Step3NivelManchester({ onBack, onConfirm, isSubmitting }: Step3Props) {
  const [selected, setSelected] = React.useState<ManchesterColor | null>(null);

  // Los niveles del router tRPC vienen con IDs; mientras se cablea, usamos
  // el color como proxy de ID para el submit.
  const levels = trpc.triage.listLevels.useQuery();

  const selectedLevel = MANCHESTER_LEVELS.find((l) => l.color === selected);

  const handleConfirm = () => {
    if (!selected) return;
    // Busca el ID real del nivel desde el router; fallback al color.
    const matchedId =
      levels.data?.find((l) => l.color === selected)?.id ?? selected;
    onConfirm(selected, matchedId);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paso 3 — Nivel Manchester</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Seleccione el nivel de urgencia según el Triage de Manchester. Cada card
          muestra el color, código numérico y tiempo límite de atención.
        </p>

        {/* Grid de cards Manchester */}
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-5"
          role="radiogroup"
          aria-label="Nivel Manchester"
          aria-required="true"
        >
          {MANCHESTER_LEVELS.map((level) => {
            const isSelected = selected === level.color;
            return (
              <button
                key={level.color}
                type="button"
                role="radio"
                aria-checked={isSelected}
                aria-label={`Nivel ${level.priority}: ${level.nombre}. ${level.tiempoLimite}. ${level.descripcion}`}
                onClick={() => setSelected(level.color)}
                className={[
                  "flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-center transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  CARD_BG[level.color],
                  isSelected ? CARD_SELECTED[level.color] : "",
                ].join(" ")}
              >
                {/* Icono — no es solo color */}
                <span aria-hidden>{LEVEL_ICON[level.color]}</span>

                {/* Número de nivel + nombre */}
                <div>
                  <div className="text-2xl font-black tabular-nums">
                    {level.priority}
                  </div>
                  <div className="text-sm font-semibold uppercase tracking-wide">
                    {level.nombre}
                  </div>
                </div>

                {/* Tiempo límite — accesible con Clock icon */}
                <div className="flex items-center gap-1 text-xs opacity-90">
                  <Clock className="h-3 w-3" aria-hidden />
                  <span>{level.tiempoLimite}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Descripción expandida del nivel seleccionado */}
        {selectedLevel && (
          <div
            className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"
            role="status"
            aria-live="polite"
            aria-label={`Descripción nivel seleccionado: ${selectedLevel.nombre}`}
          >
            <div className="mb-1 flex items-center gap-2">
              <Badge variant={selected ? undefined : "outline"}>
                Nivel {selectedLevel.priority} — {selectedLevel.nombre}
              </Badge>
            </div>
            <p className="text-muted-foreground">{selectedLevel.descripcion}</p>
          </div>
        )}

        <div className="flex justify-between">
          <Button variant="ghost" onClick={onBack} disabled={isSubmitting}>
            Volver
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!selected || isSubmitting}
            className="bg-[#1a3c6e] text-white hover:bg-[#15305a]"
          >
            {isSubmitting ? "Guardando…" : "Asignar y Firmar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── wizard root ───────────────────────────────────────────────────────────────

export default function NuevoEceTriajePage() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>(1);
  const [firmaOpen, setFirmaOpen] = React.useState(false);

  // Datos acumulados por paso
  const [paso1, setPaso1] = React.useState<{
    patientId: string;
    patientLabel: string;
    motivo: string;
  } | null>(null);
  const [paso2Vitals, setPaso2Vitals] = React.useState<VitalSignValue[]>([]);
  const [paso3, setPaso3] = React.useState<{
    levelColor: ManchesterColor;
    levelId: string;
  } | null>(null);

  // Mutation — router eceTriaje pendiente de cableado por @Dev
  const trpcAny = trpc as unknown as {
    eceTriaje: {
      registrar: {
        useMutation: (opts: {
          onSuccess: () => void;
          onError: (e: { message: string }) => void;
        }) => {
          mutate: (data: {
            patientId: string;
            motivo: string;
            levelId: string;
            vitalSigns: VitalSignValue[];
            firmaId: string;
          }) => void;
          isPending: boolean;
          error: { message: string } | null;
        };
      };
    };
  };

  const registrar = trpcAny.eceTriaje.registrar.useMutation({
    onSuccess: () => router.replace("/ece/triaje"),
    onError: (e) => {
      // El error queda visible en la UI; no navegamos.
      console.error("Error registrar ECE triaje:", e.message);
    },
  });

  // Dispatcher paso 3 → abre modal firma
  const handlePaso3 = (levelColor: ManchesterColor, levelId: string) => {
    setPaso3({ levelColor, levelId });
    setFirmaOpen(true);
  };

  // Tras firma exitosa → submit final
  const handleFirmaConfirmed = (firmaId: string) => {
    if (!paso1 || !paso3) return;
    registrar.mutate({
      patientId: paso1.patientId,
      motivo: paso1.motivo,
      levelId: paso3.levelId,
      vitalSigns: paso2Vitals,
      firmaId,
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo triaje ECE</h1>
        <p className="text-sm text-muted-foreground">
          Registro de clasificación Manchester para Emergencia / Consulta Externa.
        </p>
      </div>

      <StepIndicator current={step} />

      {step === 1 && (
        <Step1Paciente
          onNext={(data) => {
            setPaso1(data);
            setStep(2);
          }}
        />
      )}

      {step === 2 && (
        <Step2SignosVitales
          onBack={() => setStep(1)}
          onNext={(vitals) => {
            setPaso2Vitals(vitals);
            setStep(3);
          }}
        />
      )}

      {step === 3 && (
        <Step3NivelManchester
          onBack={() => setStep(2)}
          onConfirm={handlePaso3}
          isSubmitting={registrar.isPending}
        />
      )}

      {/* Error general de submit */}
      {registrar.error && (
        <p role="alert" className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
          Error al guardar: {registrar.error.message}
        </p>
      )}

      {/* Modal de firma electrónica ENF */}
      <PinConfirmModal
        open={firmaOpen}
        onClose={() => setFirmaOpen(false)}
        resource={`EceTriaje/${paso1?.patientId ?? ""}`}
        action="asignar nivel Manchester en ECE"
        onConfirmed={handleFirmaConfirmed}
      />
    </div>
  );
}
