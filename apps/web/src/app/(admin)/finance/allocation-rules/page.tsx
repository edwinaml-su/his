"use client";

/**
 * /finance/allocation-rules — Lista de reglas de prorrateo.
 *
 * Columnas: nombre, source (code + name), base distribución, # targets,
 * suma %, periodicidad, estado, acciones.
 */
import * as React from "react";
import Link from "next/link";
import { GitMerge } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
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
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = trpc as any;

const BASE_LABELS: Record<string, string> = {
  metros_cuadrados: "m²",
  numero_empleados: "Empleados",
  horas_trabajadas: "Horas",
  pacientes_atendidos: "Pacientes",
  kilos_lavados: "kg lavados",
  consumo_directo: "Consumo directo",
  porcentaje_manual: "% manual",
};

type AllocationRule = {
  id: string;
  name: string;
  sourceCostCenterId: string;
  sourceCode: string;
  sourceName: string;
  base: string;
  periodicity: string;
  active: boolean;
  targets: Array<{ percentage: number }>;
};

export default function AllocationRulesPage() {
  const [sourceFilter, setSourceFilter] = React.useState<string>("");
  const [activeFilter, setActiveFilter] = React.useState<string>("activas");
  const [confirmDeactivate, setConfirmDeactivate] = React.useState<AllocationRule | null>(null);

  const utils = trpc.useUtils();

  const query = t.allocationRule.list.useQuery({
    ...(sourceFilter ? { sourceCostCenterId: sourceFilter } : {}),
    ...(activeFilter === "activas"
      ? { active: true }
      : activeFilter === "inactivas"
        ? { active: false }
        : {}),
  });

  // Para el filtro de source, necesitamos la lista de centros de apoyo
  const costCentersQuery = t.costCenter.list.useQuery({ tipo: "apoyo", activo: true });

  const deactivate = t.allocationRule.deactivate.useMutation({
    onSuccess: () => {
      void utils.invalidate();
      setConfirmDeactivate(null);
    },
  });

  const rules = (query.data ?? []) as AllocationRule[];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <GitMerge className="h-6 w-6" />
            Reglas de Prorrateo
          </h1>
          <p className="text-sm text-muted-foreground">
            Define cómo distribuir los costos de centros de apoyo hacia centros productivos o
            intermedios.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href="/finance/allocation-rules/prorrateo">Ejecutar prorrateo mensual</Link>
          </Button>
          <Button asChild>
            <Link href="/finance/allocation-rules/nuevo">+ Nueva regla</Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reglas configuradas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Centro origen</label>
              <Select
                value={sourceFilter || "todos"}
                onValueChange={(v) => setSourceFilter(v === "todos" ? "" : v)}
              >
                <SelectTrigger className="w-56">
                  <SelectValue placeholder="Todos los centros" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los centros</SelectItem>
                  {((costCentersQuery.data ?? []) as Array<{ id: string; code: string; name: string }>).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Estado</label>
              <Select value={activeFilter} onValueChange={setActiveFilter}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activas">Solo activas</SelectItem>
                  <SelectItem value="inactivas">Solo inactivas</SelectItem>
                  <SelectItem value="todas">Todas</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">
              {query.isLoading ? "Cargando…" : `${rules.length} regla(s)`}
            </span>
          </div>

          {query.error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {(query.error as { message?: string })?.message ?? "Error al cargar reglas."}
            </p>
          ) : null}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead className="w-40">Centro origen</TableHead>
                  <TableHead className="w-32">Base distribución</TableHead>
                  <TableHead className="w-20 text-center">Targets</TableHead>
                  <TableHead className="w-20 text-center">Suma %</TableHead>
                  <TableHead className="w-28">Periodicidad</TableHead>
                  <TableHead className="w-24">Estado</TableHead>
                  <TableHead className="w-40 text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.length === 0 && !query.isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Sin reglas para los filtros seleccionados.
                    </TableCell>
                  </TableRow>
                ) : null}
                {rules.map((rule) => {
                  const sumaTarget = rule.targets.reduce((s, t) => s + t.percentage, 0);
                  const sumaOk = Math.abs(sumaTarget - 100) < 0.01;
                  return (
                    <TableRow key={rule.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/finance/allocation-rules/${rule.id}`}
                          className="underline-offset-4 hover:underline"
                        >
                          {rule.name}
                        </Link>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {rule.sourceCode}
                        <span className="ml-1 font-sans text-muted-foreground">{rule.sourceName}</span>
                      </TableCell>
                      <TableCell className="text-sm">
                        {BASE_LABELS[rule.base] ?? rule.base}
                      </TableCell>
                      <TableCell className="text-center text-sm">
                        {rule.targets.length}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            sumaOk ? "font-medium text-green-600" : "font-medium text-red-600"
                          }
                        >
                          {sumaTarget.toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {rule.periodicity === "monthly" ? "Mensual" : "Trimestral"}
                      </TableCell>
                      <TableCell>
                        {rule.active ? (
                          <Badge variant="success">Activa</Badge>
                        ) : (
                          <Badge variant="outline">Inactiva</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/finance/allocation-rules/${rule.id}`}>Ver</Link>
                          </Button>
                          {rule.active ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setConfirmDeactivate(rule)}
                            >
                              Desactivar
                            </Button>
                          ) : null}
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

      <Dialog
        open={Boolean(confirmDeactivate)}
        onOpenChange={(o) => !o && setConfirmDeactivate(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desactivar regla de prorrateo</DialogTitle>
            <DialogDescription>
              La regla{" "}
              <span className="font-medium">{confirmDeactivate?.name}</span> quedará inactiva.
              No se eliminará y puede reactivarse creando una nueva versión. El historial de
              prorrateos se conserva.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDeactivate(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deactivate.isPending}
              onClick={() => {
                if (confirmDeactivate) {
                  deactivate.mutate({ id: confirmDeactivate.id });
                }
              }}
            >
              {deactivate.isPending ? "Desactivando…" : "Desactivar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
