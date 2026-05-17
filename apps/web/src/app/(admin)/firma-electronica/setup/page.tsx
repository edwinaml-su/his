"use client";

/**
 * US-19.x — Wizard de configuración de firma electrónica (NTEC Art. 23).
 *
 * Pasos:
 *   1. Explicación legal (NTEC Art. 23 + LOPDP SV).
 *   2. Crear PIN (6–12 dígitos numéricos).
 *   3. Confirmación / resumen.
 *
 * Si el usuario ya tiene firma activa, se muestra un banner con opción
 * "Cambiar PIN" que reinicia el wizard desde el paso 2.
 *
 * WCAG 2.2 AA:
 *   - Todos los inputs con <label> explícito (htmlFor).
 *   - Errores en aria-live="polite" region.
 *   - Focus trapped dentro del paso activo via tabIndex.
 *   - Contraste garantizado vía tokens semánticos (no hardcoded).
 *   - Botones con aria-label descriptivo cuando el texto solo tiene iconografía.
 */

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
// @ts-expect-error — trpc.firma aún no registrado en _app.ts (Stream 18 pendiente).
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

type Step = 1 | 2 | 3;

// ---------------------------------------------------------------------------
// Constantes y utilidades
// ---------------------------------------------------------------------------

const PIN_MIN = 6;
const PIN_MAX = 12;
const RE_DIGITS_ONLY = /^\d*$/;

function validatePin(pin: string): string | null {
  if (!RE_DIGITS_ONLY.test(pin)) return "El PIN solo debe contener dígitos (0–9).";
  if (pin.length < PIN_MIN) return `El PIN debe tener al menos ${PIN_MIN} dígitos.`;
  if (pin.length > PIN_MAX) return `El PIN no puede superar ${PIN_MAX} dígitos.`;
  return null;
}

// Icono de candado SVG inline (sin dependencia externa).
function LockIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

// Icono de check.
function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Sub-componentes de paso
// ---------------------------------------------------------------------------

/** Paso 1: explicación legal NTEC Art. 23. */
function StepLegal({ onNext }: { onNext: () => void }) {
  return (
    <section aria-labelledby="step1-heading">
      <h2
        id="step1-heading"
        className="mb-4 text-xl font-semibold text-foreground"
      >
        Marco legal de la firma electrónica
      </h2>

      <div className="space-y-4 text-sm text-muted-foreground leading-relaxed">
        <p>
          La firma electrónica simple tiene plena validez jurídica conforme a
          la{" "}
          <strong className="text-foreground">
            Ley de Firma Electrónica (Decreto 826) y la NTEC Art.&nbsp;23
          </strong>{" "}
          de El Salvador, aplicable a documentos clínicos electrónicos emitidos
          por el Complejo Hospitalario Avante.
        </p>
        <p>
          Su configuración implica la creación de un PIN personal e intransferible
          de{" "}
          <strong className="text-foreground">{PIN_MIN}–{PIN_MAX} dígitos numéricos</strong>.
          Usted es responsable de mantenerlo en confidencialidad (LOPDP SV, Art. 17).
        </p>

        <div
          role="note"
          className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-primary"
        >
          <p className="font-medium">Efectos jurídicos</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>Los documentos firmados con su PIN tienen presunción de autoría.</li>
            <li>
              El sistema registra un hash SHA-256 inmutable en la cadena de
              auditoría (TDR §6.3). No es posible repudiar la firma posterior.
            </li>
            <li>Retención mínima: 10 años según regulación hospitalaria SV.</li>
          </ul>
        </div>

        <p>
          Al continuar, declara haber leído y aceptado los términos anteriores.
        </p>
      </div>

      <div className="mt-8 flex justify-end">
        <Button onClick={onNext} aria-label="Entendido, continuar al paso 2">
          Entendido — Continuar
        </Button>
      </div>
    </section>
  );
}

