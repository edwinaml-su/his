"use client";

/**
 * CC-0044 — Detalle de la "Constancia de atención por médico fuera de red"
 * (respaldo AVANTE, OutOfNetworkAttestation).
 *
 * Edición sólo en PENDIENTE_FIRMA. `markFirmado` registra que el impreso
 * físico fue firmado por el asegurado/responsable (sin firma digital en v1).
 *
 * Imprimible: renderizado como React (`<ConstanciaPrintView>`), NO
 * `document.write`. Hallazgo P0 de la revisión adversarial: el patrón
 * anterior (window.open + document.write interpolando strings de BD sin
 * escapar) es un XSS almacenado — con el CSP de prod
 * (`script-src 'self' 'unsafe-inline'`) un `<img onerror=...>` en un campo de
 * texto ejecutaría con la sesión de la víctima. React escapa todo el
 * contenido de texto por default; la vista imprimible vive en la misma
 * página, oculta en pantalla y visible sólo bajo `@media print` vía Tailwind
 * `hidden print:block`. Mismo patrón que
 * `apps/web/src/components/epicrisis-pdf-preview.tsx`.
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

/**
 * Vista imprimible fiel a la "Constancia de atención por médico fuera de
 * red" física. Renderiza texto de BD como children de JSX (React escapa
 * automáticamente — ver nota de seguridad arriba).
 */
function ConstanciaPrintView({
  pacienteNombre,
  aseguradora,
  polizaNumero,
  certificadoCarnet,
  aseguradoTitular,
  parentesco,
  doctorNombre,
  doctorEspecialidad,
  telefonoContacto,
  lugarFecha,
}: {
  pacienteNombre: string;
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
  const campoLabel: React.CSSProperties = { display: "inline-block", minWidth: 170 };
  return (
    <div className="hidden print:block" style={{ color: "#111", fontSize: "10pt" }}>
      <header className="flex items-center gap-3 border-b-2 border-[#1a3c5e] pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- vista de impresión, no LCP */}
        <img src="/avante-logo.svg" alt="AVANTE" style={{ height: 48 }} />
        <div>
          <h1 style={{ fontSize: "13pt", margin: 0, fontWeight: 700 }}>
            Constancia de atención por médico fuera de red
          </h1>
          <p style={{ fontSize: "9pt", color: "#555", margin: "2px 0 0" }}>
            Complejo Hospitalario Avante — Respaldo de aseguradora
          </p>
        </div>
      </header>

      <section style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: "10.5pt", borderBottom: "1px solid #ccc", paddingBottom: 3 }}>
          Datos del asegurado y del paciente
        </h2>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Aseguradora:</strong> {aseguradora}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Póliza No.:</strong> {polizaNumero || "—"}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Certificado/Carné No.:</strong> {certificadoCarnet || "—"}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Asegurado titular:</strong> {aseguradoTitular}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Nombre del paciente:</strong> {pacienteNombre}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Parentesco con el titular:</strong> {parentesco}
        </div>
      </section>

      <section style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: "10.5pt", borderBottom: "1px solid #ccc", paddingBottom: 3 }}>
          Declaración
        </h2>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>El Doctor/La Doctora:</strong> {doctorNombre}
        </div>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Especialista en:</strong> {doctorEspecialidad}
        </div>
        <p style={{ marginTop: 10, padding: 8, border: "1px solid #ccc", background: "#f7f7f7", fontSize: "9.5pt" }}>
          El asegurado declara haber sido informado de que el médico tratante NO pertenece a la red
          de su aseguradora, que pueden no aplicar los beneficios de la póliza y que los
          honorarios/gastos derivados de esta atención pueden correr por su cuenta. La selección del
          especialista es criterio personal del asegurado/paciente, no una recomendación de AVANTE.
        </p>
        <div style={{ margin: "4px 0" }}>
          <strong style={campoLabel}>Número de contacto:</strong> {telefonoContacto || "—"}
        </div>
      </section>

      <div style={{ marginTop: 40, display: "flex", justifyContent: "space-between" }}>
        <div style={{ borderTop: "1px solid #000", width: 260, paddingTop: 4, fontSize: "9pt", textAlign: "center" }}>
          Nombre del asegurado
        </div>
        <div style={{ borderTop: "1px solid #000", width: 260, paddingTop: 4, fontSize: "9pt", textAlign: "center" }}>
          Firma del asegurado
        </div>
      </div>
      <p style={{ marginTop: 20, fontSize: "9pt" }}>
        Lugar y fecha: {lugarFecha || "_______________________________"}
      </p>
    </div>
  );
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
      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-bold">Constancia fuera de red</h1>
          <Badge variant={STATUS_BADGE[constancia.status] ?? "outline"}>{constancia.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance/formularios">Volver</Link>
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
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

      <div className="space-y-4 print:hidden">
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

      <ConstanciaPrintView
        pacienteNombre={nombrePaciente}
        aseguradora={aseguradora}
        polizaNumero={constancia.polizaNumero ?? ""}
        certificadoCarnet={constancia.certificadoCarnet ?? ""}
        aseguradoTitular={constancia.aseguradoTitular}
        parentesco={
          constancia.parentesco === "OTRO"
            ? constancia.parentescoOtro ?? "Otro"
            : PARENTESCO_LABELS[constancia.parentesco] ?? constancia.parentesco
        }
        doctorNombre={constancia.doctorNombre}
        doctorEspecialidad={constancia.doctorEspecialidad}
        telefonoContacto={constancia.telefonoContacto ?? ""}
        lugarFecha={constancia.lugarFecha ?? ""}
      />
    </div>
  );
}
