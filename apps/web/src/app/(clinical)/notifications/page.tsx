"use client";

/**
 * Beta.15 (US.B15.3.1) — Inbox personal de notificaciones.
 *
 * Lista las notificaciones del usuario autenticado en su tenant. Ordenadas
 * por createdAt DESC, paginadas via cursor (botón "Cargar más"). Permite
 * marcar como leída con una mutation idempotente.
 *
 * Patrón: client component con `trpc.notifications.list.useQuery`. Sigue
 * la convención del repo (`inpatient/page.tsx`); el SDK no expone aún un
 * caller SSR.
 */
import * as React from "react";
import { Bell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type Severity = "CRITICAL" | "WARNING" | "INFO";
type Status = "PENDING" | "SENT" | "DELIVERED" | "READ" | "FAILED";

const SEVERITY_FILTERS: { value: Severity | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todas" },
  { value: "CRITICAL", label: "Críticas" },
  { value: "WARNING", label: "Warning" },
  { value: "INFO", label: "Info" },
];

const STATUS_LABEL: Record<Status, string> = {
  PENDING: "Pendiente",
  SENT: "Enviada",
  DELIVERED: "Entregada",
  READ: "Leída",
  FAILED: "Fallida",
};

const SEVERITY_VARIANT: Record<Severity, "critical" | "warning" | "info"> = {
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info",
};

const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: "Crítica",
  WARNING: "Warning",
  INFO: "Info",
};

const PAGE_SIZE = 25;

/**
 * Formatea una fecha como "hace 5 min" usando `Intl.RelativeTimeFormat`
 * con locale es-SV. No requiere date-fns/dayjs.
 */
const relativeFmt = new Intl.RelativeTimeFormat("es-SV", { numeric: "auto" });

function formatRelative(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const diffMs = d.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const absSec = Math.abs(diffSec);
  if (absSec < 60) return relativeFmt.format(diffSec, "second");
  const diffMin = Math.round(diffSec / 60);
  if (Math.abs(diffMin) < 60) return relativeFmt.format(diffMin, "minute");
  const diffHr = Math.round(diffMin / 60);
  if (Math.abs(diffHr) < 24) return relativeFmt.format(diffHr, "hour");
  const diffDay = Math.round(diffHr / 24);
  if (Math.abs(diffDay) < 30) return relativeFmt.format(diffDay, "day");
  const diffMon = Math.round(diffDay / 30);
  if (Math.abs(diffMon) < 12) return relativeFmt.format(diffMon, "month");
  return relativeFmt.format(Math.round(diffDay / 365), "year");
}

interface ListResponseItem {
  id: string;
  severity: Severity;
  subject: string;
  status: Status;
  createdAt: Date | string;
  readAt: Date | string | null;
}

export default function NotificationsPage() {
  const [severity, setSeverity] = React.useState<Severity | "ALL">("ALL");
  const [pages, setPages] = React.useState<
    { items: ListResponseItem[]; nextCursor: string | null }[]
  >([]);

  // Reset cuando cambia el filtro de severity.
  const queryInput = React.useMemo(() => {
    return {
      limit: PAGE_SIZE,
      ...(severity !== "ALL" && { severity }),
    } as { limit: number; severity?: Severity };
  }, [severity]);

  const firstQuery = trpc.notifications.list.useQuery(queryInput);
  const utils = trpc.useUtils();

  // Cuando llega la primera página o cambia severity, resetea la lista.
  React.useEffect(() => {
    if (firstQuery.data) {
      setPages([
        {
          items: firstQuery.data.items as ListResponseItem[],
          nextCursor: firstQuery.data.nextCursor,
        },
      ]);
    }
  }, [firstQuery.data]);

  const allItems = React.useMemo(
    () => pages.flatMap((p) => p.items),
    [pages],
  );
  const lastCursor = pages.length > 0 ? pages[pages.length - 1]!.nextCursor : null;

  const [loadingMore, setLoadingMore] = React.useState(false);
  const loadMore = async () => {
    if (!lastCursor) return;
    setLoadingMore(true);
    try {
      const next = await utils.notifications.list.fetch({
        ...queryInput,
        cursor: lastCursor,
      });
      setPages((prev) => [
        ...prev,
        {
          items: next.items as ListResponseItem[],
          nextCursor: next.nextCursor,
        },
      ]);
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = trpc.notifications.markRead.useMutation({
    onSuccess: (_data, vars) => {
      // Optimismo: marcar la fila local como READ para feedback inmediato.
      setPages((prev) =>
        prev.map((p) => ({
          ...p,
          items: p.items.map((it) =>
            it.id === vars.id
              ? { ...it, status: "READ" as const, readAt: new Date() }
              : it,
          ),
        })),
      );
      // Invalida unreadCount para que el badge navbar (US.B15.3.2) se actualice.
      utils.notifications.unreadCount.invalidate();
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            Inbox personal de alertas clínicas y administrativas.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-severity">Severidad</Label>
              <Select
                value={severity}
                onValueChange={(v) => setSeverity(v as Severity | "ALL")}
              >
                <SelectTrigger id="filter-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_FILTERS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tu inbox</CardTitle>
        </CardHeader>
        <CardContent>
          {firstQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          )}
          {firstQuery.error && (
            <p role="alert" className="text-sm text-destructive">
              {firstQuery.error.message}
            </p>
          )}
          {firstQuery.data && allItems.length === 0 && (
            <EmptyState />
          )}
          {allItems.length > 0 && (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidad</TableHead>
                    <TableHead>Asunto</TableHead>
                    <TableHead>Recibida</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allItems.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell>
                        <Badge variant={SEVERITY_VARIANT[n.severity]}>
                          {SEVERITY_LABEL[n.severity]}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[24rem] truncate font-medium">
                        {n.subject}
                      </TableCell>
                      <TableCell
                        className="tabular-nums text-sm text-muted-foreground"
                        title={new Date(n.createdAt).toISOString()}
                      >
                        {formatRelative(n.createdAt)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {STATUS_LABEL[n.status]}
                      </TableCell>
                      <TableCell className="text-right">
                        {n.status !== "READ" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={markRead.isPending}
                            onClick={() => markRead.mutate({ id: n.id })}
                            aria-label={`Marcar como leída: ${n.subject}`}
                          >
                            Marcar leída
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {lastCursor && (
                <div className="mt-4 flex justify-center">
                  <Button
                    variant="outline"
                    disabled={loadingMore}
                    onClick={loadMore}
                  >
                    {loadingMore ? "Cargando…" : "Cargar más"}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Bell className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium">No tienes notificaciones</p>
      <p className="text-xs text-muted-foreground">
        Cuando recibas alertas clínicas o avisos del sistema aparecerán aquí.
      </p>
    </div>
  );
}
