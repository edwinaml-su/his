"use client";

/**
 * ECE — Detalle de indicación médica.
 *
 * Muestra encabezado + tabla de items (medicamento, dosis, vía,
 * frecuencia, duración) + indicador visual de estado workflow.
 *
 * Acciones disponibles según estado:
 *  BORRADOR     → botón "Firmar" (solo MC)
 *  FIRMADA_MC   → botón "Verificar transcripción" (solo ENF)
 *  VALIDADA_ENF → read-only
 *  ANULADA      → read-only
 *
 * La firma MC se delega a /api/firma-electronica mediante el modal
 * de PIN compartido. La verificación ENF llama a
 * trpc.eceIndicaciones.validarEnfermeria.
 */
import * as React from "react";
import { useParams, useRouter } from "next/navigation";
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
  type IndicacionEstado,
} from "../_components/indicacion-estado-badge";

interface IndicacionItem {
  id: string;
  medicamentoNombre: string;
  dosis: string;
  via: string;
  frecuencia: string;
  duracionDias?: number | null;
  observaciones?: string | null;
}

interface IndicacionDetalle {
  id: string;
  estado: IndicacionEstado;
  creadoEn: string | Date;
  observaciones?: string | null;
  episodioId: string;
  medico: { id: string; firstName: string; lastName: string };
  firmadoEn?: string | Date | null;
  validadoEn?: string | Date | null;
  enfermero?: { id: string; firstName: string; lastName: string } | null;
  items: IndicacionItem[];
}

const ROUTE_LABELS: Record<string, string> = {
  ORAL: "Oral",
  IV: "Intravenosa",
  IM: "Intramuscular",
  SC: "Subcutánea",
  TOPICAL: "Tópica",
  INHALED: "Inhalada",
  RECTAL: "Rectal",
  SUBLINGUAL: "Sublingual",
  OPHTHALMIC: "Oftálmica",
  OTIC: "Ótica",
  NASAL: "Nasal",
};

