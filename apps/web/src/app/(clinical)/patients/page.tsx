"use client";

import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";

/**
 * MPI + worklist de cobro (CC-0008). Lista expedientes con cuentas pendientes de
 * cobro (factura con saldo) o cerradas (históricas), con filtros y área actual.
 */
type Vista = "pendientes" | "cerradas";

const PAGE_SIZE = 25;

const money = new Intl.NumberFormat("es-SV", { style: "currency", currency: "USD" });

function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export default function PatientsPage() {
  const [vista, setVista] = React.useState<Vista>("pendientes");
  const [nombre, setNombre] = React.useState("");
  const [documento, setDocumento] = React.useState("");
  const [expediente, setExpediente] = React.useState("");
  const [biologicalSexId, setBiologicalSexId] = React.useState("");
  const [edadMin, setEdadMin] = React.useState("");
  const [edadMax, setEdadMax] = React.useState("");
  const [page, setPage] = React.useState(0);

  const nombreD = useDebounced(nombre);
  const documentoD = useDebounced(documento);
  const expedienteD = useDebounced(expediente);

  // Resetea a la primera página cuando cambian filtros o vista.
  React.useEffect(() => {
    setPage(0);
  }, [vista, nombreD, documentoD, expedienteD, biologicalSexId, edadMin, edadMax]);

  const sexes = trpc.catalog.list.useQuery({ catalog: "biologicalSex", activeOnly: true });

  const worklist = trpc.patientAccount.listarWorklist.useQuery({
    vista,
    nombre: nombreD || undefined,
    documento: documentoD || undefined,
    expediente: expedienteD || undefined,
    biologicalSexId: biologicalSexId || undefined,
    edadMin: edadMin === "" ? undefined : Number(edadMin),
    edadMax: edadMax === "" ? undefined : Number(edadMax),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const rows = worklist.data ?? [];
  const hayMas = rows.length === PAGE_SIZE;

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold">Pacientes</h1>
          <p className="text-sm text-muted-foreground">Master Patient Index — cuentas y cobro</p>
        </div>
        <Button asChild>
          <Link href="/patients/new">Nuevo paciente</Link>
        </Button>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Estado de cuenta">
        <Button
          role="tab"
          aria-selected={vista === "pendientes"}
          variant={vista === "pendientes" ? "default" : "outline"}
          onClick={() => setVista("pendientes")}
        >
          Pendientes de cobro
        </Button>
        <Button
          role="tab"
          aria-selected={vista === "cerradas"}
          variant={vista === "cerradas" ? "default" : "outline"}
          onClick={() => setVista("cerradas")}
        >
          Cerradas (Históricas)
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="f-nombre">Nombre</Label>
              <Input id="f-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre o apellido…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-documento">Número de documento</Label>
              <Input id="f-documento" value={documento} onChange={(e) => setDocumento(e.target.value)} placeholder="DUI / pasaporte…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-expediente">Número de expediente</Label>
              <Input id="f-expediente" value={expediente} onChange={(e) => setExpediente(e.target.value)} placeholder="SV…" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-sexo">Sexo</Label>
              <select
                id="f-sexo"
                value={biologicalSexId}
                onChange={(e) => setBiologicalSexId(e.target.value)}
                className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">Todos</option>
                {sexes.data?.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-edad-min">Edad mínima</Label>
              <Input id="f-edad-min" type="number" min={0} max={150} value={edadMin} onChange={(e) => setEdadMin(e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="f-edad-max">Edad máxima</Label>
              <Input id="f-edad-max" type="number" min={0} max={150} value={edadMax} onChange={(e) => setEdadMax(e.target.value)} placeholder="150" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          {worklist.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : worklist.error ? (
            <p className="text-sm text-destructive" role="alert">
              {worklist.error.message}
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {vista === "pendientes"
                ? "No hay expedientes con cuentas pendientes de cobro."
                : "No hay expedientes con cuentas cerradas."}
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Expediente</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead>Documento</TableHead>
                    <TableHead>Sexo</TableHead>
                    <TableHead className="text-right">Edad</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Área actual</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.patientId}>
                      <TableCell className="font-mono text-xs">{r.expediente ?? r.mrn ?? "—"}</TableCell>
                      <TableCell>{r.nombreCompleto || "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.documentNumber ?? "—"}</TableCell>
                      <TableCell>{r.sexo ?? "—"}</TableCell>
                      <TableCell numeric>{r.edad ?? "—"}</TableCell>
                      <TableCell numeric>
                        {vista === "pendientes" ? (
                          <Badge variant="warning">{money.format(r.saldo)}</Badge>
                        ) : (
                          <span className="tabular-nums text-muted-foreground">{money.format(r.saldo)}</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.egresado ? (
                          <Badge variant="secondary">Egresado</Badge>
                        ) : (
                          <span>
                            {r.areaUnidad}
                            {r.areaCama ? ` · ${r.areaCama}` : ""}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Button asChild variant="outline" size="sm">
                          <Link href={`/patients/${r.patientId}`}>Ver</Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="mt-4 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">Página {page + 1}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                    Anterior
                  </Button>
                  <Button variant="outline" size="sm" disabled={!hayMas} onClick={() => setPage((p) => p + 1)}>
                    Siguiente
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
