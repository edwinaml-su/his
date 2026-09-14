"use client";

/**
 * CC-0028 — Sub-componente: pólizas de seguro del paciente en la vista 360°.
 *
 * Lista PatientCoverage (póliza, plan/aseguradora, carnet, contratante,
 * vigencia) + al expandir una póliza, sus overrides por ámbito y reglas
 * (CoverageRule ligadas a esa póliza específica). CRUD de plan/reglas a
 * nivel de plan vive en /insurance/plans/[id] (admin) — aquí solo se ve/edita
 * lo propio de ESTA póliza.
 *
 * Integrado como tab "Seguros" en `page.tsx` del paciente (vista 360°).
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
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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

function fmtFecha(d: string | Date | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("es-SV");
}

function NuevaPolizaDialog({
  open,
  onOpenChange,
  patientId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  onSuccess: () => void;
}) {
  const [planId, setPlanId] = React.useState("");
  const [policyNumber, setPolicyNumber] = React.useState("");
  const [carnet, setCarnet] = React.useState("");
  const [contratante, setContratante] = React.useState("");
  const [validFrom, setValidFrom] = React.useState("");
  const [validTo, setValidTo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const plansQuery = trpc.insurance.plan.list.useQuery({ activeOnly: true, limit: 200 });

  React.useEffect(() => {
    if (!open) return;
    setPlanId("");
    setPolicyNumber("");
    setCarnet("");
    setContratante("");
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
    if (!planId) return setError("Selecciona el plan.");
    if (!policyNumber.trim()) return setError("El número de póliza es requerido.");
    if (!validFrom) return setError("La fecha de inicio de vigencia es requerida.");

    createMutation.mutate({
      patientId,
      planId,
      policyNumber: policyNumber.trim(),
      carnet: carnet.trim() || undefined,
      contratante: contratante.trim() || undefined,
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
          <div className="space-y-1.5">
            <Label htmlFor="pol-plan">Plan</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger id="pol-plan">
                <SelectValue placeholder="Seleccionar…" />
              </SelectTrigger>
              <SelectContent>
                {(plansQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.insurer.name} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
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

/** Reglas de una póliza específica (CoverageRule.coverageId). */
function ReglasDePoliza({ coverageId }: { coverageId: string }) {
  const rulesQuery = trpc.insurance.rule.list.useQuery({ coverageId, activeOnly: true, limit: 50 });

  if (rulesQuery.isLoading) return <p className="text-xs text-muted-foreground">Cargando reglas…</p>;
  if (!rulesQuery.data || rulesQuery.data.length === 0) {
    return <p className="text-xs text-muted-foreground">Sin reglas propias — aplica la config del plan.</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {rulesQuery.data.map((r) => (
        <li key={r.id}>
          {r.ruleOn === "CODIGO" ? `Código ${r.code}` : `Categoría ${r.serviceCategoryId}`}:{" "}
          {r.fullCover ? "100%" : r.ruleType === "PORCENTAJE" ? `${r.percentage}%` : `$${r.amount}`}
        </li>
      ))}
    </ul>
  );
}

export function PatientInsurance({ patientId }: { patientId: string }) {
  const query = trpc.insurance.coverage.list.useQuery({ patientId, activeOnly: true, limit: 50 });
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Pólizas de seguro del paciente (CC-0028). La cobertura estimada por póliza se
          calcula en la liquidación de cada cuenta (tab Cuentas).
        </p>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          Nueva póliza
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pólizas vigentes</CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading && <p className="text-sm text-muted-foreground">Cargando…</p>}
          {query.data && query.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin pólizas registradas.</p>
          )}
          {query.data && query.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Póliza</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Carnet</TableHead>
                  <TableHead>Contratante</TableHead>
                  <TableHead>Vigencia</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {query.data.map((c) => (
                  <React.Fragment key={c.id}>
                    <TableRow>
                      <TableCell className="font-mono">{c.policyNumber}</TableCell>
                      <TableCell>
                        {c.plan.insurer.name} — {c.plan.name}
                      </TableCell>
                      <TableCell>{c.carnet ?? "—"}</TableCell>
                      <TableCell>{c.contratante ?? "—"}</TableCell>
                      <TableCell>
                        {fmtFecha(c.validFrom)} – {fmtFecha(c.validTo)}
                        {c.active ? <Badge className="ml-2" variant="default">Activa</Badge> : null}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpandedId(expandedId === c.id ? null : c.id)}
                        >
                          {expandedId === c.id ? "Ocultar" : "Reglas"}
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedId === c.id ? (
                      <TableRow>
                        <TableCell colSpan={6} className="bg-muted/20">
                          <ReglasDePoliza coverageId={c.id} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <NuevaPolizaDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        patientId={patientId}
        onSuccess={() => void query.refetch()}
      />
    </div>
  );
}
