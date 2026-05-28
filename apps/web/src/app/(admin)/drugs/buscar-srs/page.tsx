"use client";

/**
 * /admin/drugs/buscar-srs — Buscador del padrón SRS El Salvador.
 *
 * Permite buscar registros sanitarios vigentes, ver detalle (con cache local)
 * e importarlos al catálogo Drug del tenant.
 *
 * Spec: docs/35_integracion_srs_registro_sanitario.md
 */
import * as React from "react";
import { Search, FileText, FlaskConical, Download, ExternalLink, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
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

type Filtro = "nombre_comercial" | "id_producto" | "principio_activo";
type Estado = "ACTIVO" | "CANCELADO" | "SUSPENDIDO" | "ELIMINADO" | "";

interface ListadoItem {
  idProducto: string;
  registroSanitario: string;
  nombreRegistro: string;
  estado: string;
  titular: string | null;
  modalidadVenta: string | null;
  anualidad: string | null;
  fichaTecnicaUrl: string | null;
  expedienteUrl: string | null;
  informeEvaluacionUrl: string | null;
}

interface BuscarOutput {
  recordsTotal: number;
  recordsFiltered: number;
  data: ListadoItem[];
  cached: string[];
  imported: string[];
}

function fmtDate(s: string | Date | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("es-SV");
}

function estadoBadge(estado: string) {
  const variant =
    estado === "ACTIVO"
      ? "success"
      : estado === "SUSPENDIDO"
        ? "secondary"
        : "destructive";
  return <Badge variant={variant as "success" | "secondary" | "destructive"}>{estado}</Badge>;
}

export default function BuscarSrsPage() {
  const [filtro, setFiltro] = React.useState<Filtro>("nombre_comercial");
  const [busqueda, setBusqueda] = React.useState("");
  const [estado, setEstado] = React.useState<Estado>("ACTIVO");
  const [submitted, setSubmitted] = React.useState<{
    filtro: Filtro;
    busqueda: string;
    estado: Estado;
  } | null>(null);
  const [detalleAbierto, setDetalleAbierto] = React.useState<string | null>(null);

  const buscarQuery = trpcAny.srsRegistro.buscar.useQuery(
    submitted ? { ...submitted, start: 0, length: 50 } : undefined,
    { enabled: !!submitted },
  );

  const detalleQuery = trpcAny.srsRegistro.detalle.useQuery(
    detalleAbierto ? { registroSanitario: detalleAbierto, forceRefresh: false } : undefined,
    { enabled: !!detalleAbierto },
  );

  const importarMut = trpcAny.srsRegistro.importarADrug.useMutation({
    onSuccess: () => {
      buscarQuery.refetch();
      setDetalleAbierto(null);
    },
  });

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busqueda.trim().length < 2) return;
    setSubmitted({ filtro, busqueda: busqueda.trim(), estado });
  }

  const out = (buscarQuery.data ?? null) as BuscarOutput | null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <FlaskConical className="h-6 w-6" />
          Padrón SRS El Salvador
        </h1>
        <p className="text-sm text-muted-foreground">
          Consulta del registro sanitario de medicamentos publicado en{" "}
          <a
            href="https://expedientes.srs.gob.sv/productos/buscarProducto"
            target="_blank"
            rel="noopener noreferrer"
            className="underline-offset-4 hover:underline"
          >
            expedientes.srs.gob.sv
          </a>
          . Importa al catálogo Drug del hospital los registros que se vayan a usar.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Buscar</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="md:col-span-1">
              <Label htmlFor="filtro">Tipo de búsqueda</Label>
              <Select value={filtro} onValueChange={(v) => setFiltro(v as Filtro)}>
                <SelectTrigger id="filtro">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nombre_comercial">Nombre comercial</SelectItem>
                  <SelectItem value="principio_activo">Principio activo</SelectItem>
                  <SelectItem value="id_producto">N° de registro sanitario</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="busqueda">Búsqueda</Label>
              <Input
                id="busqueda"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="paracetamol, F050010092003, ibuprofeno…"
                autoComplete="off"
              />
            </div>
            <div>
              <Label htmlFor="estado">Estado</Label>
              <Select
                value={estado || "all"}
                onValueChange={(v) =>
                  setEstado((v === "all" ? "" : v) as Estado)
                }
              >
                <SelectTrigger id="estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVO">Activos</SelectItem>
                  <SelectItem value="SUSPENDIDO">Suspendidos</SelectItem>
                  <SelectItem value="CANCELADO">Cancelados</SelectItem>
                  <SelectItem value="ELIMINADO">Eliminados</SelectItem>
                  {/* Radix Select prohíbe value="" — centinela "all". */}
                  <SelectItem value="all">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-4">
              <Button type="submit" disabled={busqueda.trim().length < 2 || buscarQuery.isFetching}>
                {buscarQuery.isFetching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Buscando…
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Buscar en SRS
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {buscarQuery.error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(buscarQuery.error as { message?: string })?.message ?? "Error al consultar SRS."}
        </div>
      ) : null}

      {out ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Resultados ({out.recordsTotal})
              {out.recordsTotal > out.data.length ? (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  mostrando primeros {out.data.length}
                </span>
              ) : null}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-36">N° Registro</TableHead>
                    <TableHead>Nombre / Titular</TableHead>
                    <TableHead className="w-32">Modalidad</TableHead>
                    <TableHead className="w-28">Vigencia</TableHead>
                    <TableHead className="w-28">Estado</TableHead>
                    <TableHead className="w-48 text-right">Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {out.data.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                        Sin resultados para los filtros aplicados.
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {out.data.map((r) => {
                    const yaImportado = out.imported.includes(r.registroSanitario);
                    const enCache = out.cached.includes(r.registroSanitario);
                    return (
                      <TableRow key={r.registroSanitario}>
                        <TableCell className="font-mono text-xs">
                          {r.registroSanitario}
                          <div className="mt-1 flex gap-1">
                            {yaImportado ? (
                              <Badge variant="success" className="text-[10px]">Importado</Badge>
                            ) : null}
                            {enCache && !yaImportado ? (
                              <Badge variant="outline" className="text-[10px]">Cache</Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.nombreRegistro}</div>
                          {r.titular ? (
                            <div className="text-xs text-muted-foreground">{r.titular}</div>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{r.modalidadVenta ?? "—"}</TableCell>
                        <TableCell className="text-xs">{fmtDate(r.anualidad)}</TableCell>
                        <TableCell>{estadoBadge(r.estado)}</TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex gap-1">
                            {r.fichaTecnicaUrl ? (
                              <Button asChild size="sm" variant="ghost" title="Ficha técnica">
                                <a
                                  href={r.fichaTecnicaUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <FileText className="h-4 w-4" />
                                </a>
                              </Button>
                            ) : null}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setDetalleAbierto(r.registroSanitario)}
                            >
                              Detalle
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={!!detalleAbierto} onOpenChange={(open) => !open && setDetalleAbierto(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Registro {detalleAbierto}
              {detalleQuery.data?.source === "cache" ? (
                <Badge variant="outline" className="ml-2 text-xs">cache local</Badge>
              ) : detalleQuery.data?.source === "live" ? (
                <Badge variant="success" className="ml-2 text-xs">live SRS</Badge>
              ) : null}
            </DialogTitle>
            <DialogDescription>
              {detalleQuery.data?.cabecera?.nombreRegistro ?? ""}
            </DialogDescription>
          </DialogHeader>

          {detalleQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detalleQuery.error ? (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(detalleQuery.error as { message?: string })?.message ?? "Error al cargar detalle."}
            </div>
          ) : detalleQuery.data ? (
            <DetalleContenido data={detalleQuery.data} />
          ) : null}

          {detalleQuery.data ? (
            <div className="flex items-center justify-between gap-2 border-t pt-3">
              <div className="text-xs text-muted-foreground">
                {detalleQuery.data.cabecera?.fetchedAt
                  ? `Última sincronización: ${new Date(detalleQuery.data.cabecera.fetchedAt).toLocaleString("es-SV")}`
                  : null}
              </div>
              <div className="flex gap-2">
                {importarMut.error ? (
                  <span className="text-xs text-destructive">
                    {(importarMut.error as { message?: string }).message}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  disabled={importarMut.isPending}
                  onClick={() =>
                    importarMut.mutate({ registroSanitario: detalleAbierto!, alertLevel: "standard" })
                  }
                >
                  {importarMut.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Importando…
                    </>
                  ) : (
                    <>
                      <Download className="mr-2 h-4 w-4" />
                      Importar a Drug
                    </>
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface DetalleData {
  cabecera: {
    nombreRegistro: string;
    titular: string | null;
    estado: string;
    categoria: string | null;
    clasificacion: string | null;
    modalidadVenta: string | null;
    vidaUtilTexto: string | null;
    viaAdministracion: string | null;
    primeraAutorizacion: string | Date | null;
    anualidad: string | Date | null;
    condicionesAlmacenamiento: string | null;
    indicacionesTerapeuticas: string | null;
    mecanismoAccion: string | null;
    regimenDosificacion: string | null;
    contraindicaciones: string | null;
    precauciones: string | null;
    efectosAdversos: string | null;
    principalesInteracciones: string | null;
    fichaTecnicaUrl: string | null;
    expedienteUrl: string | null;
    informeEvaluacionUrl: string | null;
    fetchedAt: string | Date;
  };
  principiosActivos: Array<{
    nombrePrincipioActivo: string;
    concentracion: string | null;
    unidadMedida: string | null;
  }>;
  fabricantes: Array<{
    nombreFabricante: string;
    paisFabricante: string | null;
    tipo: string;
  }>;
  formasFarmaceuticas: string[];
  presentaciones: Array<{ codigoPresentacion: string | null; nombrePresentacion: string }>;
}

function DetalleContenido({ data }: { data: DetalleData }) {
  const c = data.cabecera;
  return (
    <div className="space-y-4 text-sm">
      <section className="grid grid-cols-2 gap-3">
        <Field label="Titular" value={c.titular} />
        <Field label="Estado" value={c.estado} />
        <Field label="Categoría" value={c.categoria} />
        <Field label="Clasificación" value={c.clasificacion} />
        <Field label="Modalidad de venta" value={c.modalidadVenta} />
        <Field label="Vida útil" value={c.vidaUtilTexto} />
        <Field label="Vía de administración" value={c.viaAdministracion} />
        <Field label="Primera autorización" value={fmtDate(c.primeraAutorizacion)} />
        <Field label="Anualidad (vigencia)" value={fmtDate(c.anualidad)} />
      </section>

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
          Principios activos
        </h3>
        <ul className="space-y-1">
          {data.principiosActivos.map((p, i) => (
            <li key={i} className="font-mono text-xs">
              {p.nombrePrincipioActivo} — {p.concentracion ?? "?"} {p.unidadMedida ?? ""}
            </li>
          ))}
        </ul>
      </section>

      {data.formasFarmaceuticas.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Formas farmacéuticas
          </h3>
          <div className="flex flex-wrap gap-1">
            {data.formasFarmaceuticas.map((f) => (
              <Badge key={f} variant="outline" className="text-xs">{f}</Badge>
            ))}
          </div>
        </section>
      ) : null}

      {data.fabricantes.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Fabricantes / acondicionadores
          </h3>
          <ul className="space-y-0.5 text-xs">
            {data.fabricantes.map((f, i) => (
              <li key={i}>
                <span className="font-medium">{f.nombreFabricante}</span>
                {f.paisFabricante ? <span className="text-muted-foreground"> — {f.paisFabricante}</span> : null}
                <Badge variant="outline" className="ml-2 text-[10px]">{f.tipo}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.presentaciones.length > 0 ? (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            Presentaciones
          </h3>
          <ul className="space-y-0.5 text-xs">
            {data.presentaciones.map((p, i) => (
              <li key={i}>
                {p.codigoPresentacion ? <span className="font-mono">{p.codigoPresentacion} — </span> : null}
                {p.nombrePresentacion}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <LongText label="Indicaciones terapéuticas" value={c.indicacionesTerapeuticas} />
      <LongText label="Mecanismo de acción" value={c.mecanismoAccion} />
      <LongText label="Régimen de dosificación" value={c.regimenDosificacion} />
      <LongText label="Contraindicaciones" value={c.contraindicaciones} />
      <LongText label="Precauciones" value={c.precauciones} />
      <LongText label="Efectos adversos" value={c.efectosAdversos} />
      <LongText label="Principales interacciones" value={c.principalesInteracciones} />
      <LongText label="Condiciones de almacenamiento" value={c.condicionesAlmacenamiento} />

      {(c.fichaTecnicaUrl || c.expedienteUrl || c.informeEvaluacionUrl) ? (
        <section className="flex flex-wrap gap-2 border-t pt-3">
          {c.fichaTecnicaUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={c.fichaTecnicaUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1 h-3 w-3" />
                Ficha técnica
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          ) : null}
          {c.expedienteUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={c.expedienteUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1 h-3 w-3" />
                Expediente
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          ) : null}
          {c.informeEvaluacionUrl ? (
            <Button asChild size="sm" variant="outline">
              <a href={c.informeEvaluacionUrl} target="_blank" rel="noopener noreferrer">
                <FileText className="mr-1 h-3 w-3" />
                Informe evaluación
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </Button>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value ?? <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

function LongText({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">{label}</h3>
      <p className="whitespace-pre-wrap text-xs">{value}</p>
    </section>
  );
}
