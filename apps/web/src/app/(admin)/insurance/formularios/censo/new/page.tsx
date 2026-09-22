"use client";

/**
 * CC-0044 — Nuevo "Censo de llamada seguro médico" (NetworkCallCensus).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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
import { BuscadorPaciente, type PacienteSeleccion } from "@/components/pacientes/BuscadorPaciente";

interface EntryDraft {
  doctorNombre: string;
  telefono: string;
  atendioLlamada: boolean | null;
  comentarios: string;
}

const EMPTY_ENTRY: EntryDraft = { doctorNombre: "", telefono: "", atendioLlamada: null, comentarios: "" };

export default function NuevoCensoLlamadasPage() {
  const router = useRouter();
  const [paciente, setPaciente] = React.useState<PacienteSeleccion | null>(null);
  const [patientAccountId, setPatientAccountId] = React.useState("");
  const [insurerId, setInsurerId] = React.useState("");
  const [aseguradoraNombre, setAseguradoraNombre] = React.useState("");
  const [diagnostico, setDiagnostico] = React.useState("");
  const [notas, setNotas] = React.useState("");
  const [entries, setEntries] = React.useState<EntryDraft[]>([{ ...EMPTY_ENTRY }]);
  const [error, setError] = React.useState<string | null>(null);

  const insurersQuery = trpc.insurance.insurer.list.useQuery({ activeOnly: true, limit: 200 });
  const cuentasQuery = trpc.patientAccount.listarPorPaciente.useQuery(
    { patientId: paciente?.id ?? "" },
    { enabled: !!paciente },
  );

  const createMutation = trpc.insurance.callCensus.create.useMutation({
    onSuccess: (censo) => router.push(`/insurance/formularios/censo/${censo.id}`),
    onError: (err) => setError(err.message ?? "Error al crear el censo."),
  });

  function updateEntry(i: number, patch: Partial<EntryDraft>) {
    setEntries((prev) => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!paciente) return setError("Busca y selecciona el paciente.");
    if (!insurerId && !aseguradoraNombre.trim()) {
      return setError("Selecciona la aseguradora del catálogo o escribe su nombre.");
    }
    if (!diagnostico.trim()) return setError("El diagnóstico es requerido.");

    const validEntries = entries.filter((e) => e.doctorNombre.trim().length > 0);

    createMutation.mutate({
      patientId: paciente.id,
      patientAccountId: patientAccountId || undefined,
      insurerId: insurerId || undefined,
      aseguradoraNombre: aseguradoraNombre.trim() || undefined,
      diagnostico: diagnostico.trim(),
      notas: notas.trim() || undefined,
      entries: validEntries.map((e, i) => ({
        ordenIndex: i,
        doctorNombre: e.doctorNombre.trim(),
        telefono: e.telefono.trim() || undefined,
        atendioLlamada: e.atendioLlamada,
        comentarios: e.comentarios.trim() || undefined,
      })),
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nuevo censo de llamadas</h1>
        <Button variant="outline" asChild>
          <Link href="/insurance/formularios">Volver</Link>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Paciente y aseguradora</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {paciente ? (
              <div className="space-y-1.5">
                <Label>Paciente</Label>
                <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                  <span className="flex-1">
                    {paciente.nombre}
                    {paciente.mrn ? ` · ${paciente.mrn}` : ""}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPaciente(null)}>
                    Cambiar
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label htmlFor="censo-paciente">Paciente</Label>
                <BuscadorPaciente id="censo-paciente" onSelect={setPaciente} />
              </div>
            )}

            {paciente && (cuentasQuery.data?.length ?? 0) > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="censo-cuenta">Cuenta (opcional)</Label>
                <Select value={patientAccountId || "none"} onValueChange={(v) => setPatientAccountId(v === "none" ? "" : v)}>
                  <SelectTrigger id="censo-cuenta">
                    <SelectValue placeholder="Sin cuenta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sin cuenta</SelectItem>
                    {(cuentasQuery.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.numeroCuenta}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="censo-insurer">Aseguradora (catálogo)</Label>
              <Select value={insurerId || "none"} onValueChange={(v) => setInsurerId(v === "none" ? "" : v)}>
                <SelectTrigger id="censo-insurer">
                  <SelectValue placeholder="Selecciona del catálogo…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— No está en el catálogo —</SelectItem>
                  {(insurersQuery.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {!insurerId ? (
              <div className="space-y-1.5">
                <Label htmlFor="censo-aseguradora-nombre">Nombre de la aseguradora</Label>
                <Input
                  id="censo-aseguradora-nombre"
                  value={aseguradoraNombre}
                  onChange={(e) => setAseguradoraNombre(e.target.value)}
                  placeholder="Ej. ISSS, MAPFRE, ASESUISA…"
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="censo-diagnostico">Diagnóstico</Label>
              <Textarea
                id="censo-diagnostico"
                rows={2}
                value={diagnostico}
                onChange={(e) => setDiagnostico(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Médicos de la red llamados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {entries.map((entry, i) => (
              <div key={i} className="grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-[2fr_1fr_1fr_2fr_auto]">
                <div className="space-y-1">
                  <Label htmlFor={`entry-doctor-${i}`}>Nombre de médico</Label>
                  <Input
                    id={`entry-doctor-${i}`}
                    value={entry.doctorNombre}
                    onChange={(e) => updateEntry(i, { doctorNombre: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`entry-tel-${i}`}>Teléfono</Label>
                  <Input
                    id={`entry-tel-${i}`}
                    value={entry.telefono}
                    onChange={(e) => updateEntry(i, { telefono: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`entry-atendio-${i}`}>Atendió</Label>
                  <Select
                    value={entry.atendioLlamada === null ? "none" : entry.atendioLlamada ? "si" : "no"}
                    onValueChange={(v) =>
                      updateEntry(i, { atendioLlamada: v === "none" ? null : v === "si" })
                    }
                  >
                    <SelectTrigger id={`entry-atendio-${i}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin registrar</SelectItem>
                      <SelectItem value="si">Sí</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`entry-comentarios-${i}`}>Comentarios</Label>
                  <Input
                    id={`entry-comentarios-${i}`}
                    placeholder="Ej. No contestó"
                    value={entry.comentarios}
                    onChange={(e) => updateEntry(i, { comentarios: e.target.value })}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setEntries((prev) => prev.filter((_, idx) => idx !== i))}
                    disabled={entries.length === 1}
                  >
                    Quitar
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setEntries((prev) => [...prev, { ...EMPTY_ENTRY }])}>
              + Agregar médico
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Notas (opcional)</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
          </CardContent>
        </Card>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Guardando…" : "Guardar censo"}
          </Button>
        </div>
      </form>
    </div>
  );
}
