"use client";

/**
 * CC-0016 — Contenedor del módulo: patient-bar + 3 tabs del mockup
 * (➕ Nueva Solicitud / 📋 Solicitudes del paciente / ⚙️ Parametrización).
 */
import * as React from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Card, CardContent } from "@his/ui/components/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { trpc } from "@/lib/trpc/react";
import { NuevaSolicitud } from "./nueva-solicitud";
import { SolicitudesListado } from "./solicitudes-listado";
import { Parametrizacion } from "./parametrizacion";

interface ModuloImagenesProps {
  cuentaId: string;
  roleCodes: string[];
  deepLinkOrderId: string | null;
}

export function ModuloImagenes({ cuentaId, roleCodes, deepLinkOrderId }: ModuloImagenesProps) {
  const isAdmin = roleCodes.includes("ADMIN") || roleCodes.includes("DIR");
  const [mainTab, setMainTab] = React.useState<"solicitud" | "listado" | "param">("solicitud");
  const [openRequestId, setOpenRequestId] = React.useState<string | null>(null);
  const [legacyOrderId, setLegacyOrderId] = React.useState<string | null>(null);

  const contexto = trpc.patient.contextoCuenta.useQuery({ cuentaId });

  // Deep-link del workflow-inbox (/imaging?id={imagingOrderId}) — resuelve si la
  // orden pertenece a una solicitud de este módulo o es una orden legada RIS/PACS.
  const deepLinkQ = trpc.imagingRequest.resolverDeepLink.useQuery(
    { orderId: deepLinkOrderId ?? "" },
    { enabled: Boolean(deepLinkOrderId) },
  );

  React.useEffect(() => {
    if (!deepLinkQ.data) return;
    if (deepLinkQ.data.requestId) {
      setMainTab("listado");
      setOpenRequestId(deepLinkQ.data.requestId);
    } else if (deepLinkOrderId) {
      setLegacyOrderId(deepLinkOrderId);
    }
  }, [deepLinkQ.data, deepLinkOrderId]);

  const paciente = contexto.data?.paciente;
  const edad = calcularEdad(paciente?.birthDate ?? null);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-x-8 gap-y-2 pt-4 text-sm">
          <div>
            <p className="font-semibold text-foreground">
              {paciente ? `${paciente.firstName} ${paciente.lastName}` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              Expediente Nº {paciente?.mrn ?? "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Edad</p>
            <p className="font-medium">{edad !== null ? `${edad} años` : "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cuenta</p>
            <p className="font-medium">{contexto.data?.cuenta.numeroCuenta ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

      <Tabs value={mainTab} onValueChange={(v) => setMainTab(v as typeof mainTab)}>
        <TabsList aria-label="Módulo de radiología e imágenes">
          <TabsTrigger value="solicitud">➕ Nueva Solicitud</TabsTrigger>
          <TabsTrigger value="listado">📋 Solicitudes del paciente</TabsTrigger>
          {isAdmin ? <TabsTrigger value="param">⚙️ Parametrización</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="solicitud">
          <NuevaSolicitud cuentaId={cuentaId} onGuardado={() => setMainTab("listado")} />
        </TabsContent>

        <TabsContent value="listado">
          <SolicitudesListado
            cuentaId={cuentaId}
            openRequestId={openRequestId}
            onOpenRequestIdChange={setOpenRequestId}
          />
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="param">
            <Parametrizacion />
          </TabsContent>
        ) : null}
      </Tabs>

      <OrdenLegadaDialog orderId={legacyOrderId} onOpenChange={(o) => !o && setLegacyOrderId(null)} />
    </div>
  );
}

/**
 * Fallback del deep-link para órdenes creadas por el flujo manual RIS/PACS
 * (`imaging.router.ts#order.create`, sin ImagingRequest padre) — muestra los
 * datos clave de solo lectura reusando `imaging.order.get`.
 */
function OrdenLegadaDialog({
  orderId,
  onOpenChange,
}: {
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const orderQ = trpc.imaging.order.get.useQuery({ id: orderId ?? "" }, { enabled: Boolean(orderId) });

  return (
    <Dialog open={Boolean(orderId)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Orden de imagen (flujo RIS/PACS)</DialogTitle>
        </DialogHeader>
        {orderQ.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : null}
        {orderQ.data ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Estudio</dt>
            <dd>{orderQ.data.studyDescription}</dd>
            <dt className="text-muted-foreground">Modalidad</dt>
            <dd>{orderQ.data.modalityType}</dd>
            <dt className="text-muted-foreground">Prioridad</dt>
            <dd>{orderQ.data.priority}</dd>
            <dt className="text-muted-foreground">Estado</dt>
            <dd>{orderQ.data.status}</dd>
          </dl>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Esta orden no fue creada desde este módulo de solicitud — no tiene una cabecera
          de solicitud asociada.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function calcularEdad(birthDate: Date | string | null | undefined): number | null {
  if (!birthDate) return null;
  const d = new Date(birthDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24 * 365.25));
}
