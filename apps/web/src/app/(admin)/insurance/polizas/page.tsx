"use client";

/**
 * CC-0028c — Catálogo admin de MANTENIMIENTO de pólizas (PatientCoverage).
 *
 * Hasta este CC el alta de pólizas sólo existía en el tab "Seguros" de la
 * vista 360° del paciente (`/patients/[id]` → insurance.tsx). Esta pantalla
 * es la vista TRANSVERSAL para admin: lista todas las pólizas del tenant con
 * filtros (búsqueda, aseguradora, sólo vigentes) + alta con buscador de
 * paciente + edición + desactivación. Reusa `insurance.coverage.list/create
 * /update/deactivate` (insurance.router.ts) — mismo backend que el tab del
 * paciente, sin duplicar lógica.
 *
 * Fidelidad de diseño: no hay mockup HTML/CSS entregado para esta pantalla
 * (CC-0028c es una pantalla de mantenimiento admin nueva, no una traducción
 * de un mockup existente) — sigue el mismo patrón visual que las pantallas
 * hermanas `/insurance` y `/insurance/plans` (Card + Table + Dialog, tokens
 * Shadcn/@his/ui ya materializados).
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
import { Badge, type BadgeProps } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Checkbox } from "@his/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { BuscadorPaciente, type PacienteSeleccion } from "@/components/pacientes/BuscadorPaciente";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@his/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type CoverageRow = RouterOutput["insurance"]["coverage"]["list"][number];

const LIMIT = 50;

function toDateInput(d: string | Date): string {
  return new Date(d).toISOString().slice(0, 10);
}

function fmtFecha(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-SV");
}

/** VIGENTE (dentro del rango) / VENCIDA (validTo pasado) / FUTURA (validFrom no ha llegado). */
function vigenciaInfo(validFrom: string | Date, validTo: string | Date | null): {
  label: string;
  variant: BadgeProps["variant"];
} {
  const now = new Date();
  const vf = new Date(validFrom);
  const vt = validTo ? new Date(validTo) : null;
  if (vf > now) return { label: "FUTURA", variant: "info" };
  if (vt && vt < now) return { label: "VENCIDA", variant: "destructive" };
  return { label: "VIGENTE", variant: "success" };
}

/**
 * Selector aseguradora → plan (dependiente). Usado por alta y edición.
 * `onInsurerChange` resetea el plan seleccionado — NO se llama durante la
 * carga inicial de un registro existente (esa sólo hace setInsurerId directo).
 */
