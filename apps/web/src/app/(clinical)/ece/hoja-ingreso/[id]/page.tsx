"use client";

/**
 * ECE — Detalle Hoja de Ingreso Hospitalario (Doc 12 NTEC §3.12).
 *
 * Muestra datos del ingreso + badges workflow.
 * Acciones contextuales por rol:
 *   ADM  → firmar (borrador / en_revision)
 *   ARCH → validar (firmado)
 *   DIR  → anular (cualquier estado pre-validado)
 */
import * as React from "react";
import { use } from "react";
import { ClipboardList, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";
import type { EstadoHojaIngreso } from "@his/contracts/src/schemas/ece-hoja-ingreso";

// ─── Presentación de estados ──────────────────────────────────────────────────

const ESTADO_LABEL: Record<EstadoHojaIngreso, string> = {
  borrador: "Borrador",
  en_revision: "En revisión",
  firmado: "Firmado",
  validado: "Validado",
  anulado: "Anulado",
};

const ESTADO_VARIANT: Record<
  EstadoHojaIngreso,
  "default" | "secondary" | "destructive" | "outline"
> = {
  borrador: "outline",
  en_revision: "secondary",
  firmado: "secondary",
  validado: "default",
  anulado: "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "short",
});

// ─── Pasos del workflow visual ─────────────────────────────────────────────────

const WORKFLOW_PASOS: Array<{ estado: EstadoHojaIngreso; label: string }> = [
  { estado: "borrador", label: "Borrador" },
  { estado: "en_revision", label: "En revisión" },
  { estado: "firmado", label: "Firmado ADM" },
  { estado: "validado", label: "Validado ARCH" },
];

const ORDEN_ESTADO: Record<EstadoHojaIngreso, number> = {
  borrador: 0,
  en_revision: 1,
  firmado: 2,
  validado: 3,
  anulado: -1,
};

