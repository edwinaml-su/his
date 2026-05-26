"use client";

/**
 * §17 LIS — Cola de resultados pendientes de validación.
 *
 * Estrategia: como el router skeleton no expone una query custom para
 * "results sin validar", traemos las órdenes con status RESULTED y
 * derivamos client-side los `LabResult` cuyo `validatedAt` es null.
 *
 * Click en row → /lis/orders/[id] (donde se ingresa la validación con
 * la regla 4-eyes server-side).
 *
 * NOTE(Sprint 5): cuando se agregue `result.listPending` con join a
 * `User` para mostrar el nombre del que ingresó, reemplazar el
 * `resultedById` (UUID) por nombre completo y agregar paginación.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import {
  ResultFlagBadge,
  type ResultFlag,
} from "../_components/result-flag-badge";

interface LabResultRow {
  id: string;
  valueNumeric: number | null;
  valueText: string | null;
  valueUnit: string | null;
  flag: ResultFlag;
  resultedById: string;
  validatedAt: string | Date | null;
  createdAt?: string | Date;
}

interface LabOrderItemRow {
  id: string;
  test: { id: string; code: string; name: string };
  results: LabResultRow[];
}

interface LabOrderRow {
  id: string;
  patient?: { firstName: string; lastName: string; mrn: string } | null;
  patientId: string;
  orderedAt: string | Date;
  items: LabOrderItemRow[];
}

interface LisOrderListAccess {
  list: {
    useQuery: (input: {
      status?: "RESULTED";
      limit?: number;
    }) => {
      data?: LabOrderRow[];
      isLoading: boolean;
      error?: { message: string } | null;
    };
  };
}

interface PendingResultRow {
  orderId: string;
  resultId: string;
  patientLabel: string;
  testLabel: string;
  flag: ResultFlag;
  value: string;
  resultedById: string;
  agedAtMs: number;
}

function formatAge(ms: number): string {
  const minutes = Math.max(0, Math.round(ms / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remM = minutes % 60;
  if (hours < 24) return `${hours}h ${remM}m`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return `${days}d ${remH}h`;
}

function formatValue(r: LabResultRow): string {
  const main =
    r.valueNumeric !== null && r.valueNumeric !== undefined
      ? String(r.valueNumeric)
      : (r.valueText ?? "—");
  return r.valueUnit ? `${main} ${r.valueUnit}` : main;
}

export default function LisResultsQueuePage(): React.ReactElement {
  const router = useRouter();
  // HH-10 (audit Stream H): lis está montado en _app.ts — acceso directo.
  // El cast a LisOrderListAccess es local (campos opcionales que la UI espera).
  const lisOrder = trpc.lis.order as unknown as LisOrderListAccess;
  const orders = lisOrder.list.useQuery({ status: "RESULTED", limit: 100 });

  const pending: PendingResultRow[] = React.useMemo(() => {
    if (!orders.data) return [];
    const now = Date.now();
    const rows: PendingResultRow[] = [];
    for (const o of orders.data) {
      const patientLabel = o.patient
        ? `${o.patient.firstName} ${o.patient.lastName}`
        : o.patientId.slice(0, 8);
      for (const item of o.items) {
        for (const r of item.results) {
          if (r.validatedAt) continue;
          const ts = r.createdAt
            ? new Date(r.createdAt).getTime()
            : new Date(o.orderedAt).getTime();
          rows.push({
            orderId: o.id,
            resultId: r.id,
            patientLabel,
            testLabel: `${item.test.code} — ${item.test.name}`,
            flag: r.flag,
            value: formatValue(r),
            resultedById: r.resultedById,
            agedAtMs: now - ts,
          });
        }
      }
    }
    rows.sort((a, b) => b.agedAtMs - a.agedAtMs);
    return rows;
  }, [orders.data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Resultados pendientes de validación</h1>

      <Card>
        <CardHeader>
          <CardTitle>Cola ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {orders.error ? (
            <p role="alert" className="text-sm text-destructive">
              {orders.error.message}
            </p>
          ) : null}
          {orders.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}
          {orders.data ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Flag</TableHead>
                  <TableHead>Resultado por</TableHead>
                  <TableHead>Antigüedad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      No hay resultados pendientes.
                    </TableCell>
                  </TableRow>
                ) : null}
                {pending.map((row) => (
                  <TableRow
                    key={row.resultId}
                    role="button"
                    tabIndex={0}
                    aria-label={`Abrir orden ${row.orderId} — ${row.testLabel}`}
                    className="cursor-pointer hover:bg-muted/50 focus:bg-muted focus:outline-none"
                    onClick={() => router.push(`/lis/orders/${row.orderId}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(`/lis/orders/${row.orderId}`);
                      }
                    }}
                  >
                    <TableCell>{row.patientLabel}</TableCell>
                    <TableCell>{row.testLabel}</TableCell>
                    <TableCell className="tabular-nums">{row.value}</TableCell>
                    <TableCell>
                      <ResultFlagBadge flag={row.flag} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.resultedById.slice(0, 8)}
                    </TableCell>
                    <TableCell className="tabular-nums">
                      {formatAge(row.agedAtMs)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
