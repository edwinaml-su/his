"use client";

/**
 * /honorarios — CC-0036 Ola 5 (REQ-HIS-AFIL-001 S6, US.AFIL.1.5/1.6/1.7).
 * Tabs: Convenios (+ reglas), Producción (excepciones SIN_REGLA/
 * PERSONAL_DE_PLANTA), Liquidaciones (generar/aprobar/anular/detalle).
 * Mismo patrón que `/contratos`: Server Component resuelve `roleCodes`, este
 * shell decide la UX de botones — RBAC real vía `convenio_honorario.*`/
 * `produccion_medica.*`/`liquidacion.*` en el router.
 */
import * as React from "react";
import { Coins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { ConvenioDialog } from "./convenio-dialog";
import { ConvenioDetailDialog } from "./convenio-detail-dialog";
import { LiquidacionDialog } from "./liquidacion-dialog";
import { LiquidacionDetailDialog } from "./liquidacion-detail-dialog";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const ROLES_ANALISTA = ["ADMIN", "DIR", "ANALISTA_HONORARIOS"];
const ROLES_GERENTE = ["ADMIN", "DIR", "GERENTE_FINANCIERO"];

const CONVENIO_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  VIGENTE: "success",
  TERMINADO: "destructive",
};

const LIQUIDACION_BADGE: Record<string, "outline" | "success" | "warning" | "destructive"> = {
  BORRADOR: "outline",
  APROBADA: "success",
  ENVIADA_ODOO: "success",
  PAGADA: "success",
  ANULADA: "destructive",
};

type ConvenioRow = {
  id: string;
  estado: string;
  retencionRentaPct: string | number;
  medicoAfiliado: { nombreCompleto: string };
};

type ProduccionRow = {
  id: string;
  fecha: string;
  rolMedico: string;
  estado: string;
  motivoExclusion: string | null;
  medicoAfiliado: { nombreCompleto: string };
};

type LiquidacionRow = {
  id: string;
  folio: string;
  estado: string;
  periodoDesde: string;
  periodoHasta: string;
  totalNeto: string | number;
  medicoAfiliado: { nombreCompleto: string };
};

