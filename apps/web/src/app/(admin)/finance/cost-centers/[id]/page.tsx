"use client";

/**
 * Sprint UI Finance — /finance/cost-centers/[id]
 * Detalle + formulario de edición. El campo `code` es readonly (inmutable, spec §6).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
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

const TIPO_LABEL: Record<Tipo, string> = {
  productivo: "Productivo",
  intermedio: "Intermedio",
  apoyo: "Apoyo",
};

const TIPO_VARIANT: Record<Tipo, "success" | "info" | "warning"> = {
  productivo: "success",
  intermedio: "info",
  apoyo: "warning",
};

const BASE_DIST_LABELS: Record<BaseDistribucion, string> = {
  m2: "Metros cuadrados (m²)",
  empleados: "Número de empleados",
  horas: "Horas trabajadas",
  pacientes_atendidos: "Pacientes atendidos",
  kilos_lavados: "Kilos lavados",
  consumo_electrico: "Consumo eléctrico (kWh)",
  porcentaje_fijo: "Porcentaje fijo",
};

type CostCenterDetail = {
  id: string;
  code: string;
  name: string;
  active: boolean;
  organizationId: string;
  parentId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  tipo: string | null;
  permite_imputacion: boolean | null;
  responsable_id: string | null;
  base_distribucion: string | null;
  centro_responsable_minsal: string | null;
  cuenta_ingreso_default_id: string | null;
  cuenta_gasto_default_id: string | null;
};

export default function CostCenterDetailPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const params = useParams<{ id: string }>();
  const id = params.id;

  const query = trpcAny.costCenter.get.useQuery({ id }, { enabled: Boolean(id) });
  const center = query.data as CostCenterDetail | undefined;

  const utils = trpc.useUtils();

  const [name, setName] = React.useState("");
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

  // Sync form cuando lleguen los datos
  React.useEffect(() => {
    if (center) {
      setName(center.name);
      setPermiteImputacion(center.permite_imputacion !== false);
      setBaseDistribucion((center.base_distribucion as BaseDistribucion | null) ?? "");
      setCentroResponsableMinsal(center.centro_responsable_minsal ?? "");
    }
  }, [center]);

  const updateMutation = trpcAny.costCenter.update.useMutation({
    onSuccess: () => {
      utils.invalidate();
      setToast({ title: "Centro actualizado", variant: "success" });
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!name.trim() || name.trim().length < 3) {
      fe.name = "Nombre mínimo 3 caracteres.";
    }
    const tipo = center?.tipo as Tipo | null;
    if (tipo === "apoyo" && !baseDistribucion) {
      fe.baseDistribucion = "Los centros de apoyo requieren base de distribución.";
    }
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate() || !center) return;

    updateMutation.mutate({
      id: center.id,
      name: name.trim(),
      permiteImputacion,
      ...(baseDistribucion ? { baseDistribucion } : { baseDistribucion: null }),
      centroResponsableMinsal: centroResponsableMinsal.trim() || null,
    });
  };

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando centro…</p>;
  }

  if (query.error || !center) {
    return (
      <div className="space-y-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/finance/cost-centers">← Volver</Link>
        </Button>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ?? "Centro no encontrado."}
        </p>
      </div>
    );
  }

  const tipo = (center.tipo ?? "productivo") as Tipo;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/finance/cost-centers">← Centros de Costo</Link>
          </Button>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            <span className="font-mono">{center.code}</span>
            {center.active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant={TIPO_VARIANT[tipo]}>{TIPO_LABEL[tipo]}</Badge>
            <span>·</span>
            <span>{center.name}</span>
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Panel información */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Información general</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-3 text-sm">
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Código</dt>
                <dd className="font-mono font-medium">{center.code}</dd>
                <dd className="text-xs text-muted-foreground">Inmutable post-creación (spec §6)</dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Tipo</dt>
                <dd>
                  <Badge variant={TIPO_VARIANT[tipo]}>{TIPO_LABEL[tipo]}</Badge>
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Permite imputación</dt>
                <dd>{center.permite_imputacion !== false ? "Sí" : "No (solo consolidación)"}</dd>
              </div>
              {center.base_distribucion ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Base de distribución</dt>
                  <dd>
                    {BASE_DIST_LABELS[center.base_distribucion as BaseDistribucion] ??
                      center.base_distribucion}
                  </dd>
                </div>
              ) : null}
              {center.centro_responsable_minsal ? (
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Código MINSAL</dt>
                  <dd className="font-mono text-xs">{center.centro_responsable_minsal}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs font-medium text-muted-foreground">Creado</dt>
                <dd className="font-mono text-xs">
                  {new Date(center.createdAt).toISOString().slice(0, 10)}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        {/* Panel edición */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Editar</CardTitle>
          </CardHeader>
          <CardContent>
            <Form onSubmit={handleSubmit}>
              <FormField>
                <Label htmlFor="code-readonly">Código</Label>
                <Input
                  id="code-readonly"
                  value={center.code}
                  disabled
                  readOnly
                  className="font-mono"
                />
                <FormHint>El código no puede modificarse (spec §6).</FormHint>
              </FormField>

              <FormField>
                <Label htmlFor="name">
                  Nombre<span className="text-destructive"> *</span>
                </Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  aria-invalid={Boolean(errors.name)}
                />
                <FormError>{errors.name}</FormError>
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
              </FormField>

              <FormField>
                <Label htmlFor="minsal">Código MINSAL</Label>
                <Input
                  id="minsal"
                  value={centroResponsableMinsal}
                  onChange={(e) => setCentroResponsableMinsal(e.target.value)}
                  maxLength={40}
                  placeholder="Opcional"
                />
              </FormField>

              {serverError ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                  {serverError}
                </p>
              ) : null}

              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? "Guardando…" : "Guardar cambios"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>

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
