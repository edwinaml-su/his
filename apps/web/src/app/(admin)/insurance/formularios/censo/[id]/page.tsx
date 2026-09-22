"use client";

/**
 * CC-0044 — Detalle del "Censo de llamada seguro médico" (NetworkCallCensus).
 *
 * Edición de cabecera/filas sólo en BORRADOR. `sign` (rol médico) transiciona
 * a FIRMADO. Imprimible: layout fiel al formulario físico AVANTE
 * (`@media print`, patrón tomado de `apps/web/src/app/(admin)/ece/bitacora/page.tsx`).
 */
import * as React from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Badge, type BadgeProps } from "@his/ui/components/badge";
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

const STATUS_BADGE: Record<string, BadgeProps["variant"]> = {
  BORRADOR: "outline",
  FIRMADO: "success",
  ANULADO: "destructive",
};

const ENTRY_ROWS_MIN_PRINT = 10;

function fmtFecha(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("es-SV");
}

function atendioLabel(v: boolean | null): string {
  if (v === null) return "—";
  return v ? "SÍ" : "NO";
}

/** Ventana imprimible fiel al formulario físico AVANTE (patrón: ece/bitacora). */
function imprimirCenso(data: {
  patienteNombre: string;
  aseguradora: string;
  diagnostico: string;
  entries: Array<{ doctorNombre: string; telefono: string; atendioLlamada: boolean | null; comentarios: string }>;
  medicoTurnoNombre: string;
}) {
  const win = window.open("", "_blank");
  if (!win) return;

  const filas = [...data.entries];
  while (filas.length < ENTRY_ROWS_MIN_PRINT) {
    filas.push({ doctorNombre: "", telefono: "", atendioLlamada: null, comentarios: "" });
  }

  const filasHtml = filas
    .map(
      (e) => `<tr>
        <td>${e.doctorNombre}</td>
        <td>${e.telefono}</td>
        <td>${e.atendioLlamada === null ? "" : e.atendioLlamada ? "SÍ" : "NO"}</td>
        <td>${e.comentarios}</td>
      </tr>`,
    )
    .join("");

  win.document.write(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Censo de llamada seguro médico — AVANTE</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 10pt; margin: 20mm; color: #111; }
    header { display: flex; align-items: center; gap: 12px; border-bottom: 2px solid #1a3c5e; padding-bottom: 8px; }
    header img { height: 48px; }
    h1 { font-size: 13pt; margin: 0; }
    .sub { font-size: 9pt; color: #555; margin: 2px 0 0; }
    .campo { margin: 4px 0; font-size: 10pt; }
    .campo strong { display: inline-block; min-width: 140px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12pt; }
    th { background: #1a3c5e; color: white; padding: 5px 6px; font-size: 9pt; text-align: left; }
    td { border: 1px solid #ccc; padding: 6px; font-size: 9pt; height: 20pt; }
    .firma { margin-top: 40pt; }
    .firma-linea { margin-top: 30pt; border-top: 1px solid #000; width: 320px; padding-top: 4px; font-size: 9pt; }
    @media print { button { display: none; } }
  </style>
</head>
<body>
  <header>
    <img src="/avante-logo.svg" alt="AVANTE" onerror="this.style.display='none'" />
    <div>
      <h1>Censo de llamada seguro médico</h1>
      <p class="sub">Complejo Hospitalario Avante — Protocolo de recepción, médico fuera de red</p>
    </div>
  </header>

  <div class="campo"><strong>Paciente:</strong> ${data.patienteNombre}</div>
  <div class="campo"><strong>Compañía de seguros:</strong> ${data.aseguradora}</div>
  <div class="campo"><strong>Diagnóstico:</strong> ${data.diagnostico}</div>

  <table>
    <thead>
      <tr>
        <th>Nombre de médico</th>
        <th>Número de teléfono</th>
        <th>Atendió llamada</th>
        <th>Comentarios</th>
      </tr>
    </thead>
    <tbody>${filasHtml}</tbody>
  </table>

  <div class="firma">
    <p>Médico de turno: ${data.medicoTurnoNombre || "_______________________________"}</p>
    <div class="firma-linea">Firma y sello (No. J.V.P.M.)</div>
  </div>

  <br/>
  <button onclick="window.print()">Imprimir / Guardar PDF</button>
</body>
</html>`);
  win.document.close();
}

export default function DetalleCensoLlamadasPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpc.insurance.callCensus.byId.useQuery({ id });
  const utils = trpc.useUtils();

  const [diagnostico, setDiagnostico] = React.useState("");
  const [notas, setNotas] = React.useState("");
  const [editing, setEditing] = React.useState(false);
  const [newEntry, setNewEntry] = React.useState({ doctorNombre: "", telefono: "", comentarios: "" });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (query.data) {
      setDiagnostico(query.data.diagnostico);
      setNotas(query.data.notas ?? "");
    }
  }, [query.data]);

  const invalidate = () => void utils.insurance.callCensus.byId.invalidate({ id });

  const updateMutation = trpc.insurance.callCensus.update.useMutation({
    onSuccess: () => {
      setEditing(false);
      invalidate();
    },
    onError: (err) => setError(err.message),
  });
  const addEntryMutation = trpc.insurance.callCensus.addEntry.useMutation({
    onSuccess: () => {
      setNewEntry({ doctorNombre: "", telefono: "", comentarios: "" });
      invalidate();
    },
    onError: (err) => setError(err.message),
  });
  const updateEntryMutation = trpc.insurance.callCensus.updateEntry.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });
  const removeEntryMutation = trpc.insurance.callCensus.removeEntry.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });
  const signMutation = trpc.insurance.callCensus.sign.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });
  const anularMutation = trpc.insurance.callCensus.anular.useMutation({
    onSuccess: () => invalidate(),
    onError: (err) => setError(err.message),
  });

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (query.error || !query.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error?.message ?? "Censo no encontrado."}
      </p>
    );
  }

  const censo = query.data;
  const esBorrador = censo.status === "BORRADOR";
  const nombrePaciente = `${censo.patient.lastName} ${censo.patient.firstName}`.trim();
  const aseguradora = censo.insurer?.name ?? censo.aseguradoraNombre ?? "—";

  function handleAnular() {
    const motivo = window.prompt("Motivo de anulación:");
    if (!motivo || !motivo.trim()) return;
    anularMutation.mutate({ id, motivo: motivo.trim() });
  }

  function handleAddEntry() {
    if (!newEntry.doctorNombre.trim()) return;
    addEntryMutation.mutate({
      censusId: id,
      entry: {
        doctorNombre: newEntry.doctorNombre.trim(),
        telefono: newEntry.telefono.trim() || undefined,
        comentarios: newEntry.comentarios.trim() || undefined,
        atendioLlamada: null,
      },
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Censo de llamadas</h1>
          <Badge variant={STATUS_BADGE[censo.status] ?? "outline"}>{censo.status}</Badge>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance/formularios">Volver</Link>
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              imprimirCenso({
                patienteNombre: nombrePaciente,
                aseguradora,
                diagnostico: censo.diagnostico,
                entries: censo.entries.map((e) => ({
                  doctorNombre: e.doctorNombre,
                  telefono: e.telefono ?? "",
                  atendioLlamada: e.atendioLlamada,
                  comentarios: e.comentarios ?? "",
                })),
                medicoTurnoNombre: censo.medicoTurno?.fullName ?? "",
              })
            }
          >
            Imprimir
          </Button>
          {esBorrador ? (
            <Button onClick={() => signMutation.mutate({ id })} disabled={signMutation.isPending}>
              {signMutation.isPending ? "Firmando…" : "Firmar (médico de turno)"}
            </Button>
          ) : null}
          {censo.status !== "ANULADO" ? (
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
          <CardTitle>Datos</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
            <p>
              <span className="font-medium">Paciente:</span> {nombrePaciente}
              {censo.patient.mrn ? ` · ${censo.patient.mrn}` : ""}
            </p>
            <p>
              <span className="font-medium">Aseguradora:</span> {aseguradora}
            </p>
            <p>
              <span className="font-medium">Cuenta:</span> {censo.account?.numeroCuenta ?? "—"}
            </p>
            <p>
              <span className="font-medium">Médico de turno (firma):</span>{" "}
              {censo.medicoTurno?.fullName ?? "—"}
            </p>
            <p>
              <span className="font-medium">Firmado:</span> {fmtFecha(censo.firmadoAt)}
            </p>
            {censo.motivoAnulacion ? (
              <p className="md:col-span-2">
                <span className="font-medium">Motivo de anulación:</span> {censo.motivoAnulacion}
              </p>
            ) : null}
          </div>

          {esBorrador && editing ? (
            <div className="space-y-3 rounded-md border p-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-diagnostico">Diagnóstico</Label>
                <Textarea
                  id="edit-diagnostico"
                  rows={2}
                  value={diagnostico}
                  onChange={(e) => setDiagnostico(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-notas">Notas</Label>
                <Textarea id="edit-notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={updateMutation.isPending}
                  onClick={() =>
                    updateMutation.mutate({ id, diagnostico: diagnostico.trim(), notas: notas.trim() || undefined })
                  }
                >
                  Guardar
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Diagnóstico:</span> {censo.diagnostico}
              </p>
              {censo.notas ? (
                <p>
                  <span className="font-medium">Notas:</span> {censo.notas}
                </p>
              ) : null}
              {esBorrador ? (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  Editar
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Médicos de la red llamados</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Médico</TableHead>
                <TableHead>Teléfono</TableHead>
                <TableHead>Atendió</TableHead>
                <TableHead>Comentarios</TableHead>
                {esBorrador ? <TableHead className="w-32"></TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {censo.entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.doctorNombre}</TableCell>
                  <TableCell>{entry.telefono ?? "—"}</TableCell>
                  <TableCell>
                    {esBorrador ? (
                      <Select
                        value={entry.atendioLlamada === null ? "none" : entry.atendioLlamada ? "si" : "no"}
                        onValueChange={(v) =>
                          updateEntryMutation.mutate({
                            censusId: id,
                            entryId: entry.id,
                            entry: { atendioLlamada: v === "none" ? null : v === "si" },
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-28">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Sin registrar</SelectItem>
                          <SelectItem value="si">Sí</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      atendioLabel(entry.atendioLlamada)
                    )}
                  </TableCell>
                  <TableCell>{entry.comentarios ?? "—"}</TableCell>
                  {esBorrador ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeEntryMutation.mutate({ censusId: id, entryId: entry.id })}
                      >
                        Quitar
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {esBorrador ? (
            <div className="mt-3 grid grid-cols-1 gap-2 rounded-md border p-3 md:grid-cols-[2fr_1fr_2fr_auto]">
              <Input
                placeholder="Nombre de médico"
                value={newEntry.doctorNombre}
                onChange={(e) => setNewEntry((prev) => ({ ...prev, doctorNombre: e.target.value }))}
              />
              <Input
                placeholder="Teléfono"
                value={newEntry.telefono}
                onChange={(e) => setNewEntry((prev) => ({ ...prev, telefono: e.target.value }))}
              />
              <Input
                placeholder="Comentarios"
                value={newEntry.comentarios}
                onChange={(e) => setNewEntry((prev) => ({ ...prev, comentarios: e.target.value }))}
              />
              <Button type="button" size="sm" onClick={handleAddEntry} disabled={addEntryMutation.isPending}>
                Agregar
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
