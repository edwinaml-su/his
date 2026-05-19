"use client";

/**
 * ECE — Registrar administracion de medicamento (eMAR/MAR).
 *
 * Formulario de enfermeria para registrar la administracion de un item
 * de indicacion medica. Si estado=OMITIDA o RECHAZADA, motivoOmision es
 * obligatorio (NTEC §3.6 — validado en Zod superRefine del router).
 *
 * Ruta: /ece/indicaciones/[id]/admin
 * Vuelve a /ece/indicaciones/[id] tras exito.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
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

type EstadoAdmin = "ADMINISTRADO" | "OMITIDA" | "RECHAZADA";

const ESTADOS: Array<{ value: EstadoAdmin; label: string }> = [
  { value: "ADMINISTRADO", label: "Administrado" },
  { value: "OMITIDA", label: "Omitida" },
  { value: "RECHAZADA", label: "Rechazada por paciente" },
];

export default function RegistrarAdminPage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [indicacionItemId, setIndicacionItemId] = React.useState("");
  const [registroEnfId, setRegistroEnfId] = React.useState("");
  const [horaAplicada, setHoraAplicada] = React.useState(
    new Date().toISOString().slice(0, 16),
  );
  const [estado, setEstado] = React.useState<EstadoAdmin>("ADMINISTRADO");
  const [motivoOmision, setMotivoOmision] = React.useState("");
  const [responsable, setResponsable] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [serverError, setServerError] = React.useState<string | null>(null);

  const registrarMutation = trpc.eceIndicaciones.registrarAdministracion.useMutation({
    onSuccess: () => router.push(`/ece/indicaciones/${params.id}`),
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const requiereMotivo = estado === "OMITIDA" || estado === "RECHAZADA";

  const validate = (): boolean => {
    const fe: Record<string, string> = {};
    if (!indicacionItemId.trim()) fe.indicacionItemId = "Item requerido.";
    if (!registroEnfId.trim()) fe.registroEnfId = "Registro de enfermeria requerido.";
    if (!horaAplicada) fe.horaAplicada = "Hora de aplicacion requerida.";
    if (!responsable.trim()) fe.responsable = "Responsable requerido.";
    if (requiereMotivo && motivoOmision.trim().length < 10)
      fe.motivoOmision = "Motivo debe tener al menos 10 caracteres (NTEC §3.6).";
    setErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setServerError(null);
    registrarMutation.mutate({
      indicacionItemId: indicacionItemId.trim(),
      registroEnfId: registroEnfId.trim(),
      horaAplicada: new Date(horaAplicada),
      estado,
      motivoOmision: requiereMotivo ? motivoOmision.trim() : undefined,
      responsable: responsable.trim(),
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Registrar administracion</h1>
        <p className="text-sm text-muted-foreground">
          Registro eMAR de enfermeria (NTEC §3.6).
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Datos de administracion</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="indicacionItemId">
                Item de indicacion <span className="text-destructive">*</span>
              </Label>
              <input
                id="indicacionItemId"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                value={indicacionItemId}
                onChange={(e) => setIndicacionItemId(e.target.value)}
                placeholder="UUID del item"
                aria-invalid={Boolean(errors.indicacionItemId)}
                data-testid="input-indicacion-item-id"
              />
              {errors.indicacionItemId ? (
                <p className="text-xs text-destructive">
                  {errors.indicacionItemId}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="registroEnfId">
                Registro de enfermeria <span className="text-destructive">*</span>
              </Label>
              <input
                id="registroEnfId"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                value={registroEnfId}
                onChange={(e) => setRegistroEnfId(e.target.value)}
                placeholder="UUID del registro de enfermeria"
                aria-invalid={Boolean(errors.registroEnfId)}
                data-testid="input-registro-enf-id"
              />
              {errors.registroEnfId ? (
                <p className="text-xs text-destructive">
                  {errors.registroEnfId}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="horaAplicada">
                Hora de aplicacion <span className="text-destructive">*</span>
              </Label>
              <input
                id="horaAplicada"
                type="datetime-local"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                value={horaAplicada}
                onChange={(e) => setHoraAplicada(e.target.value)}
                aria-invalid={Boolean(errors.horaAplicada)}
                data-testid="input-hora-aplicada"
              />
              {errors.horaAplicada ? (
                <p className="text-xs text-destructive">{errors.horaAplicada}</p>
              ) : null}
            </div>

            <div className="space-y-1">
              <Label htmlFor="estado">
                Estado <span className="text-destructive">*</span>
              </Label>
              <Select
                value={estado}
                onValueChange={(v) => setEstado(v as EstadoAdmin)}
              >
                <SelectTrigger id="estado">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="responsable">
                Responsable (UUID) <span className="text-destructive">*</span>
              </Label>
              <input
                id="responsable"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                value={responsable}
                onChange={(e) => setResponsable(e.target.value)}
                placeholder="UUID del personal responsable"
                aria-invalid={Boolean(errors.responsable)}
                data-testid="input-responsable"
              />
              {errors.responsable ? (
                <p className="text-xs text-destructive">{errors.responsable}</p>
              ) : null}
            </div>

            {requiereMotivo ? (
              <div className="space-y-1 md:col-span-2">
                <Label htmlFor="motivoOmision">
                  Motivo de omision/rechazo{" "}
                  <span className="text-destructive">*</span>
                  <span className="ml-1 text-xs font-normal text-muted-foreground">
                    (min. 10 caracteres — NTEC §3.6)
                  </span>
                </Label>
                <textarea
                  id="motivoOmision"
                  value={motivoOmision}
                  onChange={(e) => setMotivoOmision(e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-invalid:border-destructive"
                  placeholder="Describa el motivo de la omision o rechazo…"
                  aria-invalid={Boolean(errors.motivoOmision)}
                  data-testid="input-motivo-omision"
                />
                {errors.motivoOmision ? (
                  <p className="text-xs text-destructive">
                    {errors.motivoOmision}
                  </p>
                ) : null}
              </div>
            ) : null}
          </CardContent>
        </Card>

        {serverError ? (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          >
            {serverError}
          </p>
        ) : null}

        <div className="flex justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push(`/ece/indicaciones/${params.id}`)}
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            disabled={registrarMutation.isPending}
            data-testid="btn-registrar-admin"
          >
            {registrarMutation.isPending
              ? "Registrando…"
              : "Registrar administracion"}
          </Button>
        </div>
      </form>
    </div>
  );
}
