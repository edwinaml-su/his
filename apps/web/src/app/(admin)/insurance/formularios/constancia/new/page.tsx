"use client";

/**
 * CC-0044 — Nueva "Constancia de atención por médico fuera de red" (respaldo
 * AVANTE, OutOfNetworkAttestation).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { BuscadorPaciente, type PacienteSeleccion } from "@/components/pacientes/BuscadorPaciente";

const PARENTESCO_LABELS: Record<string, string> = {
  TITULAR: "Titular",
  CONYUGE: "Cónyuge",
  HIJO: "Hijo/a",
  OTRO: "Otro",
};

export default function NuevaConstanciaFueraDeRedPage() {
  const router = useRouter();
  const [paciente, setPaciente] = React.useState<PacienteSeleccion | null>(null);
  const [patientAccountId, setPatientAccountId] = React.useState("");
  const [insurerId, setInsurerId] = React.useState("");
  const [aseguradoraNombre, setAseguradoraNombre] = React.useState("");
  const [polizaNumero, setPolizaNumero] = React.useState("");
  const [certificadoCarnet, setCertificadoCarnet] = React.useState("");
  const [aseguradoTitular, setAseguradoTitular] = React.useState("");
  const [parentesco, setParentesco] = React.useState<"TITULAR" | "CONYUGE" | "HIJO" | "OTRO">("TITULAR");
  const [parentescoOtro, setParentescoOtro] = React.useState("");
  const [doctorNombre, setDoctorNombre] = React.useState("");
  const [doctorEspecialidad, setDoctorEspecialidad] = React.useState("");
  const [telefonoContacto, setTelefonoContacto] = React.useState("");
  const [lugarFecha, setLugarFecha] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const insurersQuery = trpc.insurance.insurer.list.useQuery({ activeOnly: true, limit: 200 });
  const cuentasQuery = trpc.patientAccount.listarPorPaciente.useQuery(
    { patientId: paciente?.id ?? "" },
    { enabled: !!paciente },
  );

  const createMutation = trpc.insurance.outOfNetwork.create.useMutation({
    onSuccess: (constancia) => router.push(`/insurance/formularios/constancia/${constancia.id}`),
    onError: (err) => setError(err.message ?? "Error al crear la constancia."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!paciente) return setError("Busca y selecciona el paciente.");
    if (!insurerId && !aseguradoraNombre.trim()) {
      return setError("Selecciona la aseguradora del catálogo o escribe su nombre.");
    }
    if (!aseguradoTitular.trim()) return setError("El nombre del asegurado titular es requerido.");
    if (parentesco === "OTRO" && !parentescoOtro.trim()) {
      return setError("Especifica el parentesco.");
    }
    if (!doctorNombre.trim() || !doctorEspecialidad.trim()) {
      return setError("El nombre y especialidad del médico son requeridos.");
    }

    createMutation.mutate({
      patientId: paciente.id,
      patientAccountId: patientAccountId || undefined,
      insurerId: insurerId || undefined,
      aseguradoraNombre: aseguradoraNombre.trim() || undefined,
      polizaNumero: polizaNumero.trim() || undefined,
      certificadoCarnet: certificadoCarnet.trim() || undefined,
      aseguradoTitular: aseguradoTitular.trim(),
      parentesco,
      parentescoOtro: parentesco === "OTRO" ? parentescoOtro.trim() : undefined,
      doctorNombre: doctorNombre.trim(),
      doctorEspecialidad: doctorEspecialidad.trim(),
      telefonoContacto: telefonoContacto.trim() || undefined,
      lugarFecha: lugarFecha.trim() || undefined,
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Nueva constancia fuera de red</h1>
        <Button variant="outline" asChild>
          <Link href="/insurance/formularios">Volver</Link>
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Datos del asegurado y del paciente</CardTitle>
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
                <Label htmlFor="constancia-paciente">Paciente</Label>
                <BuscadorPaciente id="constancia-paciente" onSelect={setPaciente} />
              </div>
            )}

            {paciente && (cuentasQuery.data?.length ?? 0) > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor="constancia-cuenta">Cuenta (opcional)</Label>
                <Select value={patientAccountId || "none"} onValueChange={(v) => setPatientAccountId(v === "none" ? "" : v)}>
                  <SelectTrigger id="constancia-cuenta">
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
              <Label htmlFor="constancia-insurer">Aseguradora (catálogo)</Label>
              <Select value={insurerId || "none"} onValueChange={(v) => setInsurerId(v === "none" ? "" : v)}>
                <SelectTrigger id="constancia-insurer">
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
                <Label htmlFor="constancia-aseguradora-nombre">Nombre de la aseguradora</Label>
                <Input
                  id="constancia-aseguradora-nombre"
                  value={aseguradoraNombre}
                  onChange={(e) => setAseguradoraNombre(e.target.value)}
                />
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="constancia-poliza">Póliza No. (opcional)</Label>
                <Input id="constancia-poliza" value={polizaNumero} onChange={(e) => setPolizaNumero(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="constancia-carnet">Certificado/Carné No. (opcional)</Label>
                <Input
                  id="constancia-carnet"
                  value={certificadoCarnet}
                  onChange={(e) => setCertificadoCarnet(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="constancia-titular">Nombre completo del asegurado titular</Label>
              <Input
                id="constancia-titular"
                value={aseguradoTitular}
                onChange={(e) => setAseguradoTitular(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="constancia-parentesco">Parentesco con el titular</Label>
                <Select value={parentesco} onValueChange={(v) => setParentesco(v as typeof parentesco)}>
                  <SelectTrigger id="constancia-parentesco">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(PARENTESCO_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {parentesco === "OTRO" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="constancia-parentesco-otro">Especifica el parentesco</Label>
                  <Input
                    id="constancia-parentesco-otro"
                    value={parentescoOtro}
                    onChange={(e) => setParentescoOtro(e.target.value)}
                  />
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Declaración</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              El asegurado declara haber sido informado de que el médico tratante NO pertenece a la
              red de su aseguradora, que pueden no aplicar los beneficios de la póliza y que los
              honorarios/gastos derivados pueden correr por su cuenta. La selección del especialista
              es criterio personal del asegurado/paciente, no una recomendación de AVANTE.
            </p>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="constancia-doctor">El Doctor/La Doctora</Label>
                <Input id="constancia-doctor" value={doctorNombre} onChange={(e) => setDoctorNombre(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="constancia-especialidad">Especialista en</Label>
                <Input
                  id="constancia-especialidad"
                  value={doctorEspecialidad}
                  onChange={(e) => setDoctorEspecialidad(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="constancia-telefono">Número de contacto (opcional)</Label>
                <Input
                  id="constancia-telefono"
                  value={telefonoContacto}
                  onChange={(e) => setTelefonoContacto(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="constancia-lugar-fecha">Lugar y fecha (opcional)</Label>
                <Input id="constancia-lugar-fecha" value={lugarFecha} onChange={(e) => setLugarFecha(e.target.value)} />
              </div>
            </div>
          </CardContent>
        </Card>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Guardando…" : "Guardar constancia"}
          </Button>
        </div>
      </form>
    </div>
  );
}
