"use client";

import * as React from "react";
import { cn } from "../lib/utils";

export type BedStatus = "FREE" | "OCCUPIED" | "DIRTY" | "BLOCKED" | "MAINTENANCE" | "RESERVED";

export interface BedCell {
  id: string;
  code: string;
  status: BedStatus;
  patientName?: string | null;
}

export interface BedMapServiceGroup {
  serviceUnitId: string;
  serviceUnitName: string;
  beds: BedCell[];
}

interface BedMapProps {
  groups: BedMapServiceGroup[];
  onBedClick?: (bed: BedCell) => void;
  className?: string;
}

const STATUS_STYLES: Record<BedStatus, string> = {
  FREE: "bg-success/10 border-success/40 text-success",
  OCCUPIED: "bg-info/10 border-info/40 text-info",
  DIRTY: "bg-warning/10 border-warning/40 text-warning",
  BLOCKED: "bg-destructive/10 border-destructive/40 text-destructive",
  MAINTENANCE: "bg-muted border-border text-muted-foreground",
  RESERVED: "bg-accent border-border text-accent-foreground",
};

const STATUS_LABEL: Record<BedStatus, string> = {
  FREE: "Libre",
  OCCUPIED: "Ocupada",
  DIRTY: "Sucia",
  BLOCKED: "Bloqueada",
  MAINTENANCE: "Mantenimiento",
  RESERVED: "Reservada",
};

/**
 * Mapa visual de camas por servicio (TDR §8.6).
 * Grid responsivo; cada celda es un botón si onBedClick está provisto.
 */
export function BedMap({ groups, onBedClick, className }: BedMapProps) {
  return (
    <div className={cn("space-y-6", className)}>
      {groups.map((group) => (
        <section key={group.serviceUnitId}>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            {group.serviceUnitName}
          </h3>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {group.beds.map((bed) => {
              const Cmp = onBedClick ? "button" : "div";
              return (
                <li key={bed.id}>
                  <Cmp
                    type={onBedClick ? "button" : undefined}
                    onClick={onBedClick ? () => onBedClick(bed) : undefined}
                    className={cn(
                      "flex h-20 w-full flex-col items-center justify-center rounded-md border-2 p-1 text-center transition-colors",
                      STATUS_STYLES[bed.status],
                      onBedClick && "hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                    aria-label={`Cama ${bed.code} — ${STATUS_LABEL[bed.status]}${
                      bed.patientName ? ` — ${bed.patientName}` : ""
                    }`}
                  >
                    <span className="text-sm font-bold tabular-nums">{bed.code}</span>
                    <span className="text-[10px] uppercase">{STATUS_LABEL[bed.status]}</span>
                    {bed.patientName ? (
                      <span className="mt-0.5 line-clamp-1 text-[10px]">{bed.patientName}</span>
                    ) : null}
                  </Cmp>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {groups.length === 0 && (
        <p className="text-sm text-muted-foreground">No hay camas configuradas.</p>
      )}
    </div>
  );
}
