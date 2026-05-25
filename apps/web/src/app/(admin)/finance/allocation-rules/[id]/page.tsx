"use client";

/**
 * /finance/allocation-rules/[id] — Detalle y edición de regla de prorrateo.
 */
import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Badge } from "@his/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const t = trpc as any;

const BASE_OPTIONS = [
  { value: "metros_cuadrados", label: "Metros cuadrados (m²)" },
  { value: "numero_empleados", label: "Número de empleados" },
  { value: "horas_trabajadas", label: "Horas trabajadas" },
  { value: "pacientes_atendidos", label: "Pacientes atendidos" },
  { value: "kilos_lavados", label: "Kilos lavados" },
  { value: "consumo_directo", label: "Consumo directo" },
  { value: "porcentaje_manual", label: "Porcentaje manual" },
];

type TargetItem = {
  id: string;
  targetCostCenterId: string;
  percentage: string;
};

type CostCenter = { id: string; code: string; name: string; tipo?: string | null };

function generateKey() {
  return Math.random().toString(36).slice(2);
}

export default function AllocationRuleDetailPage() {
  const params = useParams();
  const router = useRouter();
  const ruleId = params.id as string;

  const ruleQuery = t.allocationRule.get.useQuery({ id: ruleId });
  const prodQuery = t.costCenter.list.useQuery({ activo: true });

  const utils = trpc.useUtils();

  const [editing, setEditing] = React.useState(false);
  const [name, setName] = React.useState("");
  const [base, setBase] = React.useState("");
  const [periodicity, setPeriodicity] = React.useState("monthly");
  const [targets, setTargets] = React.useState<TargetItem[]>([]);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const rule = ruleQuery.data as
    | {
        id: string;
        name: string;
        sourceCode: string;
        sourceName: string;
        base: string;
        periodicity: string;
        active: boolean;
        targets: Array<{ id: string; targetCostCenterId: string; targetCode: string; targetName: string; percentage: number }>;
      }
    | undefined;

  // Cuando carga la regla, inicializar estado de edición
  React.useEffect(() => {
    if (!rule) return;
    setName(rule.name);
    setBase(rule.base);
    setPeriodicity(rule.periodicity);
    setTargets(
      rule.targets.map((t) => ({
        id: generateKey(),
        targetCostCenterId: t.targetCostCenterId,
        percentage: t.percentage.toFixed(2),
      })),
    );
  }, [rule]);

  const allCenters = (prodQuery.data ?? []) as CostCenter[];
  const destinos = allCenters.filter(
    (c) => c.tipo === "productivo" || c.tipo === "intermedio",
  );

  const update = t.allocationRule.update.useMutation({
    onSuccess: () => {
      void utils.allocationRule.get.invalidate({ id: ruleId });
      setEditing(false);
      setServerError(null);
    },
    onError: (err: { message: string }) => {
      setServerError(err.message);
    },
  });

  const deactivate = t.allocationRule.deactivate.useMutation({
    onSuccess: () => {
      router.push("/finance/allocation-rules");
    },
  });

  const sumaActual = targets.reduce((s, t) => s + (parseFloat(t.percentage) || 0), 0);
  const sumaOk = Math.abs(sumaActual - 100) < 0.01;

  function addTarget() {
    setTargets((prev) => [...prev, { id: generateKey(), targetCostCenterId: "", percentage: "" }]);
  }

  function removeTarget(key: string) {
    setTargets((prev) => prev.filter((t) => t.id !== key));
  }

  function updateTarget(key: string, field: "targetCostCenterId" | "percentage", value: string) {
    setTargets((prev) =>
      prev.map((t) => (t.id === key ? { ...t, [field]: value } : t)),
    );
  }

  function distribuirIgual() {
    if (!targets.length) return;
    const pct = (100 / targets.length).toFixed(2);
    const base = parseFloat(pct);
    const total = base * (targets.length - 1);
    const last = (100 - total).toFixed(2);
    setTargets((prev) =>
      prev.map((t, i) => ({
        ...t,
        percentage: i === prev.length - 1 ? last : pct,
      })),
    );
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    update.mutate({
      id: ruleId,
      name: name.trim(),
      base,
      periodicity,
      targets: targets.map((t) => ({
        targetCostCenterId: t.targetCostCenterId,
        percentage: parseFloat(t.percentage),
      })),
    });
  }

  function cancelEdit() {
    if (!rule) return;
    setName(rule.name);
    setBase(rule.base);
    setPeriodicity(rule.periodicity);
    setTargets(
      rule.targets.map((t) => ({
        id: generateKey(),
        targetCostCenterId: t.targetCostCenterId,
        percentage: t.percentage.toFixed(2),
      })),
    );
    setEditing(false);
    setServerError(null);
  }

  const canSave =
    name.trim().length >= 3 &&
    base &&
    targets.length > 0 &&
    targets.every((t) => t.targetCostCenterId && parseFloat(t.percentage) > 0) &&
    sumaOk &&
    !update.isPending;

  if (ruleQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando regla…</p>;
  }

  if (!rule) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
        Regla no encontrada.
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/allocation-rules">Volver</Link>
        </Button>
        <h1 className="text-2xl font-bold">{rule.name}</h1>
        {rule.active ? (
          <Badge variant="success">Activa</Badge>
        ) : (
          <Badge variant="outline">Inactiva</Badge>
        )}
      </div>

      {!editing ? (
        <>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Datos generales</CardTitle>
                {rule.active ? (
                  <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                    Editar
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <dt className="font-medium text-muted-foreground">Centro origen</dt>
                <dd className="font-mono">
                  {rule.sourceCode}{" "}
                  <span className="font-sans text-muted-foreground">{rule.sourceName}</span>
                </dd>
                <dt className="font-medium text-muted-foreground">Base distribución</dt>
                <dd>
                  {BASE_OPTIONS.find((o) => o.value === rule.base)?.label ?? rule.base}
                </dd>
                <dt className="font-medium text-muted-foreground">Periodicidad</dt>
                <dd>{rule.periodicity === "monthly" ? "Mensual" : "Trimestral"}</dd>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Centros destino ({rule.targets.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 font-medium">Centro</th>
                    <th className="pb-2 text-right font-medium">%</th>
                  </tr>
                </thead>
                <tbody>
                  {rule.targets.map((t) => (
                    <tr key={t.id} className="border-b last:border-0">
                      <td className="py-2">
                        <span className="font-mono text-xs">{t.targetCode}</span>{" "}
                        <span className="text-muted-foreground">{t.targetName}</span>
                      </td>
                      <td className="py-2 text-right font-medium">
                        {t.percentage.toFixed(2)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="pt-2 font-medium">Total</td>
                    <td className="pt-2 text-right font-medium text-green-600">
                      {rule.targets.reduce((s, t) => s + t.percentage, 0).toFixed(2)}%
                    </td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>

          {rule.active ? (
            <div className="flex justify-end">
              <Button
                variant="destructive"
                size="sm"
                disabled={deactivate.isPending}
                onClick={() => deactivate.mutate({ id: ruleId })}
              >
                {deactivate.isPending ? "Desactivando…" : "Desactivar regla"}
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Editar regla</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="name">Nombre</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="base">Base distribución</Label>
                  <Select value={base} onValueChange={setBase}>
                    <SelectTrigger id="base">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {BASE_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="periodicity">Periodicidad</Label>
                  <Select value={periodicity} onValueChange={setPeriodicity}>
                    <SelectTrigger id="periodicity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="monthly">Mensual</SelectItem>
                      <SelectItem value="quarterly">Trimestral</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Centros destino</CardTitle>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-medium ${sumaOk ? "text-green-600" : "text-red-600"}`}
                  >
                    Suma: {sumaActual.toFixed(2)}%{sumaOk ? " ✓" : " (debe ser 100%)"}
                  </span>
                  <Button type="button" size="sm" variant="outline" onClick={distribuirIgual}>
                    Distribuir igualmente
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={addTarget}>
                    + Agregar
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {targets.map((target, idx) => (
                <div key={target.id} className="flex items-end gap-2">
                  <div className="flex-1 space-y-1">
                    {idx === 0 ? <Label className="text-xs">Centro destino</Label> : null}
                    <Select
                      value={target.targetCostCenterId}
                      onValueChange={(v) => updateTarget(target.id, "targetCostCenterId", v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Selecciona centro destino" />
                      </SelectTrigger>
                      <SelectContent>
                        {destinos.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.code} — {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 space-y-1">
                    {idx === 0 ? <Label className="text-xs">Porcentaje %</Label> : null}
                    <Input
                      type="number"
                      min={0.01}
                      max={100}
                      step={0.01}
                      value={target.percentage}
                      onChange={(e) => updateTarget(target.id, "percentage", e.target.value)}
                      placeholder="0.00"
                    />
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={targets.length <= 1}
                    onClick={() => removeTarget(target.id)}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {serverError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {serverError}
            </p>
          ) : null}

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={cancelEdit}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!canSave}>
              {update.isPending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
