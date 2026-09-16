"use client";

/**
 * /rentabilidad — CC-0036 Ola 6 (REQ-HIS-AFIL-001 S7, US.AFIL.1.8). Tabs:
 * Rentabilidad por afiliado (AC1/AC2/AC4/AC5) y Ocupación de consultorios
 * (AC3). Pantalla solo-lectura: sin mutaciones, RBAC real vía
 * `requirePermission("tablero_afiliado.leer")` en el router.
 *
 * Filtro de sede (AC2 "filtro por sede") queda TODO en esta ola: el único
 * catálogo de establecimientos (`establishment.list`) es `requireRole(["ADMIN",
 * "DIR"])`, y este tablero también lo usa GERENTE_FINANCIERO — exponer el
 * filtro necesitaría relajar ese router o duplicar el catálogo. El backend
 * (`rentabilidadRouter`) ya acepta `establishmentId` — es un follow-up de UI,
 * no de datos.
 */
import * as React from "react";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

type AfiliadoRow = {
  medicoAfiliadoId: string;
  nombreCompleto: string;
  jvpmNumero: string | null;
  rentaDevengada: number;
  rentaCobrada: number;
  produccionTotal: number;
  produccionPorLinea: Record<string, number>;
  honorariosDevengados: number;
  margenContribucion: number;
  inactivoComercialmente: boolean;
};

type DetalleRow = {
  periodMonth: string;
  establishmentId: string;
  rentaDevengada: number;
  rentaCobrada: number;
  produccionTotal: number;
  produccionPorLinea: Record<string, number>;
  honorariosDevengados: number;
  margenContribucion: number;
};

type ConsultorioRow = {
  consultorioId: string;
  codigo: string;
  nombre: string;
  horasContratadasSemana: number;
  horasDisponiblesSemana: number;
  pctHorasContratadas: number | null;
  cuposPublicados: number;
  cuposUsados: number;
  pctCuposUsados: number | null;
};

function defaultRange(): { desde: string; hasta: string } {
  const now = new Date();
  const hasta = now.toISOString().slice(0, 10);
  const desdeDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const desde = desdeDate.toISOString().slice(0, 10);
  return { desde, hasta };
}

