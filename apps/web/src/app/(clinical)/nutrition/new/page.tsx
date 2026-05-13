"use client";

/**
 * §22 Nutrition — Crear plan dietético.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormField } from "@his/ui/components/form";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type DietType =
  | "REGULAR"
  | "SOFT"
  | "LIQUID_CLEAR"
  | "LIQUID_FULL"
  | "DIABETIC"
  | "LOW_SODIUM"
  | "RENAL"
  | "HYPOPROTEIC"
  | "HYPERPROTEIC"
  | "HYPOCALORIC"
  | "HIPERCALORIC"
  | "ENTERAL_ONLY"
  | "NPO"
  | "OTHER";

const DIET_OPTIONS: { value: DietType; label: string }[] = [
  { value: "REGULAR", label: "Regular" },
  { value: "SOFT", label: "Blanda" },
  { value: "LIQUID_CLEAR", label: "Líquida clara" },
  { value: "LIQUID_FULL", label: "Líquida completa" },
  { value: "DIABETIC", label: "Diabética" },
  { value: "LOW_SODIUM", label: "Baja en sodio" },
  { value: "RENAL", label: "Renal" },
  { value: "HYPOPROTEIC", label: "Hipoproteica" },
  { value: "HYPERPROTEIC", label: "Hiperproteica" },
  { value: "HYPOCALORIC", label: "Hipocalórica" },
  { value: "HIPERCALORIC", label: "Hipercalórica" },
  { value: "ENTERAL_ONLY", label: "Sólo enteral" },
  { value: "NPO", label: "NPO (nada por boca)" },
  { value: "OTHER", label: "Otra" },
];

interface FormState {
  encounterId: string;
  patientId: string;
  dietType: DietType;
  caloriesTarget: string;
  proteinTarget: string;
  notes: string;
}

const INITIAL: FormState = {
  encounterId: "",
  patientId: "",
  dietType: "REGULAR",
  caloriesTarget: "",
  proteinTarget: "",
  notes: "",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro requerido.";
  if (!f.patientId.trim()) return "Paciente requerido.";
  if (f.caloriesTarget.trim()) {
    const n = Number(f.caloriesTarget);
    if (Number.isNaN(n) || n < 0 || n > 10000) return "Calorías inválidas.";
  }
  if (f.proteinTarget.trim()) {
    const n = Number(f.proteinTarget);
    if (Number.isNaN(n) || n < 0) return "Proteína inválida.";
  }
  return null;
}

export default function NewDietPlanPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  const create = trpc.nutrition.diet.create.useMutation({
    onSuccess: () => router.push("/nutrition"),
  });

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validate(form);
    if (err) {
      setClientError(err);
      return;
    }
    setClientError(null);
    create.mutate({
      encounterId: form.encounterId.trim(),
      patientId: form.patientId.trim(),
      dietType: form.dietType,
      caloriesTarget: form.caloriesTarget.trim()
        ? Math.trunc(Number(form.caloriesTarget))
        : undefined,
      proteinTarget: form.proteinTarget.trim() ? Number(form.proteinTarget) : undefined,
      notes: form.notes.trim() || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Nuevo plan dietético</h1>
        <p className="text-sm text-muted-foreground">
          Asigna dieta al encuentro activo (§22).
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos del plan</CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={onSubmit} noValidate>
            <FormField>
              <Label htmlFor="encounterId">Encuentro (UUID)</Label>
              <Input
                id="encounterId"
                required
                value={form.encounterId}
                onChange={(e) => update("encounterId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="patientId">Paciente (UUID)</Label>
              <Input
                id="patientId"
                required
                value={form.patientId}
                onChange={(e) => update("patientId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="dietType">Tipo de dieta</Label>
              <Select
                value={form.dietType}
                onValueChange={(v) => update("dietType", v as DietType)}
              >
                <SelectTrigger id="dietType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DIET_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="caloriesTarget">Calorías objetivo (kcal/día)</Label>
              <Input
                id="caloriesTarget"
                type="number"
                min={0}
                max={10000}
                step={50}
                value={form.caloriesTarget}
                onChange={(e) => update("caloriesTarget", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="proteinTarget">Proteína objetivo (g/día)</Label>
              <Input
                id="proteinTarget"
                type="number"
                min={0}
                step="0.5"
                value={form.proteinTarget}
                onChange={(e) => update("proteinTarget", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="notes">Notas</Label>
              <Input
                id="notes"
                maxLength={4000}
                value={form.notes}
                onChange={(e) => update("notes", e.target.value)}
              />
            </FormField>
            {errorMessage && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {errorMessage}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => router.back()} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Guardando…" : "Crear plan"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
