"use client";

/**
 * CC-0044 — Detalle de la "Constancia de atención por médico fuera de red"
 * (respaldo AVANTE, OutOfNetworkAttestation).
 *
 * Edición sólo en PENDIENTE_FIRMA. `markFirmado` registra que el impreso
 * físico fue firmado por el asegurado/responsable (sin firma digital en v1).
 * Imprimible: layout fiel al formulario físico (patrón: ece/bitacora).
 */
import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge, type BadgeProps } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  PENDIENTE_FIRMA: "outline",
  FIRMADO: "success",
  ANULADO: "destructive",
};

const PARENTESCO_LABELS: Record<string, string> = {
  TITULAR: "Titular",
  CONYUGE: "Cónyuge",
  HIJO: "Hijo/a",
  OTRO: "Otro",
};

function fmtFecha(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV");
}

function imprimirConstancia(data: {
  patienteNombre: string;
  aseguradora: string;
  polizaNumero: string;
  certificadoCarnet: string;
  aseguradoTitular: string;
  parentesco: string;
  doctorNombre: string;
  doctorEspecialidad: string;
  telefonoContacto: string;
  lugarFecha: string;
}) {
  const win = window.open("", "_blank");
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Constancia de atención por médico fuera de red — AVANTE</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 10pt; margin: 20mm; color: #111; }
    header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a3c5e; padding-bottom: 8px; }
    header img { height: 48px; }
    h1 { font-size: 13pt; margin: 0; }
    .sub { font-size: 9pt; color: #555; margin: 2px 0 0; }
    section { margin-top: 14pt; }
    section h2 { font-size: 10.5pt; border-bottom: 1px solid #ccc; padding-bottom: 3px; }
    .campo { margin: 4px 0; font-size: 10pt; }
    .campo strong { display: inline-block; min-width: 170px; }
    .declaracion { margin-top: 10pt; padding: 8px; border: 1px solid #ccc; background: #f7f7f7; font-size: 9.5pt; }
    .firmas { margin-top: 40pt; display: flex; justify-content: space-between; }
    .firma-linea { border-top: 1px solid #000; width: 260px; padding-top: 4px; font-size: 9pt; text-align: center; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <header>
    <img src="/avante-logo.svg" alt="AVANTE" onerror="this.style.display='none'" />
    <div>
      <h1>Constancia de atención por médico fuera de red</h1>
      <p class="sub">Complejo Hospitalario Avante — Respaldo de aseguradora</p>
    </div>
  </header>

  <section>
    <h2>Datos del asegurado y del paciente</h2>
    <div class="campo"><strong>Aseguradora:</strong> ${data.aseguradora}</div>
    <div class="campo"><strong>Póliza No.:</strong> ${data.polizaNumero || "—"}</div>
    <div class="campo"><strong>Certificado/Carné No.:</strong> ${data.certificadoCarnet || "—"}</div>
    <div class="campo"><strong>Asegurado titular:</strong> ${data.aseguradoTitular}</div>
    <div class="campo"><strong>Nombre del paciente:</strong> ${data.patienteNombre}</div>
    <div class="campo"><strong>Parentesco con el titular:</strong> ${data.parentesco}</div>
  </section>

  <section>
    <h2>Declaración</h2>
    <div class="campo"><strong>El Doctor/La Doctora:</strong> ${data.doctorNombre}</div>
    <div class="campo"><strong>Especialista en:</strong> ${data.doctorEspecialidad}</div>
    <p class="declaracion">
      El asegurado declara haber sido informado de que el médico tratante NO pertenece a la red de
      su aseguradora, que pueden no aplicar los beneficios de la póliza y que los honorarios/gastos
      derivados de esta atención pueden correr por su cuenta. La selección del especialista es
      criterio personal del asegurado/paciente, no una recomendación de AVANTE.
    </p>
    <div class="campo"><strong>Número de contacto:</strong> ${data.telefonoContacto || "—"}</div>
  </section>

  <div class="firmas">
    <div class="firma-linea">Nombre del asegurado</div>
    <div class="firma-linea">Firma del asegurado</div>
  </div>
  <p style="margin-top: 20pt; font-size: 9pt;">Lugar y fecha: ${data.lugarFecha || "_______________________________"}</p>

  <br/>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</body>
</html>`);
  win.document.close();
}

export default function DetalleConstanciaFueraDeRedPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.insurance.outOfNetwork.byId.useQuery({ id });
  const utils = trpc.useUtils();
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [doctorNombre, setDoctorNombre] = React.useState("");
  const [doctorEspecialidad, setDoctorEspecialidad] = React.useState("");
  const [telefonoContacto, setTelefonoContacto] = React.useState("");
  const [lugarFecha, setLugarFecha] = React.useState("");

  React.useEffect(() => {
    if (query.data) {
      setDoctorNombre(query.data.doctorNombre);
      setDoctorEspecialidad(query.data.doctorEspecialidad);
      setTelefonoContacto(query.data.telefonoContacto ?? "");
      setLugarFecha(query.data.lugarFecha ?? "");
    }
  }, [query.data]);

  const invalidate = () => void utils.insurance.outOfNetwork.byId.invalidate({ id });

  const updateMutation = trpc.insurance.outOfNetwork.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });
  const markFirmadoMutation = trpc.insurance.outOfNetwork.markFirmado.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });
  const anularMutation = trpc.insurance.outOfNetwork.anular.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (query.error || !query.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error?.message ?? "Constancia no encontrada."}
      </p>
    );
  }

  const constancia = query.data;
  const pendiente = constancia.status === "PENDIENTE_FIRMA";
  const nombrePaciente = `${constancia.patient.lastName} ${constancia.patient.firstName}`.trim();
  const aseguradora = constancia.insurer?.name ?? constancia.aseguradoraNombre ?? "—";

  function handleAnular() {
    const motivo = window.prompt("Motivo de anulación:");
    if (!motivo || !motivo.trim()) return;
    anularMutation.mutate({ id, motivo: motivo.trim() });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Constancia fuera de red</h1>
          <Badge variant={STATUS_BADGE[constancia.status] ?? "outline"}>{constancia.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance/formularios">Volver</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              imprimirConstancia({
                patienteNombre: nombrePaciente,
                aseguradora,
                polizaNumero: constancia.polizaNumero ?? "",
                certificadoCarnet: constancia.certificadoCarnet ?? "",
                aseguradoTitular: constancia.aseguradoTitular,
                parentesco:
                  constancia.parentesco === "OTRO"
                    ? constancia.parentescoOtro ?? "Otro"
                    : PARENTESCO_LABELS[constancia.parentesco] ?? constancia.parentesco,
                doctorNombre: constancia.doctorNombre,
                doctorEspecialidad: constancia.doctorEspecialidad,
                telefonoContacto: constancia.telefonoContacto ?? "",
                lugarFecha: constancia.lugarFecha ?? "",
              })
            }
          >
            Imprimir
          </Button>
          {pendiente ? (
            <Button onClick={() => markFirmadoMutation.mutate({ id })} disabled={markFirmadoMutation.isPending}>
              {markFirmadoMutation.isPending ? "Guardando…" : "Marcar como firmado"}
            </Button>
          ) : null}
          {constancia.status !== "ANULADO" ? (
            <Button variant="destructive" onClick={handleAnular} disabled={anularMutation.isPending}>
              Anular
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Datos del asegurado y del paciente</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <p>
            <span className="font-medium">Paciente:</span> {nombrePaciente}
            {constancia.patient.mrn ? ` · ${constancia.patient.mrn}` : ""}
          </p>
          <p>
            <span className="font-medium">Aseguradora:</span> {aseguradora}
          </p>
          <p>
            <span className="font-medium">Póliza No.:</span> {constancia.polizaNumero ?? "—"}
          </p>
          <p>
            <span className="font-medium">Certificado/Carné No.:</span> {constancia.certificadoCarnet ?? "—"}
          </p>
          <p>
            <span className="font-medium">Asegurado titular:</span> {constancia.aseguradoTitular}
          </p>
          <p>
            <span className="font-medium">Parentesco:</span>{" "}
            {constancia.parentesco === "OTRO"
              ? constancia.parentescoOtro
              : PARENTESCO_LABELS[constancia.parentesco] ?? constancia.parentesco}
          </p>
          <p>
            <span className="font-medium">Cuenta:</span> {constancia.account?.numeroCuenta ?? "—"}
          </p>
          <p>
            <span className="font-medium">Firmado:</span> {fmtFecha(constancia.firmadoAt)}
          </p>
          {constancia.motivoAnulacion ? (
            <p>
              <span className="font-medium">Motivo de anulación:</span> {constancia.motivoAnulacion}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Declaración</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {pendiente && editing ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-doctor">El Doctor/La Doctora</Label>
                  <Input id="edit-doctor" value={doctorNombre} onChange={(e) => setDoctorNombre(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-especialidad">Especialista en</Label>
                  <Input
                    id="edit-especialidad"
                    value={doctorEspecialidad}
                    onChange={(e) => setDoctorEspecialidad(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="edit-telefono">Número de contacto</Label>
                  <Input
                    id="edit-telefono"
                    value={telefonoContacto}
                    onChange={(e) => setTelefonoContacto(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-lugar-fecha">Lugar y fecha</Label>
                  <Input id="edit-lugar-fecha" value={lugarFecha} onChange={(e) => setLugarFecha(e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({
                      id,
                      doctorNombre: doctorNombre.trim(),
                      doctorEspecialidad: doctorEspecialidad.trim(),
                      telefonoContacto: telefonoContacto.trim() || undefined,
                      lugarFecha: lugarFecha.trim() || undefined,
                    })
                  }
                >
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">El Doctor/La Doctora:</span> {constancia.doctorNombre}
              </p>
              <p>
                <span className="font-medium">Especialista en:</span> {constancia.doctorEspecialidad}
              </p>
              <p>
                <span className="font-medium">Número de contacto:</span> {constancia.telefonoContacto ?? "—"}
              </p>
              <p>
                <span className="font-medium">Lugar y fecha:</span> {constancia.lugarFecha ?? "—"}
              </p>
              {pendiente ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
