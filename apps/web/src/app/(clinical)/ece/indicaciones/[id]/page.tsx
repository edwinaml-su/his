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

  const detail = trpc.eceIndicaciones.get.useQuery(
    { id: params.id },
    { enabled: Boolean(params.id) },
  );

  const firmaMutation = trpc.eceIndicaciones.firmar.useMutation({
    onSuccess: () => void detail.refetch(),
    onError: (err: { message: string }) => setServerError(err.message),
  });

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
    </div>
  );
}
