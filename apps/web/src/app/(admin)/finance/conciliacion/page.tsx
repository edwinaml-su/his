"use client";

/**
 * docs/48 Ola 4 (C4-2) — Conciliación clínico-financiera (RN-HIS-BOT-001 R11).
 *
 * Resumen (6 conteos) + los 6 bloques de detalle, cada uno con su propia
 * tabla. UI mínima — patrón de `finance/reportes` (DateRangePicker + tablas
 * Shadcn), sin export (no pedido para esta pantalla).
 *
 * Bloque 6 (SQL 232) — despachadoSinCierre: devolución post-despacho
 * (RN-HIS-BOT-001) que cierra el ciclo de la requisición.
 */
import * as React from "react";
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
import { DateRangePicker, useDateRange, fmtCurrency, SkeletonRows, EmptyState } from "../reportes/_shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

function fmtFecha(v: string | Date | null): string {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("es-SV");
}

interface Bloque {
  key: string;
  count: number | undefined;
  label: string;
}

export default function ConciliacionPage() {
  const { desde, hasta, setDesde, setHasta } = useDateRange();
  const [search, setSearch] = React.useState({ fechaDesde: desde, fechaHasta: hasta });

  const resumenQ = trpcAny.conciliacionCargos.resumen.useQuery(search);
  const indicacionesQ = trpcAny.conciliacionCargos.indicacionesSinDispensa.useQuery(search);
  const dispensadoQ = trpcAny.conciliacionCargos.dispensadoSinCargo.useQuery(search);
  const cargosSinMovQ = trpcAny.conciliacionCargos.cargosSinMovimiento.useQuery(search);
  const sinTarifaQ = trpcAny.conciliacionCargos.cargosSinTarifa.useQuery(search);
  const devolucionesQ = trpcAny.conciliacionCargos.devolucionesSinReversion.useQuery(search);
  const despachadoSinCierreQ = trpcAny.conciliacionCargos.despachadoSinCierre.useQuery(search);

  const loading = resumenQ.isLoading;

  const bloques: Bloque[] = [
    { key: "indicacionesSinDispensa", count: resumenQ.data?.indicacionesSinDispensa, label: "Indicaciones sin dispensa" },
    { key: "dispensadoSinCargo", count: resumenQ.data?.dispensadoSinCargo, label: "Dispensado sin cargo" },
    { key: "cargosSinMovimiento", count: resumenQ.data?.cargosSinMovimiento, label: "Cargos sin movimiento" },
    { key: "cargosSinTarifa", count: resumenQ.data?.cargosSinTarifa, label: "Cargos sin tarifa" },
    { key: "devolucionesSinReversion", count: resumenQ.data?.devolucionesSinReversion, label: "Devoluciones sin reversión" },
    { key: "despachadoSinCierre", count: resumenQ.data?.despachadoSinCierre, label: "Despachado sin cierre" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Conciliación Clínico-Financiera</h1>
        <p className="text-sm text-muted-foreground">
          Brechas entre el acto clínico y su reflejo financiero (RN-HIS-BOT-001 R11). Una excepción aquí bloquea el cierre de la cuenta asociada.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle>Periodo</CardTitle></CardHeader>
        <CardContent>
          <DateRangePicker
            desde={desde}
            hasta={hasta}
            onDesdeChange={setDesde}
            onHastaChange={setHasta}
            onSearch={() => setSearch({ fechaDesde: desde, fechaHasta: hasta })}
            loading={loading}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {bloques.map((b) => (
          <Card key={b.key} className={b.count ? "border-warning" : undefined}>
            <CardContent className="pt-4 text-center">
              <p className="text-xs text-muted-foreground">{b.label}</p>
              <p className="font-mono text-2xl font-bold">{loading ? "…" : (b.count ?? 0)}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader><CardTitle>1. Indicaciones sin dispensa</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Medicamento</TableHead>
                <TableHead>Prescrito</TableHead>
                <TableHead>Prescription ID</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {indicacionesQ.isLoading ? (
                <SkeletonRows cols={3} />
              ) : (indicacionesQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (indicacionesQ.data ?? []).map((r: { prescriptionId: string; prescriptionItemId: string; genericName: string; prescribedAt: string }) => (
                  <TableRow key={r.prescriptionItemId}>
                    <TableCell>{r.genericName}</TableCell>
                    <TableCell>{fmtFecha(r.prescribedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.prescriptionId}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>2. Dispensado sin cargo</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>SKU</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Referencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {dispensadoQ.isLoading ? (
                <SkeletonRows cols={3} />
              ) : (dispensadoQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (dispensadoQ.data ?? []).map((r: { stockMovementId: string; sku: string; performedAt: string; referenceCode: string | null }) => (
                  <TableRow key={r.stockMovementId}>
                    <TableCell>{r.sku}</TableCell>
                    <TableCell>{fmtFecha(r.performedAt)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.referenceCode ?? "—"}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>3. Cargos sin movimiento</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cargosSinMovQ.isLoading ? (
                <SkeletonRows cols={3} />
              ) : (cargosSinMovQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (cargosSinMovQ.data ?? []).map((r: { cargoId: string; code: string | null; totalPrice: string | null; createdAt: string }) => (
                  <TableRow key={r.cargoId}>
                    <TableCell>{r.code ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">${fmtCurrency(Number(r.totalPrice ?? 0))}</TableCell>
                    <TableCell>{fmtFecha(r.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>4. Cargos sin tarifa</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descripción</TableHead>
                <TableHead className="text-right">Antigüedad (días)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sinTarifaQ.isLoading ? (
                <SkeletonRows cols={3} />
              ) : (sinTarifaQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (sinTarifaQ.data ?? []).map((r: { cargoId: string; code: string | null; descripcion: string | null; antiguedadDias: number }) => (
                  <TableRow key={r.cargoId}>
                    <TableCell>{r.code ?? "—"}</TableCell>
                    <TableCell>{r.descripcion ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">{r.antiguedadDias}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>5. Devoluciones sin reversión</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reserva</TableHead>
                <TableHead>Motivo cancelación</TableHead>
                <TableHead className="text-right">Total cargo</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devolucionesQ.isLoading ? (
                <SkeletonRows cols={4} />
              ) : (devolucionesQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (devolucionesQ.data ?? []).map((r: { cargoId: string; reservationId: string; cancelMotivo: string | null; totalPrice: string | null; createdAt: string }) => (
                  <TableRow key={r.cargoId}>
                    <TableCell className="font-mono text-xs">{r.reservationId}</TableCell>
                    <TableCell>{r.cancelMotivo ?? "—"}</TableCell>
                    <TableCell className="text-right font-mono">${fmtCurrency(Number(r.totalPrice ?? 0))}</TableCell>
                    <TableCell>{fmtFecha(r.createdAt)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>6. Despachado sin cierre</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reserva</TableHead>
                <TableHead>GTIN / Lote</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Horas transcurridas</TableHead>
                <TableHead>Fecha</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {despachadoSinCierreQ.isLoading ? (
                <SkeletonRows cols={5} />
              ) : (despachadoSinCierreQ.data ?? []).length === 0 ? (
                <EmptyState />
              ) : (
                (despachadoSinCierreQ.data ?? []).map(
                  (r: {
                    reservationId: string;
                    status: string;
                    gtin: string;
                    lote: string;
                    horasTranscurridas: number;
                    createdAt: string;
                  }) => (
                    <TableRow key={r.reservationId}>
                      <TableCell className="font-mono text-xs">{r.reservationId}</TableCell>
                      <TableCell className="font-mono text-xs">{r.gtin} / {r.lote}</TableCell>
                      <TableCell>{r.status}</TableCell>
                      <TableCell className="text-right font-mono">{Math.round(r.horasTranscurridas)}</TableCell>
                      <TableCell>{fmtFecha(r.createdAt)}</TableCell>
                    </TableRow>
                  ),
                )
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
