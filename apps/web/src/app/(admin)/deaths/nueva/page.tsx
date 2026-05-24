"use client";

/**
 * Wizard para crear un certificado de defunción ECE (NTEC Art. 21).
 * Consume trpc.eceCertDef.create — no usa el router legacy deathCertificate.
 *
 * CIE-10 validado con regex ^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$ en cliente
 * y también en el router (cie10Schema).
 *
 * Post-create redirige a /deaths/<id> para completar el workflow de firma.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const CIE10_REGEX = /^[A-Z][0-9]{2}(\.[0-9A-Z]{0,4})?$/;

const MANERA_OPTIONS = [
  { value: "natural", label: "Natural" },
  { value: "violenta", label: "Violenta" },
  { value: "accidental", label: "Accidental" },
  { value: "suicidio", label: "Suicidio" },
  { value: "homicidio", label: "Homicidio" },
  { value: "indeterminada", label: "Indeterminada" },
] as const;

const LUGAR_OPTIONS = [
  { value: "intrahospitalaria", label: "Intrahospitalaria" },
  { value: "extrahospitalaria", label: "Extrahospitalaria" },
] as const;

type ManeraDef = typeof MANERA_OPTIONS[number]["value"];
type LugarDef = typeof LUGAR_OPTIONS[number]["value"];

// ---------------------------------------------------------------------------
// Estado del formulario
// ---------------------------------------------------------------------------

interface FormState {
  episodioId: string;
  epicrisisId: string;
  fechaHoraDefuncion: string;
  lugarDefuncion: LugarDef | "";
  causaPrincipalCie10: string;
  causaBasicaCie10: string;
  causasIntermediasCie10: string; // comma-separated, parseado antes del submit
  manera: ManeraDef | "";
  autopsiaRealizada: boolean;
  observaciones: string;
}

const EMPTY_FORM: FormState = {
  episodioId: "",
  epicrisisId: "",
  fechaHoraDefuncion: "",
  lugarDefuncion: "",
  causaPrincipalCie10: "",
  causaBasicaCie10: "",
  causasIntermediasCie10: "",
  manera: "",
  autopsiaRealizada: false,
  observaciones: "",
};

// ---------------------------------------------------------------------------
// Helpers de validación
// ---------------------------------------------------------------------------

function validateCie10(code: string): string | null {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return "Campo requerido.";
  if (!CIE10_REGEX.test(trimmed)) return "Formato CIE-10 inválido (ej. J18.0).";
  return null;
}

function parseCausasIntermedias(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

interface FieldErrors {
  episodioId?: string;
  epicrisisId?: string;
  fechaHoraDefuncion?: string;
  lugarDefuncion?: string;
  causaPrincipalCie10?: string;
  causaBasicaCie10?: string;
  causasIntermediasCie10?: string;
  manera?: string;
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};

  if (!form.episodioId.trim()) errors.episodioId = "Requerido.";
  if (!form.epicrisisId.trim()) errors.epicrisisId = "Requerido.";

  if (!form.fechaHoraDefuncion) {
    errors.fechaHoraDefuncion = "Requerido.";
  }

  if (!form.lugarDefuncion) errors.lugarDefuncion = "Requerido.";
  if (!form.manera) errors.manera = "Requerido.";

  const cpErr = validateCie10(form.causaPrincipalCie10);
  if (cpErr) errors.causaPrincipalCie10 = cpErr;

  const cbErr = validateCie10(form.causaBasicaCie10);
  if (cbErr) errors.causaBasicaCie10 = cbErr;

  const intermedias = parseCausasIntermedias(form.causasIntermediasCie10);
  for (const code of intermedias) {
    if (!CIE10_REGEX.test(code)) {
      errors.causasIntermediasCie10 = `Código inválido: ${code}`;
      break;
    }
  }
  if (intermedias.length > 3) {
    errors.causasIntermediasCie10 = "Máximo 3 causas intermedias.";
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Componente auxiliar: campo CIE-10
// ---------------------------------------------------------------------------

function Cie10Field({
  id,
  label,
  value,
  error,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {label}{" "}
        <span className="text-xs font-normal text-muted-foreground">(CIE-10)</span>
      </Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder ?? "ej. J18.0"}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-err` : undefined}
        className="font-mono uppercase"
      />
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------

export default function DeathsNuevaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = React.useState<FieldErrors>({});
  const [submitted, setSubmitted] = React.useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (submitted) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  };

  const create = trpc.eceCertDef.create.useMutation({
    onSuccess(data: { id: string }) {
      router.push(`/deaths/${data.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);

    const errors = validate(form);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    create.mutate({
      episodioId: form.episodioId.trim(),
      epicrisisId: form.epicrisisId.trim(),
      fechaHoraDefuncion: new Date(form.fechaHoraDefuncion),
      lugarDefuncion: form.lugarDefuncion as "intrahospitalaria" | "extrahospitalaria",
      causaPrincipalCie10: form.causaPrincipalCie10.trim().toUpperCase(),
      causaBasicaCie10: form.causaBasicaCie10.trim().toUpperCase(),
      causasIntermediasCie10: parseCausasIntermedias(form.causasIntermediasCie10),
      manera: form.manera as ManeraDef,
      autopsiaRealizada: form.autopsiaRealizada,
      observaciones: form.observaciones.trim() || undefined,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Nuevo certificado de defunción</h1>
          <p className="text-sm text-muted-foreground">
            ECE — NTEC Art. 21 / MINSAL Acuerdo 1616-2024
          </p>
        </div>
        <Link href="/deaths" className="text-sm text-primary underline">
          Cancelar
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del certificado</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-6">
            {/* Episodio */}
            <div className="space-y-1.5">
              <Label htmlFor="episodioId">ID de episodio (UUID)</Label>
              <Input
                id="episodioId"
                value={form.episodioId}
                onChange={(e) => set("episodioId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={Boolean(fieldErrors.episodioId)}
                aria-describedby={fieldErrors.episodioId ? "episodioId-err" : undefined}
                className="font-mono text-sm"
              />
              {fieldErrors.episodioId && (
                <p id="episodioId-err" className="text-xs text-destructive">
                  {fieldErrors.episodioId}
                </p>
              )}
            </div>

            {/* Epicrisis — B-04: debe tener tipo_egreso = 'fallecido' */}
            <div className="space-y-1.5">
              <Label htmlFor="epicrisisId">ID de epicrisis (UUID)</Label>
              <Input
                id="epicrisisId"
                value={form.epicrisisId}
                onChange={(e) => set("epicrisisId", e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                aria-invalid={Boolean(fieldErrors.epicrisisId)}
                aria-describedby={fieldErrors.epicrisisId ? "epicrisisId-err" : undefined}
                className="font-mono text-sm"
              />
              {fieldErrors.epicrisisId && (
                <p id="epicrisisId-err" className="text-xs text-destructive">
                  {fieldErrors.epicrisisId}
                </p>
              )}
            </div>

            {/* Fecha y hora */}
            <div className="space-y-1.5">
              <Label htmlFor="fechaHora">Fecha y hora de defunción</Label>
              <Input
                id="fechaHora"
                type="datetime-local"
                value={form.fechaHoraDefuncion}
                onChange={(e) => set("fechaHoraDefuncion", e.target.value)}
                aria-invalid={Boolean(fieldErrors.fechaHoraDefuncion)}
                aria-describedby={fieldErrors.fechaHoraDefuncion ? "fechaHora-err" : undefined}
              />
              {fieldErrors.fechaHoraDefuncion && (
                <p id="fechaHora-err" className="text-xs text-destructive">
                  {fieldErrors.fechaHoraDefuncion}
                </p>
              )}
            </div>

            {/* Lugar + manera */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Lugar de defunción</Label>
                <Select
                  value={form.lugarDefuncion}
                  onValueChange={(v) => set("lugarDefuncion", v as LugarDef)}
                >
                  <SelectTrigger aria-invalid={Boolean(fieldErrors.lugarDefuncion)}>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {LUGAR_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.lugarDefuncion && (
                  <p className="text-xs text-destructive">{fieldErrors.lugarDefuncion}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Manera de muerte</Label>
                <Select
                  value={form.manera}
                  onValueChange={(v) => set("manera", v as ManeraDef)}
                >
                  <SelectTrigger aria-invalid={Boolean(fieldErrors.manera)}>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {MANERA_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldErrors.manera && (
                  <p className="text-xs text-destructive">{fieldErrors.manera}</p>
                )}
              </div>
            </div>

            {/* Cadena causal CIE-10 */}
            <fieldset className="space-y-4 rounded-md border p-4">
              <legend className="px-1 text-sm font-medium">
                Cadena causal CIE-10
              </legend>

              <Cie10Field
                id="causaPrincipal"
                label="Causa principal"
                value={form.causaPrincipalCie10}
                error={fieldErrors.causaPrincipalCie10}
                onChange={(v) => set("causaPrincipalCie10", v)}
              />

              <Cie10Field
                id="causaBasica"
                label="Causa básica"
                value={form.causaBasicaCie10}
                error={fieldErrors.causaBasicaCie10}
                onChange={(v) => set("causaBasicaCie10", v)}
              />

              <div className="space-y-1.5">
                <Label htmlFor="causasIntermedias">
                  Causas intermedias{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    (hasta 3, separadas por coma)
                  </span>
                </Label>
                <Input
                  id="causasIntermedias"
                  value={form.causasIntermediasCie10}
                  onChange={(e) => set("causasIntermediasCie10", e.target.value.toUpperCase())}
                  placeholder="ej. J18.1, I50.0"
                  aria-invalid={Boolean(fieldErrors.causasIntermediasCie10)}
                  aria-describedby={fieldErrors.causasIntermediasCie10 ? "causasInt-err" : undefined}
                  className="font-mono uppercase"
                />
                {fieldErrors.causasIntermediasCie10 && (
                  <p id="causasInt-err" className="text-xs text-destructive">
                    {fieldErrors.causasIntermediasCie10}
                  </p>
                )}
              </div>
            </fieldset>

            {/* Autopsia */}
            <div className="flex items-center gap-2">
              <input
                id="autopsia"
                type="checkbox"
                checked={form.autopsiaRealizada}
                onChange={(e) => set("autopsiaRealizada", e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="autopsia" className="cursor-pointer font-normal">
                Se realizó autopsia
              </Label>
            </div>

            {/* Observaciones */}
            <div className="space-y-1.5">
              <Label htmlFor="observaciones">
                Observaciones{" "}
                <span className="text-xs font-normal text-muted-foreground">(opcional)</span>
              </Label>
              <Textarea
                id="observaciones"
                value={form.observaciones}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  set("observaciones", e.target.value)
                }
                rows={3}
                maxLength={2000}
                placeholder="Información adicional relevante…"
              />
            </div>

            {create.error && (
              <p className="text-sm text-destructive" role="alert">
                {create.error.message}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button asChild variant="outline" type="button">
                <Link href="/deaths">Cancelar</Link>
              </Button>
              <Button
                type="submit"
                disabled={create.isPending}
                className="bg-[#1a3c6e] text-white hover:bg-[#15305a]"
              >
                {create.isPending ? "Guardando…" : "Crear certificado"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
