"use client";

/**
 * §20 Services & Equipment — Detalle de equipo biomédico.
 * Extiende el legacy con sección "Identificación GS1" (GIAI + GLN).
 */
import * as React from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Componente stub — escaneo GS1 (reemplazable con lector HW real)
// ---------------------------------------------------------------------------
function Gs1Scanner({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="font-mono"
        />
        {/* Punto de extensión: integrar con lector de código de barras GS1 */}
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={`Escanear ${label}`}
          onClick={() => {
            /* stub: invocar API de cámara / lector HW */
          }}
        >
          Escanear
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página principal
// ---------------------------------------------------------------------------
export default function EquipmentDetailPage() {
  const params = useParams<{ id: string }>();
  const equipmentId = params.id;

  const equipmentQuery = trpc.servicesEquipment.equipment.get.useQuery({ id: equipmentId });

  const [giaiCode, setGiaiCode] = React.useState("");
  const [glnUbicacion, setGlnUbicacion] = React.useState("");
  const [bizStep, setBizStep] = React.useState("storing");
  const [giaiError, setGiaiError] = React.useState<string | null>(null);
  const [ubicError, setUbicError] = React.useState<string | null>(null);

  const utils = trpc.useUtils();

  const registrarGiai = trpc.servicesEquipment.equipment.registrarGiai.useMutation({
    onSuccess: () => {
      setGiaiCode("");
      setGiaiError(null);
      void utils.servicesEquipment.equipment.get.invalidate({ id: equipmentId });
    },
    onError: (e) => setGiaiError(e.message),
  });

  const actualizarUbicacion = trpc.servicesEquipment.equipment.actualizarUbicacion.useMutation({
    onSuccess: () => {
      setGlnUbicacion("");
      setUbicError(null);
      void utils.servicesEquipment.equipment.historialUbicaciones.invalidate({ equipmentId });
      void utils.servicesEquipment.equipment.get.invalidate({ id: equipmentId });
    },
    onError: (e) => setUbicError(e.message),
  });

  const historialQuery = trpc.servicesEquipment.equipment.historialUbicaciones.useQuery({
    equipmentId,
    limit: 20,
  });

  if (equipmentQuery.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando equipo…</p>;
  }
  if (equipmentQuery.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {equipmentQuery.error.message}
      </p>
    );
  }

  const equipment = equipmentQuery.data;
  if (!equipment) return null;

  // Los campos GS1 provienen de la BD pero Prisma aún no los tipifica
  // (columnas agregadas vía ALTER TABLE sin regenerar client).
  const equipmentRaw = equipment as Record<string, unknown>;

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div>
        <h1 className="text-2xl font-bold">{equipment.name}</h1>
        <p className="text-sm text-muted-foreground font-mono">{equipment.assetTag}</p>
      </div>

      {/* Info básica */}
      <Card>
        <CardHeader>
          <CardTitle>Información general</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <span>
            <strong>Fabricante:</strong> {equipment.manufacturer ?? "—"}
          </span>
          <span>
            <strong>Modelo:</strong> {equipment.model ?? "—"}
          </span>
          <span>
            <strong>N° serie:</strong> {equipment.serialNumber ?? "—"}
          </span>
          <span>
            <strong>Estado:</strong> {equipment.status}
          </span>
          <span>
            <strong>Criticidad:</strong> {equipment.criticality}
          </span>
          <span>
            <strong>Ubicación:</strong> {equipment.location ?? "—"}
          </span>
        </CardContent>
      </Card>

      {/* Identificación GS1 */}
      <Card>
        <CardHeader>
          <CardTitle>Identificación GS1</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* GIAI actual */}
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">
              <strong>GIAI actual:</strong>{" "}
              <span className="font-mono">
                {(equipmentRaw.giai_code as string | null) ?? "No asignado"}
              </span>
            </p>
            <p className="text-sm text-muted-foreground">
              <strong>GLN ubicación actual:</strong>{" "}
              <span className="font-mono">
                {(equipmentRaw.gln_ubicacion_actual as string | null) ?? "No asignado"}
              </span>
            </p>
          </div>

          {/* Registrar GIAI */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              registrarGiai.mutate({ equipmentId, giaiCode });
            }}
          >
            <Gs1Scanner
              label="Registrar GIAI (18 dígitos)"
              value={giaiCode}
              onChange={setGiaiCode}
              placeholder="000000000000000000"
            />
            {giaiError && (
              <p role="alert" className="text-sm text-destructive">
                {giaiError}
              </p>
            )}
            <Button type="submit" size="sm" disabled={registrarGiai.isPending || !giaiCode.trim()}>
              {registrarGiai.isPending ? "Guardando…" : "Registrar GIAI"}
            </Button>
          </form>

          {/* Actualizar ubicación */}
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              actualizarUbicacion.mutate({ equipmentId, glnUbicacion, bizStep });
            }}
          >
            <Gs1Scanner
              label="GLN nueva ubicación (13 dígitos)"
              value={glnUbicacion}
              onChange={setGlnUbicacion}
              placeholder="0000000000000"
            />
            <div className="space-y-1.5">
              <Label htmlFor="biz-step">bizStep EPCIS</Label>
              <Input
                id="biz-step"
                value={bizStep}
                onChange={(e) => setBizStep(e.target.value)}
                placeholder="storing"
                className="max-w-xs"
              />
            </div>
            {ubicError && (
              <p role="alert" className="text-sm text-destructive">
                {ubicError}
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={actualizarUbicacion.isPending || !glnUbicacion.trim()}
            >
              {actualizarUbicacion.isPending ? "Actualizando…" : "Actualizar ubicación"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Historial de ubicaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Historial de ubicaciones (EPCIS)</CardTitle>
        </CardHeader>
        <CardContent>
          {historialQuery.isLoading && (
            <p className="text-sm text-muted-foreground">Cargando historial…</p>
          )}
          {historialQuery.data && historialQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Sin eventos de ubicación registrados.</p>
          )}
          {historialQuery.data && historialQuery.data.length > 0 && (
            <ul className="divide-y text-sm">
              {historialQuery.data.map((ev) => (
                <li key={ev.id} className="py-2 flex gap-4">
                  <span className="text-muted-foreground w-40 shrink-0">
                    {new Date(ev.event_time).toLocaleString("es-SV")}
                  </span>
                  <span>
                    <span className="font-mono">{ev.gln_origen ?? "—"}</span>
                    {" → "}
                    <span className="font-mono font-medium">{ev.gln_destino ?? "—"}</span>
                  </span>
                  {ev.biz_step && (
                    <span className="text-muted-foreground italic">{ev.biz_step}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
