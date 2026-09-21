"use client";

/**
 * Historia Clínica Ambulatoria — Detalle con firma electrónica.
 *
 * - Carga HC por ID vía `eceHistoriaClinica.get`.
 * - Muestra todas las secciones clínicas en modo lectura.
 * - Botón "Firmar" disponible solo en estado 'borrador'.
 * - Modal PIN: envía PIN en claro (TLS) → el router resuelve+valida el
 *   firmaId contra ece.firma_electronica (argon2id).
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
import { DESTINO_LABELS, type Destino } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";

/**
 * `get` devuelve `antecedentes`/`examenFisico` como `unknown` (columnas jsonb
 * sin narrowing en el output schema — ver historiaClinicaGetOutput). La forma
 * real la fija `antecedentesSchema`/`examenFisicoSchema` (@his/contracts) al
 * escribir; estas vistas locales narrowan solo los campos que esta página lee.
 */
interface AntecedentesView {
  personales?: string;
  familiares?: string;
  obstetricos?: string;
  alergias?: string;
}
interface ExamenFisicoView {
  sistemas?: Array<{ sistema: string; hallazgo: string }>;
}

// ── Constantes ────────────────────────────────────────────────────────────────

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "medium",
});

const TIPO_LABELS: Record<string, string> = {
  primera_vez: "Primera vez",
  subsecuente: "Subsecuente",
};

const ESTADO_COLORS: Record<string, string> = {
  borrador: "text-amber-600 bg-amber-50",
  firmado: "text-blue-700 bg-blue-50",
  validado: "text-green-700 bg-green-50",
  anulado: "text-red-700 bg-red-50",
};

// ── Tipos de respuesta esperada ───────────────────────────────────────────────

// ── Componente ────────────────────────────────────────────────────────────────

export default function HistoriaClinicaAmbulatoriaDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [pinOpen, setPinOpen] = React.useState(false);
  const [pin, setPin] = React.useState("");
  const [pinError, setPinError] = React.useState<string | null>(null);

  const query = trpc.eceHistoriaClinica.get.useQuery({ id: params.id });

  const firmar = trpc.eceHistoriaClinica.firmar.useMutation({
    onSuccess: () => {
      setPinOpen(false);
      setPin("");
      setPinError(null);
      void query.refetch();
    },
    onError: (err) => {
      setPinError(err.message);
    },
  });

  function handleFirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6,8}$/.test(pin.trim())) {
      setPinError("El PIN debe tener entre 6 y 8 dígitos.");
      return;
    }
    setPinError(null);
    firmar.mutate({ id: params.id, pin: pin.trim() });
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
  const antecedentes = hc.antecedentes as AntecedentesView | null;
  const examenFisico = hc.examenFisico as ExamenFisicoView | null;

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
              <>
                <Button asChild variant="outline" size="sm">
                  <Link
                    href={`/historia-clinica-ambulatoria/${hc.id}/editar`}
                    aria-label="Editar borrador de historia clínica ambulatoria"
                  >
                    Editar
                  </Link>
                </Button>
                <Button
                  size="sm"
                  onClick={() => setPinOpen(true)}
                  aria-label="Firmar electrónicamente esta historia clínica ambulatoria"
                >
                  Firmar
                </Button>
              </>
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
            {hc.destino && (
              <div>
                <p className="font-medium text-muted-foreground">Destino</p>
                <p className="mt-0.5">{DESTINO_LABELS[hc.destino as Destino] ?? hc.destino}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Antecedentes */}
        {antecedentes && (
          <Card>
            <CardHeader>
              <CardTitle>Antecedentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {antecedentes.personales && (
                <div>
                  <p className="font-medium text-muted-foreground">Personales</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{antecedentes.personales}</p>
                </div>
              )}
              {antecedentes.familiares && (
                <div>
                  <p className="font-medium text-muted-foreground">Familiares</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{antecedentes.familiares}</p>
                </div>
              )}
              {antecedentes.obstetricos && (
                <div>
                  <p className="font-medium text-muted-foreground">Ginecológicos / obstétricos</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{antecedentes.obstetricos}</p>
                </div>
              )}
              {antecedentes.alergias && (
                <div>
                  <p className="font-medium text-muted-foreground">Alergias</p>
                  <p className="mt-0.5 whitespace-pre-wrap">{antecedentes.alergias}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Examen físico */}
        {examenFisico?.sistemas?.length ? (
          <Card>
            <CardHeader>
              <CardTitle>Examen físico</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <ul className="space-y-2" aria-label="Hallazgos por sistema">
                {examenFisico.sistemas.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.sistema}: </span>
                    <span>{s.hallazgo}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        {/* Diagnósticos CIE-11 */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-11)</CardTitle>
          </CardHeader>
          <CardContent>
            {hc.diagnosticos && hc.diagnosticos.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Lista de diagnósticos CIE-11">
                {hc.diagnosticos.map((dx, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{dx.codigo}</span>
                    <span>{dx.descripcion}</span>
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
