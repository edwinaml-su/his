"use client";

/**
 * US.F2.7.44-45 — Portal: solicitud ARCO del paciente.
 *
 * El paciente puede:
 *   - Crear solicitud de RECTIFICACION o SUPRESION
 *   - Ver el historial de sus solicitudes con estado y respuesta del director
 *
 * URL: /solicitudes-arco (portal)
 */

import * as React from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";

type Tipo = "RECTIFICACION" | "SUPRESION";

function estadoBadge(estado: string) {
  const map: Record<string, string> = {
    PENDIENTE: "bg-amber-500",
    APROBADA: "bg-green-600",
    RECHAZADA: "bg-rose-600",
    EJECUTADA: "bg-blue-600",
  };
  return (
    <Badge className={`${map[estado] ?? "bg-gray-400"} text-white`}>{estado}</Badge>
  );
}

function NuevaSolicitudForm({ onSuccess }: { onSuccess: () => void }) {
  const [tipo, setTipo] = React.useState<Tipo>("RECTIFICACION");
  const [documentoTarget, setDocumentoTarget] = React.useState("");
  const [motivo, setMotivo] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const utils = trpc.useUtils();

  const crear = trpc.portalArco.crearSolicitud.useMutation({
    onSuccess: () => {
      setDocumentoTarget("");
      setMotivo("");
      setError(null);
      void utils.portalArco.listMisSolicitudes.invalidate();
      onSuccess();
    },
    onError: (err) => setError(err.message),
  });

  const canSubmit = motivo.trim().length >= 20 && !crear.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Nueva solicitud ARCO</CardTitle>
        <CardDescription>
          Derechos reconocidos por la Ley de Protección de Datos Personales Arts. 9 y 18.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <Label>Tipo de solicitud</Label>
          <div className="flex gap-3">
            <Button
              variant={tipo === "RECTIFICACION" ? "default" : "outline"}
              size="sm"
              onClick={() => setTipo("RECTIFICACION")}
            >
              Rectificación (corregir dato)
            </Button>
            <Button
              variant={tipo === "SUPRESION" ? "destructive" : "outline"}
              size="sm"
              onClick={() => setTipo("SUPRESION")}
            >
              Supresión (derecho al olvido)
            </Button>
          </div>
          {tipo === "SUPRESION" ? (
            <p className="text-xs text-muted-foreground">
              Nota: La NTEC limita la supresión de datos clínicos necesarios para la
              continuidad de su atención (Arts. 34-35). El director evaluará su caso.
            </p>
          ) : null}
        </div>

        <div className="space-y-1">
          <Label htmlFor="doc-target">Campo o documento afectado (opcional)</Label>
          <Input
            id="doc-target"
            value={documentoTarget}
            onChange={(e) => setDocumentoTarget(e.target.value)}
            placeholder="Ej.: Fecha de nacimiento, Historia clínica HC-2026-001"
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="motivo">Descripción del problema (≥20 caracteres)</Label>
          <textarea
            id="motivo"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            rows={5}
            placeholder={
              tipo === "RECTIFICACION"
                ? "Ej.: Mi fecha de nacimiento está incorrecta. La correcta es 15/03/1985 según mi DUI adjunto."
                : "Ej.: Solicito supresión de mis datos de contacto (teléfono/email) por cambio de residencia al extranjero."
            }
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {motivo.trim().length}/20 caracteres mínimos.
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button
          disabled={!canSubmit}
          onClick={() =>
            crear.mutate({
              tipo,
              documentoTarget: documentoTarget.trim() || undefined,
              motivo: motivo.trim(),
            })
          }
        >
          {crear.isPending ? "Enviando…" : "Enviar solicitud"}
        </Button>
      </CardContent>
    </Card>
  );
}

export default function SolicitudesArcoPage() {
  const [showForm, setShowForm] = React.useState(false);
  const mis = trpc.portalArco.listMisSolicitudes.useQuery({});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Mis solicitudes ARCO</h1>
          <p className="text-sm text-muted-foreground">
            Rectificación y supresión de datos personales en tu expediente clínico.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)} variant="outline" size="sm">
          {showForm ? "Ocultar formulario" : "Nueva solicitud"}
        </Button>
      </div>

      {showForm ? (
        <NuevaSolicitudForm onSuccess={() => setShowForm(false)} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Historial de solicitudes</CardTitle>
        </CardHeader>
        <CardContent>
          {mis.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : mis.error ? (
            <p className="text-sm text-destructive">{mis.error.message}</p>
          ) : !mis.data || mis.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tienes solicitudes registradas.</p>
          ) : (
            <div className="space-y-3">
              {mis.data.map((s) => (
                <div key={s.id} className="rounded-md border p-4 text-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{s.tipo}</span>
                      {estadoBadge(s.estado)}
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(s.creadoEn).toLocaleDateString("es-SV")}
                    </span>
                  </div>
                  {s.documentoTarget ? (
                    <p className="text-muted-foreground">
                      Documento: <span className="font-medium">{s.documentoTarget}</span>
                    </p>
                  ) : null}
                  <p className="text-muted-foreground">{s.motivo}</p>
                  {s.motivoRespuesta ? (
                    <div className="mt-2 rounded-md bg-muted p-2">
                      <p className="text-xs font-medium">Respuesta del director:</p>
                      <p className="text-xs text-muted-foreground">{s.motivoRespuesta}</p>
                      {s.fechaRespuesta ? (
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {new Date(s.fechaRespuesta).toLocaleDateString("es-SV")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
