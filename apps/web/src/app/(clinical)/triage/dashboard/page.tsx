"use client";

/**
 * US-6.5 + US-6.6 — Pantalla operativa principal de triage (whiteboard).
 *
 * Equipo Sierra. Layout:
 *  - Header con título + botón "Nuevo triage" + toggle de alarma sonora.
 *  - 5 cards color-coded con counts por nivel + total overdue.
 *  - Búsqueda por nombre/MRN + filtro por serviceUnit.
 *  - Grid masonry de TriageCards (1/2/3 cols según viewport).
 *  - Auto-refresh cada 10s.
 *
 * El router `triageDashboard` será cableado en `_app.ts` por @Orq —
 * mientras tanto accedemos vía `(trpc as any).triageDashboard.*`, idéntico
 * al patrón usado por `auditIntegrity` antes de su wiring.
 */
import * as React from "react";
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";
import { QueueList, useAlarmToggle } from "./queue-list";
import type { TriageCardItem } from "./triage-card";

interface LevelCount {
  color: "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";
  name: string;
  uiColorHex: string | null;
  count: number;
  overdueCount: number;
}

interface QueueResponse {
  serverNow: Date;
  counts: LevelCount[];
  totalActive: number;
  totalOverdue: number;
  items: TriageCardItem[];
}

const LEVEL_BG: Record<LevelCount["color"], string> = {
  RED: "bg-red-600 text-white",
  ORANGE: "bg-orange-500 text-white",
  YELLOW: "bg-yellow-400 text-black",
  GREEN: "bg-green-500 text-white",
  BLUE: "bg-blue-500 text-white",
};

export default function TriageDashboardPage() {
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [serviceUnitId, setServiceUnitId] = React.useState<string | undefined>(undefined);
  const [alarmEnabled, setAlarmEnabled] = useAlarmToggle();

  // Debounce 300ms — evita refetch en cada keystroke.
  React.useEffect(() => {
    const id = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);

  // Acceso "as any" mientras Orq cablea el router.
  const trpcAny = trpc as unknown as {
    triageDashboard: {
      queueWithTimers: {
        useQuery: (
          input: { search?: string; serviceUnitId?: string; onlyActive: boolean },
          opts: { refetchInterval: number; refetchOnWindowFocus: boolean },
        ) => {
          data: QueueResponse | undefined;
          isLoading: boolean;
          isFetching: boolean;
          error: { message: string } | null;
        };
      };
    };
  };

  const queryInput = {
    search: debouncedSearch.length >= 2 ? debouncedSearch : undefined,
    serviceUnitId,
    onlyActive: true,
  };

  const queue = trpcAny.triageDashboard.queueWithTimers.useQuery(queryInput, {
    refetchInterval: 10_000, // 10s — ver comentario en queue-list.tsx.
    refetchOnWindowFocus: true,
  });

  const counts: LevelCount[] = queue.data?.counts ?? [];
  const items: TriageCardItem[] = queue.data?.items ?? [];
  const totalActive = queue.data?.totalActive ?? 0;
  const totalOverdue = queue.data?.totalOverdue ?? 0;
  const serverNow = queue.data?.serverNow ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tablero de triage</h1>
          <p className="text-sm text-muted-foreground">
            {totalActive} activos · {totalOverdue} excedidos
            {queue.isFetching && " · actualizando…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex select-none items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={alarmEnabled}
              onChange={(e) => setAlarmEnabled(e.target.checked)}
              aria-label="Alarma sonora para casos críticos"
            />
            <span>Alarma sonora</span>
          </label>
          <Button asChild>
            <Link href="/triage/intake">Nuevo triage</Link>
          </Button>
        </div>
      </div>

      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-5"
        role="group"
        aria-label="Resumen por nivel Manchester"
      >
        {counts.map((c) => (
          <div
            key={c.color}
            className={[
              "rounded-md px-3 py-2 shadow-sm",
              LEVEL_BG[c.color],
            ].join(" ")}
          >
            <div className="text-xs uppercase opacity-90">{c.name}</div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{c.count}</span>
              {c.overdueCount > 0 && (
                <span
                  className="rounded bg-black/30 px-1.5 py-0.5 text-xs font-semibold"
                  aria-label={`${c.overdueCount} excedidos`}
                >
                  +{c.overdueCount} excedidos
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <CardTitle className="text-base">Cola activa</CardTitle>
          <div className="flex items-center gap-2">
            <Input
              type="search"
              placeholder="Buscar nombre o MRN…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
              aria-label="Buscar paciente"
            />
            <select
              value={serviceUnitId ?? ""}
              onChange={(e) => setServiceUnitId(e.target.value || undefined)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              aria-label="Filtrar por unidad"
            >
              <option value="">Todas las unidades</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {queue.error && (
            <p role="alert" className="text-sm text-destructive">
              Error cargando cola: {queue.error.message}
            </p>
          )}
          {queue.isLoading && !queue.data && (
            <p className="text-sm text-muted-foreground">Cargando cola…</p>
          )}
          {queue.data && (
            <QueueList
              items={items}
              serverNow={serverNow}
              alarmEnabled={alarmEnabled}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