export function HonorariosShell({ roleCodes }: { roleCodes: string[] }) {
  const canAnalista = roleCodes.some((r) => ROLES_ANALISTA.includes(r));
  const canGerente = roleCodes.some((r) => ROLES_GERENTE.includes(r));

  const convenios = trpcAny.honorario.convenio.list.useQuery();
  const excepciones = trpcAny.honorario.produccion.excepciones.useQuery({});
  const liquidaciones = trpcAny.honorario.liquidacion.list.useQuery({});

  const [convenioCreateOpen, setConvenioCreateOpen] = React.useState(false);
  const [convenioDetailId, setConvenioDetailId] = React.useState<string | null>(null);
  const [liquidacionCreateOpen, setLiquidacionCreateOpen] = React.useState(false);
  const [liquidacionDetailId, setLiquidacionDetailId] = React.useState<string | null>(null);

  const convenioRows = (convenios.data ?? []) as ConvenioRow[];
  const excepcionRows = (excepciones.data ?? []) as ProduccionRow[];
  const liquidacionRows = (liquidaciones.data ?? []) as LiquidacionRow[];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Coins className="h-6 w-6" />
          Honorarios médicos
        </h1>
        <p className="text-sm text-muted-foreground">
          Convenios y reglas de honorario, atribución de producción y liquidación por médico
          afiliado (REQ-HIS-AFIL-001 S6). Llega hasta APROBADA — el pago lo ejecuta Odoo en una fase
          de integración posterior.
        </p>
      </div>

      <Tabs defaultValue="convenios">
        <TabsList>
          <TabsTrigger value="convenios">Convenios</TabsTrigger>
          <TabsTrigger value="produccion">Producción — excepciones</TabsTrigger>
          <TabsTrigger value="liquidaciones">Liquidaciones</TabsTrigger>
        </TabsList>

        <TabsContent value="convenios" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">
                {convenios.isLoading ? "Cargando…" : `${convenioRows.length} convenio(s)`}
              </CardTitle>
              {canAnalista ? <Button onClick={() => setConvenioCreateOpen(true)}>+ Nuevo convenio</Button> : null}
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Médico afiliado</TableHead>
                      <TableHead className="w-32">Retención renta</TableHead>
                      <TableHead className="w-24">Estado</TableHead>
                      <TableHead className="w-32 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {convenioRows.length === 0 && !convenios.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          Sin convenios registrados.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {convenioRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium">{row.medicoAfiliado.nombreCompleto}</TableCell>
                        <TableCell>{(Number(row.retencionRentaPct) * 100).toFixed(2)}%</TableCell>
                        <TableCell>
                          <Badge variant={CONVENIO_BADGE[row.estado] ?? "outline"}>{row.estado}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setConvenioDetailId(row.id)}>
                            Ver / Gestionar
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

        <TabsContent value="produccion" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {excepciones.isLoading ? "Cargando…" : `${excepcionRows.length} excepción(es)`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-sm text-muted-foreground">
                Producción EXCLUIDA (SIN_REGLA o PERSONAL_DE_PLANTA) — US.AFIL.1.5 AC5: revisar antes
                de la primera liquidación real de cada afiliado.
              </p>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Médico afiliado</TableHead>
                      <TableHead>Rol</TableHead>
                      <TableHead>Motivo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {excepcionRows.length === 0 && !excepciones.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                          Sin excepciones pendientes de revisión.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {excepcionRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{String(row.fecha).slice(0, 10)}</TableCell>
                        <TableCell>{row.medicoAfiliado.nombreCompleto}</TableCell>
                        <TableCell>{row.rolMedico}</TableCell>
                        <TableCell>
                          <Badge variant="warning">{row.motivoExclusion}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="liquidaciones" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="text-base">
                {liquidaciones.isLoading ? "Cargando…" : `${liquidacionRows.length} liquidación(es)`}
              </CardTitle>
              {canAnalista ? <Button onClick={() => setLiquidacionCreateOpen(true)}>+ Generar liquidación</Button> : null}
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">Folio</TableHead>
                      <TableHead>Médico afiliado</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="w-24 text-right">Neto</TableHead>
                      <TableHead className="w-28">Estado</TableHead>
                      <TableHead className="w-32 text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {liquidacionRows.length === 0 && !liquidaciones.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                          Sin liquidaciones generadas.
                        </TableCell>
                      </TableRow>
                    ) : null}
                    {liquidacionRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm">{row.folio}</TableCell>
                        <TableCell className="font-medium">{row.medicoAfiliado.nombreCompleto}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {String(row.periodoDesde).slice(0, 10)} a {String(row.periodoHasta).slice(0, 10)}
                        </TableCell>
                        <TableCell className="text-right">${Number(row.totalNeto).toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={LIQUIDACION_BADGE[row.estado] ?? "outline"}>{row.estado}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setLiquidacionDetailId(row.id)}>
                            Ver / Gestionar
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
      </Tabs>

      <ConvenioDialog open={convenioCreateOpen} onOpenChange={setConvenioCreateOpen} onSaved={() => convenios.refetch()} />
      <ConvenioDetailDialog
        convenioId={convenioDetailId}
        onOpenChange={(open) => !open && setConvenioDetailId(null)}
        canManage={canAnalista}
        onChanged={() => convenios.refetch()}
      />
      <LiquidacionDialog
        open={liquidacionCreateOpen}
        onOpenChange={setLiquidacionCreateOpen}
        onSaved={() => liquidaciones.refetch()}
      />
      <LiquidacionDetailDialog
        liquidacionId={liquidacionDetailId}
        onOpenChange={(open) => !open && setLiquidacionDetailId(null)}
        canAprobar={canGerente}
        canAnular={canGerente}
        onChanged={() => {
          liquidaciones.refetch();
          excepciones.refetch();
        }}
      />
    </div>
  );
}
