"use client";

/**
 * Detalle de un profesional de salud — usado por:
 *   - /admin/medicos/[id]
 *   - /admin/profesionales-salud/[id]
 *
 * 4 tabs:
 *   1. Datos básicos       — datos demográficos + roles + estado firma.
 *   2. Pacientes referidos — vista B2B2C con filtros de fecha y export PDF/CSV/XLSX.
 *   3. Reportes            — productividad mensual + total facturado.
 *   4. Cuenta de acceso    — vincula/crea/desvincula User HIS.
 */
import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft, ShieldCheck, ShieldAlert, Link2, Unlink, Search,
  Download, FileText, FileSpreadsheet, FileDown, Calendar as CalendarIcon,
  TrendingUp, DollarSign, UserPlus2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@his/ui/components/dropdown-menu";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";
import {
  exportToCsv,
  exportToXlsx,
  exportToPdf,
  timestampedFilename,
  type ExportColumn,
} from "@/lib/export";

type ReferidoRow =
  inferRouterOutputs<AppRouter>["personalSalud"]["getPacientesReferidos"]["pacientes"][number];

interface PersonalSaludDetailProps {
  personalId: string;
  /** Para el breadcrumb y URL de "volver". */
  backHref: string;
  backLabel: string;
}

export function PersonalSaludDetail({ personalId, backHref, backLabel }: PersonalSaludDetailProps) {
  const utils = trpc.useUtils();
  const [linkOpen, setLinkOpen] = React.useState(false);
  const [linkSearch, setLinkSearch] = React.useState("");
  const [linkTab, setLinkTab] = React.useState<"existente" | "nueva">("existente");
  const [newUserForm, setNewUserForm] = React.useState({ email: "", fullName: "", roleCode: "" });
  const [fechaDesde, setFechaDesde] = React.useState("");
  const [fechaHasta, setFechaHasta] = React.useState("");
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const personalQuery = trpc.personalSalud.get.useQuery({ id: personalId });
  const referidosQuery = trpc.personalSalud.getPacientesReferidos.useQuery({
    personalId,
    ...(fechaDesde && { fechaDesde }),
    ...(fechaHasta && { fechaHasta }),
  });
  const reporteQuery = trpc.personalSalud.getReporteMedico.useQuery({
    personalId,
    ...(fechaDesde && { fechaDesde }),
    ...(fechaHasta && { fechaHasta }),
  });

  const userSearchQuery = trpc.personalSalud.searchAvailableUsers.useQuery(
    { search: linkSearch.trim(), limit: 10 },
    { enabled: linkSearch.trim().length >= 2 },
  );

  const linkMut = trpc.personalSalud.linkAuthUser.useMutation({
    onSuccess: (data) => {
      utils.personalSalud.get.invalidate();
      utils.personalSalud.getPacientesReferidos.invalidate();
      setLinkOpen(false);
      setLinkSearch("");
      setToast({ title: "Cuenta vinculada", description: data.userEmail, variant: "success" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const unlinkMut = trpc.personalSalud.unlinkAuthUser.useMutation({
    onSuccess: () => {
      utils.personalSalud.get.invalidate();
      utils.personalSalud.getPacientesReferidos.invalidate();
      setToast({ title: "Cuenta desvinculada", variant: "default" });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createAndLinkMut = trpc.personalSalud.createAndLinkUser.useMutation({
    onSuccess: (data) => {
      utils.personalSalud.get.invalidate();
      utils.personalSalud.getPacientesReferidos.invalidate();
      setLinkOpen(false);
      setNewUserForm({ email: "", fullName: "", roleCode: "" });
      setToast({
        title: "Cuenta creada y vinculada",
        description: `${data.fullName} (${data.email})`,
        variant: "success",
      });
    },
    onError: (err) => setToast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Columnas de export para pacientes referidos (declarado antes de early
  // returns para cumplir la regla de hooks de React).
  const exportColumns: ExportColumn<ReferidoRow>[] = React.useMemo(
    () => [
      { header: "MRN", accessor: (r) => r.mrn },
      { header: "Nombre", accessor: (r) => `${r.firstName} ${r.lastName}` },
      { header: "Sexo", accessor: (r) => r.biologicalSexCode ?? "" },
      { header: "Cirugía", accessor: (r) => r.conteos.cirugia },
      { header: "Hospitalización", accessor: (r) => r.conteos.hospitalizacion },
      { header: "Ambulatorio", accessor: (r) => r.conteos.ambulatorio },
      { header: "Emergencia", accessor: (r) => r.conteos.emergencia },
      { header: "Total", accessor: (r) => r.conteos.total },
      {
        header: "Última atención",
        accessor: (r) => (r.ultimaAtencion
          ? new Date(r.ultimaAtencion).toLocaleDateString("es-SV")
          : ""),
      },
    ],
    [],
  );

  // Early returns — solo después de TODOS los hooks (regla de hooks de React).
  if (personalQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (personalQuery.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        {personalQuery.error.message}
      </p>
    );
  }
  const personal = personalQuery.data;
  if (!personal) return null;

  const referidos = referidosQuery.data;
  const reporte = reporteQuery.data;

  const exportBase = `pacientes-referidos-${personal.documentoIdentidad}`;
  const exportSubtitle = `${personal.nombreCompleto} (${personal.documentoIdentidad})${fechaDesde || fechaHasta ? ` — ${fechaDesde || "inicio"} a ${fechaHasta || "hoy"}` : ""}`;

  const handleExportCsv = () => {
    if (!referidos || referidos.pacientes.length === 0) return;
    exportToCsv(referidos.pacientes, exportColumns, timestampedFilename(exportBase, "csv"));
    setToast({ title: "CSV descargado", variant: "success" });
  };

  const handleExportXlsx = async () => {
    if (!referidos || referidos.pacientes.length === 0) return;
    try {
      await exportToXlsx(referidos.pacientes, exportColumns, timestampedFilename(exportBase, "xlsx"), "Pacientes referidos");
      setToast({ title: "Excel descargado", variant: "success" });
    } catch (err) {
      setToast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleExportPdf = async () => {
    if (!referidos || referidos.pacientes.length === 0) return;
    try {
      await exportToPdf(referidos.pacientes, exportColumns, timestampedFilename(exportBase, "pdf"), {
        title: "Pacientes Referidos",
        subtitle: exportSubtitle,
        orientation: "landscape",
      });
      setToast({ title: "PDF descargado", variant: "success" });
    } catch (err) {
      setToast({ title: "Error", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  function formatCurrency(n: number): string {
    return new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" }).format(n);
  }

  function setQuickRange(months: number) {
    const hasta = new Date();
    const desde = new Date();
    desde.setMonth(desde.getMonth() - months);
    desde.setDate(1);
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    setFechaDesde(fmt(desde));
    setFechaHasta(fmt(hasta));
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href={backHref} aria-label={`Volver a ${backLabel}`}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-bold">{personal.nombreCompleto}</h1>
          <p className="text-sm text-muted-foreground">
            Doc. {personal.documentoIdentidad}
            {personal.jvpmOJvp ? <> · {personal.jvpmOJvp}</> : null}
            {personal.profesion ? <> · {personal.profesion}</> : null}
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            {personal.activo ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
            {personal.firmaActiva ? (
              <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">
                <ShieldCheck className="mr-1 h-3 w-3" aria-hidden /> Firma electrónica activa
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700">
                <ShieldAlert className="mr-1 h-3 w-3" aria-hidden /> Sin firma electrónica
              </Badge>
            )}
            {personal.authUserId ? (
              <Badge variant="secondary">
                <Link2 className="mr-1 h-3 w-3" aria-hidden /> Cuenta de acceso vinculada
              </Badge>
            ) : (
              <Badge variant="outline" className="text-amber-700">
                <Unlink className="mr-1 h-3 w-3" aria-hidden /> Sin cuenta de acceso
              </Badge>
            )}
          </div>
        </div>
      </div>

      <Tabs defaultValue="basicos">
        <TabsList>
          <TabsTrigger value="basicos">Datos básicos</TabsTrigger>
          <TabsTrigger value="referidos">
            Pacientes referidos
            {referidos && referidos.pacientes.length > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {referidos.pacientes.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="reportes">
            <TrendingUp className="mr-1 h-3 w-3" aria-hidden />
            Reportes
          </TabsTrigger>
          <TabsTrigger value="cuenta">Cuenta de acceso</TabsTrigger>
        </TabsList>

        {/* Tab: Datos básicos */}
        <TabsContent value="basicos" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información del profesional</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Documento de identidad</dt>
                  <dd className="font-mono">{personal.documentoIdentidad}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">JVPM / JVP / JNR</dt>
                  <dd className="font-mono">{personal.jvpmOJvp ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Profesión</dt>
                  <dd>{personal.profesion ?? "—"}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Alta del registro</dt>
                  <dd>{new Date(personal.creadoEn).toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}</dd>
                </div>
                {personal.fechaBaja && (
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground">Fecha de baja</dt>
                    <dd>{new Date(personal.fechaBaja).toLocaleDateString("es-SV", { day: "numeric", month: "long", year: "numeric" })}</dd>
                  </div>
                )}
              </dl>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Roles ECE asignados</p>
                <div className="flex flex-wrap gap-1">
                  {personal.roles.length === 0 ? (
                    <span className="text-sm text-muted-foreground">Sin roles asignados.</span>
                  ) : (
                    personal.roles.map((r) => (
                      <Badge key={r.codigo} variant="secondary">{r.nombre}</Badge>
                    ))
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Para editar datos básicos o roles, vuelva al listado y use el botón &quot;Editar&quot;.
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Pacientes referidos (CORE B2B2C) */}
        <TabsContent value="referidos" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <CardTitle className="text-base">Pacientes que ha atendido</CardTitle>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!referidos?.pacientes.length}
                    aria-label="Exportar pacientes referidos"
                  >
                    <Download className="mr-2 h-3 w-3" aria-hidden /> Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuLabel>Formato</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={handleExportPdf}>
                    <FileText className="mr-2 h-4 w-4" aria-hidden /> PDF
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportXlsx}>
                    <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden /> Excel (.xlsx)
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handleExportCsv}>
                    <FileDown className="mr-2 h-4 w-4" aria-hidden /> CSV
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Filtros de fecha */}
              <div className="flex flex-wrap items-end gap-2 rounded-md border bg-muted/30 p-3">
                <div>
                  <Label htmlFor="fechaDesde" className="text-xs">Desde</Label>
                  <Input
                    id="fechaDesde"
                    type="date"
                    value={fechaDesde}
                    onChange={(e) => setFechaDesde(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div>
                  <Label htmlFor="fechaHasta" className="text-xs">Hasta</Label>
                  <Input
                    id="fechaHasta"
                    type="date"
                    value={fechaHasta}
                    onChange={(e) => setFechaHasta(e.target.value)}
                    className="w-40"
                  />
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(1)}>1m</Button>
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(3)}>3m</Button>
                  <Button size="sm" variant="outline" onClick={() => setQuickRange(12)}>12m</Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setFechaDesde(""); setFechaHasta(""); }}
                  >
                    Limpiar
                  </Button>
                </div>
                {(fechaDesde || fechaHasta) && (
                  <span className="ml-auto text-xs text-muted-foreground">
                    <CalendarIcon className="inline h-3 w-3 mr-1" aria-hidden />
                    Filtrando {fechaDesde || "inicio"} → {fechaHasta || "hoy"}
                  </span>
                )}
              </div>

              {referidosQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Calculando…</p>
              )}
              {referidos && !referidos.authUserLinked && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Sin cuenta de acceso vinculada</p>
                  <p className="text-xs mt-1">
                    No se puede mostrar el listado de pacientes hasta que vincule este
                    profesional con un usuario HIS. Ve a la pestaña{" "}
                    <strong>Cuenta de acceso</strong> para enlazar.
                  </p>
                </div>
              )}
              {referidos && referidos.authUserLinked && referidos.pacientes.length === 0 && (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  Aún no hay pacientes atendidos por este profesional.
                </p>
              )}
              {referidos && referidos.authUserLinked && referidos.pacientes.length > 0 && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {referidos.pacientes.length} paciente(s) en {referidos.totalEncuentros} encuentro(s) total(es).
                    Última atención de cada paciente con este profesional.
                  </p>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-32">MRN</TableHead>
                          <TableHead>Paciente</TableHead>
                          <TableHead className="text-center w-20">Cirugía</TableHead>
                          <TableHead className="text-center w-20">Hospital.</TableHead>
                          <TableHead className="text-center w-20">Ambulat.</TableHead>
                          <TableHead className="text-center w-20">Emerg.</TableHead>
                          <TableHead className="w-40">Última atención</TableHead>
                          <TableHead className="w-16" aria-label="Acciones" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {referidos.pacientes.map((p) => (
                          <TableRow key={p.patientId}>
                            <TableCell className="font-mono text-xs">{p.mrn}</TableCell>
                            <TableCell>
                              <Link
                                href={`/patients/${p.patientId}`}
                                className="font-medium underline-offset-4 hover:underline"
                              >
                                {p.firstName} {p.lastName}
                              </Link>
                              {p.biologicalSexCode && (
                                <span className="ml-2 text-xs text-muted-foreground">
                                  ({p.biologicalSexCode})
                                </span>
                              )}
                            </TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.cirugia || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.hospitalizacion || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.ambulatorio || "—"}</TableCell>
                            <TableCell className="text-center tabular-nums">{p.conteos.emergencia || "—"}</TableCell>
                            <TableCell className="text-xs">
                              {p.ultimaAtencion
                                ? new Date(p.ultimaAtencion).toLocaleDateString("es-SV", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  })
                                : "—"}
                            </TableCell>
                            <TableCell>
                              <Button asChild size="sm" variant="outline">
                                <Link href={`/patients/${p.patientId}`}>Ver</Link>
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Tab: Reportes (productividad + facturación) */}
        <TabsContent value="reportes" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Resumen del período</CardTitle>
            </CardHeader>
            <CardContent>
              {reporteQuery.isLoading && (
                <p className="text-sm text-muted-foreground">Calculando…</p>
              )}
              {reporte && !reporte.authUserLinked && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                  Sin cuenta de acceso vinculada — no hay datos.
                </div>
              )}
              {reporte && reporte.authUserLinked && (
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <Stat label="Pacientes únicos" value={reporte.totales.pacientesUnicos} />
                  <Stat label="Cirugías" value={reporte.totales.cirugia} accent="primary" />
                  <Stat label="Hospitalizaciones" value={reporte.totales.hospitalizacion} />
                  <Stat label="Ambulatorios" value={reporte.totales.ambulatorio} />
                  <Stat label="Emergencias" value={reporte.totales.emergencia} />
                  <Stat
                    label="Facturado total"
                    icon={<DollarSign className="h-4 w-4" aria-hidden />}
                    value={formatCurrency(reporte.totales.facturadoTotal)}
                  />
                  <Stat
                    label="Cobrado"
                    icon={<DollarSign className="h-4 w-4" aria-hidden />}
                    value={formatCurrency(reporte.totales.facturadoCobrado)}
                  />
                  <Stat
                    label="% Cobranza"
                    value={
                      reporte.totales.facturadoTotal > 0
                        ? `${Math.round((reporte.totales.facturadoCobrado / reporte.totales.facturadoTotal) * 100)}%`
                        : "—"
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Productividad mensual */}
          {reporte && reporte.authUserLinked && reporte.mensual.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Productividad mensual (últimos 12 meses)</CardTitle>
              </CardHeader>
              <CardContent>
                <ProductividadMensual data={reporte.mensual} />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Tab: Cuenta de acceso */}
        <TabsContent value="cuenta" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cuenta de acceso al sistema</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <p className="text-muted-foreground">
                Para que el profesional pueda iniciar sesión en el HIS, firmar
                documentos electrónicamente y aparecer en reportes de productividad,
                debe estar vinculado con un usuario HIS (correo + roles RBAC).
              </p>
              {personal.authUserId ? (
                <div className="space-y-3">
                  <div className="rounded-md border border-green-300 bg-green-50 p-3">
                    <p className="font-medium text-green-900 flex items-center gap-1">
                      <Link2 className="h-4 w-4" aria-hidden /> Cuenta vinculada
                    </p>
                    <p className="text-xs text-green-700 mt-1 font-mono">
                      User ID: {personal.authUserId}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => unlinkMut.mutate({ personalId })}
                    disabled={unlinkMut.isPending}
                  >
                    <Unlink className="mr-2 h-4 w-4" aria-hidden />
                    {unlinkMut.isPending ? "Desvinculando…" : "Desvincular cuenta"}
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3">
                    <p className="font-medium text-amber-900">Sin cuenta vinculada</p>
                    <p className="text-xs text-amber-800 mt-1">
                      Vincule con un usuario existente o crea uno nuevo desde{" "}
                      <Link href="/users" className="underline">Administración → Usuarios</Link>{" "}
                      y luego regresa aquí.
                    </p>
                  </div>
                  <Button onClick={() => setLinkOpen(true)}>
                    <Link2 className="mr-2 h-4 w-4" aria-hidden />
                    Vincular cuenta existente
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Dialog: vincular o crear User */}
      <Dialog open={linkOpen} onOpenChange={(o) => !o && setLinkOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cuenta de acceso</DialogTitle>
            <DialogDescription>
              Vincula al profesional con un usuario HIS existente o crea una
              cuenta nueva en un solo paso.
            </DialogDescription>
          </DialogHeader>

          <Tabs value={linkTab} onValueChange={(v) => setLinkTab(v as "existente" | "nueva")}>
            <TabsList className="w-full">
              <TabsTrigger value="existente" className="flex-1">
                <Link2 className="mr-1 h-3 w-3" aria-hidden /> Vincular existente
              </TabsTrigger>
              <TabsTrigger value="nueva" className="flex-1">
                <UserPlus2 className="mr-1 h-3 w-3" aria-hidden /> Crear nueva
              </TabsTrigger>
            </TabsList>

            <TabsContent value="existente" className="mt-3 space-y-3">
              <div className="space-y-1">
                <Label htmlFor="userSearch">Buscar usuario</Label>
                <div className="relative">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                  <Input
                    id="userSearch"
                    value={linkSearch}
                    onChange={(e) => setLinkSearch(e.target.value)}
                    placeholder="Mínimo 2 caracteres…"
                    className="pl-8"
                  />
                </div>
              </div>
              <div className="rounded-md border max-h-64 overflow-y-auto">
                {linkSearch.trim().length < 2 ? (
                  <p className="text-sm text-muted-foreground p-3 text-center">
                    Escribe al menos 2 caracteres.
                  </p>
                ) : userSearchQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground p-3 text-center">Buscando…</p>
                ) : (userSearchQuery.data ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-3 text-center">
                    Sin resultados disponibles.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {(userSearchQuery.data ?? []).map((u) => (
                      <li key={u.id} className="flex items-center justify-between gap-2 p-2 hover:bg-muted/50">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{u.fullName}</p>
                          <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => linkMut.mutate({ personalId, userId: u.id })}
                          disabled={linkMut.isPending}
                        >
                          Vincular
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </TabsContent>

            <TabsContent value="nueva" className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Se creará una cuenta HIS con el correo + nombre del profesional.
                El rol RBAC inicial es opcional — el ADMIN puede asignarlo después
                desde <Link href="/users" className="underline">Usuarios</Link>.
              </p>
              <div className="space-y-1">
                <Label htmlFor="newUserEmail">
                  Correo <span aria-hidden className="text-destructive">*</span>
                </Label>
                <Input
                  id="newUserEmail"
                  type="email"
                  value={newUserForm.email}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="correo@hospital.com"
                  maxLength={254}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="newUserFullName">
                  Nombre completo <span aria-hidden className="text-destructive">*</span>
                </Label>
                <Input
                  id="newUserFullName"
                  value={newUserForm.fullName}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, fullName: e.target.value }))}
                  placeholder="Tal como debe aparecer en sus firmas"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="newUserRoleCode">Rol RBAC inicial (opcional)</Label>
                <Input
                  id="newUserRoleCode"
                  value={newUserForm.roleCode}
                  onChange={(e) => setNewUserForm((f) => ({ ...f, roleCode: e.target.value }))}
                  placeholder="Ej. PHYSICIAN, NURSE, ADMIN, DIR"
                  list="role-suggestions"
                />
                <datalist id="role-suggestions">
                  <option value="PHYSICIAN" />
                  <option value="NURSE" />
                  <option value="ADMIN" />
                  <option value="DIR" />
                  <option value="ANEST" />
                  <option value="PHARMACIST" />
                </datalist>
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  if (!newUserForm.email.trim() || !newUserForm.fullName.trim()) return;
                  createAndLinkMut.mutate({
                    personalId,
                    email: newUserForm.email.trim(),
                    fullName: newUserForm.fullName.trim(),
                    ...(newUserForm.roleCode.trim() && { roleCode: newUserForm.roleCode.trim() }),
                  });
                }}
                disabled={
                  createAndLinkMut.isPending
                  || !newUserForm.email.trim()
                  || !newUserForm.fullName.trim()
                }
              >
                {createAndLinkMut.isPending ? "Creando…" : "Crear cuenta y vincular"}
              </Button>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkOpen(false)}>
              Cerrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description && <ToastDescription>{toast.description}</ToastDescription>}
          </div>
        </Toast>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-componentes de Reportes
// ─────────────────────────────────────────────────────────────────────────────

interface StatProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: "primary";
}

function Stat({ label, value, icon, accent }: StatProps) {
  return (
    <div className="rounded-md border bg-card p-3">
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p className={`text-2xl font-bold tabular-nums ${accent === "primary" ? "text-primary" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/**
 * Mini bar-chart inline mensual: cirugías (color primario) + otros (gris).
 * Sin lib — barras CSS por altura proporcional.
 */
function ProductividadMensual({ data }: { data: Array<{ mes: string; cirugia: number; otros: number }> }) {
  const max = Math.max(1, ...data.map((d) => d.cirugia + d.otros));
  return (
    <div className="flex items-end gap-1 h-40 px-1" role="img" aria-label="Productividad mensual">
      {data.map((d) => {
        const totalH = ((d.cirugia + d.otros) / max) * 100;
        const cirH = ((d.cirugia) / Math.max(1, d.cirugia + d.otros)) * 100;
        const label = d.mes.slice(2); // YY-MM
        return (
          <div key={d.mes} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex flex-col w-full justify-end h-32 relative" title={`${d.mes}: ${d.cirugia} cirugías + ${d.otros} otros`}>
              <div
                className="w-full bg-muted rounded-t"
                style={{ height: `${totalH}%` }}
              >
                <div
                  className="bg-primary rounded-t"
                  style={{ height: `${cirH}%`, width: "100%" }}
                />
              </div>
            </div>
            <span className="text-[10px] text-muted-foreground tabular-nums">{label}</span>
            <span className="text-[10px] font-mono tabular-nums">{d.cirugia + d.otros}</span>
          </div>
        );
      })}
      <div className="ml-2 text-[10px] text-muted-foreground space-y-1 self-start">
        <p className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 bg-primary rounded-sm" /> Cirugías
        </p>
        <p className="flex items-center gap-1">
          <span className="inline-block w-2 h-2 bg-muted rounded-sm" /> Otros
        </p>
      </div>
    </div>
  );
}