function SelectorAseguradoraPlan({
  insurerId,
  planId,
  onInsurerChange,
  onPlanChange,
}: {
  insurerId: string;
  planId: string;
  onInsurerChange: (id: string) => void;
  onPlanChange: (id: string) => void;
}) {
  const insurersQuery = trpc.insurance.insurer.list.useQuery({ activeOnly: true, limit: 200 });
  const plansQuery = trpc.insurance.plan.list.useQuery(
    { insurerId, activeOnly: true, limit: 200 },
    { enabled: insurerId.length > 0 },
  );

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="pol-insurer">Aseguradora</Label>
        <Select value={insurerId} onValueChange={onInsurerChange}>
          <SelectTrigger id="pol-insurer">
            <SelectValue placeholder="Seleccionar…" />
          </SelectTrigger>
          <SelectContent>
            {(insurersQuery.data ?? []).map((i) => (
              <SelectItem key={i.id} value={i.id}>
                {i.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="pol-plan">Plan</Label>
        <Select value={planId} onValueChange={onPlanChange} disabled={!insurerId}>
          <SelectTrigger id="pol-plan">
            <SelectValue placeholder={insurerId ? "Seleccionar…" : "Selecciona aseguradora primero"} />
          </SelectTrigger>
          <SelectContent>
            {(plansQuery.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function NuevaPolizaDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [paciente, setPaciente] = React.useState<PacienteSeleccion | null>(null);
  const [insurerId, setInsurerId] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [carnet, setCarnet] = React.useState("");
  const [contratante, setContratante] = React.useState("");
  const [priceListId, setPriceListId] = React.useState("");
  const [validFrom, setValidFrom] = React.useState("");
  const [validTo, setValidTo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const priceListsQuery = trpc.servicePriceList.list.useQuery({ active: true });

  React.useEffect(() => {
    if (!open) return;
    setPaciente(null);
    setInsurerId("");
    setPlanId("");
    setPolicyNumber("");
    setCarnet("");
    setContratante("");
    setPriceListId("");
    setValidFrom(new Date().toISOString().slice(0, 10));
    setValidTo("");
    setError(null);
  }, [open]);

  const createMutation = trpc.insurance.coverage.create.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => setError(err.message ?? "Error al registrar la póliza."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!paciente) return setError("Busca y selecciona el paciente.");
    if (!planId) return setError("Selecciona la aseguradora y el plan.");
    if (!policyNumber.trim()) return setError("El número de póliza es requerido.");
    if (!validFrom) return setError("La fecha de inicio de vigencia es requerida.");

    createMutation.mutate({
      patientId: paciente.id,
      planId,
      policyNumber: policyNumber.trim(),
      carnet: carnet.trim() || undefined,
      contratante: contratante.trim() || undefined,
      priceListId: priceListId || undefined,
      validFrom: new Date(validFrom),
      validTo: validTo ? new Date(validTo) : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva póliza</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {paciente ? (
            <div className="space-y-1.5">
              <Label>Paciente</Label>
              <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-sm">
                <span className="flex-1">
                  {paciente.nombre}
                  {paciente.mrn ? ` · ${paciente.mrn}` : ""}
                </span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPaciente(null)}>
                  Cambiar
                </Button>
              </div>
            </div>
          ) : (
            <BuscadorPaciente id="pol-paciente" onSelect={setPaciente} />
          )}

          <SelectorAseguradoraPlan
            insurerId={insurerId}
            planId={planId}
            onInsurerChange={(id) => {
              setInsurerId(id);
              setPlanId("");
            }}
            onPlanChange={setPlanId}
          />

          <div className="space-y-1.5">
            <Label htmlFor="pol-number">Número de póliza</Label>
            <Input id="pol-number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-carnet">Carnet (opcional)</Label>
            <Input id="pol-carnet" value={carnet} onChange={(e) => setCarnet(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-contratante">Contratante (opcional)</Label>
            <Input id="pol-contratante" value={contratante} onChange={(e) => setContratante(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pol-from">Vigente desde</Label>
              <Input id="pol-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-to">Vigente hasta (opcional)</Label>
              <Input id="pol-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-pricelist">Lista de precios (opcional)</Label>
            <Select value={priceListId} onValueChange={setPriceListId}>
              <SelectTrigger id="pol-pricelist">
                <SelectValue placeholder="Usa la del plan" />
              </SelectTrigger>
              <SelectContent>
                {(priceListsQuery.data ?? []).map((pl) => (
                  <SelectItem key={pl.id} value={pl.id}>
                    {pl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Guardando…" : "Registrar póliza"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditarPolizaDialog({
  open,
  onOpenChange,
  coverage,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coverage: CoverageRow | null;
  onSuccess: () => void;
}) {
  const [insurerId, setInsurerId] = React.useState("");
  const [planId, setPlanId] = React.useState("");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [carnet, setCarnet] = React.useState("");
  const [contratante, setContratante] = React.useState("");
  const [priceListId, setPriceListId] = React.useState("");
  const [validFrom, setValidFrom] = React.useState("");
  const [validTo, setValidTo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const priceListsQuery = trpc.servicePriceList.list.useQuery({ active: true });

  React.useEffect(() => {
    if (!open || !coverage) return;
    setInsurerId(coverage.plan.insurer.id);
    setPlanId(coverage.plan.id);
    setPolicyNumber(coverage.policyNumber);
    setCarnet(coverage.carnet ?? "");
    setContratante(coverage.contratante ?? "");
    setPriceListId(coverage.priceListId ?? "");
    setValidFrom(toDateInput(coverage.validFrom));
    setValidTo(coverage.validTo ? toDateInput(coverage.validTo) : "");
    setError(null);
  }, [open, coverage]);

  const updateMutation = trpc.insurance.coverage.update.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => setError(err.message ?? "Error al actualizar la póliza."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!coverage) return;
    if (!planId) return setError("Selecciona la aseguradora y el plan.");
    if (!policyNumber.trim()) return setError("El número de póliza es requerido.");
    if (!validFrom) return setError("La fecha de inicio de vigencia es requerida.");

    updateMutation.mutate({
      id: coverage.id,
      planId,
      policyNumber: policyNumber.trim(),
      carnet: carnet.trim() || undefined,
      contratante: contratante.trim() || undefined,
      priceListId: priceListId || undefined,
      validFrom: new Date(validFrom),
      // null explícito = borrar la fecha fin (con undefined Prisma no toca el
      // campo y vaciar era un falso éxito — hallazgo pre-pr-review).
      validTo: validTo ? new Date(validTo) : null,
    });
  }

  if (!coverage) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar póliza</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label>Paciente</Label>
            {/* CC-0028c: una póliza no se transfiere de paciente — se desactiva
                y se crea una nueva. Sólo lectura aquí a propósito. */}
            <div className="rounded-md border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
              {coverage.patient.lastName} {coverage.patient.firstName}
              {coverage.patient.mrn ? ` · ${coverage.patient.mrn}` : ""} (no editable)
            </div>
          </div>

          <SelectorAseguradoraPlan
            insurerId={insurerId}
            planId={planId}
            onInsurerChange={(id) => {
              setInsurerId(id);
              setPlanId("");
            }}
            onPlanChange={setPlanId}
          />

          <div className="space-y-1.5">
            <Label htmlFor="pol-edit-number">Número de póliza</Label>
            <Input id="pol-edit-number" value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-edit-carnet">Carnet (opcional)</Label>
            <Input id="pol-edit-carnet" value={carnet} onChange={(e) => setCarnet(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-edit-contratante">Contratante (opcional)</Label>
            <Input id="pol-edit-contratante" value={contratante} onChange={(e) => setContratante(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pol-edit-from">Vigente desde</Label>
              <Input id="pol-edit-from" type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-edit-to">Vigente hasta (opcional)</Label>
              <Input id="pol-edit-to" type="date" value={validTo} onChange={(e) => setValidTo(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pol-edit-pricelist">Lista de precios (opcional)</Label>
            <Select value={priceListId} onValueChange={setPriceListId}>
              <SelectTrigger id="pol-edit-pricelist">
                <SelectValue placeholder="Usa la del plan" />
              </SelectTrigger>
              <SelectContent>
                {(priceListsQuery.data ?? []).map((pl) => (
                  <SelectItem key={pl.id} value={pl.id}>
                    {pl.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PolizasAdminPage() {
  const [search, setSearch] = React.useState("");
  const [insurerFilter, setInsurerFilter] = React.useState("ALL");
  const [soloVigentes, setSoloVigentes] = React.useState(false);
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    setOffset(0);
  }, [search, insurerFilter, soloVigentes]);

  const insurersQuery = trpc.insurance.insurer.list.useQuery({ activeOnly: true, limit: 200 });

  const listInput = React.useMemo(() => {
    const input: Record<string, unknown> = {
      // Mantenimiento admin: se ven pólizas activas E inactivas (columna "activo").
      activeOnly: false,
      limit: LIMIT,
      offset,
    };
    if (search.trim()) input.search = search.trim();
    if (insurerFilter !== "ALL") input.insurerId = insurerFilter;
    if (soloVigentes) input.vigentesA = new Date();
    return input;
  }, [search, insurerFilter, soloVigentes, offset]);

  const query = trpc.insurance.coverage.list.useQuery(listInput);

  const [createOpen, setCreateOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<CoverageRow | null>(null);

  const deactivateMutation = trpc.insurance.coverage.deactivate.useMutation({
    onSuccess: () => void query.refetch(),
  });

  function handleDeactivate(c: CoverageRow) {
    const nombre = `${c.patient.lastName} ${c.patient.firstName}`.trim();
    if (!window.confirm(`¿Desactivar la póliza ${c.policyNumber} de ${nombre}?`)) return;
    deactivateMutation.mutate({ id: c.id });
  }

  const rows = query.data ?? [];
  const hasNextPage = rows.length === LIMIT;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Mantenimiento de pólizas</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo transversal de pólizas de seguro (CC-0028c) — configura/gestiona todas
            las pólizas del tenant. El alta por paciente sigue disponible en el tab
            &quot;Seguros&quot; de cada expediente.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/insurance">Aseguradoras</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/insurance/plans">Planes</Link>
          </Button>
          <Button onClick={() => setCreateOpen(true)}>Nueva póliza</Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="filter-search">Búsqueda</Label>
              <Input
                id="filter-search"
                placeholder="Paciente, MRN o nº de póliza"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="filter-insurer">Aseguradora</Label>
              <Select value={insurerFilter} onValueChange={setInsurerFilter}>
                <SelectTrigger id="filter-insurer">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todas</SelectItem>
                  {(insurersQuery.data ?? []).map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end gap-2 pb-1.5">
              <Checkbox
                id="filter-vigentes"
                checked={soloVigentes}
                onCheckedChange={setSoloVigentes}
              />
              <Label htmlFor="filter-vigentes" className="font-normal">
                Sólo vigentes hoy
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pólizas</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {query.error.message}
            </p>
          )}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin pólizas para los filtros actuales.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Paciente</TableHead>
                  <TableHead>Aseguradora</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Carnet</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead>Activo</TableHead>
                  <TableHead className="w-40"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((c) => {
                  const vigencia = vigenciaInfo(c.validFrom, c.validTo);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span>
                            {c.patient.lastName} {c.patient.firstName}
                          </span>
                          {c.patient.mrn ? (
                            <span className="font-mono text-xs text-muted-foreground">{c.patient.mrn}</span>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>{c.plan.insurer.name}</TableCell>
                      <TableCell>{c.plan.name}</TableCell>
                      <TableCell className="font-mono">{c.policyNumber}</TableCell>
                      <TableCell>{c.carnet ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant={vigencia.variant} className="w-fit">
                            {vigencia.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {fmtFecha(c.validFrom)} – {fmtFecha(c.validTo)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={c.active ? "success" : "secondary"}>
                          {c.active ? "Activo" : "Inactivo"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => setEditing(c)}>
                            Editar
                          </Button>
                          {c.active ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeactivate(c)}
                              disabled={deactivateMutation.isPending}
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
          )}
          {query.data && (rows.length > 0 || offset > 0) && (
            <div className="mt-3 flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!hasNextPage}
                onClick={() => setOffset((o) => o + LIMIT)}
              >
                Siguiente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <NuevaPolizaDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={() => void query.refetch()}
      />
      <EditarPolizaDialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
        coverage={editing}
        onSuccess={() => void query.refetch()}
      />
    </div>
  );
}
