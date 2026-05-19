"use client";

/**
 * ECE — Wizard nueva solicitud RRI (2 pasos).
 * Paso 1: datos de la solicitud.
 * Paso 2: firma MC con PIN electrónico.
 *
 * HD-25 (S1): campos renombrados para alinear con BD:
 *   destinoServicioId → establecimientoDestinoId
 *   datosClinicosRelevantes → resumenClinico
 *   urgencia → eliminado (no existe en ece.rri)
 *
 * HD-26 (S1): validación UUID client-side en episodioId antes de submit.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ─── Tipos locales ────────────────────────────────────────────────────────────

type TipoRri = "referencia" | "retorno" | "interconsulta";

interface DatosSolicitud {
  episodioId: string;
  tipo: TipoRri | "";
  establecimientoDestinoId: string;
  motivo: string;
  resumenClinico: string;
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const TIPO_OPTIONS: { value: TipoRri; label: string }[] = [
  { value: "referencia", label: "Referencia" },
  { value: "retorno", label: "Retorno" },
  { value: "interconsulta", label: "Interconsulta" },
];

const STEPS = ["Datos solicitud", "Firma MC"];

// ─── Validación UUID (RFC 4122) ───────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

// ─── Indicador de pasos ───────────────────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <nav aria-label="Pasos del wizard" className="flex items-center gap-3">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            {i > 0 && <div className="h-px w-8 bg-border" aria-hidden />}
            <div className="flex items-center gap-1.5 text-sm">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              ) : (
                <Circle
                  className={`h-4 w-4 ${active ? "text-primary" : "text-muted-foreground"}`}
                  aria-hidden
                />
              )}
              <span
                className={
                  active ? "font-semibold text-foreground" : "text-muted-foreground"
                }
              >
                {label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ─── Paso 1: datos solicitud ──────────────────────────────────────────────────

function Step1({
  datos,
  onChange,
  onNext,
}: {
  datos: DatosSolicitud;
  onChange: (patch: Partial<DatosSolicitud>) => void;
  onNext: () => void;
}) {
  const [episodioTouched, setEpisodioTouched] = React.useState(false);

  const episodioError =
    episodioTouched && datos.episodioId.length > 0 && !isUuid(datos.episodioId)
      ? "El ID del episodio debe ser un UUID válido (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)"
      : null;

  const isValid =
    isUuid(datos.episodioId) &&
    datos.tipo !== "" &&
    isUuid(datos.establecimientoDestinoId) &&
    datos.motivo.trim().length > 0 &&
    datos.resumenClinico.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="episodio-id">
            Episodio (UUID) <span aria-hidden className="text-destructive">*</span>
          </Label>
          <Input
            id="episodio-id"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={datos.episodioId}
            onChange={(e) => onChange({ episodioId: e.target.value })}
            onBlur={() => setEpisodioTouched(true)}
            aria-describedby={episodioError ? "episodio-id-error" : undefined}
            aria-invalid={episodioError ? true : undefined}
            className={episodioError ? "border-destructive" : ""}
          />
          {episodioError && (
            <p id="episodio-id-error" role="alert" className="text-xs text-destructive">
              {episodioError}
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="tipo-rri">
            Tipo <span aria-hidden className="text-destructive">*</span>
          </Label>
          <Select
            value={datos.tipo}
            onValueChange={(v) => onChange({ tipo: v as TipoRri })}
          >
            <SelectTrigger id="tipo-rri">
              <SelectValue placeholder="Seleccione tipo…" />
            </SelectTrigger>
            <SelectContent>
              {TIPO_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="estab-destino">
            Establecimiento destino (UUID) <span aria-hidden className="text-destructive">*</span>
          </Label>
          <Input
            id="estab-destino"
            placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            value={datos.establecimientoDestinoId}
            onChange={(e) => onChange({ establecimientoDestinoId: e.target.value })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="motivo">
          Motivo de solicitud <span aria-hidden className="text-destructive">*</span>
        </Label>
        <textarea
          id="motivo"
          rows={3}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Describa el motivo de la solicitud…"
          maxLength={2000}
          value={datos.motivo}
          onChange={(e) => onChange({ motivo: e.target.value })}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="resumen-clinico">
          Resumen clinico <span aria-hidden className="text-destructive">*</span>
        </Label>
        <textarea
          id="resumen-clinico"
          rows={4}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder="Antecedentes, diagnóstico, medicamentos actuales, diagnóstico CIE-10…"
          maxLength={4000}
          value={datos.resumenClinico}
          onChange={(e) => onChange({ resumenClinico: e.target.value })}
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!isValid}>
          Continuar a firma
        </Button>
      </div>
    </div>
  );
}

// ─── Paso 2: firma MC ─────────────────────────────────────────────────────────

function Step2({
  datos,
  onBack,
  onDone,
}: {
  datos: DatosSolicitud;
  onBack: () => void;
  onDone: (rriId: string) => void;
}) {
  const [pin, setPin] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [createdRriId, setCreatedRriId] = React.useState<string | undefined>(undefined);

  const createMutation = trpc.eceRri.create.useMutation();
  const firmarMutation = trpc.eceRri.firmar.useMutation();

  const isReady = datos.tipo !== "";

  const handleFirmar = async () => {
    if (!isReady || pin.length < 6) return;
    setError(null);

    try {
      let rriId: string = createdRriId ?? "";
      if (!rriId) {
        const created = await createMutation.mutateAsync({
          episodioId: datos.episodioId,
          tipo: datos.tipo as TipoRri,
          establecimientoDestinoId: datos.establecimientoDestinoId,
          motivo: datos.motivo,
          resumenClinico: datos.resumenClinico,
        });
        rriId = created.rriId;
        setCreatedRriId(rriId);
      }

      await firmarMutation.mutateAsync({ rriId, pin });
      onDone(rriId);
    } catch (err) {
      setError(
        (err as { message?: string })?.message ??
          "Error al procesar la solicitud.",
      );
    }
  };

  const isPending = createMutation.isPending || firmarMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="rounded-md border bg-muted/40 px-4 py-3 text-sm">
        <p className="font-medium">Resumen de la solicitud</p>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Tipo</dt>
          <dd className="font-medium capitalize">{datos.tipo}</dd>
          <dt className="text-muted-foreground">Episodio</dt>
          <dd className="font-mono">{datos.episodioId.slice(0, 16)}…</dd>
        </dl>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="firma-pin">
          PIN de firma electronica <span aria-hidden className="text-destructive">*</span>
        </Label>
        <Input
          id="firma-pin"
          type="password"
          inputMode="numeric"
          placeholder="6-8 digitos"
          value={pin}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 8);
            setPin(digits);
            setError(null);
          }}
          disabled={isPending}
          className="tracking-widest text-center text-lg"
        />
        <p className="text-xs text-muted-foreground">
          La firma registra y avanza la solicitud al estado &quot;firmado&quot;.
        </p>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-between gap-2">
        <Button variant="outline" onClick={onBack} disabled={isPending}>
          Atras
        </Button>
        <Button
          onClick={() => void handleFirmar()}
          disabled={isPending || pin.length < 6}
        >
          {isPending ? "Procesando…" : "Firmar y enviar"}
        </Button>
      </div>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function NuevaRriPage() {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [datos, setDatos] = React.useState<DatosSolicitud>({
    episodioId: "",
    tipo: "",
    establecimientoDestinoId: "",
    motivo: "",
    resumenClinico: "",
  });

  const patchDatos = (patch: Partial<DatosSolicitud>) =>
    setDatos((prev) => ({ ...prev, ...patch }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ArrowLeftRight className="h-6 w-6" aria-hidden />
          Nueva solicitud RRI
        </h1>
        <p className="text-sm text-muted-foreground">
          Referencia / Retorno / Interconsulta — NTEC Doc 10
        </p>
      </div>

      <StepIndicator current={step} />

      <Card>
        <CardHeader>
          <CardTitle>{STEPS[step]}</CardTitle>
        </CardHeader>
        <CardContent>
          {step === 0 && (
            <Step1
              datos={datos}
              onChange={patchDatos}
              onNext={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <Step2
              datos={datos}
              onBack={() => setStep(0)}
              onDone={(rriId) => router.push(`/ece/rri/${rriId}`)}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