export default function IndicacionDetallePage(): React.ReactElement {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [pinModal, setPinModal] = React.useState<
    "firma_mc" | "valida_enf" | null
  >(null);
  const [pin, setPin] = React.useState("");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;

  const detail = trpcAny.eceIndicaciones?.get?.useQuery(
    { id: params.id },
    { enabled: Boolean(params.id) },
  ) ?? { data: undefined, isLoading: false };

  const firmaMutation = trpcAny.eceIndicaciones?.firmarMC?.useMutation?.({
    onSuccess: () => {
      setPinModal(null);
      setPin("");
      detail.refetch?.();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  }) ?? { mutate: () => void 0, isPending: false };

  const validarMutation = trpcAny.eceIndicaciones?.validarEnfermeria?.useMutation?.({
    onSuccess: () => {
      setPinModal(null);
      setPin("");
      detail.refetch?.();
    },
    onError: (err: { message: string }) => setServerError(err.message),
  }) ?? { mutate: () => void 0, isPending: false };

  const ind = detail.data as IndicacionDetalle | undefined;

  const handleFirmar = () => {
    if (!pin.trim()) return;
    firmaMutation.mutate({ id: params.id, pin: pin.trim() });
  };

  const handleValidar = () => {
    if (!pin.trim()) return;
    validarMutation.mutate({ id: params.id, pin: pin.trim() });
  };

  if (detail.isLoading) {
    return (
      <p className="text-sm text-muted-foreground">Cargando indicación…</p>
    );
  }

  if (!ind) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Indicación no encontrada.
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

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">Indicación médica</h1>
            <IndicacionEstadoBadge estado={ind.estado} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Episodio{" "}
            <span className="font-mono">{ind.episodioId.slice(0, 8)}…</span>
            {" · "}Dr/a. {ind.medico.firstName} {ind.medico.lastName}
            {" · "}
            {new Date(ind.creadoEn).toLocaleString("es-SV")}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => router.push("/ece/indicaciones")}
        >
          Volver
        </Button>
      </div>

      {/* Timeline de workflow */}
      <Card>
        <CardHeader>
          <CardTitle>Trazabilidad del workflow</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex items-center gap-0">
            {(
              [
                {
                  key: "BORRADOR",
                  label: "Borrador",
                  done: true,
                  date: ind.creadoEn,
                },
                {
                  key: "FIRMADA_MC",
                  label: "Firma MC",
                  done:
                    ind.estado === "FIRMADA_MC" ||
                    ind.estado === "VALIDADA_ENF",
                  date: ind.firmadoEn,
                },
                {
                  key: "VALIDADA_ENF",
                  label: "Validación ENF",
                  done: ind.estado === "VALIDADA_ENF",
                  date: ind.validadoEn,
                },
              ] as const
            ).map((step, idx, arr) => (
              <React.Fragment key={step.key}>
                <li className="flex flex-col items-center gap-1 text-center">
                  <span
                    className={[
                      "flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold",
                      step.done
                        ? "bg-primary text-primary-foreground"
                        : "border-2 border-muted-foreground/30 text-muted-foreground/50",
                    ].join(" ")}
                    aria-label={step.done ? `${step.label}: completado` : `${step.label}: pendiente`}
                  >
                    {idx + 1}
                  </span>
                  <span
                    className={
                      step.done
                        ? "text-xs font-medium text-foreground"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {step.label}
                  </span>
                  {step.date ? (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {new Date(step.date).toLocaleDateString("es-SV")}
                    </span>
                  ) : null}
                </li>
                {idx < arr.length - 1 ? (
                  <div className="h-px flex-1 bg-border mx-2" aria-hidden="true" />
                ) : null}
              </React.Fragment>
            ))}
          </ol>
        </CardContent>
      </Card>

      {/* Observaciones generales */}
      {ind.observaciones ? (
        <Card>
          <CardHeader>
            <CardTitle>Observaciones generales</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{ind.observaciones}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Items de medicamentos */}
      <Card>
        <CardHeader>
          <CardTitle>Medicamentos indicados</CardTitle>
        </CardHeader>
        <CardContent>
          {ind.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin medicamentos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Medicamento</TableHead>
                  <TableHead>Dosis</TableHead>
                  <TableHead>Vía</TableHead>
                  <TableHead>Frecuencia</TableHead>
                  <TableHead>Duración (días)</TableHead>
                  <TableHead>Observaciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ind.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.medicamentoNombre}
                    </TableCell>
                    <TableCell>{item.dosis}</TableCell>
                    <TableCell>
                      {ROUTE_LABELS[item.via] ?? item.via}
                    </TableCell>
                    <TableCell>{item.frecuencia}</TableCell>
                    <TableCell className="tabular-nums">
                      {item.duracionDias ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {item.observaciones ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Acciones por estado */}
      {ind.estado === "BORRADOR" ? (
        <div className="flex justify-end">
          <Button onClick={() => { setPinModal("firma_mc"); setPin(""); }}>
            Firmar indicación (MC)
          </Button>
        </div>
      ) : null}

      {ind.estado === "FIRMADA_MC" ? (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => { setPinModal("valida_enf"); setPin(""); }}
            data-testid="btn-verificar-transcripcion"
          >
            Verificar transcripción (ENF)
          </Button>
        </div>
      ) : null}

      {/* Modal PIN inline */}
      {pinModal !== null ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-pin-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        >
          <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-xl">
            <h2
              id="modal-pin-title"
              className="mb-4 text-lg font-semibold"
            >
              {pinModal === "firma_mc"
                ? "Firma electrónica — Médico"
                : "Verificación de transcripción — Enfermería"}
            </h2>
            <label
              htmlFor="pin-input"
              className="mb-1 block text-sm font-medium"
            >
              PIN de firma
            </label>
            <input
              id="pin-input"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={12}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              autoFocus
              aria-describedby="pin-hint"
            />
            <p id="pin-hint" className="mt-1 text-xs text-muted-foreground">
              PIN de 6–12 dígitos registrado en su perfil.
            </p>
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
                  setPinModal(null);
                  setPin("");
                  setServerError(null);
                }}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={
                  pin.trim().length < 6 ||
                  firmaMutation.isPending ||
                  validarMutation.isPending
                }
                onClick={
                  pinModal === "firma_mc" ? handleFirmar : handleValidar
                }
                data-testid={
                  pinModal === "firma_mc"
                    ? "btn-confirmar-firma"
                    : "btn-confirmar-validacion"
                }
              >
                {firmaMutation.isPending || validarMutation.isPending
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
