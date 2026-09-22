"use client";

/**
 * CC-0044 — Formularios de médico fuera de red (módulo de aseguradoras).
 *
 * Índice combinado de "Censo de llamada seguro médico" (NetworkCallCensus) +
 * "Constancia de atención por médico fuera de red" (OutOfNetworkAttestation),
 * más el protocolo de recepción AVANTE como guía colapsable.
 *
 * Sidebar: NO se agrega item nuevo — se navega desde el toolbar de
 * `/insurance` (mismo patrón que "Planes"/"Pólizas", regla de un solo item
 * por dominio en nav-sections.ts).
 */
import * as React from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";

function fmtFecha(d: string | Date): string {
  return new Date(d).toLocaleString("es-SV");
}

const CENSUS_BADGE: Record<string, BadgeProps["variant"]> = {
  BORRADOR: "outline",
  FIRMADO: "success",
  ANULADO: "destructive",
};

const ATTESTATION_BADGE: Record<string, BadgeProps["variant"]> = {
  PENDIENTE_FIRMA: "outline",
  FIRMADO: "success",
  ANULADO: "destructive",
};

/** Protocolo de recepción AVANTE — guía colapsable (no editable, texto fijo). */
function ProtocoloRecepcion() {
  return (
    <details className="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <summary className="cursor-pointer text-sm font-medium text-foreground">
        Protocolo de recepción — médico fuera de red
      </summary>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        <li>Recepción confirma pertenencia a la red ANTES de definir el tipo de ingreso.</li>
        <li>
          Si el médico tratante está fuera de red → llenar el formulario de la aseguradora, o el
          de respaldo AVANTE (Constancia).
        </li>
        <li>Completar y hacer FIRMAR al asegurado/responsable ANTES de cerrar la admisión.</li>
        <li>Adjuntar al expediente/caso.</li>
        <li>Notificar a Cuentas/Seguros.</li>
      </ol>
      <p className="mt-2 text-xs text-muted-foreground">
        v1: el bloqueo automático de admisión y la notificación a Cuentas/Seguros quedan para una
        siguiente iteración — ver docs/CC/CC-0044-formularios-fuera-de-red.md.
      </p>
    </details>
  );
}

export default function FormulariosFueraDeRedPage() {
  const censusQuery = trpc.insurance.callCensus.list.useQuery({ limit: 50, offset: 0 });
  const attestationQuery = trpc.insurance.outOfNetwork.list.useQuery({ limit: 50, offset: 0 });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Formularios de médico fuera de red</h1>
          <p className="text-sm text-muted-foreground">
            Censo de llamadas y constancia de respaldo AVANTE — protocolo de recepción cuando el
            médico tratante no pertenece a la red de la aseguradora del paciente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance">Aseguradoras</Link>
          </Button>
          <Button asChild>
            <Link href="/insurance/formularios/censo/new">Nuevo censo de llamadas</Link>
          </Button>
          <Button asChild>
            <Link href="/insurance/formularios/constancia/new">Nueva constancia fuera de red</Link>
          </Button>
        </div>
      </div>

      <ProtocoloRecepcion />

      <Tabs defaultValue="censos">
        <TabsList>
          <TabsTrigger value="censos">Censos de llamadas</TabsTrigger>
          <TabsTrigger value="constancias">Constancias fuera de red</TabsTrigger>
        </TabsList>

        <TabsContent value="censos">
          <Card>
            <CardHeader>
              <CardTitle>Censo de llamada seguro médico</CardTitle>
            </CardHeader>
            <CardContent>
              {censusQuery.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
              {censusQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  {censusQuery.error.message}
                </p>
              )}
              {censusQuery.data && censusQuery.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin censos registrados.</p>
              )}
              {censusQuery.data && censusQuery.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Aseguradora</TableHead>
                      <TableHead>Diagnóstico</TableHead>
                      <TableHead>Llamadas</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Creado</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {censusQuery.data.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          {c.patient.lastName} {c.patient.firstName}
                          {c.patient.mrn ? (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {c.patient.mrn}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{c.insurer?.name ?? c.aseguradoraNombre ?? "—"}</TableCell>
                        <TableCell className="max-w-xs truncate">{c.diagnostico}</TableCell>
                        <TableCell>{c._count.entries}</TableCell>
                        <TableCell>
                          <Badge variant={CENSUS_BADGE[c.status] ?? "outline"}>{c.status}</Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtFecha(c.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/insurance/formularios/censo/${c.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="constancias">
          <Card>
            <CardHeader>
              <CardTitle>Constancia de atención por médico fuera de red</CardTitle>
            </CardHeader>
            <CardContent>
              {attestationQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              )}
              {attestationQuery.error && (
                <p role="alert" className="text-sm text-destructive">
                  {attestationQuery.error.message}
                </p>
              )}
              {attestationQuery.data && attestationQuery.data.length === 0 && (
                <p className="text-sm text-muted-foreground">Sin constancias registradas.</p>
              )}
              {attestationQuery.data && attestationQuery.data.length > 0 && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Paciente</TableHead>
                      <TableHead>Aseguradora</TableHead>
                      <TableHead>Médico</TableHead>
                      <TableHead>Asegurado titular</TableHead>
                      <TableHead>Estado</TableHead>
                      <TableHead>Creado</TableHead>
                      <TableHead className="w-24"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attestationQuery.data.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          {a.patient.lastName} {a.patient.firstName}
                          {a.patient.mrn ? (
                            <span className="ml-1 font-mono text-xs text-muted-foreground">
                              {a.patient.mrn}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>{a.insurer?.name ?? a.aseguradoraNombre ?? "—"}</TableCell>
                        <TableCell>{a.doctorNombre}</TableCell>
                        <TableCell>{a.aseguradoTitular}</TableCell>
                        <TableCell>
                          <Badge variant={ATTESTATION_BADGE[a.status] ?? "outline"}>
                            {a.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {fmtFecha(a.createdAt)}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/insurance/formularios/constancia/${a.id}`}>Ver</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
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
