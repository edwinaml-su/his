"use client";

/**
 * Wizard Acto Quirúrgico (4 pasos) — NTEC §3.13.
 *
 * Paso 1 — Equipo: cirujano, anestesiólogo, ayudantes.
 * Paso 2 — Preoperatorio: diagnóstico pre, valoración ASA, checklist entrada.
 * Paso 3 — Técnica: procedimiento, hallazgos, técnica, complicaciones, sangrado,
 *           muestras, tiempo quirúrgico, hora inicio/fin.
 * Paso 4 — Postoperatorio + firma: diagnóstico post, registro URPA, PIN cirujano.
 *
 * La firma en paso 4 hace el documento INMUTABLE (NTEC §3.13).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Scissors, Users, ClipboardCheck, FlaskConical, HeartPulse, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";

// ── tipos locales ─────────────────────────────────────────────────────────────

type Step = 1 | 2 | 3 | 4 | "success";

interface FormState {
  // step 1 — Equipo
  episodioId: string;
  cirujanoId: string;
  anestesiologoId: string;
  // step 2 — Preop
  diagnosticoPre: string;
  asaClase: string;
  ayunoHoras: string;
  alergiasRelevantes: string;
  // step 3 — Técnica
  procedimientoRealizado: string;
  hallazgos: string;
  tecnica: string;
  complicaciones: string;
  sangradoEstimadoMl: string;
  muestrasEnviadas: string;
  tiempoQuirurgicoMin: string;
  horaInicio: string;
  horaFin: string;
  // step 4 — Postop
  diagnosticoPost: string;
  // firma
  pin: string;
  firmarAlCrear: boolean;
}

const INITIAL_FORM: FormState = {
  episodioId: "",
  cirujanoId: "",
  anestesiologoId: "",
  diagnosticoPre: "",
  asaClase: "",
  ayunoHoras: "",
  alergiasRelevantes: "",
  procedimientoRealizado: "",
  hallazgos: "",
  tecnica: "",
  complicaciones: "",
  sangradoEstimadoMl: "",
  muestrasEnviadas: "",
  tiempoQuirurgicoMin: "",
  horaInicio: "",
  horaFin: "",
  diagnosticoPost: "",
  pin: "",
  firmarAlCrear: false,
};

// ── step indicator ────────────────────────────────────────────────────────────

const STEPS = [
  { num: 1 as Step, label: "Equipo", icon: Users },
  { num: 2 as Step, label: "Preoperatorio", icon: ClipboardCheck },
  { num: 3 as Step, label: "Técnica", icon: FlaskConical },
  { num: 4 as Step, label: "Postop + Firma", icon: HeartPulse },
];

function StepIndicator({ current }: { current: Step }) {
  return (
    <nav aria-label="Pasos del acto quirúrgico" className="mb-6">
      <ol className="flex items-center gap-0">
        {STEPS.map((s, idx) => {
          const stepNum = s.num as number;
          const currentNum = typeof current === "number" ? current : 5;
          const done = currentNum > stepNum;
          const active = currentNum === stepNum;
          const Icon = s.icon;
          return (
            <React.Fragment key={s.label}>
              <li className="flex flex-col items-center">
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold",
                    done
                      ? "border-primary bg-primary text-primary-foreground"
                      : active
                        ? "border-primary text-primary"
                        : "border-muted-foreground/30 text-muted-foreground",
                  ].join(" ")}
                  aria-current={active ? "step" : undefined}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </span>
                <span
                  className={[
                    "mt-1 text-xs",
                    active ? "font-semibold text-primary" : "text-muted-foreground",
                  ].join(" ")}
                >
                  {s.label}
                </span>
              </li>
              {idx < STEPS.length - 1 && (
                <div
                  className={[
                    "mx-1 mb-5 h-0.5 flex-1",
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

// ── page ──────────────────────────────────────────────────────────────────────

export default function NuevoActoQxPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<Step>(1);
  const [form, setForm] = React.useState<FormState>(INITIAL_FORM);
  const [createdId, setCreatedId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const createMut = trpc.eceActoQx.create.useMutation();
  const firmarMut = trpc.eceActoQx.firmar.useMutation();

  function set(field: keyof FormState, value: string | boolean) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  // ── Step 1 — Equipo ─────────────────────────────────────────────────────────

  function renderStep1() {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" aria-hidden />
            Paso 1: Equipo quirúrgico
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="episodio-id">ID de episodio *</Label>
            <Input
              id="episodio-id"
              placeholder="UUID del episodio hospitalario"
              value={form.episodioId}
              onChange={(e) => set("episodioId", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cirujano-id">ID cirujano *</Label>
            <Input
              id="cirujano-id"
              placeholder="UUID del cirujano (personal_salud)"
              value={form.cirujanoId}
              onChange={(e) => set("cirujanoId", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="anestesiologo-id">ID anestesiólogo</Label>
            <Input
              id="anestesiologo-id"
              placeholder="UUID del anestesiólogo (opcional)"
              value={form.anestesiologoId}
              onChange={(e) => set("anestesiologoId", e.target.value)}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button
              disabled={!form.episodioId.trim() || !form.cirujanoId.trim()}
              onClick={() => setStep(2)}
            >
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 2 — Preoperatorio ──────────────────────────────────────────────────

  function renderStep2() {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5" aria-hidden />
            Paso 2: Preoperatorio
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="diag-pre">Diagnóstico preoperatorio *</Label>
            <Textarea
              id="diag-pre"
              rows={3}
              placeholder="Diagnóstico antes de la cirugía"
              value={form.diagnosticoPre}
              onChange={(e) => set("diagnosticoPre", e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="asa">Clase ASA</Label>
              <Input
                id="asa"
                placeholder="I, II, III, IV, V, VI"
                value={form.asaClase}
                onChange={(e) => set("asaClase", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ayuno">Ayuno (horas)</Label>
              <Input
                id="ayuno"
                type="number"
                min="0"
                max="48"
                placeholder="8"
                value={form.ayunoHoras}
                onChange={(e) => set("ayunoHoras", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="alergias">Alergias relevantes</Label>
              <Input
                id="alergias"
                placeholder="Penicilina, látex..."
                value={form.alergiasRelevantes}
                onChange={(e) => set("alergiasRelevantes", e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(1)}>Anterior</Button>
            <Button
              disabled={!form.diagnosticoPre.trim()}
              onClick={() => setStep(3)}
            >
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 3 — Técnica ────────────────────────────────────────────────────────

  function renderStep3() {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5" aria-hidden />
            Paso 3: Descripción técnica
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="procedimiento">Procedimiento realizado *</Label>
            <Textarea
              id="procedimiento"
              rows={3}
              placeholder="Descripción del procedimiento quirúrgico"
              value={form.procedimientoRealizado}
              onChange={(e) => set("procedimientoRealizado", e.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="hallazgos">Hallazgos</Label>
            <Textarea
              id="hallazgos"
              rows={2}
              placeholder="Hallazgos intraoperatorios"
              value={form.hallazgos}
              onChange={(e) => set("hallazgos", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tecnica">Técnica quirúrgica</Label>
            <Textarea
              id="tecnica"
              rows={2}
              placeholder="Descripción de la técnica empleada"
              value={form.tecnica}
              onChange={(e) => set("tecnica", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="complicaciones">Complicaciones</Label>
            <Textarea
              id="complicaciones"
              rows={2}
              placeholder="Ninguna / descripción de complicaciones"
              value={form.complicaciones}
              onChange={(e) => set("complicaciones", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="sangrado">Sangrado estimado (mL)</Label>
              <Input
                id="sangrado"
                type="number"
                min="0"
                placeholder="200"
                value={form.sangradoEstimadoMl}
                onChange={(e) => set("sangradoEstimadoMl", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tiempo-qx">Tiempo quirúrgico (min)</Label>
              <Input
                id="tiempo-qx"
                type="number"
                min="1"
                placeholder="120"
                value={form.tiempoQuirurgicoMin}
                onChange={(e) => set("tiempoQuirurgicoMin", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="muestras">Muestras enviadas</Label>
              <Input
                id="muestras"
                placeholder="Biopsias, cultivos..."
                value={form.muestrasEnviadas}
                onChange={(e) => set("muestrasEnviadas", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="hora-inicio">Hora de inicio</Label>
              <Input
                id="hora-inicio"
                type="datetime-local"
                value={form.horaInicio}
                onChange={(e) => set("horaInicio", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hora-fin">Hora de fin</Label>
              <Input
                id="hora-fin"
                type="datetime-local"
                value={form.horaFin}
                onChange={(e) => set("horaFin", e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(2)}>Anterior</Button>
            <Button
              disabled={!form.procedimientoRealizado.trim()}
              onClick={() => setStep(4)}
            >
              Siguiente
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Step 4 — Postop + Firma ─────────────────────────────────────────────────

  async function handleSubmit() {
    setError(null);
    try {
      const createResult = await createMut.mutateAsync({
        episodioId: form.episodioId.trim(),
        cirujanoId: form.cirujanoId.trim(),
        anestesiologoId: form.anestesiologoId.trim() || undefined,
        diagnosticoPre: form.diagnosticoPre.trim(),
        diagnosticoPost: form.diagnosticoPost.trim() || undefined,
        procedimientoRealizado: form.procedimientoRealizado.trim(),
        hallazgos: form.hallazgos.trim() || undefined,
        tecnica: form.tecnica.trim() || undefined,
        complicaciones: form.complicaciones.trim() || undefined,
        sangradoEstimadoMl: form.sangradoEstimadoMl ? parseInt(form.sangradoEstimadoMl, 10) : undefined,
        muestrasEnviadas: form.muestrasEnviadas.trim() || undefined,
        tiempoQuirurgicoMin: form.tiempoQuirurgicoMin ? parseInt(form.tiempoQuirurgicoMin, 10) : undefined,
        horaInicio: form.horaInicio ? new Date(form.horaInicio) : undefined,
        horaFin: form.horaFin ? new Date(form.horaFin) : undefined,
        valoracionPreop: form.asaClase
          ? {
              asaClase: form.asaClase as "I" | "II" | "III" | "IV" | "V" | "VI",
              ayunoHoras: form.ayunoHoras ? parseInt(form.ayunoHoras, 10) : undefined,
              alergiasRelevantes: form.alergiasRelevantes || undefined,
            }
          : undefined,
      });

      setCreatedId(createResult.actoQxId);

      // Firmar si el cirujano ingresó PIN en el mismo wizard
      if (form.firmarAlCrear && form.pin.trim()) {
        await firmarMut.mutateAsync({
          id: createResult.actoQxId,
          pin: form.pin.trim(),
        });
      }

      setStep("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function renderStep4() {
    const isLoading = createMut.isPending || firmarMut.isPending;
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <HeartPulse className="h-5 w-5" aria-hidden />
            Paso 4: Postoperatorio y firma
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="diag-post">Diagnóstico postoperatorio</Label>
            <Textarea
              id="diag-post"
              rows={3}
              placeholder="Diagnóstico confirmado tras la cirugía"
              value={form.diagnosticoPost}
              onChange={(e) => set("diagnosticoPost", e.target.value)}
            />
          </div>

          <div className="rounded-md border border-blue-400/40 bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-950/30 dark:text-blue-300">
            <p className="font-semibold">Firma electrónica del cirujano (opcional en este paso)</p>
            <p className="mt-1 text-xs">
              Puede guardar el borrador sin firmar y firmarlo desde el detalle del documento.
              Al firmar, el documento queda <strong>inmutable</strong>.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              id="firmar-al-crear"
              type="checkbox"
              checked={form.firmarAlCrear}
              onChange={(e) => set("firmarAlCrear", e.target.checked)}
              className="h-4 w-4 rounded border"
            />
            <Label htmlFor="firmar-al-crear">Firmar al guardar (requiere PIN)</Label>
          </div>

          {form.firmarAlCrear && (
            <div className="space-y-1.5">
              <Label htmlFor="pin">PIN de firma electrónica *</Label>
              <Input
                id="pin"
                type="password"
                placeholder="6-8 dígitos"
                maxLength={8}
                value={form.pin}
                onChange={(e) => set("pin", e.target.value)}
                autoComplete="off"
              />
            </div>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">{error}</p>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(3)} disabled={isLoading}>
              Anterior
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isLoading || (form.firmarAlCrear && form.pin.trim().length < 6)}
            >
              {isLoading
                ? "Guardando…"
                : form.firmarAlCrear
                  ? "Guardar y firmar"
                  : "Guardar borrador"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Success ─────────────────────────────────────────────────────────────────

  if (step === "success") {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <CheckCircle2 className="h-6 w-6 text-green-600" aria-hidden />
          Acto quirúrgico registrado
        </h1>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              El acto quirúrgico fue guardado exitosamente.{" "}
              {form.firmarAlCrear
                ? "El documento está firmado y es inmutable."
                : "Puede firmarlo desde el detalle del documento."}
            </p>
            <div className="mt-4 flex gap-2">
              {createdId && (
                <Button asChild variant="outline">
                  <a href={`/ece/quirofano/acto-quirurgico/${createdId}`}>
                    Ver documento
                  </a>
                </Button>
              )}
              <Button onClick={() => router.push("/ece/quirofano/acto-quirurgico")}>
                Volver al listado
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Scissors className="h-6 w-6" aria-hidden />
          Nuevo acto quirúrgico
        </h1>
        <p className="text-sm text-muted-foreground">
          NTEC §3.13 — Acuerdo n.° 1616 MINSAL 2024.
        </p>
      </div>

      <StepIndicator current={step} />

      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
      {step === 4 && renderStep4()}
    </div>
  );
}
