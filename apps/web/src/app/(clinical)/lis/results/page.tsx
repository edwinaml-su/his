"use client";

/**
 * §17 LIS — Cola de resultados pendientes de validación.
 *
 * HH-11: filtros movidos al server via lis.order.listPending.
 * El server retorna únicamente LabResults con validatedAt=null
 * de órdenes en estado RESULTED — sin filtrado client-side.
 *
 * Click en row → /lis/orders/[id] (donde se ingresa la validación con
 * la regla 4-eyes server-side).
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

interface PendingResultRow {
  resultId: string;
  orderId: string;
  patientLabel: string;
  testLabel: string;
  flag: ResultFlag;
  value: string;
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

export default function LisResultsQueuePage(): React.ReactElement {
  const router = useRouter();
  // HH-11: server-side filter via listPending — solo resultados sin validar.
  const { data, isLoading, error } = trpc.lis.order.listPending.useQuery({ limit: 100 });

  const pending: PendingResultRow[] = React.useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    return data.map((r) => {
      const order = r.orderItem.order;
      const patientLabel = order.patient
        ? `${order.patient.firstName} ${order.patient.lastName}`
        : order.id.slice(0, 8);
      const valueMain =
        r.valueNumeric !== null && r.valueNumeric !== undefined
          ? String(r.valueNumeric)
          : (r.valueText ?? "—");
      const value = r.valueUnit ? `${valueMain} ${r.valueUnit}` : valueMain;
      return {
        resultId: r.id,
        orderId: order.id,
        patientLabel,
        testLabel: `${r.orderItem.test.code} — ${r.orderItem.test.name}`,
        flag: r.flag as ResultFlag,
        value,
        agedAtMs: now - new Date(r.createdAt).getTime(),
      };
    });
  }, [data]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Resultados pendientes de validación</h1>

      <Card>
        <CardHeader>
          <CardTitle>Cola ({pending.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error.message}
            </p>
          ) : null}
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}
          {data ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Test</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Flag</TableHead>
                  <TableHead>Antigüedad</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={5}
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
