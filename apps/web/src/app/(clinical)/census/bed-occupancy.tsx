"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";

/**
 * NOTA US-5.4 wiring: el router `census` se registrará en `_app.ts` durante
 * el merge del coordinador (la historia restringe modificarlo en paralelo).
 * Hasta entonces casteamos para permitir que la UI compile.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const censusTrpc = (trpc as any).census;

export interface BedOccupancyProps {
  serviceUnitId?: string;
  establishmentId?: string;
}

interface BedCellData {
  id: string;
  code: string;
  room: string | null;
  status: string;
  isolation: string | null;
  patient: {
    id: string;
    mrn: string;
    fullName: string;
    admittedAt: string | Date;
    admissionType: string;
    primaryDiagnosis: string | null;
  } | null;
}

interface BedGroupData {
  serviceUnitId: string;
  serviceUnitCode: string;
  serviceUnitName: string;
  beds: BedCellData[];
}

const STATUS_STYLES: Record<string, string> = {
  FREE: "bg-success/10 border-success/40 text-success",
  OCCUPIED: "bg-info/10 border-info/40 text-info",
  DIRTY: "bg-warning/10 border-warning/40 text-warning",
  BLOCKED: "bg-destructive/10 border-destructive/40 text-destructive",
  MAINTENANCE: "bg-muted border-border text-muted-foreground",
  RESERVED: "bg-accent border-border text-accent-foreground",
};

const STATUS_LABEL: Record<string, string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  DIRTY: "Sucia",
  BLOCKED: "Bloqueada",
  MAINTENANCE: "Mant.",
  RESERVED: "Reservada",
};

/**
 * US-5.4 — Mapa visual de ocupación.
 *
 * Replica BedMap pero enriquecido: cada cama OCUPADA expone un tooltip con
 * el resumen del paciente (nombre, MRN, admittedAt). Auto-refresh cada 30s.
 *
 * Empty state: si la org no tiene servicios o no tiene camas configuradas
 * mostramos un mensaje de inventario vacío con call-to-action al admin.
 */
export function BedOccupancy({ serviceUnitId, establishmentId }: BedOccupancyProps) {
  const map = censusTrpc.bedMap.useQuery(
    { serviceUnitId, establishmentId },
    { refetchInterval: 30_000 },
  );

  if (map.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ocupación de camas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Cargando mapa de camas…</p>
        </CardContent>
      </Card>
    );
  }

  const groups: BedGroupData[] = (map.data as BedGroupData[] | undefined) ?? [];
  const totalBeds = groups.reduce((acc, g) => acc + g.beds.length, 0);

  if (totalBeds === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ocupación de camas</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No hay camas configuradas para esta organización. Pídale al
            administrador que registre el inventario en{" "}
            <a className="text-primary underline" href="/catalogs">
              catálogos
            </a>
            .
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Ocupación de camas</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {groups.map((group) => (
          <section key={group.serviceUnitId}>
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {group.serviceUnitName}{" "}
              <span className="text-xs normal-case text-muted-foreground/70">
                ({group.beds.length} camas)
              </span>
            </h3>
            {group.beds.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Sin camas en este servicio.
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {group.beds.map((bed) => {
                  const tooltip = bed.patient
                    ? `${bed.patient.fullName} · MRN ${bed.patient.mrn} · Ingreso ${new Date(
                        bed.patient.admittedAt,
                      ).toLocaleString()} — Click: expediente histórico del paciente`
                    : `${bed.code} — ${STATUS_LABEL[bed.status] ?? bed.status}`;
                  const cellClass = `flex h-20 w-full flex-col items-center justify-center rounded-md border-2 p-1 text-center transition-colors ${
                    STATUS_STYLES[bed.status] ?? "bg-muted"
                  }`;
                  const inner = (
                    <>
                      <span className="text-sm font-bold tabular-nums">{bed.code}</span>
                      <span className="text-[10px] uppercase">
                        {STATUS_LABEL[bed.status] ?? bed.status}
                      </span>
                      {bed.patient ? (
                        <span className="mt-0.5 line-clamp-1 text-[10px]">
                          {bed.patient.fullName}
                        </span>
                      ) : null}
                    </>
                  );
                  return (
                    <li key={bed.id}>
                      {bed.patient ? (
                        <Link
                          href={`/patients/${bed.patient.id}`}
                          title={tooltip}
                          aria-label={tooltip}
                          className={`${cellClass} hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div title={tooltip} aria-label={tooltip} className={cellClass}>
                          {inner}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
  );
}
