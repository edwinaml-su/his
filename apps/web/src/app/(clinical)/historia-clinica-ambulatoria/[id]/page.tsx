"use client";

/**
 * Historia Clínica Ambulatoria — Detalle con firma electrónica.
 *
 * - Carga HC por ID vía `eceHistoriaClinica.get`.
 * - Muestra todas las secciones clínicas en modo lectura.
 * - Botón "Firmar" disponible solo en estado 'borrador'.
 * - Modal PIN: envía PIN → router verifica contra ece.firma_electronica.
 *
 * TODO(HC-002): usar tipo nativo cuando el router esté mergeado.
 * Cast `(trpc as any)` es temporal hasta disponibilidad del router.
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
import { Button } from "@his/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { trpc } from "@/lib/trpc/react";

// ── Constantes ────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "medium",
});

const TIPO_LABELS: Record<string, string> = {
  ingreso: "Ingreso hospitalario",
  control: "Control",
  urgencia: "Urgencia",
  ambulatoria: "Consulta ambulatoria",
  interconsulta: "Interconsulta",
};

const ESTADO_COLORS: Record<string, string> = {
  borrador: "text-amber-600 bg-amber-50",
  firmado: "text-blue-700 bg-blue-50",
  validado: "text-green-700 bg-green-50",
  anulado: "text-red-700 bg-red-50",
};

// ── Tipos de respuesta esperada ───────────────────────────────────────────────

interface DxCie10 {
  code: string;
  description: string;
  tipo: string;
}

interface HcAmbulatoria {
  id: string;
  tipoConsulta: string;
  motivoConsulta: string | null;
  enfermedadActual: string | null;
  antecedentes: {
    personales?: string;
    familiares?: string;
    ginecologicos?: string;
    sociales?: string;
    alergias?: string;
  } | null;
  examenFisico: {
    sistemas?: Array<{ sistema: string; hallazgo: string }>;
  } | null;
  diagnosticos: DxCie10[] | null;
  planManejo: string | null;
  disposicion: string | null;
  estadoRegistro: string;
  registradoEn: string | Date;
  firmadoEn: string | Date | null;
  validadoEn: string | Date | null;
  patient: {
    firstName: string;
    lastName: string;
    mrn?: string | null;
  } | null;
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function HistoriaClinicaAmbulatoriaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [pinOpen, setPinOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);

  // TODO(HC-002): reemplazar cast cuando el router esté disponible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = (trpc as any).eceHistoriaClinica.get.useQuery(
    { id: params.id },
  ) as {
    isLoading: boolean;
    error: { message: string } | null;
    data: HcAmbulatoria | undefined;
    refetch: () => void;
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const firmar = (trpc as any).eceHistoriaClinica.firmar.useMutation({
    onSuccess: () => {
      setPinOpen(false);
      setPin("");
      setPinError(null);
      void query.refetch();
    },
    onError: (err: { message: string }) => {
      setPinError(err.message);
    },
  }) as {
    mutate: (input: Record<string, unknown>) => void;
    isPending: boolean;
  };

  function handleFirmar(e: React.FormEvent) {
    e.preventDefault();
    if (pin.trim().length < 6) {
      setPinError("El PIN debe tener al menos 6 caracteres.");
      return;
    }
    setPinError(null);
    // PIN se envía como observación; el router resuelve la firma contra ece.firma_electronica.
    firmar.mutate({ id: params.id, observacion: `pin:${pin.trim()}` });
  }

  function handlePinClose() {
    if (firmar.isPending) return;
    setPinOpen(false);
    setPin("");
    setPinError(null);
  }

  // ── Carga / error ─────────────────────────────────────────────────────────

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
  if (!query.data) {
    return (
      <p className="text-sm text-muted-foreground">
        Historia clínica no encontrada.
      </p>
    );
  }

  const hc = query.data;
  const esBorrador = hc.estadoRegistro === "borrador";
  const estadoClass = ESTADO_COLORS[hc.estadoRegistro] ?? "";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">

        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Historia Clínica Ambulatoria</h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${estadoClass}`}
                aria-label={`Estado: ${hc.estadoRegistro}`}
              >
                {hc.estadoRegistro.charAt(0).toUpperCase() + hc.estadoRegistro.slice(1)}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {hc.patient
                ? `${hc.patient.firstName} ${hc.patient.lastName}${hc.patient.mrn ? ` · MRN ${hc.patient.mrn}` : ""}`
                : "—"}
              {" · "}
              {TIPO_LABELS[hc.tipoConsulta] ?? hc.tipoConsulta}
              {" · "}
              {dateFmt.format(new Date(hc.registradoEn))}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/historia-clinica-ambulatoria">Volver</Link>
            </Button>
            {esBorrador && (
              <Button
                size="sm"
                onClick={() => setPinOpen(true)}
                aria-label="Firmar electrónicamente esta historia clínica ambulatoria"
              >
                Firmar
              </Button>
            )}
          </div>
        </div>

        {/* Datos clínicos principales */}
        <Card>
          <CardHeader>
            <CardTitle>Consulta</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Motivo de consulta</p>
              <p className="mt-0.5">{hc.motivoConsulta ?? "—"}</p>
            </div>
            {hc.enfermedadActual && (
              <div>
                <p className="font-medium text-muted-foreground">Anamnesis</p>
                <p className="mt-0.5 whitespace-pre-wrap">{hc.enfermedadActual}</p>
              </div>
            )}
            {hc.disposicion && (
              <div>
                <p className="font-medium text-muted-foreground">Disposición</p>
                <p className="mt-0.5">{hc.disposicion}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Antecedentes */}
        {hc.antecedentes && (
          <Card>
            <CardHeader>
              <CardTitle>Antecedentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {hc.antecedentes.personales && (
                <div>
                  <p className="font-medium text-muted-foreground">Personales</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentes.personales}</p>
                </div>
              )}
              {hc.antecedentes.familiares && (
                <div>
                  <p className="font-medium text-muted-foreground">Familiares</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentes.familiares}</p>
                </div>
              )}
              {hc.antecedentes.ginecologicos && (
                <div>
                  <p className="font-medium text-muted-foreground">Ginecológicos / obstétricos</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentes.ginecologicos}</p>
                </div>
              )}
              {hc.antecedentes.sociales && (
                <div>
                  <p className="font-medium text-muted-foreground">Sociales</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentes.sociales}</p>
                </div>
              )}
              {hc.antecedentes.alergias && (
                <div>
                  <p className="font-medium text-muted-foreground">Alergias</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentes.alergias}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Examen físico */}
        {hc.examenFisico?.sistemas?.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Examen físico</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <ul className="space-y-2" aria-label="Hallazgos por sistema">
                {hc.examenFisico.sistemas.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.sistema}: </span>
                    <span>{s.hallazgo}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* Diagnósticos CIE-10 */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-10)</CardTitle>
          </CardHeader>
          <CardContent>
            {hc.diagnosticos && hc.diagnosticos.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Lista de diagnósticos CIE-10">
                {hc.diagnosticos.map((dx, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{dx.code}</span>
                    <span>{dx.description}</span>
                    <span className="text-xs text-muted-foreground">({dx.tipo})</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin diagnósticos registrados.</p>
            )}
          </CardContent>
        </Card>

        {/* Plan terapéutico */}
        <Card>
          <CardHeader>
            <CardTitle>Plan terapéutico</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{hc.planManejo ?? "—"}</p>
          </CardContent>
        </Card>

        {/* Firma electrónica */}
        {hc.estadoRegistro !== "borrador" && (hc.firmadoEn ?? hc.validadoEn) && (
          <Card>
            <CardHeader>
              <CardTitle>Firma electrónica</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {hc.firmadoEn && (
                <p>
                  <span className="text-muted-foreground">Firmada: </span>
                  {dateFmt.format(new Date(hc.firmadoEn))}
                </p>
              )}
              {hc.estadoRegistro === "validado" && hc.validadoEn && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Validada: </span>
                  {dateFmt.format(new Date(hc.validadoEn))}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => router.push("/historia-clinica-ambulatoria")}
          >
            Volver al listado
          </Button>
        </div>
      </div>

      {/* Modal PIN firma electrónica */}
      <Dialog open={pinOpen} onOpenChange={handlePinClose}>
        <DialogContent aria-describedby="pin-firma-desc">
          <DialogHeader>
            <DialogTitle>Firma electrónica</DialogTitle>
            <DialogDescription id="pin-firma-desc">
              Ingrese su PIN de firma para suscribir esta historia clínica ambulatoria.
              Esta acción no se puede deshacer (NTEC Art. 7).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFirmar} noValidate>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="firma-pin-ambulatoria">PIN de firma</Label>
                <Input
                  id="firma-pin-ambulatoria"
                  type="password"
                  inputMode="numeric"
                  placeholder="••••••"
                  autoComplete="current-password"
                  autoFocus
                  required
                  aria-required="true"
                  aria-describedby={pinError ? "pin-error-ambulatoria" : undefined}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={firmar.isPending}
                />
                {pinError && (
                  <p
                    id="pin-error-ambulatoria"
                    role="alert"
                    aria-live="polite"
                    className="text-xs font-medium text-destructive"
                  >
                    {pinError}
                  </p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={handlePinClose}
                disabled={firmar.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={firmar.isPending}
                aria-label="Confirmar firma electrónica de historia clínica ambulatoria"
              >
                {firmar.isPending ? "Firmando…" : "Confirmar firma"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
