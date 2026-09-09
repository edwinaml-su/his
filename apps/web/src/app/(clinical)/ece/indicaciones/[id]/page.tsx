"use client";

/**
 * ECE — Detalle de indicación médica (IND_MED).
 *
 * Muestra encabezado + tabla de items (tipo, descripción, dosis, vía,
 * frecuencia, duración) + estado/vigencia.
 *
 * Acciones disponibles según estado_registro y rol:
 *   borrador  + PHYSICIAN → botón "Firmar"
 *   ACTIVA    + PHYSICIAN → botón "Cancelar"
 *   ACTIVA    + NURSE     → botón "Suspender"
 *   cualquiera + NURSE    → botón "Registrar administración" por item
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";
import {
  IndicacionEstadoBadge,
  type EstadoRegistro,
  type Vigencia,
} from "../_components/indicacion-estado-badge";

interface ItemRow {
  id: string;
  tipo: string;
  descripcion: string;
  dosis: string | null;
  via: string | null;
  frecuencia: string | null;
  duracion: string | null;
}

/**
 * ADR 0023 Ola 2 — espejo de `PharmacyInteractionAlert`
 * (`packages/contracts/src/schemas/pharmacy.ts`). El server reenvía este
 * arreglo en `err.data.interactionAlerts` cuando `firmar()` bloquea por
 * interacción major/contraindicated (ver `errorFormatter` en
 * `packages/trpc/src/trpc.ts`).
 */
interface InteractionAlertUI {
  atcA: string;
  atcB: string;
  drugAName?: string | null;
  drugBName?: string | null;
  severity: "minor" | "moderate" | "major" | "contraindicated";
  description: string;
}

const ROUTE_LABELS: Record<string, string> = {
  ORAL: "Oral",
  IV: "Intravenosa",
  IM: "Intramuscular",
  SC: "Subcutánea",
  TOPICAL: "Topica",
  INHALED: "Inhalada",
  RECTAL: "Rectal",
  SUBLINGUAL: "Sublingual",
  OPHTHALMIC: "Oftalmica",
  OTIC: "Otica",
  NASAL: "Nasal",
};

