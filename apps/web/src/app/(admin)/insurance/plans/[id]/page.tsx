"use client";

/**
 * CC-0028 — Detalle de plan: coberturas por ámbito (InsurancePlanCoverage) +
 * reglas de reparto (CoverageRule) a nivel de plan. Ver precedencia completa
 * en packages/trpc/src/lib/coverage-resolver.ts.
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
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
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
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
import { formatCurrency } from "@/lib/i18n/currency";

const AMBITOS = ["CONSULTA", "FARMACIA", "GENERAL"] as const;
type Ambito = (typeof AMBITOS)[number];
type CoverageType = "PORCENTAJE" | "MONTO_FIJO" | "PORCENTAJE_CON_TOPE";

const AMBITO_LABEL: Record<Ambito, string> = {
  CONSULTA: "Consulta",
  FARMACIA: "Farmacia",
  GENERAL: "General (default)",
};

const COVERAGE_TYPE_LABEL: Record<CoverageType, string> = {
  PORCENTAJE: "Porcentaje",
  MONTO_FIJO: "Copago fijo",
  PORCENTAJE_CON_TOPE: "Porcentaje con tope",
};

// ---------------------------------------------------------------------------
// Dialog: config de cobertura de un ámbito.
// ---------------------------------------------------------------------------

function AmbitoConfigDialog({
  open,
  onOpenChange,
  planId,
  ambito,
  actual,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  ambito: Ambito;
  actual: { coverageType: CoverageType; insuredPercentage: number | null; copayAmount: number | null; coverageLimit: number | null } | null;
  onSuccess: () => void;
}) {
  const [coverageType, setCoverageType] = React.useState<CoverageType>("PORCENTAJE");
  const [insuredPercentage, setInsuredPercentage] = React.useState("");
  const [copayAmount, setCopayAmount] = React.useState("");
  const [coverageLimit, setCoverageLimit] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setCoverageType(actual?.coverageType ?? "PORCENTAJE");
    setInsuredPercentage(actual?.insuredPercentage != null ? String(actual.insuredPercentage) : "");
    setCopayAmount(actual?.copayAmount != null ? String(actual.copayAmount) : "");
    setCoverageLimit(actual?.coverageLimit != null ? String(actual.coverageLimit) : "");
    setError(null);
  }, [open, actual]);

  const upsertMutation = trpc.insurance.planCoverage.upsert.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => setError(err.message ?? "Error al guardar la config."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    upsertMutation.mutate({
      planId,
      ambito,
      coverageType,
      insuredPercentage: insuredPercentage ? Number(insuredPercentage) : undefined,
      copayAmount: copayAmount ? Number(copayAmount) : undefined,
      coverageLimit: coverageLimit ? Number(coverageLimit) : undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cobertura — {AMBITO_LABEL[ambito]}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cov-type">Tipo</Label>
            <Select value={coverageType} onValueChange={(v) => setCoverageType(v as CoverageType)}>
              <SelectTrigger id="cov-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COVERAGE_TYPE_LABEL).map(([v, label]) => (
                  <SelectItem key={v} value={v}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {(coverageType === "PORCENTAJE" || coverageType === "PORCENTAJE_CON_TOPE") && (
            <div className="space-y-1.5">
              <Label htmlFor="cov-pct">% cubierto por la aseguradora</Label>
              <Input
                id="cov-pct"
                type="number"
                min={0}
                max={100}
                value={insuredPercentage}
                onChange={(e) => setInsuredPercentage(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="cov-copay">Copago fijo del paciente (opcional)</Label>
            <Input id="cov-copay" type="number" min={0} value={copayAmount} onChange={(e) => setCopayAmount(e.target.value)} />
            <p className="text-xs text-muted-foreground">
              Bajo &quot;Copago fijo&quot; es la config completa. Bajo porcentaje, resta adicionalmente del lado asegurado.
            </p>
          </div>
          {coverageType === "PORCENTAJE_CON_TOPE" && (
            <div className="space-y-1.5">
              <Label htmlFor="cov-limit">Límite acumulado por liquidación</Label>
              <Input id="cov-limit" type="number" min={0} value={coverageLimit} onChange={(e) => setCoverageLimit(e.target.value)} />
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={upsertMutation.isPending}>
              {upsertMutation.isPending ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dialog: nueva regla (CoverageRule) a nivel de plan.
// ---------------------------------------------------------------------------

function NuevaReglaDialog({
  open,
  onOpenChange,
  planId,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  planId: string;
  onSuccess: () => void;
}) {
  const [ruleOn, setRuleOn] = React.useState<"CODIGO" | "CATEGORIA">("CODIGO");
  const [code, setCode] = React.useState("");
  const [serviceCategoryId, setServiceCategoryId] = React.useState("");
  const [ruleType, setRuleType] = React.useState<"PORCENTAJE" | "MONTO">("PORCENTAJE");
  const [percentage, setPercentage] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [fullCover, setFullCover] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setRuleOn("CODIGO");
    setCode("");
    setServiceCategoryId("");
    setRuleType("PORCENTAJE");
    setPercentage("");
    setAmount("");
    setFullCover(false);
    setError(null);
  }, [open]);

  const createMutation = trpc.insurance.rule.create.useMutation({
    onSuccess: () => {
      onOpenChange(false);
      onSuccess();
    },
    onError: (err) => setError(err.message ?? "Error al crear la regla."),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createMutation.mutate({
      planId,
      ruleOn,
      code: ruleOn === "CODIGO" ? code.trim() : undefined,
      serviceCategoryId: ruleOn === "CATEGORIA" ? serviceCategoryId.trim() : undefined,
      ruleType,
      percentage: !fullCover && ruleType === "PORCENTAJE" && percentage ? Number(percentage) : undefined,
      amount: !fullCover && ruleType === "MONTO" && amount ? Number(amount) : undefined,
      fullCover,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nueva regla de cobertura</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="rule-on">Aplica por</Label>
            <Select value={ruleOn} onValueChange={(v) => setRuleOn(v as "CODIGO" | "CATEGORIA")}>
              <SelectTrigger id="rule-on">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CODIGO">Código de tarifario</SelectItem>
                <SelectItem value="CATEGORIA">Categoría de servicio</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {ruleOn === "CODIGO" ? (
            <div className="space-y-1.5">
              <Label htmlFor="rule-code">Código</Label>
              <Input id="rule-code" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="rule-cat">Id de categoría (ServiceCategory)</Label>
              <Input id="rule-cat" value={serviceCategoryId} onChange={(e) => setServiceCategoryId(e.target.value)} />
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="rule-fullcover"
              type="checkbox"
              checked={fullCover}
              onChange={(e) => setFullCover(e.target.checked)}
            />
            <Label htmlFor="rule-fullcover">Cobertura al 100% (fullCover)</Label>
          </div>
          {!fullCover && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-type">Tipo</Label>
              <Select value={ruleType} onValueChange={(v) => setRuleType(v as "PORCENTAJE" | "MONTO")}>
                <SelectTrigger id="rule-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PORCENTAJE">Porcentaje cubierto</SelectItem>
                  <SelectItem value="MONTO">Monto cubierto</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {!fullCover && ruleType === "PORCENTAJE" && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-pct">%</Label>
              <Input id="rule-pct" type="number" min={0} max={100} value={percentage} onChange={(e) => setPercentage(e.target.value)} />
            </div>
          )}
          {!fullCover && ruleType === "MONTO" && (
            <div className="space-y-1.5">
              <Label htmlFor="rule-amount">Monto</Label>
              <Input id="rule-amount" type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
          )}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Guardando…" : "Crear regla"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function InsurancePlanDetailPage() {
  const params = useParams<{ id: string }>();
  const planId = params.id;

  const plansQuery = trpc.insurance.plan.list.useQuery({ activeOnly: false, limit: 200 });
  const plan = plansQuery.data?.find((p) => p.id === planId);

  const coverageQuery = trpc.insurance.planCoverage.list.useQuery({ planId });
  const rulesQuery = trpc.insurance.rule.list.useQuery({ planId, activeOnly: true, limit: 100 });

  const [ambitoDialog, setAmbitoDialog] = React.useState<Ambito | null>(null);
  const [reglaDialogOpen, setReglaDialogOpen] = React.useState(false);

  const configPorAmbito = new Map(
    (coverageQuery.data ?? []).map((c) => [c.ambito as Ambito, c]),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{plan ? plan.name : "Plan"}</h1>
          <p className="text-sm text-muted-foreground">
            {plan ? `${plan.code} · ${plan.insurer.name}` : "Cargando…"}
          </p>
        </div>
        <Button variant="outline" asChild>
          <Link href="/insurance/plans">Volver a planes</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cobertura por ámbito</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ámbito</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>%</TableHead>
                <TableHead>Copago</TableHead>
                <TableHead>Límite</TableHead>
                <TableHead className="w-24"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {AMBITOS.map((ambito) => {
                const cfg = configPorAmbito.get(ambito);
                return (
                  <TableRow key={ambito}>
                    <TableCell>{AMBITO_LABEL[ambito]}</TableCell>
                    <TableCell>{cfg ? COVERAGE_TYPE_LABEL[cfg.coverageType as CoverageType] : "— sin configurar —"}</TableCell>
                    <TableCell className="font-mono">{cfg?.insuredPercentage != null ? `${cfg.insuredPercentage}%` : "—"}</TableCell>
                    <TableCell className="font-mono">{cfg?.copayAmount != null ? formatCurrency(Number(cfg.copayAmount)) : "—"}</TableCell>
                    <TableCell className="font-mono">{cfg?.coverageLimit != null ? formatCurrency(Number(cfg.coverageLimit)) : "—"}</TableCell>
                    <TableCell>
                      <Button variant="outline" size="sm" onClick={() => setAmbitoDialog(ambito)}>
                        {cfg ? "Editar" : "Configurar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Reglas de reparto (Patient Share Rules)</CardTitle>
          <Button size="sm" onClick={() => setReglaDialogOpen(true)}>
            Nueva regla
          </Button>
        </CardHeader>
        <CardContent>
          {rulesQuery.data && rulesQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin reglas — aplica la config por ámbito.</p>
          )}
          {rulesQuery.data && rulesQuery.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Aplica por</TableHead>
                  <TableHead>Valor</TableHead>
                  <TableHead>Cobertura</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rulesQuery.data.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.ruleOn === "CODIGO" ? "Código" : "Categoría"}</TableCell>
                    <TableCell className="font-mono">{r.code ?? r.serviceCategoryId}</TableCell>
                    <TableCell>
                      {r.fullCover ? (
                        <Badge>100%</Badge>
                      ) : r.ruleType === "PORCENTAJE" ? (
                        `${r.percentage}%`
                      ) : (
                        formatCurrency(Number(r.amount))
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {ambitoDialog ? (
        <AmbitoConfigDialog
          open={ambitoDialog !== null}
          onOpenChange={(o) => setAmbitoDialog(o ? ambitoDialog : null)}
          planId={planId}
          ambito={ambitoDialog}
          actual={
            configPorAmbito.get(ambitoDialog)
              ? {
                  coverageType: configPorAmbito.get(ambitoDialog)!.coverageType as CoverageType,
                  insuredPercentage: configPorAmbito.get(ambitoDialog)!.insuredPercentage as number | null,
                  copayAmount: configPorAmbito.get(ambitoDialog)!.copayAmount as number | null,
                  coverageLimit: configPorAmbito.get(ambitoDialog)!.coverageLimit as number | null,
                }
              : null
          }
          onSuccess={() => void coverageQuery.refetch()}
        />
      ) : null}

      <NuevaReglaDialog
        open={reglaDialogOpen}
        onOpenChange={setReglaDialogOpen}
        planId={planId}
        onSuccess={() => void rulesQuery.refetch()}
      />
    </div>
  );
}
