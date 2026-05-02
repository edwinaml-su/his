"use client";

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

export interface BedAssignmentStepProps {
  /** Si EMERGENCY, la cama es opcional. SCHEDULED la requiere. */
  required: boolean;
  serviceUnitId?: string;
  selectedBedId: string | null;
  onSelectBed: (bedId: string | null) => void;
  onBack: () => void;
  onContinue: () => void;
}

/**
 * US-5.2 — Selector de cama disponible. Filtra automáticamente por el
 * servicio elegido en el paso 2 (si lo hay) y permite cambiar el filtro
 * desde aquí. Las camas se pintan como tarjetas clickeables; sólo se
 * muestran las que están en `FREE` (las DIRTY/MAINTENANCE/RESERVED no son
 * elegibles aquí — se gestionan desde housekeeping).
 */
export function BedAssignmentStep({
  required,
  serviceUnitId,
  selectedBedId,
  onSelectBed,
  onBack,
  onContinue,
}: BedAssignmentStepProps) {
  const [filterServiceId, setFilterServiceId] = React.useState<string>(
    serviceUnitId ?? "ALL",
  );

  const beds = trpc.bed.findAvailable.useQuery(
    filterServiceId === "ALL" ? {} : { serviceUnitId: filterServiceId },
  );

  // Lista de servicios derivada de las camas para no agregar más queries.
  const services = React.useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    beds.data?.forEach((b) => {
      if (b.serviceUnit && !map.has(b.serviceUnit.id)) {
        map.set(b.serviceUnit.id, b.serviceUnit);
      }
    });
    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [beds.data]);

  const canContinue = required ? !!selectedBedId : true;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <label className="text-sm text-muted-foreground">Filtrar servicio</label>
        <Select value={filterServiceId} onValueChange={setFilterServiceId}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Todos</SelectItem>
            {services.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!required ? (
          <Badge variant="outline">Opcional (emergencia)</Badge>
        ) : (
          <Badge variant="success">Requerida</Badge>
        )}
      </div>

      {beds.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando camas…</p>
      ) : null}

      {beds.data && beds.data.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay camas libres en el filtro actual.
        </p>
      ) : null}

      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {beds.data?.map((b) => {
          const isSelected = selectedBedId === b.id;
          return (
            <li key={b.id}>
              <button
                type="button"
                onClick={() => onSelectBed(isSelected ? null : b.id)}
                className={`flex h-24 w-full flex-col items-center justify-center rounded-md border-2 p-2 text-center transition-colors ${
                  isSelected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-success/40 bg-success/10 text-success hover:opacity-80"
                }`}
                aria-pressed={isSelected}
                aria-label={`Cama ${b.code} en ${b.serviceUnit?.name ?? ""}`}
              >
                <span className="text-base font-bold tabular-nums">{b.code}</span>
                <span className="text-[10px] uppercase">
                  {b.serviceUnit?.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-between gap-2">
        <Button type="button" variant="outline" onClick={onBack}>
          Atrás
        </Button>
        <div className="flex gap-2">
          {!required ? (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                onSelectBed(null);
                onContinue();
              }}
            >
              Continuar sin cama
            </Button>
          ) : null}
          <Button type="button" onClick={onContinue} disabled={!canContinue}>
            Continuar
          </Button>
        </div>
      </div>
    </div>
  );
}
