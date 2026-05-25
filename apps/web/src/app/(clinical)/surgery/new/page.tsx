"use client";

/**
 * §13 Surgery — Programar caso quirúrgico.
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

type AsaClass = "ASA_I" | "ASA_II" | "ASA_III" | "ASA_IV" | "ASA_V" | "ASA_VI";

const ASA_OPTIONS: { value: AsaClass | "NONE"; label: string }[] = [
  { value: "NONE", label: "Sin asignar" },
  { value: "ASA_I", label: "ASA I" },
  { value: "ASA_II", label: "ASA II" },
  { value: "ASA_III", label: "ASA III" },
  { value: "ASA_IV", label: "ASA IV" },
  { value: "ASA_V", label: "ASA V" },
  { value: "ASA_VI", label: "ASA VI" },
];

// Códigos quirúrgicos habilitados para imputación de SurgeryCase.
const SURGICAL_CC_CODES = ["1-QUI-MAY", "1-QUI-MEN", "1-PAR-SAL"] as const;

interface FormState {
  encounterId: string;
  establishmentId: string;
  patientId: string;
  primarySurgeonId: string;
  operatingRoomId: string;
  procedureDescription: string;
  scheduledStart: string;
  scheduledEnd: string;
  asaClass: AsaClass | "NONE";
  costCenterId: string;
}

const INITIAL: FormState = {
  encounterId: "",
  establishmentId: "",
  patientId: "",
  primarySurgeonId: "",
  operatingRoomId: "",
  procedureDescription: "",
  scheduledStart: "",
  scheduledEnd: "",
  asaClass: "NONE",
  costCenterId: "",
};

function validate(f: FormState): string | null {
  if (!f.encounterId.trim()) return "Encuentro es requerido.";
  if (!f.establishmentId.trim()) return "Establecimiento es requerido.";
  if (!f.patientId.trim()) return "Paciente es requerido.";
  if (!f.primarySurgeonId.trim()) return "Cirujano principal es requerido.";
  if (!f.procedureDescription.trim()) return "Descripción del procedimiento es requerida.";
  if (!f.scheduledStart || !f.scheduledEnd)
    return "Fechas programadas son requeridas.";
  const s = new Date(f.scheduledStart);
  const e = new Date(f.scheduledEnd);
  if (e <= s) return "Fin programado debe ser posterior al inicio.";
  return null;
}

export default function NewSurgeryCasePage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>(INITIAL);
  const [clientError, setClientError] = React.useState<string | null>(null);

  // Carga centros de costo activos y filtra a los 3 quirúrgicos.
  const { data: costCenters } = trpc.costCenter.list.useQuery(
    { activo: true },
    {
      select: (rows) =>
        rows.filter((cc: { code: string }) =>
          (SURGICAL_CC_CODES as ReadonlyArray<string>).includes(cc.code),
        ),
    },
  );

  // Pre-selecciona 1-QUI-MAY en cuanto cargan los cost centers.
  React.useEffect(() => {
    if (!costCenters || form.costCenterId) return;
    const defaultCc = costCenters.find((cc: { code: string }) => cc.code === "1-QUI-MAY");
    if (defaultCc) setForm((f) => ({ ...f, costCenterId: defaultCc.id }));
  }, [costCenters, form.costCenterId]);

  const create = trpc.surgery.case.create.useMutation({
    onSuccess: () => router.push("/surgery"),
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
      establishmentId: form.establishmentId.trim(),
      patientId: form.patientId.trim(),
      primarySurgeonId: form.primarySurgeonId.trim(),
      operatingRoomId: form.operatingRoomId.trim() || undefined,
      procedureDescription: form.procedureDescription.trim(),
      scheduledStart: new Date(form.scheduledStart),
      scheduledEnd: new Date(form.scheduledEnd),
      asaClass: form.asaClass === "NONE" ? undefined : form.asaClass,
      costCenterId: form.costCenterId || undefined,
    });
  }

  const errorMessage = clientError ?? create.error?.message ?? null;
  const isSubmitting = create.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Programar cirugía</h1>
        <p className="text-sm text-muted-foreground">Programa un caso quirúrgico (§13).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Datos del caso</CardTitle>
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
              <Label htmlFor="establishmentId">Establecimiento (UUID)</Label>
              <Input
                id="establishmentId"
                required
                value={form.establishmentId}
                onChange={(e) => update("establishmentId", e.target.value)}
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
              <Label htmlFor="primarySurgeonId">Cirujano principal (UUID)</Label>
              <Input
                id="primarySurgeonId"
                required
                value={form.primarySurgeonId}
                onChange={(e) => update("primarySurgeonId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="operatingRoomId">Quirófano (UUID, opcional)</Label>
              <Input
                id="operatingRoomId"
                value={form.operatingRoomId}
                onChange={(e) => update("operatingRoomId", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="costCenterId">Centro de costo</Label>
              <Select
                value={form.costCenterId}
                onValueChange={(v) => update("costCenterId", v)}
              >
                <SelectTrigger id="costCenterId">
                  <SelectValue placeholder="Seleccionar centro de costo" />
                </SelectTrigger>
                <SelectContent>
                  {(costCenters ?? []).map((cc: { id: string; code: string; name: string }) => (
                    <SelectItem key={cc.id} value={cc.id}>
                      {cc.code} — {cc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField>
              <Label htmlFor="procedureDescription">Descripción del procedimiento</Label>
              <Input
                id="procedureDescription"
                required
                value={form.procedureDescription}
                onChange={(e) => update("procedureDescription", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="scheduledStart">Inicio programado</Label>
              <Input
                id="scheduledStart"
                type="datetime-local"
                required
                value={form.scheduledStart}
                onChange={(e) => update("scheduledStart", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="scheduledEnd">Fin programado</Label>
              <Input
                id="scheduledEnd"
                type="datetime-local"
                required
                value={form.scheduledEnd}
                onChange={(e) => update("scheduledEnd", e.target.value)}
              />
            </FormField>
            <FormField>
              <Label htmlFor="asaClass">Clasificación ASA</Label>
              <Select
                value={form.asaClass}
                onValueChange={(v) => update("asaClass", v as AsaClass | "NONE")}
              >
                <SelectTrigger id="asaClass">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASA_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                {isSubmitting ? "Programando…" : "Programar cirugía"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
