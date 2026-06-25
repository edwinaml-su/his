"use client";

/**
 * §12 Emergency — Crear visita a urgencias.
 *
 * Flujo paciente-first:
 *   1. Buscador de paciente (BuscadorPaciente).
 *   2. Encuentros abiertos del paciente (carga tras selección, auto-selección si hay 1).
 *   3. Establecimiento de la org (auto-selección si hay 1).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { BuscadorPaciente, type PacienteSeleccion } from "@/components/pacientes/BuscadorPaciente";

type ArrivalMode =
  | "WALK_IN"
  | "AMBULANCE"
  | "POLICE"
  | "REFERRAL"
  | "PRIVATE_VEHICLE"
  | "OTHER";

const ARRIVAL_OPTIONS: { value: ArrivalMode; label: string }[] = [
  { value: "WALK_IN", label: "A pie" },
  { value: "AMBULANCE", label: "Ambulancia" },
  { value: "POLICE", label: "Policía" },
  { value: "REFERRAL", label: "Referencia" },
  { value: "PRIVATE_VEHICLE", label: "Vehículo particular" },
  { value: "OTHER", label: "Otro" },
];

interface FormState {
  encounterId: string;
  establishmentId: string;
  patientId: string;
  chiefComplaint: string;
  arrivalMode: ArrivalMode;
}

const INITIAL: FormState = {
  encounterId: "",
  establishmentId: "",
  patientId: "",
  chiefComplaint: "",
  arrivalMode: "WALK_IN",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro es requerido.";
  if (!f.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!f.patientId.trim()) return "Paciente es requerido.";
  if (!f.chiefComplaint.trim()) return "Motivo principal es requerido.";
  return null;
}

export default function NewEmergencyVisitPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);
  const [pacienteLabel, setPacienteLabel] = React.useState<string | null>(null);

  // Encuentros abiertos del paciente seleccionado.
  const encountersQ = trpc.encounter.list.useQuery(
    { patientId: form.patientId, status: "OPEN", page: 1, pageSize: 50 },
    { enabled: !!form.patientId },
  );

  // Establecimientos activos de la org.
  const orgQ = trpc.organization.current.useQuery();
  const establishments = orgQ.data?.establishments ?? [];

  // Auto-seleccionar establecimiento cuando se carga y hay exactamente 1.
  React.useEffect(() => {
    const estabs = orgQ.data?.establishments ?? [];
    if (estabs.length === 1 && !form.establishmentId) {
      setForm((f) => ({ ...f, establishmentId: estabs[0]!.id }));
    }
  }, [orgQ.data, form.establishmentId]);

  // Auto-seleccionar encuentro cuando se carga y hay exactamente 1.
  const encounters = encountersQ.data?.items ?? [];
  React.useEffect(() => {
    const encs = encountersQ.data?.items ?? [];
    if (!form.patientId) return;
    if (encs.length === 1 && !form.encounterId) {
      setForm((f) => ({ ...f, encounterId: encs[0]!.id }));
    }
  }, [encountersQ.data, form.patientId, form.encounterId]);

  const create = trpc.emergency.visit.create.useMutation({
    onSuccess: () => router.push("/emergency"),
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handlePacienteSelect(p: PacienteSeleccion) {
    // Al elegir un paciente nuevo se resetea el encuentro.
    setForm((f) => ({ ...f, patientId: p.id, encounterId: "" }));
    setPacienteLabel(p.nombre + (p.mrn ? ` · ${p.mrn}` : ""));
    setClientError(null);
  }

  function handleCambiarPaciente() {
    setForm((f) => ({ ...f, patientId: "", encounterId: "" }));
    setPacienteLabel(null);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    create.mutate({
      encounterId: form.encounterId.trim(),
      establishmentId: form.establishmentId.trim(),
      patientId: form.patientId.trim(),
      chiefComplaint: form.chiefComplaint.trim(),
      arrivalMode: form.arrivalMode,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nueva visita a urgencias</h1>
        <p className="text-sm text-muted-foreground">Registra una llegada a urgencias (§12).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos de la visita</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            {/* ── Paciente ─────────────────────────────────────── */}
            <FormField>
              {form.patientId && pacienteLabel ? (
                <div className="space-y-1.5">
                  <Label>Paciente</Label>
                  <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                    <span className="flex-1">{pacienteLabel}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleCambiarPaciente}
                      disabled={isSubmitting}
                    >
                      Cambiar
                    </Button>
                  </div>
                </div>
              ) : (
                <BuscadorPaciente
                  id="patientId"
                  onSelect={handlePacienteSelect}
                  disabled={isSubmitting}
                />
              )}
            </FormField>

            {/* ── Encuentro ────────────────────────────────────── */}
            <FormField>
              <Label htmlFor={encounters.length > 1 ? "encounterId" : undefined}>Encuentro</Label>
              {!form.patientId ? (
                <p className="text-sm text-muted-foreground">
                  Seleccione un paciente primero.
                </p>
              ) : encountersQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando encuentros…</p>
              ) : encounters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este paciente no tiene encuentros abiertos. Admítalo primero en Admisión.
                </p>
              ) : encounters.length === 1 ? (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  {encounters[0]!.serviceUnit?.name ?? "Sin servicio"} &mdash;{" "}
                  {new Date(encounters[0]!.admittedAt).toLocaleDateString("es-SV")}
                </div>
              ) : (
                <Select
                  value={form.encounterId}
                  onValueChange={(v) => update("encounterId", v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="encounterId">
                    <SelectValue placeholder="Seleccione un encuentro…" />
                  </SelectTrigger>
                  <SelectContent>
                    {encounters.map((enc) => (
                      <SelectItem key={enc.id} value={enc.id}>
                        {enc.serviceUnit?.name ?? "Sin servicio"} &mdash;{" "}
                        {new Date(enc.admittedAt).toLocaleDateString("es-SV")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            {/* ── Establecimiento ──────────────────────────────── */}
            <FormField>
              <Label htmlFor={establishments.length > 1 ? "establishmentId" : undefined}>Establecimiento</Label>
              {orgQ.isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando establecimientos…</p>
              ) : establishments.length === 1 ? (
                <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  {establishments[0]!.name}
                </div>
              ) : (
                <Select
                  value={form.establishmentId}
                  onValueChange={(v) => update("establishmentId", v)}
                  disabled={isSubmitting}
                >
                  <SelectTrigger id="establishmentId">
                    <SelectValue placeholder="Seleccione un establecimiento…" />
                  </SelectTrigger>
                  <SelectContent>
                    {establishments.map((est) => (
                      <SelectItem key={est.id} value={est.id}>
                        {est.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </FormField>

            {/* ── Modo de llegada ──────────────────────────────── */}
            <FormField>
              <Label htmlFor="arrivalMode">Modo de llegada</Label>
              <Select
                value={form.arrivalMode}
                onValueChange={(v) => update("arrivalMode", v as ArrivalMode)}
              >
                <SelectTrigger id="arrivalMode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ARRIVAL_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            {/* ── Motivo principal ─────────────────────────────── */}
            <FormField>
              <Label htmlFor="chiefComplaint">Motivo principal</Label>
              <Input
                id="chiefComplaint"
                required
                value={form.chiefComplaint}
                onChange={(e) => update("chiefComplaint", e.target.value)}
              />
            </FormField>

            {errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {errorMessage}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creando…" : "Registrar visita"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
