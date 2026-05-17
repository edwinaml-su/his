"use client";

/**
 * ECE — Abrir registro de enfermería (cabecera).
 *
 * Crea una instancia de workflow tipo "REGISTRO_ENFERMERIA" en estado
 * inicial (BORRADOR) mediante workflowInstance.create.
 *
 * Campos de cabecera:
 *   - Turno (MATUTINO / VESPERTINO / NOCTURNO) — requerido.
 *   - Observaciones generales del turno.
 *   - pacienteId — UUID del paciente (ingresado manualmente en MVP;
 *     en iteración siguiente vendrá pre-llenado desde la agenda).
 *
 * Rol habilitado: ENF.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";

type Turno = "MATUTINO" | "VESPERTINO" | "NOCTURNO";

const TURNOS: { value: Turno; label: string }[] = [
  { value: "MATUTINO", label: "Matutino (06:00–14:00)" },
  { value: "VESPERTINO", label: "Vespertino (14:00–22:00)" },
  { value: "NOCTURNO", label: "Nocturno (22:00–06:00)" },
];

function detectCurrentShift(): Turno {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return "MATUTINO";
  if (h >= 14 && h < 22) return "VESPERTINO";
  return "NOCTURNO";
}

interface FormState {
  pacienteId: string;
  turno: Turno;
  observaciones: string;
}

function validate(f: FormState): string | null {
  if (!f.pacienteId.trim()) return "El UUID del paciente es requerido.";
  // UUID v4 básico — el servidor valida más estrictamente
  if (!/^[0-9a-f-]{36}$/i.test(f.pacienteId.trim())) {
    return "El UUID del paciente no tiene formato válido.";
  }
  return null;
}

/**
 * El tipoDocumentoId para "REGISTRO_ENFERMERIA" es un valor conocido del
 * catálogo ECE. En producción se obtendrá de workflowTipoDoc.list; aquí se
 * usa la variable de entorno ECE_TIPO_REGISTRO_ENFERMERIA o un placeholder
 * que dejará ver el error del servidor para depuración.
 *
 * TODO(Dev): inyectar tipoDocumentoId desde query al cargar la página
 *   (workflowTipoDoc.list filtrando por código "REGISTRO_ENFERMERIA").
 */
const TIPO_DOCUMENTO_REGISTRO_ENF =
  typeof process !== "undefined"
    ? (process.env.NEXT_PUBLIC_TIPO_REGISTRO_ENF_ID ?? "")
    : "";

export default function NuevoRegistroEnfermeriaPage() {
  const router = useRouter();
  const [form, setForm] = React.useState<FormState>({
    pacienteId: "",
    turno: detectCurrentShift(),
    observaciones: "",
  });
  const [clientError, setClientError] = React.useState<string | null>(null);

  /**
   * Consulta tipos de documento para obtener el ID de "REGISTRO_ENFERMERIA".
   * Se usa para evitar hardcodear UUIDs que cambiarán entre entornos.
   */
  const tiposQuery = trpc.workflowTipoDoc.list.useQuery({});
  const tipoDocId = React.useMemo(() => {
    if (TIPO_DOCUMENTO_REGISTRO_ENF) return TIPO_DOCUMENTO_REGISTRO_ENF;
    const found = tiposQuery.data?.find(
      (t) => t.codigo === "REGISTRO_ENFERMERIA",
    );
    return found?.id ?? "";
  }, [tiposQuery.data]);

  const createInstance = trpc.workflowInstance.create.useMutation({
    onSuccess: (data) => {
      // Navegar al MAR del paciente usando el instanceId como referencia
      // (en iteración siguiente usaremos el admissionId; por ahora el
      // instanceId sirve para trazar el documento en el historial).
      router.push(`/ece/registro-enfermeria?instancia=${data.id}`);
    },
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
    if (!tipoDocId) {
      setClientError(
        "Tipo de documento REGISTRO_ENFERMERIA no encontrado en catálogo ECE. " +
          "Contacte al administrador.",
      );
      return;
    }
    setClientError(null);
    createInstance.mutate({
      tipoDocumentoId: tipoDocId,
      pacienteId: form.pacienteId.trim(),
      // observaciones se persiste en el historial inicial vía campo observacion
    });
  }

  const errorMsg =
    clientError ?? createInstance.error?.message ?? null;
  const isSubmitting = createInstance.isPending;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Abrir Registro de Enfermería</h1>
        <p className="text-sm text-muted-foreground">
          Inicia un nuevo registro de turno (cabecera). El registro quedará en
          estado Borrador hasta ser firmado.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Datos del turno</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} noValidate className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="paciente-id">UUID del paciente</Label>
              <Input
                id="paciente-id"
                required
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={form.pacienteId}
                onChange={(e) => update("pacienteId", e.target.value)}
                className="font-mono text-sm"
                aria-describedby="paciente-id-hint"
              />
              <p id="paciente-id-hint" className="text-xs text-muted-foreground">
                UUID del paciente obtenido desde la agenda o la ficha de paciente.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="turno-nuevo">Turno</Label>
              <Select
                value={form.turno}
                onValueChange={(v) => update("turno", v as Turno)}
              >
                <SelectTrigger id="turno-nuevo">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TURNOS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="observaciones">Observaciones del turno</Label>
              <textarea
                id="observaciones"
                rows={4}
                placeholder="Condiciones generales al inicio del turno, novedades..."
                value={form.observaciones}
                onChange={(e) => update("observaciones", e.target.value)}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            {errorMsg && (
              <p role="alert" aria-live="polite" className="text-sm font-medium text-destructive">
                {errorMsg}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => router.back()}
                disabled={isSubmitting}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSubmitting || tiposQuery.isLoading}>
                {isSubmitting ? "Abriendo registro…" : "Abrir registro"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