export default function IndicacionDetallePage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [motivoModal, setMotivoModal] = React.useState<
    "suspender" | "cancelar" | null
  >(null);
  const [motivo, setMotivo] = React.useState("");

  // ADR 0023 Ola 2 — pipeline de seguridad al firmar. `advertencias` son
  // NO bloqueantes (moderate/minor + advisory renal); `interactionAlerts`
  // dispara el modal de override cuando hay major/contraindicated.
  const [advertencias, setAdvertencias] = React.useState<string[]>([]);
  const [interactionAlerts, setInteractionAlerts] = React.useState<
    InteractionAlertUI[] | null
  >(null);
  const [overrideJustificacion, setOverrideJustificacion] = React.useState("");
  const [overrideVerificadorId, setOverrideVerificadorId] = React.useState("");
  const [overrideVerificadorPin, setOverrideVerificadorPin] = React.useState("");

  const detail = trpc.eceIndicaciones.get.useQuery(
    { id: params.id },
    { enabled: Boolean(params.id) },
  );

  const firmaMutation = trpc.eceIndicaciones.firmar.useMutation({
    onSuccess: (data) => {
      setInteractionAlerts(null);
      setOverrideJustificacion("");
      setOverrideVerificadorId("");
      setOverrideVerificadorPin("");
      setAdvertencias(data.advertencias ?? []);
      void detail.refetch();
    },
    onError: (err) => {
      // ADR 0023 Ola 2 — H-01/H-06: `firmar()` bloquea con PRECONDITION_FAILED
      // y reenvía los pares en conflicto vía errorFormatter (trpc.ts). Si
      // vienen, abrimos el modal de override en vez de un error genérico.
      const alerts = (err.data as { interactionAlerts?: unknown } | undefined)
        ?.interactionAlerts;
      if (
        err.data?.code === "PRECONDITION_FAILED" &&
        Array.isArray(alerts) &&
        alerts.length > 0
      ) {
        setInteractionAlerts(alerts as InteractionAlertUI[]);
        setServerError(null);
      } else {
        setServerError(err.message);
      }
    },
  });

  const handleOverrideSubmit = () => {
    if (!params.id) return;
    firmaMutation.mutate({
      id: params.id,
      overrideInteracciones: {
        justificacion: overrideJustificacion.trim(),
        verificadorId: overrideVerificadorId.trim(),
        verificadorPin: overrideVerificadorPin.trim(),
      },
    });
  };

  const suspenderMutation = trpc.eceIndicaciones.suspender.useMutation({
    onSuccess: () => {
      setMotivoModal(null);
      setMotivo("");
      void detail.refetch();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const cancelarMutation = trpc.eceIndicaciones.cancelar.useMutation({
    onSuccess: () => {
      setMotivoModal(null);
      setMotivo("");
      void detail.refetch();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  });

  const ind = detail.data;

  const handleMotivo = () => {
    if (!motivo.trim() || !params.id) return;
    if (motivoModal === "suspender") {
      suspenderMutation.mutate({ id: params.id, motivo: motivo.trim() });
    } else if (motivoModal === "cancelar") {
      cancelarMutation.mutate({ id: params.id, motivo: motivo.trim() });
    }
  };

  if (detail.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Cargando indicacion…</p>
    );
  }

  if (!ind) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Indicacion no encontrada.
        </p>
        <Button
          variant="outline"
          onClick={() => router.push("/ece/indicaciones")}
        >
          Volver
        </Button>
      </div>
    );
  }

  const estadoRegistro = ind.estado_registro as EstadoRegistro;
  const vigencia = ind.vigencia as Vigencia;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Indicacion medica</h1>
            <IndicacionEstadoBadge
              estadoRegistro={estadoRegistro}
              vigencia={vigencia}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Episodio{" "}
            <span className="font-mono">{ind.episodio_id.slice(0, 8)}…</span>
            {" · "}
            {new Date(ind.registrado_en).toLocaleString("es-SV")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/ece/indicaciones")}
        >
          Volver
        </Button>
      </div>

      {/* Items de indicaciones */}
      <Card>
        <CardHeader>
          <CardTitle>Items indicados</CardTitle>
        </CardHeader>
        <CardContent>
          {ind.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin items.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Descripcion</TableHead>
                  <TableHead>Dosis</TableHead>
                  <TableHead>Via</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Duracion</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(ind.items as ItemRow[]).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-xs font-medium">
                      {item.tipo}
                    </TableCell>
                    <TableCell>{item.descripcion}</TableCell>
                    <TableCell>{item.dosis ?? "—"}</TableCell>
                    <TableCell>
                      {item.via ? (ROUTE_LABELS[item.via] ?? item.via) : "—"}
                    </TableCell>
                    <TableCell>{item.frecuencia ?? "—"}</TableCell>
                    <TableCell>{item.duracion ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
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

      {/* ADR 0023 Ola 2 — advertencias NO bloqueantes de la última firma
          (interacciones moderate/minor u overrideadas + advisory renal). */}
      {advertencias.length > 0 ? (
        <Alert variant="warning" data-testid="alert-advertencias">
          <AlertTitle>Advertencias de la firma</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {advertencias.map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Acciones por estado */}
      <div className="flex flex-wrap justify-end gap-2">
        {estadoRegistro === "borrador" ? (
          <Button
            onClick={() => {
              setServerError(null);
              firmaMutation.mutate({ id: params.id });
            }}
            disabled={firmaMutation.isPending}
            data-testid="btn-firmar"
          >
            {firmaMutation.isPending ? "Firmando…" : "Firmar (MC)"}
          </Button>
        ) : null}

        {vigencia === "ACTIVA" ? (
          <>
            <Button
              variant="outline"
              onClick={() => {
                setMotivoModal("suspender");
                setMotivo("");
                setServerError(null);
              }}
              data-testid="btn-suspender"
            >
              Suspender
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setMotivoModal("cancelar");
                setMotivo("");
                setServerError(null);
              }}
              data-testid="btn-cancelar"
            >
              Cancelar indicacion
            </Button>
          </>
        ) : null}

        <Button asChild variant="secondary" size="sm">
          <Link href={`/ece/indicaciones/${params.id}/admin`}>
            Registrar administracion
          </Link>
        </Button>
      </div>

      {/* Modal motivo (suspender / cancelar) */}
      {motivoModal !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-motivo-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-xl">
            <h2
              id="modal-motivo-title"
              className="mb-4 text-lg font-semibold"
            >
              {motivoModal === "suspender"
                ? "Suspender indicacion"
                : "Cancelar indicacion"}
            </h2>
            <label
              htmlFor="motivo-input"
              className="mb-1 block text-sm font-medium"
            >
              Motivo <span className="text-destructive">*</span>
            </label>
            <textarea
              id="motivo-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              placeholder="Motivo clinico documentado…"
              autoFocus
              data-testid="input-motivo"
            />
            {serverError ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {serverError}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMotivoModal(null);
                  setMotivo("");
                  setServerError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={
                  motivo.trim().length < 1 ||
                  suspenderMutation.isPending ||
                  cancelarMutation.isPending
                }
                onClick={handleMotivo}
                data-testid="btn-confirmar-motivo"
              >
                {suspenderMutation.isPending || cancelarMutation.isPending
                  ? "Procesando…"
                  : "Confirmar"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ADR 0023 Ola 2 (R06 H-01/H-06) — modal de override de interacción
          medicamentosa major/contraindicated. Exige un profesional DISTINTO
          del que firma (2ª firma: verificadorId + PIN), validado server-side
          en firmar(). */}
      {interactionAlerts !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-interaccion-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-full max-w-md rounded-lg border bg-background p-6 shadow-xl">
            <h2
              id="modal-interaccion-title"
              className="mb-2 text-lg font-semibold text-destructive"
            >
              Interacción medicamentosa detectada
            </h2>
            <p className="mb-3 text-sm text-muted-foreground">
              Se requiere autorización de un segundo profesional para firmar
              esta indicación.
            </p>

            <ul className="mb-4 space-y-2" data-testid="interaction-alert-list">
              {interactionAlerts.map((a, i) => (
                <li
                  key={i}
                  className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm"
                >
                  <span className="font-medium">
                    {a.drugAName ?? a.atcA} ↔ {a.drugBName ?? a.atcB}
                  </span>{" "}
                  <span className="uppercase text-xs text-destructive">
                    [{a.severity}]
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {a.description}
                  </p>
                </li>
              ))}
            </ul>

            <div className="space-y-3">
              <div>
                <label
                  htmlFor="override-verificador"
                  className="mb-1 block text-sm font-medium"
                >
                  Verificador (distinto del médico que firma){" "}
                  <span className="text-destructive">*</span>
                </label>
                <input
                  id="override-verificador"
                  value={overrideVerificadorId}
                  onChange={(e) => setOverrideVerificadorId(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="ID de usuario del verificador"
                  data-testid="input-override-verificador"
                />
              </div>
              <div>
                <label
                  htmlFor="override-pin"
                  className="mb-1 block text-sm font-medium"
                >
                  PIN del verificador <span className="text-destructive">*</span>
                </label>
                <input
                  id="override-pin"
                  type="password"
                  inputMode="numeric"
                  value={overrideVerificadorPin}
                  onChange={(e) => setOverrideVerificadorPin(e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="6-8 dígitos"
                  data-testid="input-override-pin"
                />
              </div>
              <div>
                <label
                  htmlFor="override-justificacion"
                  className="mb-1 block text-sm font-medium"
                >
                  Justificación clínica <span className="text-destructive">*</span>
                </label>
                <textarea
                  id="override-justificacion"
                  value={overrideJustificacion}
                  onChange={(e) => setOverrideJustificacion(e.target.value)}
                  rows={3}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  placeholder="Mínimo 10 caracteres…"
                  data-testid="input-override-justificacion"
                />
              </div>
            </div>

            {serverError ? (
              <p
                role="alert"
                className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive"
              >
                {serverError}
              </p>
            ) : null}

            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setInteractionAlerts(null);
                  setOverrideJustificacion("");
                  setOverrideVerificadorId("");
                  setOverrideVerificadorPin("");
                  setServerError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={
                  overrideJustificacion.trim().length < 10 ||
                  !overrideVerificadorId.trim() ||
                  !overrideVerificadorPin.trim() ||
                  firmaMutation.isPending
                }
                onClick={handleOverrideSubmit}
                data-testid="btn-confirmar-override"
              >
                {firmaMutation.isPending ? "Firmando…" : "Firmar con override"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
