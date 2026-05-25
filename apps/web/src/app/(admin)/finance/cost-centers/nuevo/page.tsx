"use client";

/**
 * Sprint UI Finance — /finance/cost-centers/nuevo
 * Formulario de creación de centro de costo.
 */
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Form, FormError, FormField, FormHint } from "@his/ui/components/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

type Tipo = "productivo" | "intermedio" | "apoyo";
type BaseDistribucion =
  | "m2"
  | "empleados"
  | "horas"
  | "pacientes_atendidos"
  | "kilos_lavados"
  | "consumo_electrico"
  | "porcentaje_fijo";

const CODE_REGEX = /^[123]-[A-Z0-9]{3}-[A-Z0-9]{3}$/;

const BASE_DIST_LABELS: Record<BaseDistribucion, string> = {
  m2: "Metros cuadrados (m²)",
  empleados: "Número de empleados",
  horas: "Horas trabajadas",
  pacientes_atendidos: "Pacientes atendidos",
  kilos_lavados: "Kilos lavados",
  consumo_electrico: "Consumo eléctrico (kWh)",
  porcentaje_fijo: "Porcentaje fijo",
};

export default function NuevoCostCenterPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const router = useRouter();
  const orgQuery = trpc.organization.current.useQuery();
  const org = orgQuery.data;

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [tipo, setTipo] = React.useState<Tipo | "">("");
  const [permiteImputacion, setPermiteImputacion] = React.useState(true);
  const [baseDistribucion, setBaseDistribucion] = React.useState<BaseDistribucion | "">("");
  const [centroResponsableMinsal, setCentroResponsableMinsal] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{
    title: string;
    description?: string;
    variant?: "default" | "success" | "destructive";
  } | null>(null);

  const createMutation = trpcAny.costCenter.create.useMutation({
    onSuccess: () => {
      setToast({ title: "Centro de costo creado", variant: "success" });
      setTimeout(() => router.push("/finance/cost-centers"), 1000);
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    const upperCode = code.toUpperCase();
    if (!upperCode) {
      fe.code = "El código es requerido.";
    } else if (!CODE_REGEX.test(upperCode)) {
      fe.code = "Formato inválido. Use T-AAA-SSS donde T ∈ {1,2,3} (ej. 1-CEX-GEN).";
    }
    if (!name.trim() || name.trim().length < 3) {
      fe.name = "Nombre mínimo 3 caracteres.";
    }
    if (!tipo) {
      fe.tipo = "Selecciona el tipo de centro.";
    }
    if (tipo === "apoyo" && !baseDistribucion) {
      fe.baseDistribucion = "Los centros de apoyo requieren base de distribución para prorrateo.";
    }
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;

    createMutation.mutate({
      code: code.toUpperCase(),
      name: name.trim(),
      tipo,
      permiteImputacion,
      ...(baseDistribucion ? { baseDistribucion } : {}),
      ...(centroResponsableMinsal.trim() ? { centroResponsableMinsal: centroResponsableMinsal.trim() } : {}),
    });
  };

  if (orgQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando organización…</p>;
  }

  if (!org) {
    return (
      <div className="space-y-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/finance/cost-centers">← Volver</Link>
        </Button>
        <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          Sin tenant activo. Selecciona una organización para crear centros de costo.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/finance/cost-centers">← Centros de Costo</Link>
      </Button>

      <div>
        <h1 className="text-2xl font-bold">Nuevo centro de costo</h1>
        <p className="text-sm text-muted-foreground">
          El código es inmutable una vez creado. Use el formato T-AAA-SSS.
        </p>
      </div>

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle className="text-base">
            {org.tradeName ?? org.legalName}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Form onSubmit={handleSubmit}>
            <FormField>
              <Label htmlFor="code">
                Código<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="code"
                placeholder="Ej. 1-CEX-GEN"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="font-mono uppercase"
                aria-invalid={Boolean(errors.code)}
              />
              <FormHint>
                Formato: T-AAA-SSS. T=1 productivo, T=2 intermedio, T=3 apoyo.
                Inmutable post-creación.
              </FormHint>
              <FormError>{errors.code}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="name">
                Nombre<span className="text-destructive"> *</span>
              </Label>
              <Input
                id="name"
                placeholder="Ej. Consulta externa general"
                value={name}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={Boolean(errors.name)}
              />
              <FormError>{errors.name}</FormError>
            </FormField>

            <FormField>
              <Label htmlFor="tipo">
                Tipo<span className="text-destructive"> *</span>
              </Label>
              <Select
                value={tipo || ""}
                onValueChange={(v) => setTipo(v as Tipo)}
              >
                <SelectTrigger aria-invalid={Boolean(errors.tipo)}>
                  <SelectValue placeholder="Selecciona tipo…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="productivo">Productivo — genera ingresos directos</SelectItem>
                  <SelectItem value="intermedio">Intermedio — apoyo diagnóstico/terapéutico</SelectItem>
                  <SelectItem value="apoyo">Apoyo — área administrativa, costo prorrateable</SelectItem>
                </SelectContent>
              </Select>
              <FormError>{errors.tipo}</FormError>
            </FormField>

            {tipo === "apoyo" ? (
              <FormField>
                <Label htmlFor="baseDistribucion">
                  Base de distribución<span className="text-destructive"> *</span>
                </Label>
                <Select
                  value={baseDistribucion || ""}
                  onValueChange={(v) => setBaseDistribucion(v as BaseDistribucion)}
                >
                  <SelectTrigger aria-invalid={Boolean(errors.baseDistribucion)}>
                    <SelectValue placeholder="Selecciona base…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(BASE_DIST_LABELS) as [BaseDistribucion, string][]).map(
                      ([val, label]) => (
                        <SelectItem key={val} value={val}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <FormHint>
                  Criterio de prorrateo hacia centros productivos e intermedios.
                </FormHint>
                <FormError>{errors.baseDistribucion}</FormError>
              </FormField>
            ) : null}

            <FormField>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={permiteImputacion}
                  onChange={(e) => setPermiteImputacion(e.target.checked)}
                  className="h-4 w-4 rounded border-input"
                />
                Permite imputación de transacciones
              </label>
              <FormHint>
                Desmarca si es un centro padre de consolidación (no nodo hoja).
              </FormHint>
            </FormField>

            <FormField>
              <Label htmlFor="minsal">Código MINSAL (opcional)</Label>
              <Input
                id="minsal"
                placeholder="Ej. MINSAL-UCC-001"
                value={centroResponsableMinsal}
                onChange={(e) => setCentroResponsableMinsal(e.target.value)}
                maxLength={40}
              />
              <FormHint>Código equivalente para reporte regulatorio MINSAL.</FormHint>
            </FormField>

            {serverError ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                {serverError}
              </p>
            ) : null}

            <div className="flex gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/finance/cost-centers")}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Creando…" : "Crear centro"}
              </Button>
            </div>
          </Form>
        </CardContent>
      </Card>

      {toast ? (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <div className="flex flex-col gap-1">
            <ToastTitle>{toast.title}</ToastTitle>
            {toast.description ? <ToastDescription>{toast.description}</ToastDescription> : null}
          </div>
        </Toast>
      ) : null}
    </div>
  );
}