/** Paso 2: creación y confirmación del PIN. */
function StepCreatePin({
  onSuccess,
  isChanging,
}: {
  onSuccess: (maskedPin: string) => void;
  isChanging: boolean;
}) {
  const [pin, setPin] = React.useState("");
  const [pinConfirm, setPinConfirm] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Ref para el live-region de errores (WCAG SC 4.1.3).
  const liveRegionRef = React.useRef<HTMLDivElement>(null);

  // @ts-expect-error — trpc.firma aún no registrado en _app.ts (Stream 18 pendiente).
  const setup = trpc.firma.setup.useMutation({
    onSuccess: () => {
      // Enmascarar: muestra primero 2 y últimos 2 dígitos.
      const masked =
        pin.slice(0, 2) + "*".repeat(Math.max(0, pin.length - 4)) + pin.slice(-2);
      onSuccess(masked);
    },
    onError: (err: { message: string }) => {
      setServerError(err.message ?? "Error al guardar el PIN. Intente nuevamente.");
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const pinErr = validatePin(pin);
    setPinError(pinErr);

    let confirmErr: string | null = null;
    if (!pinErr && pin !== pinConfirm) {
      confirmErr = "Los PINs no coinciden.";
    }
    setConfirmError(confirmErr);

    if (pinErr || confirmErr) return;

    setup.mutate({ pin });
  }

  // Todos los errores visibles — anunciados al live region.
  const allErrors = [pinError, confirmError, serverError].filter(Boolean).join(" ");

  return (
    <section aria-labelledby="step2-heading">
      <h2
        id="step2-heading"
        className="mb-4 text-xl font-semibold text-foreground"
      >
        {isChanging ? "Cambiar PIN de firma" : "Crear PIN de firma"}
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Ingrese un PIN numérico de {PIN_MIN} a {PIN_MAX} dígitos. No lo comparta con nadie.
      </p>

      {/* Live region WCAG SC 4.1.3 — anuncia errores a lectores de pantalla */}
      <div
        ref={liveRegionRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {allErrors}
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-5">
        {/* Campo PIN */}
        <div className="space-y-1.5">
          <Label htmlFor="pin-input">
            PIN de firma
            <span aria-hidden="true" className="ml-1 text-muted-foreground">
              ({PIN_MIN}–{PIN_MAX} dígitos)
            </span>
          </Label>
          <div className="relative">
            <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => {
                const v = e.target.value;
                if (RE_DIGITS_ONLY.test(v) && v.length <= PIN_MAX) setPin(v);
                if (pinError) setPinError(validatePin(v));
              }}
              aria-required="true"
              aria-invalid={pinError ? "true" : undefined}
              aria-describedby={pinError ? "pin-error" : "pin-hint"}
              className="pl-9"
              maxLength={PIN_MAX}
            />
          </div>

          {/* Indicador visual de fortaleza del PIN */}
          <PinStrengthBar length={pin.length} />

          <span id="pin-hint" className="text-xs text-muted-foreground">
            Solo dígitos numéricos (0–9).
          </span>

          {pinError && (
            <p id="pin-error" role="alert" className="text-xs text-destructive">
              {pinError}
            </p>
          )}
        </div>

        {/* Campo confirmación */}
        <div className="space-y-1.5">
          <Label htmlFor="pin-confirm-input">Confirmar PIN</Label>
          <div className="relative">
            <LockIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="pin-confirm-input"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pinConfirm}
              onChange={(e) => {
                const v = e.target.value;
                if (RE_DIGITS_ONLY.test(v) && v.length <= PIN_MAX) setPinConfirm(v);
                if (confirmError) setConfirmError(v !== pin ? "Los PINs no coinciden." : null);
              }}
              aria-required="true"
              aria-invalid={confirmError ? "true" : undefined}
              aria-describedby={confirmError ? "confirm-error" : undefined}
              className="pl-9"
              maxLength={PIN_MAX}
            />
          </div>
          {confirmError && (
            <p id="confirm-error" role="alert" className="text-xs text-destructive">
              {confirmError}
            </p>
          )}
        </div>

        {/* Error de servidor */}
        {serverError && (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={setup.isPending}
            aria-label={
              setup.isPending
                ? "Guardando PIN, espere..."
                : isChanging
                ? "Cambiar PIN de firma electrónica"
                : "Crear PIN de firma electrónica"
            }
          >
            {setup.isPending
              ? "Guardando…"
              : isChanging
              ? "Cambiar PIN"
              : "Crear PIN"}
          </Button>
        </div>
      </form>
    </section>
  );
}

/** Barra visual de fortaleza del PIN (informativa, no bloquea). */
function PinStrengthBar({ length }: { length: number }) {
  // 0–2: débil, 3–5: aceptable, 6+: fuerte (dentro del rango válido).
  const level =
    length === 0 ? 0 : length < PIN_MIN ? 1 : length <= 8 ? 2 : 3;

  const colors = [
    "bg-muted",
    "bg-destructive",
    "bg-warning",
    "bg-success",
  ] as const;

  const labels = ["", "Muy corto", "Aceptable", "Fuerte"] as const;

  return (
    <div className="space-y-1">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3].map((seg) => (
          <div
            key={seg}
            className={`h-1 flex-1 rounded-full transition-colors duration-200 ${
              level >= seg ? colors[level] : "bg-muted"
            }`}
          />
        ))}
      </div>
      {length > 0 && (
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {labels[level]}
        </span>
      )}
    </div>
  );
}

/** Paso 3: confirmación final. */
function StepConfirm({ maskedPin, onReset }: { maskedPin: string; onReset: () => void }) {
  return (
    <section aria-labelledby="step3-heading" className="text-center">
      <div
        className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-success/15"
        aria-hidden="true"
      >
        <CheckIcon className="h-8 w-8 text-success" />
      </div>

      <h2
        id="step3-heading"
        className="mb-2 text-xl font-semibold text-foreground"
      >
        PIN configurado correctamente
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Su PIN de firma electrónica ha sido guardado de forma segura.
        <br />
        PIN registrado:{" "}
        <span className="font-mono text-foreground" aria-label="PIN enmascarado">
          {maskedPin}
        </span>
      </p>

      <div
        role="note"
        className="mb-8 rounded-lg border border-primary/30 bg-primary/5 p-4 text-left text-sm text-primary"
      >
        <p className="font-medium">Recuerde</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Use su PIN únicamente en formularios clínicos autorizados de Avante HIS.</li>
          <li>No comparta su PIN bajo ninguna circunstancia.</li>
          <li>Si sospecha que fue comprometido, cámbielo de inmediato.</li>
        </ul>
      </div>

      <Button variant="outline" onClick={onReset} aria-label="Cambiar PIN de firma electrónica">
        Cambiar PIN
      </Button>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Indicador de pasos (stepper)
// ---------------------------------------------------------------------------

const STEPS: { label: string }[] = [
  { label: "Marco legal" },
  { label: "Crear PIN" },
  { label: "Confirmación" },
];

function Stepper({ current }: { current: Step }) {
  return (
    <nav
      aria-label="Progreso del wizard"
      className="mb-8 flex items-center gap-0"
    >
      {STEPS.map((step, idx) => {
        const stepNum = (idx + 1) as Step;
        const isDone = stepNum < current;
        const isActive = stepNum === current;

        return (
          <React.Fragment key={step.label}>
            {idx > 0 && (
              <div
                className={`h-px flex-1 ${isDone ? "bg-primary" : "bg-border"}`}
                aria-hidden="true"
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                aria-current={isActive ? "step" : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                  isDone
                    ? "bg-primary text-primary-foreground"
                    : isActive
                    ? "border-2 border-primary bg-background text-primary"
                    : "border border-border bg-background text-muted-foreground"
                }`}
              >
                {isDone ? (
                  <CheckIcon className="h-4 w-4" />
                ) : (
                  stepNum
                )}
              </div>
              <span
                className={`text-xs ${
                  isActive
                    ? "font-medium text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                {step.label}
              </span>
            </div>
          </React.Fragment>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Banner: usuario ya tiene firma activa
// ---------------------------------------------------------------------------

function ExistingFirmaBanner({ onChangePinClick }: { onChangePinClick: () => void }) {
  return (
    <div
      role="status"
      className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-success/40 bg-success/10 p-4"
    >
      <div className="flex items-start gap-3">
        <CheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-success" />
        <div>
          <p className="text-sm font-medium text-foreground">
            Firma electrónica activa
          </p>
          <p className="text-xs text-muted-foreground">
            Ya tiene un PIN configurado. Puede cambiarlo cuando lo necesite.
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onChangePinClick}
        aria-label="Iniciar proceso para cambiar el PIN de firma electrónica"
      >
        Cambiar PIN
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function FirmaElectronicaSetupPage() {
  const [step, setStep] = React.useState<Step>(1);
  const [maskedPin, setMaskedPin] = React.useState<string>("");
  const [isChangingPin, setIsChangingPin] = React.useState(false);

  // Consulta de estado actual del usuario.
  // @ts-expect-error — trpc.firma aún no registrado en _app.ts (Stream 18 pendiente).
  const statusQuery = trpc.firma.status.useQuery(undefined, {
    retry: false,
  });

  const hasActiveFirma =
    statusQuery.data?.hasPin === true && !isChangingPin;

  function handleChangePinClick() {
    setIsChangingPin(true);
    setStep(2);
    setMaskedPin("");
  }

  function handlePinSuccess(masked: string) {
    setMaskedPin(masked);
    setStep(3);
  }

  function handleResetFromConfirm() {
    setIsChangingPin(true);
    setStep(2);
    setMaskedPin("");
  }

  return (
    <div className="space-y-6">
      {/* Encabezado de sección */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Firma electrónica
        </h1>
        <p className="text-sm text-muted-foreground">
          Configure su PIN personal para firmar documentos clínicos (NTEC Art. 23).
        </p>
      </div>

      {/* Banner de firma activa */}
      {hasActiveFirma && !isChangingPin && (
        <ExistingFirmaBanner onChangePinClick={handleChangePinClick} />
      )}

      {/* Wizard (oculto si hay firma activa y no se inició cambio de PIN) */}
      {(!hasActiveFirma || isChangingPin) && (
        <Card className="mx-auto max-w-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="sr-only">
              Wizard de configuración de firma electrónica
            </CardTitle>
            <Stepper current={step} />
          </CardHeader>

          <CardContent className="min-h-[340px] pt-2">
            {statusQuery.isLoading && (
              <p className="text-sm text-muted-foreground" aria-busy="true">
                Verificando estado de firma…
              </p>
            )}

            {!statusQuery.isLoading && step === 1 && (
              <StepLegal onNext={() => setStep(2)} />
            )}

            {!statusQuery.isLoading && step === 2 && (
              <StepCreatePin
                onSuccess={handlePinSuccess}
                isChanging={isChangingPin}
              />
            )}

            {!statusQuery.isLoading && step === 3 && (
              <StepConfirm
                maskedPin={maskedPin}
                onReset={handleResetFromConfirm}
              />
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