function fmtMoney(n: number): string {
  return n.toLocaleString("es-SV", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n: number | null): string {
  return n === null ? "—" : `${(n * 100).toFixed(1)}%`;
}

/**
 * Export CSV v1 (AC5) con hoja de metodología anexada al pie — CSV no admite
 * múltiples hojas como XLSX real; TODO documentado (no hay librería xlsx en
 * el repo, ver honorario.router.ts que ya documenta el mismo TODO para
 * reporteCuentaTercero).
 */
function downloadRentabilidadCsv(rows: AfiliadoRow[], desde: string, hasta: string): void {
  const headers = [
    "Afiliado",
    "JVPM",
    "Renta devengada",
    "Renta cobrada",
    "Producción facturada",
    "Honorarios devengados",
    "Margen de contribución",
    "Inactivo comercialmente",
  ];
  const dataLines = rows.map((r) =>
    [
      r.nombreCompleto,
      r.jvpmNumero ?? "",
      r.rentaDevengada.toFixed(2),
      r.rentaCobrada.toFixed(2),
      r.produccionTotal.toFixed(2),
      r.honorariosDevengados.toFixed(2),
      r.margenContribucion.toFixed(2),
      r.inactivoComercialmente ? "SI" : "NO",
    ]
      .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
      .join(","),
  );
  const metodologia = [
    "",
    "== Metodología de cálculo (US.AFIL.1.8 AC5) ==",
    `Período: ${desde} a ${hasta}`,
    "Renta devengada: suma de ContratoCargo con concepto RENTA/SERVICIOS, estado <> ANULADO.",
    "Renta cobrada: suma de ContratoCargo con estado PAGADO (reservado sin escritor en esta fase — siempre 0).",
    "Producción facturada: suma de ProduccionMedica.montoFacturado con estado <> REVERSADO, agrupado por origen del cargo.",
    "Honorarios devengados: suma de ProduccionMedica.honorarioCalculado con estado PENDIENTE o LIQUIDADO.",
    "Margen de contribución: producción facturada - honorarios devengados (no neta la renta).",
    "Inactivo comercialmente: contrato de arrendamiento VIGENTE sin producción registrada en los últimos 90 días.",
    "Fuente: analytics.mv_rentabilidad_afiliado (matview, refresco diario 03:30 UTC).",
  ].join("\n");

  const csv = [headers.join(","), ...dataLines].join("\n") + "\n" + metodologia + "\n";
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `rentabilidad_${desde}_${hasta}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function RentabilidadShell(_props: { roleCodes: string[] }) {
  const initial = defaultRange();
  const [desde, setDesde] = React.useState(initial.desde);
  const [hasta, setHasta] = React.useState(initial.hasta);
  const [detalleId, setDetalleId] = React.useState<string | null>(null);

  const tablero = trpcAny.rentabilidad.tablero.porAfiliado.useQuery({ desde, hasta });
  const ocupacion = trpcAny.rentabilidad.ocupacion.porConsultorio.useQuery({ desde, hasta });

  const afiliadoRows = (tablero.data ?? []) as AfiliadoRow[];
  const consultorioRows = (ocupacion.data ?? []) as ConsultorioRow[];
  const detalleMedico = afiliadoRows.find((r) => r.medicoAfiliadoId === detalleId) ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <TrendingUp className="h-6 w-6" />
          Rentabilidad y ocupación
        </h1>
        <p className="text-sm text-muted-foreground">
          Renta devengada, producción facturada y honorarios por médico afiliado, y ocupación de
          consultorios (REQ-HIS-AFIL-001 S7, US.AFIL.1.8) — última ola de médicos afiliados.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="desde">Desde</Label>
          <Input id="desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="w-40" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="hasta">Hasta</Label>
          <Input id="hasta" type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="w-40" />
        </div>
        <Button
          variant="outline"
          onClick={() => {
            tablero.refetch();
            ocupacion.refetch();
          }}
        >
          Buscar
        </Button>
        <Button variant="outline" onClick={() => downloadRentabilidadCsv(afiliadoRows, desde, hasta)}>
          Excel (CSV) + metodología
        </Button>
      </div>

      <Tabs defaultValue="afiliados">
        <TabsList>
          <TabsTrigger value="afiliados">Rentabilidad por afiliado</TabsTrigger>
          <TabsTrigger value="ocupacion">Ocupación de consultorios</TabsTrigger>
        </TabsList>

        <TabsContent value="afiliados" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {tablero.isLoading ? "Cargando…" : `${afiliadoRows.length} afiliado(s)`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Médico afiliado</TableHead>
                      <TableHead className="text-right">Renta devengada</TableHead>
                      <TableHead className="text-right">Renta cobrada</TableHead>
                      <TableHead className="text-right">Producción facturada</TableHead>
                      <TableHead className="text-right">Honorarios devengados</TableHead>
                      <TableHead className="text-right">Margen contribución</TableHead>
                      <TableHead className="w-40">Estado</TableHead>
                      <TableHead className="w-28 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {afiliadoRows.length === 0 && !tablero.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                          Sin movimientos en el período seleccionado.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {afiliadoRows.map((row) => (
                      <TableRow key={row.medicoAfiliadoId}>
                        <TableCell className="font-medium">
                          {row.nombreCompleto}
                          {row.jvpmNumero ? (
                            <span className="ml-1 text-xs text-muted-foreground">JVPM {row.jvpmNumero}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">${fmtMoney(row.rentaDevengada)}</TableCell>
                        <TableCell className="text-right">${fmtMoney(row.rentaCobrada)}</TableCell>
                        <TableCell className="text-right">${fmtMoney(row.produccionTotal)}</TableCell>
                        <TableCell className="text-right">${fmtMoney(row.honorariosDevengados)}</TableCell>
                        <TableCell className="text-right font-medium">${fmtMoney(row.margenContribucion)}</TableCell>
                        <TableCell>
                          {row.inactivoComercialmente ? (
                            <Badge variant="warning">Inactivo comercialmente</Badge>
                          ) : (
                            <Badge variant="outline">Activo</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setDetalleId(row.medicoAfiliadoId)}>
                            Ver detalle
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ocupacion" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {ocupacion.isLoading ? "Cargando…" : `${consultorioRows.length} consultorio(s)`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Consultorio</TableHead>
                      <TableHead className="text-right">Horas contratadas/sem.</TableHead>
                      <TableHead className="text-right">Horas disponibles/sem.</TableHead>
                      <TableHead className="text-right">% horas contratadas</TableHead>
                      <TableHead className="text-right">Cupos publicados</TableHead>
                      <TableHead className="text-right">Cupos usados</TableHead>
                      <TableHead className="text-right">% cupos usados</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {consultorioRows.length === 0 && !ocupacion.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                          Sin consultorios activos en el período seleccionado.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {consultorioRows.map((row) => (
                      <TableRow key={row.consultorioId}>
                        <TableCell className="font-medium">
                          {row.codigo} — {row.nombre}
                        </TableCell>
                        <TableCell className="text-right">{row.horasContratadasSemana.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{row.horasDisponiblesSemana.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{fmtPct(row.pctHorasContratadas)}</TableCell>
                        <TableCell className="text-right">{row.cuposPublicados}</TableCell>
                        <TableCell className="text-right">{row.cuposUsados}</TableCell>
                        <TableCell className="text-right">{fmtPct(row.pctCuposUsados)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <DetalleAfiliadoDialog
        medicoAfiliadoId={detalleId}
        medicoNombre={detalleMedico?.nombreCompleto ?? ""}
        produccionPorLinea={detalleMedico?.produccionPorLinea ?? {}}
        desde={desde}
        hasta={hasta}
        onOpenChange={(open) => !open && setDetalleId(null)}
      />
    </div>
  );
}

function DetalleAfiliadoDialog({
  medicoAfiliadoId,
  medicoNombre,
  produccionPorLinea,
  desde,
  hasta,
  onOpenChange,
}: {
  medicoAfiliadoId: string | null;
  medicoNombre: string;
  produccionPorLinea: Record<string, number>;
  desde: string;
  hasta: string;
  onOpenChange: (open: boolean) => void;
}) {
  const detalle = trpcAny.rentabilidad.tablero.detalleAfiliado.useQuery(
    { medicoAfiliadoId: medicoAfiliadoId ?? "", desde, hasta },
    { enabled: !!medicoAfiliadoId },
  );
  const rows = (detalle.data ?? []) as DetalleRow[];

  return (
    <Dialog open={!!medicoAfiliadoId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{medicoNombre}</DialogTitle>
          <DialogDescription>Desglose mensual — renta, producción, honorarios y margen.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium">Producción por línea de negocio</p>
            <div className="flex flex-wrap gap-2">
              {Object.entries(produccionPorLinea).length === 0 ? (
                <span className="text-sm text-muted-foreground">Sin producción en el período.</span>
              ) : (
                Object.entries(produccionPorLinea).map(([linea, monto]) => (
                  <Badge key={linea} variant="outline">
                    {linea}: ${fmtMoney(monto)}
                  </Badge>
                ))
              )}
            </div>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead className="text-right">Renta devengada</TableHead>
                  <TableHead className="text-right">Producción</TableHead>
                  <TableHead className="text-right">Honorarios</TableHead>
                  <TableHead className="text-right">Margen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !detalle.isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-sm text-muted-foreground">
                      Sin movimientos en el período.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((r, i) => (
                  <TableRow key={`${r.periodMonth}-${r.establishmentId}-${i}`}>
                    <TableCell>{r.periodMonth.slice(0, 7)}</TableCell>
                    <TableCell className="text-right">${fmtMoney(r.rentaDevengada)}</TableCell>
                    <TableCell className="text-right">${fmtMoney(r.produccionTotal)}</TableCell>
                    <TableCell className="text-right">${fmtMoney(r.honorariosDevengados)}</TableCell>
                    <TableCell className="text-right">${fmtMoney(r.margenContribucion)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
