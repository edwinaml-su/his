"use client";

/**
 * Formulario de digitación retroactiva de registros en papel (US.F2.7.27).
 *
 * Flujo:
 *   1. El usuario selecciona el período de contingencia que cubre el registro.
 *   2. Ingresa el episodio destino y el tipo de documento.
 *   3. El sistema verifica que timestamp_real_papel está dentro del período.
 *   4. Se marca el último registro sin marcar del episodio como retroactivo.
 *
 * El contenido del documento debe haberse ingresado previamente mediante el
 * formulario nativo (signos vitales, triaje, etc.).
 *
 * Badge amarillo "Capturado en contingencia" se muestra en listas de cada doc.
 * Roles: NURSE, PHYSICIAN, ARCH (backend valida).
 */
import * as React from "react";
import { trpc } from "@/lib/trpc/react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TipoDocumento =
  | "signos_vitales"
  | "hoja_triaje"
  | "indicaciones_medicas"
  | "evolucion_medica";

interface ContingenciaEvento {
  id: string;
  motivo: string;
  activado_en: string;
  desactivado_en?: string | null;
}

interface TrpcContingencia {
  eceContingencia: {
    list: {
      useQuery: (input?: {
        soloActivos?: boolean;
        limit?: number;
        offset?: number;
      }) => { data?: ContingenciaEvento[]; isLoading: boolean };
    };
    registrarRetroactivo: {
      useMutation: (opts?: {
        onSuccess?: (data: { ok: boolean; tabla: string }) => void;
        onError?: (e: { message: string }) => void;
      }) => {
        mutate: (input: {
          contingenciaEventoId: string;
          tipoDocumento: TipoDocumento;
          encounterId: string;
          contenido: Record<string, unknown>;
          timestampRealPapel: string;
        }) => void;
        isPending: boolean;
      };
    };
  };
}

const TIPOS_DOCUMENTO: { value: TipoDocumento; label: string }[] = [
  { value: "signos_vitales", label: "Signos Vitales" },
  { value: "hoja_triaje", label: "Hoja de Triaje" },
  { value: "indicaciones_medicas", label: "Indicaciones Médicas" },
  { value: "evolucion_medica", label: "Evolución Médica" },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RegistroRetroactivoPage() {
  const utils = (trpc as unknown as TrpcContingencia).eceContingencia;

  const eventosQuery = utils.list.useQuery({ soloActivos: false, limit: 20 });

  const [eventoId, setEventoId] = React.useState("");
  const [tipoDocumento, setTipoDocumento] = React.useState<TipoDocumento | "">("");
  const [encounterId, setEncounterId] = React.useState("");
  const [timestampRealPapel, setTimestampRealPapel] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  const registrar = utils.registrarRetroactivo.useMutation({
    onSuccess: (data) => {
      setSuccessMsg(`Registro marcado correctamente en tabla ${data.tabla}.`);
      setError(null);
      setEncounterId("");
      setTimestampRealPapel("");
    },
    onError: (e) => {
      setError(e.message);
      setSuccessMsg(null);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventoId || !tipoDocumento || !encounterId || !timestampRealPapel) {
      setError("Todos los campos son requeridos.");
      return;
    }
    registrar.mutate({
      contingenciaEventoId: eventoId,
      tipoDocumento: tipoDocumento as TipoDocumento,
      encounterId,
      contenido: {},
      timestampRealPapel: new Date(timestampRealPapel).toISOString(),
    });
  };

  const formatDate = (d: string) => new Date(d).toLocaleString("es-SV");

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">
          Digitación retroactiva — registros en papel
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Marca el último registro ingresado de un episodio como capturado durante contingencia.
          El registro debe haberse ingresado primero mediante el formulario nativo.
        </p>
      </div>

      <Badge
        variant="outline"
        className="border-amber-400 text-amber-700 bg-amber-50"
      >
        Capturado en contingencia
      </Badge>
      <p className="text-xs text-muted-foreground -mt-4">
        Este badge aparecerá en las listas del documento marcado.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Marcar registro retroactivo</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Período de contingencia */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Período de contingencia *
              </label>
              <Select value={eventoId} onValueChange={setEventoId}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona el período..." />
                </SelectTrigger>
                <SelectContent>
                  {eventosQuery.data?.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>
                      {formatDate(ev.activado_en)} —{" "}
                      {ev.desactivado_en ? formatDate(ev.desactivado_en) : "Activo"}
                      {" · "}
                      {ev.motivo.slice(0, 40)}
                      {ev.motivo.length > 40 ? "…" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tipo de documento */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Tipo de documento *
              </label>
              <Select
                value={tipoDocumento}
                onValueChange={(v) => setTipoDocumento(v as TipoDocumento)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_DOCUMENTO.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Episodio ID */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                ID del episodio (UUID) *
              </label>
              <Input
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={encounterId}
                onChange={(e) => setEncounterId(e.target.value)}
                className="font-mono text-sm"
              />
            </div>

            {/* Timestamp real */}
            <div>
              <label className="text-sm font-medium mb-1 block">
                Fecha y hora real del registro en papel *
              </label>
              <Input
                type="datetime-local"
                value={timestampRealPapel}
                onChange={(e) => setTimestampRealPapel(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Debe estar dentro del período de contingencia seleccionado.
              </p>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            {successMsg && (
              <p className="text-sm text-green-700">{successMsg}</p>
            )}

            <Button type="submit" disabled={registrar.isPending}>
              {registrar.isPending
                ? "Marcando registro..."
                : "Marcar como retroactivo"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
