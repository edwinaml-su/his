"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { BedDouble, Scissors, FlaskConical, ImageIcon, Activity } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { AllergyAlert } from "@his/ui/components/AllergyAlert";
import { Badge } from "@his/ui/components/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { PatientShellBar } from "@/components/patient-shell-bar";

const dateTimeFmt = new Intl.DateTimeFormat("es-SV", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
function fmtDT(value: Date | string | null | undefined): string {
  return value ? dateTimeFmt.format(new Date(value)) : "—";
}

const ESTADO_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  abierto: "default",
  en_curso: "default",
  alta_iniciada: "secondary",
  cerrado: "outline",
  cancelado: "destructive",
};

/**
 * Vista 360° del paciente (TDR §8.1).
 * TODO(Sprint 2): historia clínica resumida, encuentros, signos vitales, órdenes.
 */
export default function PatientDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const query = trpc.patient.get.useQuery({ id: params.id });
  const admisiones = trpc.eceEpisodioHospitalario.listAdmisionesPorPaciente.useQuery(
    { patientId: params.id, incluirCerrados: true, limit: 100 },
  );

  if (query.isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (query.error) return <p className="text-sm text-destructive">{query.error.message}</p>;
  const p = query.data!;

  return (
    <div className="space-y-4">
      <PatientShellBar patientId={params.id} />
      <div>
        <h1 className="text-2xl font-bold">
          {p.lastName}
          {p.secondLastName ? ` ${p.secondLastName}` : ""}, {p.firstName}
        </h1>
        <p className="text-xs font-mono text-muted-foreground">MRN {p.mrn}</p>
      </div>

      <AllergyAlert
        allergies={p.allergies.map((a) => ({
          id: a.id,
          substanceText: a.substanceText,
          severity: a.severity as "mild" | "moderate" | "severe" | "life-threatening",
          reaction: a.reaction,
        }))}
      />

      <Tabs defaultValue="general">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="ids">Identificadores</TabsTrigger>
          <TabsTrigger value="contact">Contacto</TabsTrigger>
          <TabsTrigger value="admisiones">Admisiones</TabsTrigger>
        </TabsList>
        <TabsContent value="general">
          <Card>
            <CardHeader><CardTitle>Datos generales</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              <p><span className="text-muted-foreground">Fecha de nacimiento: </span>{p.birthDate ? new Date(p.birthDate).toLocaleDateString("es-SV") : "—"}</p>
              <p><span className="text-muted-foreground">Sexo biológico: </span>{p.biologicalSex?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Género: </span>{p.gender?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Estado civil: </span>{p.maritalStatus?.name ?? "—"}</p>
              <p><span className="text-muted-foreground">Tipo de sangre: </span>{p.bloodTypeAbo ?? "—"} {p.bloodRh ?? ""}</p>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ids">
          <Card>
            <CardHeader><CardTitle>Identificadores</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {p.identifiers.length === 0 ? (
                <p className="text-muted-foreground">Sin identificadores registrados.</p>
              ) : (
                <ul className="space-y-1">
                  {p.identifiers.map((i) => (
                    <li key={i.id} className="font-mono">
                      {i.identifierType.code}: {i.value}
                      {i.isPrimary ? <span className="ml-2 text-xs text-primary">(primario)</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="contact">
          <Card>
            <CardHeader><CardTitle>Contacto</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div>
                <p className="font-medium">Teléfonos</p>
                {p.phones.length === 0 ? <p className="text-muted-foreground">—</p> : (
                  <ul>{p.phones.map((ph) => <li key={ph.id} className="font-mono">{ph.phone}</li>)}</ul>
                )}
              </div>
              <div>
                <p className="font-medium">Direcciones</p>
                {p.addresses.length === 0 ? <p className="text-muted-foreground">—</p> : (
                  <ul>{p.addresses.map((a) => <li key={a.id}>{a.line1}</li>)}</ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="admisiones">
          <Card>
            <CardHeader>
              <CardTitle>Admisiones del paciente</CardTitle>
              <p className="text-xs text-muted-foreground">
                Histórico de admisiones (episodios de atención) en el establecimiento activo,
                ambulatorias y hospitalarias. La columna &ldquo;Contenido&rdquo; resume lo que se
                registró dentro de cada admisión (hospitalización, procedimientos, exámenes,
                imágenes, gabinete). Click en una fila abre el detalle de la admisión.
              </p>
            </CardHeader>
            <CardContent>
              {admisiones.isLoading ? (
                <p className="text-sm text-muted-foreground">Cargando admisiones…</p>
              ) : admisiones.error ? (
                <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {admisiones.error.message}
                </p>
              ) : (admisiones.data ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Sin admisiones registradas para este paciente.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>N.º admisión</TableHead>
                      <TableHead>Área</TableHead>
                      <TableHead>Modalidad</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Contenido</TableHead>
                      <TableHead>Ingreso</TableHead>
                      <TableHead>Egreso</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(admisiones.data ?? []).map((r) => {
                      const irAlDetalle = () => {
                        const href = r.tiene_hospitalizacion
                          ? `/ece/episodio-hospitalario/${r.id}`
                          : `/ece/admision/${r.id}`;
                        router.push(href);
                      };
                      const rowTitle = r.tiene_hospitalizacion
                        ? "Click para abrir el detalle hospitalario"
                        : "Click para abrir el detalle de la admisión ambulatoria";
                      return (
                        <TableRow
                          key={r.id}
                          role="button"
                          tabIndex={0}
                          aria-label={rowTitle}
                          title={rowTitle}
                          onClick={irAlDetalle}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              irAlDetalle();
                            }
                          }}
                          className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <TableCell className="font-mono text-xs">
                            {r.public_encounter_id ? `${r.public_encounter_id.slice(0, 8)}…` : "—"}
                          </TableCell>
                          <TableCell>{r.servicio_nombre ?? r.servicio_categoria ?? "—"}</TableCell>
                          <TableCell><Badge variant="outline">{r.modalidad}</Badge></TableCell>
                          <TableCell>
                            <Badge variant={ESTADO_VARIANT[r.estado] ?? "outline"}>
                              {r.estado.replace(/_/g, " ")}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1.5">
                              {r.tiene_hospitalizacion && (
                                <Badge variant="secondary" className="gap-1" title="Hospitalización registrada">
                                  <BedDouble className="h-3 w-3" aria-hidden /> Hospitalización
                                </Badge>
                              )}
                              {r.procedimientos_count > 0 && (
                                <Badge variant="secondary" className="gap-1" title="Procedimientos quirúrgicos">
                                  <Scissors className="h-3 w-3" aria-hidden /> {r.procedimientos_count}
                                </Badge>
                              )}
                              {r.lab_count > 0 && (
                                <Badge variant="secondary" className="gap-1" title="Solicitudes de laboratorio">
                                  <FlaskConical className="h-3 w-3" aria-hidden /> {r.lab_count}
                                </Badge>
                              )}
                              {r.imagen_count > 0 && (
                                <Badge variant="secondary" className="gap-1" title="Solicitudes de imagenología">
                                  <ImageIcon className="h-3 w-3" aria-hidden /> {r.imagen_count}
                                </Badge>
                              )}
                              {r.gabinete_count > 0 && (
                                <Badge variant="secondary" className="gap-1" title="Estudios de gabinete">
                                  <Activity className="h-3 w-3" aria-hidden /> {r.gabinete_count}
                                </Badge>
                              )}
                              {!r.tiene_hospitalizacion
                                && r.procedimientos_count === 0
                                && r.lab_count === 0
                                && r.imagen_count === 0
                                && r.gabinete_count === 0 && (
                                  <span className="text-xs text-muted-foreground">Sin registros</span>
                                )}
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">{fmtDT(r.fecha_inicio)}</TableCell>
                          <TableCell className="tabular-nums">{fmtDT(r.fecha_cierre)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
