"use client";

/**
 * Sprint UI Finance — /finance/cost-centers
 * Lista filtrable de centros de costo con semáforo por tipo.
 */
import * as React from "react";
import Link from "next/link";
import { Building2, Download, FileText, FileSpreadsheet, FileDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@his/ui/components/dropdown-menu";
import {
  exportToCsv,
  exportToXlsx,
  exportToPdf,
  timestampedFilename,
  type ExportColumn,
} from "@/lib/export";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

type Tipo = "productivo" | "intermedio" | "apoyo";

const TIPO_LABEL: Record<Tipo, string> = {
  productivo: "Productivo",
  intermedio: "Intermedio",
  apoyo: "Apoyo",
};

// Verde / Azul / Ámbar alineado con la jerarquía de colores del sistema.
const TIPO_VARIANT: Record<Tipo, "success" | "info" | "warning"> = {
  productivo: "success",
  intermedio: "info",
  apoyo: "warning",
};

type CostCenterRow = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  tipo: string | null;
  permite_imputacion: boolean | null;
  base_distribucion: string | null;
};

export default function CostCentersPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  const orgQuery = trpc.organization.current.useQuery();
  const org = orgQuery.data;

  const [tipoFilter, setTipoFilter] = React.useState<string>("");
  const [activoFilter, setActivoFilter] = React.useState<string>("activos");
  const [confirmDeactivate, setConfirmDeactivate] = React.useState<CostCenterRow | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const utils = trpc.useUtils();

  const query = trpcAny.costCenter.list.useQuery(
    {
      ...(tipoFilter ? { tipo: tipoFilter } : {}),
      ...(activoFilter === "activos"
        ? { activo: true }
        : activoFilter === "inactivos"
          ? { activo: false }
          : {}),
    },
    { enabled: Boolean(org) },
  );

  const setActive = trpcAny.costCenter.setActive.useMutation({
    onSuccess: (_: unknown, vars: { active: boolean }) => {
      utils.invalidate();
      setToast({
        title: vars.active ? "Centro activado" : "Centro desactivado",
        variant: "success",
      });
      setConfirmDeactivate(null);
    },
    onError: (err: { message: string }) => {
      setToast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const rows = (query.data ?? []) as CostCenterRow[];

  // Columnas exportables (label visible idéntico al de la tabla).
  const exportColumns: ExportColumn<CostCenterRow>[] = React.useMemo(
    () => [
      { header: "Código", accessor: (r) => r.code },
      { header: "Nombre", accessor: (r) => r.name },
      { header: "Tipo", accessor: (r) => TIPO_LABEL[(r.tipo ?? "productivo") as Tipo] },
      {
        header: "Imputación",
        accessor: (r) => (r.permite_imputacion !== false ? "Sí" : "Solo consolidación"),
      },
      { header: "Base distribución", accessor: (r) => r.base_distribucion ?? "" },
      { header: "Estado", accessor: (r) => (r.active ? "Activo" : "Inactivo") },
    ],
    [],
  );

  const exportBase = "centros-costo";
  const exportSubtitle = `${org?.tradeName ?? org?.legalName ?? ""} — ${rows.length} centro(s)`;

  const handleExportCsv = () => {
    exportToCsv(rows, exportColumns, timestampedFilename(exportBase, "csv"));
    setToast({ title: "CSV descargado", variant: "success" });
  };

  const handleExportXlsx = async () => {
    try {
      await exportToXlsx(rows, exportColumns, timestampedFilename(exportBase, "xlsx"), "Centros de costo");
      setToast({ title: "Excel descargado", variant: "success" });
    } catch (err) {
      setToast({
        title: "Error al exportar Excel",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const handleExportPdf = async () => {
    try {
      await exportToPdf(rows, exportColumns, timestampedFilename(exportBase, "pdf"), {
        title: "Centros de Costo",
        subtitle: exportSubtitle,
        orientation: "landscape",
      });
      setToast({ title: "PDF descargado", variant: "success" });
    } catch (err) {
      setToast({
        title: "Error al exportar PDF",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  if (orgQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando organización…</p>;
  }

  if (!org) {
    return (
      <div className="space-y-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Building2 className="h-6 w-6" />
          Centros de Costo
        </h1>
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Sin tenant activo. Selecciona una organización desde el switcher superior.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <Building2 className="h-6 w-6" />
            Centros de Costo
          </h1>
          <p className="text-sm text-muted-foreground">
            Catálogo maestro de centros de costo para{" "}
            <span className="font-medium">{org.tradeName ?? org.legalName}</span>.
            Formato de código: T-AAA-SSS (1=productivo, 2=intermedio, 3=apoyo).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                disabled={rows.length === 0 || query.isLoading}
                aria-label="Exportar centros de costo"
              >
                <Download className="mr-2 h-4 w-4" aria-hidden />
                Exportar
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Formato de exportación</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={handleExportPdf}>
                <FileText className="mr-2 h-4 w-4" aria-hidden />
                PDF
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportXlsx}>
                <FileSpreadsheet className="mr-2 h-4 w-4" aria-hidden />
                Excel (.xlsx)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={handleExportCsv}>
                <FileDown className="mr-2 h-4 w-4" aria-hidden />
                CSV
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button asChild>
            <Link href="/finance/cost-centers/nuevo">+ Nuevo centro</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Centros de costo</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Filtros */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Tipo</label>
              <Select
                value={tipoFilter || "todos"}
                onValueChange={(v) => setTipoFilter(v === "todos" ? "" : v)}
              >
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Todos los tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los tipos</SelectItem>
                  <SelectItem value="productivo">Productivo</SelectItem>
                  <SelectItem value="intermedio">Intermedio</SelectItem>
                  <SelectItem value="apoyo">Apoyo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Estado</label>
              <Select value={activoFilter} onValueChange={setActivoFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {query.isLoading ? "Cargando…" : `${rows.length} centro(s)`}
            </span>
          </div>

          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar centros."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Código</TableHead>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-32">Tipo</TableHead>
                  <TableHead className="w-24">Imputación</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-48 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Sin centros para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rows.map((row) => {
                  const tipo = (row.tipo ?? "productivo") as Tipo;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs font-medium">
                        {row.code}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={`/finance/cost-centers/${row.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {row.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant={TIPO_VARIANT[tipo]}>{TIPO_LABEL[tipo]}</Badge>
                      </TableCell>
                      <TableCell>
                        {row.permite_imputacion !== false ? (
                          <Badge variant="outline">Sí</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">Solo consolidación</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {row.active ? (
                          <Badge variant="success">Activo</Badge>
                        ) : (
                          <Badge variant="outline">Inactivo</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/finance/cost-centers/${row.id}`}>Ver</Link>
                          </Button>
                          {row.active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDeactivate(row)}
                            >
                              Desactivar
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActive.mutate({ id: row.id, active: true })}
                              disabled={setActive.isPending}
                            >
                              Reactivar
                            </Button>
                          )}
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

      {/* Confirmación desactivar */}
      <Dialog open={Boolean(confirmDeactivate)} onOpenChange={(o) => !o && setConfirmDeactivate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar centro de costo</DialogTitle>
            <DialogDescription>
              El centro{" "}
              <span className="font-mono font-medium">{confirmDeactivate?.code}</span>{" "}
              — {confirmDeactivate?.name} quedará inactivo. No se eliminará y puede
              reactivarse. Las transacciones históricas se conservan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeactivate(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={setActive.isPending}
              onClick={() => {
                if (confirmDeactivate) {
                  setActive.mutate({ id: confirmDeactivate.id, active: false });
                }
              }}
            >
              {setActive.isPending ? "Desactivando…" : "Desactivar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
