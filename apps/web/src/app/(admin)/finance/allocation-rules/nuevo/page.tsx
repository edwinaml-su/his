"use client";

/**
 * /finance/allocation-rules/nuevo — Crear nueva regla de prorrateo.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
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
  id: string; // key de React, no persistido
  targetCostCenterId: string;
  percentage: string; // string para el input
};

type CostCenter = { id: string; code: string; name: string };

function generateKey() {
  return Math.random().toString(36).slice(2);
}

export default function NuevaAllocationRulePage() {
  const router = useRouter();

  const [name, setName] = React.useState("");
  const [sourceCostCenterId, setSourceCostCenterId] = React.useState("");
  const [base, setBase] = React.useState("");
  const [periodicity, setPeriodicity] = React.useState("monthly");
  const [targets, setTargets] = React.useState<TargetItem[]>([
    { id: generateKey(), targetCostCenterId: "", percentage: "" },
  ]);
  const [serverError, setServerError] = React.useState<string | null>(null);

  // Centros de apoyo (solo tipo apoyo pueden ser source)
  const apoyoQuery = t.costCenter.list.useQuery({ tipo: "apoyo", activo: true });
  // Centros destino (productivo o intermedio)
  const prodQuery = t.costCenter.list.useQuery({ activo: true });

  const apoyo = (apoyoQuery.data ?? []) as CostCenter[];
  const allCenters = (prodQuery.data ?? []) as Array<CostCenter & { tipo: string | null }>;
  const destinos = allCenters.filter(
    (c) => c.tipo === "productivo" || c.tipo === "intermedio",
  );

  const create = t.allocationRule.create.useMutation({
    onSuccess: () => {
      router.push("/finance/allocation-rules");
    },
    onError: (err: { message: string }) => {
      setServerError(err.message);
    },
  });

  // Suma en vivo de porcentajes
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
    // Ajustar último para que la suma sea exactamente 100
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const targetsPayload = targets.map((t) => ({
      targetCostCenterId: t.targetCostCenterId,
      percentage: parseFloat(t.percentage),
    }));

    create.mutate({
      name: name.trim(),
      sourceCostCenterId,
      base,
      periodicity,
      targets: targetsPayload,
    });
  }

  const canSubmit =
    name.trim().length >= 3 &&
    sourceCostCenterId &&
    base &&
    targets.length > 0 &&
    targets.every((t) => t.targetCostCenterId && parseFloat(t.percentage) > 0) &&
    sumaOk &&
    !create.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/allocation-rules">Volver</Link>
        </Button>
        <h1 className="text-2xl font-bold">Nueva regla de prorrateo</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Datos generales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="name">Nombre de la regla</Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ej. Prorrateo Lavandería por kg"
                maxLength={120}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="source">Centro de costo origen (tipo apoyo)</Label>
              <Select value={sourceCostCenterId} onValueChange={setSourceCostCenterId}>
                <SelectTrigger id="source">
                  <SelectValue placeholder="Selecciona un centro de apoyo" />
                </SelectTrigger>
                <SelectContent>
                  {apoyo.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.code} — {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="base">Base de distribución</Label>
                <Select value={base} onValueChange={setBase}>
                  <SelectTrigger id="base">
                    <SelectValue placeholder="Selecciona una base" />
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
                  {idx === 0 ? (
                    <Label className="text-xs">Centro destino</Label>
                  ) : null}
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
                  {idx === 0 ? (
                    <Label className="text-xs">Porcentaje %</Label>
                  ) : null}
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
                  className="mb-0"
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
          <Button asChild variant="outline">
            <Link href="/finance/allocation-rules">Cancelar</Link>
          </Button>
          <Button type="submit" disabled={!canSubmit}>
            {create.isPending ? "Guardando…" : "Guardar regla"}
          </Button>
        </div>
      </form>
    </div>
  );
}
