"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

/** Wiring TODO US-5.4: ver nota en bed-occupancy.tsx. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const censusTrpc = (trpc as any).census;

export interface MovementsProps {
  establishmentId?: string;
}

interface PatientLite {
  id: string;
  mrn: string;
  firstName: string;
  lastName: string;
}

interface AdmissionItem {
  id: string;
  encounterNumber: string;
  admittedAt: string | Date;
  patient: PatientLite;
}

interface DischargeItem {
  id: string;
  encounterNumber: string;
  dischargedAt: string | Date | null;
  dischargeType: string | null;
  patient: PatientLite;
}

interface TransferItem {
  id: string;
  occurredAt: string | Date;
  reason: string;
  encounter: { id: string; encounterNumber: string; patient: PatientLite };
}

interface DeathOrAbscondedItem {
  id: string;
  encounterNumber: string;
  dischargedAt: string | Date | null;
  patient: PatientLite;
}

interface MovementsData {
  admissions: { count: number; items: AdmissionItem[] };
  discharges: { count: number; items: DischargeItem[] };
  transfers: { count: number; items: TransferItem[] };
  deaths: { count: number; items: DeathOrAbscondedItem[] };
  absconded: { count: number; items: DeathOrAbscondedItem[] };
}

interface MovementCardProps {
  title: string;
  count: number;
  variant?: "default" | "success" | "warning" | "destructive";
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function MovementCard({
  title,
  count,
  variant = "default",
  expanded,
  onToggle,
  children,
}: MovementCardProps) {
  const variantClass =
    variant === "success"
      ? "bg-success/10 border-success/40 text-success"
      : variant === "warning"
        ? "bg-warning/10 border-warning/40 text-warning"
        : variant === "destructive"
          ? "bg-destructive/10 border-destructive/40 text-destructive"
          : "bg-muted/40";

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm font-medium">
          <span>{title}</span>
          <Badge className={variantClass}>{count}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          onClick={onToggle}
          disabled={count === 0}
          className="text-xs text-primary underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-muted-foreground disabled:no-underline"
        >
          {count === 0
            ? "Sin movimientos"
            : expanded
              ? "Ocultar lista"
              : "Ver lista"}
        </button>
        {expanded && count > 0 ? (
          <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
            {children}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * US-5.4 — Cuatro cards con counts de ingresos/egresos/traslados/defunciones
 * + lista expandible (top 50 por bucket). Auto-refresh 30s.
 */
export function Movements({ establishmentId }: MovementsProps) {
  const m = censusTrpc.dailyMovements.useQuery(
    { establishmentId },
    { refetchInterval: 30_000 },
  );
  const data: MovementsData | undefined = m.data as MovementsData | undefined;

  const [open, setOpen] = React.useState<{
    admissions: boolean;
    discharges: boolean;
    transfers: boolean;
    deaths: boolean;
  }>({ admissions: false, discharges: false, transfers: false, deaths: false });

  if (m.isLoading) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">Cargando movimientos…</p>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <MovementCard
        title="Ingresos hoy"
        count={data.admissions.count}
        variant="success"
        expanded={open.admissions}
        onToggle={() => setOpen((s) => ({ ...s, admissions: !s.admissions }))}
      >
        {data.admissions.items.map((a) => (
          <li key={a.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
            <span>
              <span className="font-semibold">
                {a.patient.firstName} {a.patient.lastName}
              </span>
              <span className="ml-2 text-muted-foreground">MRN {a.patient.mrn}</span>
            </span>
            <span className="text-muted-foreground">
              {new Date(a.admittedAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </MovementCard>

      <MovementCard
        title="Egresos hoy"
        count={data.discharges.count}
        expanded={open.discharges}
        onToggle={() => setOpen((s) => ({ ...s, discharges: !s.discharges }))}
      >
        {data.discharges.items.map((d) => (
          <li key={d.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
            <span>
              <span className="font-semibold">
                {d.patient.firstName} {d.patient.lastName}
              </span>
              <span className="ml-2 text-muted-foreground">
                {d.dischargeType ?? "—"}
              </span>
            </span>
            <span className="text-muted-foreground">
              {d.dischargedAt ? new Date(d.dischargedAt).toLocaleTimeString() : ""}
            </span>
          </li>
        ))}
      </MovementCard>

      <MovementCard
        title="Traslados internos"
        count={data.transfers.count}
        expanded={open.transfers}
        onToggle={() => setOpen((s) => ({ ...s, transfers: !s.transfers }))}
      >
        {data.transfers.items.map((t) => (
          <li key={t.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
            <span>
              <span className="font-semibold">
                {t.encounter.patient.firstName} {t.encounter.patient.lastName}
              </span>
              <span className="ml-2 text-muted-foreground">{t.reason}</span>
            </span>
            <span className="text-muted-foreground">
              {new Date(t.occurredAt).toLocaleTimeString()}
            </span>
          </li>
        ))}
      </MovementCard>

      <MovementCard
        title="Defunciones / fugas"
        count={data.deaths.count + data.absconded.count}
        variant="destructive"
        expanded={open.deaths}
        onToggle={() => setOpen((s) => ({ ...s, deaths: !s.deaths }))}
      >
        {[
          ...data.deaths.items.map((x) => ({
            ...x,
            kind: "Defunción" as const,
          })),
          ...data.absconded.items.map((x) => ({
            ...x,
            kind: "Fuga" as const,
          })),
        ].map((d) => (
          <li key={d.id} className="flex justify-between gap-2 border-b pb-1 last:border-0">
            <span>
              <span className="font-semibold">
                {d.patient.firstName} {d.patient.lastName}
              </span>
              <span className="ml-2 text-muted-foreground">{d.kind}</span>
            </span>
            <span className="text-muted-foreground">
              {d.dischargedAt ? new Date(d.dischargedAt).toLocaleTimeString() : ""}
            </span>
          </li>
        ))}
      </MovementCard>
    </div>
  );
}
