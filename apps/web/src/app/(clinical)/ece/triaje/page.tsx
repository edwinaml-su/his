"use client";

/**
 * ECE Triaje — Cola priorizada de pacientes (TDR §8, ECE emergencia).
 *
 * Orden: nivel Manchester (1=rojo primero) + tiempo de espera dentro del mismo nivel.
 * Auto-refresh cada 15s — ECE es ligeramente menos time-critical que el
 * whiteboard de triage general (10s) pero sigue siendo urgente.
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";
import { TriageTimer } from "@/components/triage-timer";

// ── tipos locales ─────────────────────────────────────────────────────────────

type ManchesterColor = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";

interface EceTriajeItem {
  id: string;
  patient: { id: string; firstName: string; lastName: string; mrn: string };
  encounterId: string | null;
  assignedLevel: {
    id: string;
    color: ManchesterColor;
    name: string;
    priority: number;
    maxWaitMinutes: number;
  };
  motivoConsulta: string | null;
  startedAt: Date | string;
  isOverdue: boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

const BADGE_VARIANT: Record<ManchesterColor, Parameters<typeof Badge>[0]["variant"]> = {
  RED: "triageRed",
  ORANGE: "triageOrange",
  YELLOW: "triageYellow",
  GREEN: "triageGreen",
  BLUE: "triageBlue",
};

/** Etiqueta de nivel accesible (texto + color) para no depender solo del color. */
const LEVEL_LABEL: Record<ManchesterColor, string> = {
  RED: "1 — Inmediato",
  ORANGE: "2 — Muy urgente",
  YELLOW: "3 — Urgente",
  GREEN: "4 — Poco urgente",
  BLUE: "5 — No urgente",
};

// ── componente ────────────────────────────────────────────────────────────────

export default function EceTriajePage() {
  // El router eceTriaje está siendo creado en paralelo; usamos el patrón
  // "as any" para no bloquear la UI mientras @Dev cablea el router.
  const trpcAny = trpc as unknown as {
    eceTriaje: {
      cola: {
        useQuery: (
          _: Record<string, never>,
          opts: { refetchInterval: number; refetchOnWindowFocus: boolean },
        ) => {
          data: { serverNow: Date; items: EceTriajeItem[] } | undefined;
          isLoading: boolean;
          isFetching: boolean;
          error: { message: string } | null;
        };
      };
    };
  };

  const cola = trpcAny.eceTriaje.cola.useQuery(
    {},
    { refetchInterval: 15_000, refetchOnWindowFocus: true },
  );

  const items: EceTriajeItem[] = cola.data?.items ?? [];
  const serverNow = cola.data?.serverNow ?? null;

  return (
    <div className="space-y-4">
      {/* ── encabezado ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Cola ECE — Triaje</h1>
          <p className="text-sm text-muted-foreground">
            {items.length} paciente{items.length !== 1 ? "s" : ""} activo
            {items.length !== 1 ? "s" : ""}
            {items.filter((i) => i.isOverdue).length > 0 && (
              <span className="ml-2 font-medium text-destructive">
                · {items.filter((i) => i.isOverdue).length} excedido
                {items.filter((i) => i.isOverdue).length !== 1 ? "s" : ""}
              </span>
            )}
            {cola.isFetching && " · actualizando…"}
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/triaje/nuevo">Nuevo triaje ECE</Link>
        </Button>
      </div>

      {/* ── resumen niveles ── */}
      <div
        className="grid grid-cols-5 gap-2"
        role="group"
        aria-label="Resumen por nivel Manchester"
      >
        {(["RED", "ORANGE", "YELLOW", "GREEN", "BLUE"] as ManchesterColor[]).map((color) => {
          const count = items.filter((i) => i.assignedLevel.color === color).length;
          return (
            <div
              key={color}
              className="rounded-md border px-3 py-2 text-center"
              aria-label={`${LEVEL_LABEL[color]}: ${count} pacientes`}
            >
              <Badge variant={BADGE_VARIANT[color]} className="mb-1 w-full justify-center">
                {LEVEL_LABEL[color]}
              </Badge>
              <span className="text-xl font-bold tabular-nums">{count}</span>
            </div>
          );
        })}
      </div>

      {/* ── tabla de cola ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cola priorizada</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {cola.error && (
            <p role="alert" className="p-4 text-sm text-destructive">
              Error cargando cola: {cola.error.message}
            </p>
          )}
          {cola.isLoading && !cola.data && (
            <p className="p-4 text-sm text-muted-foreground">Cargando…</p>
          )}
          {!cola.isLoading && items.length === 0 && (
            <div className="rounded-b-lg border-t border-dashed px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">
                No hay pacientes activos en la cola de triaje ECE.
              </p>
            </div>
          )}
          {items.length > 0 && (
            <div className="overflow-x-auto" role="region" aria-label="Lista cola ECE">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left">
                    <th className="px-4 py-2 font-medium" scope="col">
                      Nivel
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Paciente
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Motivo
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      Tiempo espera
                    </th>
                    <th className="px-4 py-2 font-medium" scope="col">
                      <span className="sr-only">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr
                      key={item.id}
                      className={item.isOverdue ? "bg-red-50 dark:bg-red-950/20" : undefined}
                    >
                      <td className="px-4 py-2">
                        <Badge variant={BADGE_VARIANT[item.assignedLevel.color]}>
                          {LEVEL_LABEL[item.assignedLevel.color]}
                        </Badge>
                        {item.isOverdue && (
                          <span
                            className="ml-1 text-xs font-semibold text-destructive"
                            aria-label="Tiempo excedido"
                          >
                            excedido
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <span className="font-medium">
                          {item.patient.firstName} {item.patient.lastName}
                        </span>
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {item.patient.mrn}
                        </span>
                      </td>
                      <td className="max-w-[14rem] truncate px-4 py-2 text-muted-foreground">
                        {item.motivoConsulta ?? "—"}
                      </td>
                      <td className="px-4 py-2">
                        <TriageTimer
                          startedAt={item.startedAt}
                          maxWaitMinutes={item.assignedLevel.maxWaitMinutes}
                          serverNow={serverNow}
                          className="min-w-[6rem]"
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/ece/triaje/${item.id}`}>Ver</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
