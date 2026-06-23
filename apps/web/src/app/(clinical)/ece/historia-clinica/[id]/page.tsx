"use client";

/**
 * §ECE — Historia Clínica Electrónica — Detalle con firma electrónica.
 *
 * HC-001: cubre la ausencia total de UI para ver/firmar una HC.
 * - Carga HC por ID vía `eceHistoriaClinica.get`.
 * - Muestra estado workflow y secciones clínicas en modo lectura.
 * - Botón "Firmar" disponible solo en estado 'borrador'.
 * - Modal PIN llama a `eceHistoriaClinica.firmar`.
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
import {
  DESTINO_LABELS,
  TIPO_DIAGNOSTICO_LABELS,
  type Destino,
} from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { WorkflowBadge } from "../_components/workflow-badge";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "medium",
});

const TIPO_LABELS: Record<string, string> = {
  // DDL CHECK historia_clinica_tipo_consulta_check (CC-0001)
  primera_vez: "Primera vez",
  subsecuente: "Subsecuente",
  // Legacy — registros previos al CC-0001
  ingreso: "Ingreso hospitalario",
  control: "Control",
  urgencia: "Urgencia",
  ambulatoria: "Consulta ambulatoria",
  interconsulta: "Interconsulta",
};

export default function EceHistoriaClinicaDetailPage() {
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
    onError: (err: { message: string }) => {
      setPinError(err.message);
    },
  });

  function handleFirmar(e: React.FormEvent) {
    e.preventDefault();
    if (!pin.trim()) {
      setPinError("Ingrese su PIN de firma electrónica.");
      return;
    }
    setPinError(null);
    // firmaId se resuelve en el server contra ece.firma_electronica;
    // por ahora se pasa el PIN como observación hasta integrar el flujo PIN→firmaId.
    firmar.mutate({ id: params.id, observacion: `pin:${pin.trim()}` });
  }

  function handlePinClose() {
    if (firmar.isPending) return;
    setPinOpen(false);
    setPin("");
    setPinError(null);
  }

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
      <p className="text-sm text-muted-foreground">Historia clínica no encontrada.</p>
    );
  }

  const hc = query.data;
  const esBorrador = hc.estadoRegistro === "borrador";

  return (
    <>
      <div className="space-y-4">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Historia Clínica</h1>
              <WorkflowBadge estado={hc.estadoRegistro} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {hc.patient
                ? `${hc.patient.firstName} ${hc.patient.lastName} · MRN ${hc.patient.mrn ?? "—"}`
                : "—"}
              {" · "}
              Tipo: {TIPO_LABELS[hc.tipoConsulta] ?? hc.tipoConsulta}
              {" · "}
              Registrada: {dateFmt.format(hc.registradoEn)}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/ece/historia-clinica">Volver</Link>
            </Button>
            {esBorrador && (
              <Button
                size="sm"
                onClick={() => setPinOpen(true)}
                aria-label="Firmar electrónicamente esta historia clínica"
              >
                Firmar
              </Button>
            )}
          </div>
        </div>

        {/* Datos clínicos principales */}
        <Card>
          <CardHeader>
            <CardTitle>Datos del episodio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Motivo de consulta</p>
              <p className="mt-0.5">{hc.motivoConsulta ?? "—"}</p>
            </div>
            <div>
              <p className="font-medium text-muted-foreground">Enfermedad actual</p>
              <p className="mt-0.5 whitespace-pre-wrap">{hc.enfermedadActual ?? "—"}</p>
            </div>
            {hc.destino && (
              <div>
                <p className="font-medium text-muted-foreground">Destino</p>
                <p className="mt-0.5">
                  {DESTINO_LABELS[hc.destino as Destino] ?? hc.destino}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Antecedentes */}
        {(hc.antecedentes as object | null) && (
          <Card>
            <CardHeader>
              <CardTitle>Antecedentes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              {(() => {
                type Ant = {
                  alergias?: string;
                  personales?: string;
                  familiares?: string;
                  ocupacion?: string;
                  habitosPersonales?: string;
                  obstetricos?: string;
                  fum?: string;
                  fpp?: string;
                  sociales?: string;
                };
                const ant = hc.antecedentes as Ant;
                const Campo = ({ label, valor }: { label: string; valor?: string }) =>
                  valor ? (
                    <div>
                      <p className="font-medium text-muted-foreground">{label}</p>
                      <p className="mt-0.5 whitespace-pre-wrap">{valor}</p>
                    </div>
                  ) : null;

                const patologicos = ant.alergias || ant.personales || ant.familiares;
                const noPatologicos = ant.ocupacion || ant.habitosPersonales || ant.obstetricos;

                return (
                  <>
                    {patologicos && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Patológicos
                        </p>
                        <Campo label="Alergias" valor={ant.alergias} />
                        <Campo label="Personales" valor={ant.personales} />
                        <Campo label="Familiares" valor={ant.familiares} />
                      </div>
                    )}
                    {noPatologicos && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          No patológicos
                        </p>
                        <Campo label="Ocupación" valor={ant.ocupacion} />
                        <Campo label="Hábitos personales" valor={ant.habitosPersonales} />
                        <Campo label="Obstétricos" valor={ant.obstetricos} />
                      </div>
                    )}
                    {(ant.fum || ant.fpp) && (
                      <div className="flex flex-wrap gap-6">
                        {ant.fum && (
                          <div>
                            <p className="font-medium text-muted-foreground">FUM</p>
                            <p className="mt-0.5">{ant.fum}</p>
                          </div>
                        )}
                        {ant.fpp && (
                          <div>
                            <p className="font-medium text-muted-foreground">FPP (Naegele)</p>
                            <p className="mt-0.5">{ant.fpp}</p>
                          </div>
                        )}
                      </div>
                    )}
                    {/* Legacy CC-0001: `sociales` reemplazado por ocupación/hábitos. */}
                    <Campo label="Sociales (histórico)" valor={ant.sociales} />
                  </>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Examen físico */}
        {(hc.examenFisico as object | null) && (
          <Card>
            <CardHeader>
              <CardTitle>Examen físico</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              {(() => {
                type Ef = { sistemas?: Array<{ sistema: string; hallazgo: string }> };
                const ef = hc.examenFisico as Ef;
                if (ef.sistemas?.length) {
                  return (
                    <ul className="space-y-2">
                      {ef.sistemas.map((s, i) => (
                        <li key={i}>
                          <span className="font-medium">{s.sistema}: </span>
                          <span>{s.hallazgo}</span>
                        </li>
                      ))}
                    </ul>
                  );
                }
                return <p className="text-muted-foreground">Sin hallazgos registrados.</p>;
              })()}
            </CardContent>
          </Card>
        )}

        {/* Diagnósticos CIE-11 (CC-0001 RF-03) */}
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
                    <span className="text-xs text-muted-foreground">
                      ({TIPO_DIAGNOSTICO_LABELS[dx.tipo] ?? dx.tipo})
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">Sin diagnósticos registrados.</p>
            )}
          </CardContent>
        </Card>

        {/* Análisis clínico (CC-0001 RF-05) */}
        {hc.analisisClinico && (
          <Card>
            <CardHeader>
              <CardTitle>Análisis clínico</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap text-sm">{hc.analisisClinico}</p>
            </CardContent>
          </Card>
        )}

        {/* Plan de manejo */}
        <Card>
          <CardHeader>
            <CardTitle>Plan de manejo</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{hc.planManejo ?? "—"}</p>
          </CardContent>
        </Card>

        {/* Info firma */}
        {hc.estadoRegistro !== "borrador" && hc.firmadoEn && (
          <Card>
            <CardHeader>
              <CardTitle>Firma electrónica</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>
                <span className="text-muted-foreground">Firmado: </span>
                {dateFmt.format(hc.firmadoEn)}
              </p>
              {hc.estadoRegistro === "validado" && hc.validadoEn && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Validado: </span>
                  {dateFmt.format(hc.validadoEn)}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end">
          <Button variant="outline" onClick={() => router.push(`/ece/historia-clinica`)}>
            Volver al listado
          </Button>
        </div>
      </div>

      {/* Modal PIN firma electrónica */}
      <Dialog open={pinOpen} onOpenChange={handlePinClose}>
        <DialogContent aria-describedby="pin-desc">
          <DialogHeader>
            <DialogTitle>Firma electrónica</DialogTitle>
            <DialogDescription id="pin-desc">
              Ingrese su PIN de firma para suscribir esta historia clínica.
              Esta acción no se puede deshacer (NTEC Art. 7).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleFirmar} noValidate>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="firma-pin">PIN de firma</Label>
                <Input
                  id="firma-pin"
                  type="password"
                  inputMode="numeric"
                  placeholder="••••••"
                  autoComplete="current-password"
                  autoFocus
                  required
                  aria-required="true"
                  aria-describedby={pinError ? "pin-error" : undefined}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={firmar.isPending}
                />
                {pinError && (
                  <p
                    id="pin-error"
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
                aria-label="Confirmar firma electrónica"
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
