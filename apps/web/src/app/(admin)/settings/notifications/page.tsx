"use client";

/**
 * Beta.15 (US.B15.3.3) — Página de preferencias de notificaciones.
 *
 * Permite al usuario configurar qué canales recibe por severidad.
 * Si no hay preferencia explícita, muestra el default heredado del rol.
 *
 * AC:
 *  - CRITICAL no se puede deshabilitar — toggle forzado a true con aviso.
 *  - "Restablecer a defaults del rol" elimina todos los overrides.
 *  - Canales futuros (PUSH, SMS) visibles como disabled-placeholder.
 *
 * A11y: WCAG 2.2 AA — roles switch, labels asociados, focus ring visible.
 */
import * as React from "react";
import { Settings2, RotateCcw } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Switch } from "@his/ui/components/switch";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

type Severity = "CRITICAL" | "WARNING" | "INFO";
type Channel = "EMAIL" | "INBOX";

const SEVERITIES: Severity[] = ["CRITICAL", "WARNING", "INFO"];
const ACTIVE_CHANNELS: Channel[] = ["EMAIL", "INBOX"];

const SEVERITY_LABEL: Record<Severity, string> = {
  CRITICAL: "Crítica",
  WARNING: "Advertencia",
  INFO: "Informativa",
};

const SEVERITY_VARIANT: Record<Severity, "critical" | "warning" | "info"> = {
  CRITICAL: "critical",
  WARNING: "warning",
  INFO: "info",
};

const CHANNEL_LABEL: Record<string, string> = {
  EMAIL: "Correo electrónico",
  INBOX: "Bandeja (in-app)",
  PUSH: "Push (próximamente)",
  SMS: "SMS (próximamente)",
};

export default function NotificationSettingsPage() {
  const utils = trpc.useUtils();

  const { data, isLoading, error } = trpc.notifications.getPreferences.useQuery();

  const setPreference = trpc.notifications.setPreferences.useMutation({
    onSuccess: () => utils.notifications.getPreferences.invalidate(),
  });

  const resetPreferences = trpc.notifications.resetPreferences.useMutation({
    onSuccess: () => utils.notifications.getPreferences.invalidate(),
  });

  /**
   * Obtiene el estado habilitado para una combinación severidad/canal.
   * Si no hay datos aún, devuelve false para evitar flash de estado incorrecto.
   */
  function getEnabled(severity: Severity, channel: Channel): boolean {
    if (!data) return false;
    const pref = data.preferences.find(
      (p) => p.severity === severity && p.channel === channel,
    );
    return pref?.enabled ?? false;
  }

  function isOverride(severity: Severity, channel: Channel): boolean {
    if (!data) return false;
    return (
      data.preferences.find(
        (p) => p.severity === severity && p.channel === channel,
      )?.isUserOverride ?? false
    );
  }

  function handleToggle(severity: Severity, channel: Channel, checked: boolean) {
    // CRITICAL no se puede deshabilitar — UI fuerza el toggle a true.
    if (severity === "CRITICAL" && !checked) {
      return;
    }
    setPreference.mutate({ severity, channel, enabled: checked });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Preferencias de notificaciones</h1>
          <p className="text-sm text-muted-foreground">
            Configura qué canales recibes para cada nivel de alerta clínica.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={resetPreferences.isPending || isLoading}
          onClick={() => resetPreferences.mutate()}
          aria-label="Restablecer preferencias a los valores por defecto del rol"
        >
          <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
          Restablecer defaults
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}

      {isLoading && (
        <p className="text-sm text-muted-foreground">Cargando preferencias…</p>
      )}

      {!isLoading && (
        <div className="space-y-4">
          {SEVERITIES.map((severity) => (
            <Card key={severity}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Badge variant={SEVERITY_VARIANT[severity]}>
                    {SEVERITY_LABEL[severity]}
                  </Badge>
                  {severity === "CRITICAL" && (
                    <span className="text-xs text-muted-foreground font-normal">
                      Las alertas críticas no se pueden desactivar por política de cumplimiento.
                    </span>
                  )}
                </CardTitle>
                <CardDescription>
                  Selecciona los canales por los que recibirás alertas de severidad{" "}
                  <strong>{SEVERITY_LABEL[severity].toLowerCase()}</strong>.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  {/* Canales activos */}
                  {ACTIVE_CHANNELS.map((channel) => {
                    const enabled = getEnabled(severity, channel);
                    const override = isOverride(severity, channel);
                    const isCritical = severity === "CRITICAL";
                    const switchId = `pref-${severity}-${channel}`;

                    return (
                      <div
                        key={channel}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="space-y-0.5">
                          <Label
                            htmlFor={switchId}
                            className="text-sm font-medium cursor-pointer"
                          >
                            {CHANNEL_LABEL[channel]}
                          </Label>
                          <p className="text-xs text-muted-foreground">
                            {override ? "Personalizado" : "Heredado del rol"}
                          </p>
                        </div>
                        <Switch
                          id={switchId}
                          checked={enabled}
                          disabled={
                            isCritical ||
                            setPreference.isPending ||
                            resetPreferences.isPending
                          }
                          onCheckedChange={(checked) =>
                            handleToggle(severity, channel, checked)
                          }
                          aria-label={`${CHANNEL_LABEL[channel]} para alertas ${SEVERITY_LABEL[severity]}`}
                        />
                      </div>
                    );
                  })}

                  {/* Canales futuros — placeholder accesible */}
                  {(["PUSH", "SMS"] as const).map((channel) => (
                    <div
                      key={channel}
                      className="flex items-center justify-between rounded-lg border border-dashed p-3 opacity-50"
                      aria-hidden="true"
                    >
                      <div className="space-y-0.5">
                        <span className="text-sm font-medium">
                          {CHANNEL_LABEL[channel]}
                        </span>
                        <p className="text-xs text-muted-foreground">
                          No disponible aún
                        </p>
                      </div>
                      <Switch disabled checked={false} tabIndex={-1} />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-lg border bg-muted/50 p-4">
        <Settings2 className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm text-muted-foreground">
          Los cambios se aplican de forma inmediata. Usa{" "}
          <strong>Restablecer defaults</strong> para volver a la configuración
          predeterminada de tu rol.
        </p>
      </div>
    </div>
  );
}