function WorkflowBadges({ estadoActual }: { estadoActual: EstadoHojaIngreso }) {
  if (estadoActual === "anulado") {
    return (
      <div className="flex items-center gap-2 text-destructive">
        <XCircle className="h-5 w-5" aria-hidden />
        <span className="font-medium">Anulado</span>
      </div>
    );
  }

  const ordenActual = ORDEN_ESTADO[estadoActual];

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {WORKFLOW_PASOS.map((paso, i) => {
        const done = i < ordenActual;
        const active = i === ordenActual;
        return (
          <React.Fragment key={paso.estado}>
            <div className="flex items-center gap-1">
              {done ? (
                <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />
              ) : active ? (
                <Clock className="h-4 w-4 text-amber-500" aria-hidden />
              ) : (
                <div className="h-4 w-4 rounded-full border-2 border-muted" aria-hidden />
              )}
              <span
                className={
                  active
                    ? "text-sm font-semibold text-foreground"
                    : done
                    ? "text-sm text-primary"
                    : "text-sm text-muted-foreground"
                }
              >
                {paso.label}
              </span>
            </div>
            {i < WORKFLOW_PASOS.length - 1 && (
              <span className="text-muted-foreground" aria-hidden>›</span>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function HojaIngresoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const query = trpc.eceHojaIngreso.get.useQuery({ id });
  const utils = trpc.useUtils();

  // ── Estado de diálogos de acción ──────────────────────────────────────────
  const [firmarOpen, setFirmarOpen] = React.useState(false);
  const [validarOpen, setValidarOpen] = React.useState(false);
  const [anularOpen, setAnularOpen] = React.useState(false);

  const [pin, setPin] = React.useState("");
  const [observacion, setObservacion] = React.useState("");
  const [motivoAnulacion, setMotivoAnulacion] = React.useState("");

  const firmarMutation = trpc.eceHojaIngreso.firmar.useMutation({
    onSuccess: () => {
      void utils.eceHojaIngreso.get.invalidate({ id });
      setFirmarOpen(false);
      setPin("");
    },
  });

  const validarMutation = trpc.eceHojaIngreso.validar.useMutation({
    onSuccess: () => {
      void utils.eceHojaIngreso.get.invalidate({ id });
      setValidarOpen(false);
      setObservacion("");
    },
  });

  const anularMutation = trpc.eceHojaIngreso.anular.useMutation({
    onSuccess: () => {
      void utils.eceHojaIngreso.get.invalidate({ id });
      setAnularOpen(false);
      setMotivoAnulacion("");
    },
  });

  // ── Render de estados de carga ────────────────────────────────────────────
  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando…</p>;
  }
  if (query.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  }
  if (!query.data) return null;

  const hoja = query.data;
  const estado = hoja.estado_codigo;

  const puedeAnular =
    estado !== "validado" && estado !== "anulado";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <ClipboardList className="h-6 w-6" aria-hidden />
            Hoja de Ingreso
          </h1>
          <p className="font-mono text-xs text-muted-foreground">{hoja.id}</p>
        </div>
        <Badge variant={ESTADO_VARIANT[estado]}>{ESTADO_LABEL[estado]}</Badge>
      </div>

      {/* Workflow visual */}
      <Card>
        <CardHeader>
          <CardTitle>Estado del documento</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowBadges estadoActual={estado} />
        </CardContent>
      </Card>

      {/* Datos del ingreso */}
      <Card>
        <CardHeader>
          <CardTitle>Datos del ingreso</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <DataField label="Fecha y hora de ingreso">
              {dateFmt.format(new Date(hoja.fecha_hora_ingreso))}
            </DataField>
            <DataField label="Modalidad">
              <span className="capitalize">{hoja.modalidad}</span>
            </DataField>
            <DataField label="Procedencia">{hoja.procedencia}</DataField>
            <DataField label="Orden de ingreso">
              <span className="font-mono text-xs">{hoja.orden_ingreso_id}</span>
            </DataField>
            <DataField label="Servicio">
              <span className="font-mono text-xs">{hoja.servicio_ingreso_id}</span>
            </DataField>
            {hoja.cama_asignada_id && (
              <DataField label="Cama asignada">
                <span className="font-mono text-xs">{hoja.cama_asignada_id}</span>
              </DataField>
            )}
            {hoja.diagnostico_ingreso && (
              <DataField label="Diagnóstico de ingreso" className="sm:col-span-2">
                {hoja.diagnostico_ingreso}
              </DataField>
            )}
            {hoja.motivo_consulta && (
              <DataField label="Motivo de consulta" className="sm:col-span-2">
                {hoja.motivo_consulta}
              </DataField>
            )}
            {hoja.notas_adicionales && (
              <DataField label="Notas adicionales" className="sm:col-span-2">
                <pre className="whitespace-pre-wrap text-sm">{hoja.notas_adicionales}</pre>
              </DataField>
            )}
          </dl>
        </CardContent>
      </Card>

      {/* Acciones contextuales */}
      <Card>
        <CardHeader>
          <CardTitle>Acciones</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {(estado === "borrador" || estado === "en_revision") && (
            <Button onClick={() => setFirmarOpen(true)}>
              Firmar (ADM)
            </Button>
          )}
          {estado === "firmado" && (
            <Button onClick={() => setValidarOpen(true)}>
              Validar (ARCH)
            </Button>
          )}
          {puedeAnular && (
            <Button variant="destructive" onClick={() => setAnularOpen(true)}>
              Anular (DIR)
            </Button>
          )}
          {estado === "validado" && (
            <p className="text-sm text-muted-foreground">
              Documento validado. Solo lectura.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Diálogo: Firmar */}
      <Dialog open={firmarOpen} onOpenChange={setFirmarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Firmar hoja de ingreso</DialogTitle>
            <DialogDescription>
              Ingrese su PIN electrónico para firmar. El documento avanzará a estado firmado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="firmar-pin">PIN (6-8 dígitos)</Label>
              <Input
                id="firmar-pin"
                type="password"
                inputMode="numeric"
                maxLength={8}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
              />
            </div>
            {firmarMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {firmarMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFirmarOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => firmarMutation.mutate({ id: hoja.id, pin })}
              disabled={!pin.trim() || firmarMutation.isPending}
            >
              {firmarMutation.isPending ? "Firmando…" : "Confirmar firma"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Validar */}
      <Dialog open={validarOpen} onOpenChange={setValidarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Validar hoja de ingreso</DialogTitle>
            <DialogDescription>
              El documento avanzará a estado validado (ARCH).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="validar-obs">Observación (opcional)</Label>
              <Textarea
                id="validar-obs"
                rows={2}
                value={observacion}
                onChange={(e) => setObservacion(e.target.value)}
              />
            </div>
            {validarMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {validarMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setValidarOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() =>
                validarMutation.mutate({ id: hoja.id, observacion: observacion || undefined })
              }
              disabled={validarMutation.isPending}
            >
              {validarMutation.isPending ? "Validando…" : "Confirmar validación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diálogo: Anular */}
      <Dialog open={anularOpen} onOpenChange={setAnularOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Anular hoja de ingreso</DialogTitle>
            <DialogDescription>
              Esta acción es irreversible. El documento pasará a estado anulado.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="anular-motivo">Motivo de anulación (requerido)</Label>
              <Textarea
                id="anular-motivo"
                rows={3}
                value={motivoAnulacion}
                onChange={(e) => setMotivoAnulacion(e.target.value)}
                aria-required="true"
              />
            </div>
            {anularMutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {anularMutation.error.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAnularOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                anularMutation.mutate({ id: hoja.id, motivoAnulacion })
              }
              disabled={motivoAnulacion.trim().length < 5 || anularMutation.isPending}
            >
              {anularMutation.isPending ? "Anulando…" : "Confirmar anulación"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function DataField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}
