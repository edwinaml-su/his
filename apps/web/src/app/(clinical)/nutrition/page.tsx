"use client";

/**
 * §22 Nutrition — Listado de planes dietéticos activos.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
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

type PlanStatus = "ACTIVE" | "DISCONTINUED" | "COMPLETED";

const STATUS_OPTIONS: { value: PlanStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "Todos" },
  { value: "ACTIVE", label: "Activo" },
  { value: "DISCONTINUED", label: "Descontinuado" },
  { value: "COMPLETED", label: "Completado" },
];

const dateFmt = new Intl.DateTimeFormat("es-SV", { dateStyle: "short" });

export default function NutritionPage() {
  const [status, setStatus] = React.useState<PlanStatus | "ALL">("ACTIVE");

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {};
    if (status !== "ALL") input.status = status;
    return input;
  }, [status]);

  const query = trpc.nutrition.diet.list.useQuery(listInput);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Nutrición</h1>
          <p className="text-sm text-muted-foreground">
            Planes dietéticos, valoraciones y órdenes enteral/parenteral (§22).
          </p>
        </div>
        <Button asChild>
          <Link href="/nutrition/new">Nuevo plan dietético</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="filter-status">Estado</Label>
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as PlanStatus | "ALL")}
              >
                <SelectTrigger id="filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
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
          <CardTitle>Planes dietéticos</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin planes para el filtro.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Tipo de dieta</TableHead>
                  <TableHead>kcal/día</TableHead>
                  <TableHead>Proteína (g/día)</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((p) => {
                  const patientName = p.patient
                    ? `${p.patient.firstName} ${p.patient.lastName}`
                    : "—";
                  return (
                    <TableRow key={p.id}>
                      <TableCell>{patientName}</TableCell>
                      <TableCell>{p.dietType}</TableCell>
                      <TableCell className="tabular-nums">{p.caloriesTarget ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">{p.proteinTarget?.toString() ?? "—"}</TableCell>
                      <TableCell className="tabular-nums">
                        {dateFmt.format(new Date(p.startedAt))}
                      </TableCell>
                      <TableCell>{p.status}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
