// @ts-nocheck — UI shape mismatch con router F2-S2; refinar en F2-S3.
"use client";

/**
 * §ECE — Historia Clínica Electrónica — Detalle con firma electrónica.
 *
 * - Carga HC por ID vía `eceHistoriaClinica.get`.
 * - Muestra estado workflow y secciones clínicas en modo lectura.
 * - Botón "Firmar" disponible solo en estado BORRADOR; abre modal PIN.
 * - Modal PIN llama a `eceHistoriaClinica.firmar` con el código.
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
import { WorkflowBadge, type HcEstado } from "../_components/workflow-badge";

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "long",
  timeStyle: "medium",
});

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
      // Re-fetch para actualizar estado workflow
      void query.refetch();
    },
    onError: (err) => {
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
    firmar.mutate({ id: params.id, pin: pin.trim() });
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
      <p className="text-sm text-muted-foreground">
        Historia clínica no encontrada.
      </p>
    );
  }

  // El router devuelve campos snake_case + un subset minimal. El detalle
  // usa nombres expandidos (signosVitales, diagnosticos, etc.) que llegarán
  // en iteraciones posteriores — cast tolerante mientras tanto.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hc = query.data as any;
  const esBorrador = hc.estado === "BORRADOR" || hc.estado === "borrador";

  return (
    <>
      <div className="space-y-4">
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">Historia Clínica</h1>
              <WorkflowBadge estado={hc.estado as HcEstado} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {hc.patient
                ? `${hc.patient.firstName} ${hc.patient.lastName} · MRN ${hc.patient.mrn ?? "—"}`
                : "—"}
              {" · "}
              Creada: {dateFmt.format(new Date(hc.createdAt))}
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

        {/* Datos generales */}
        <Card>
          <CardHeader>
            <CardTitle>Datos generales</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <p className="font-medium text-muted-foreground">Motivo de consulta</p>
              <p className="mt-0.5">{hc.motivoConsulta ?? "—"}</p>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div>
                <p className="font-medium text-muted-foreground">Antecedentes personales</p>
                <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentesPersonales ?? "—"}</p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground">Antecedentes familiares</p>
                <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentesFamiliares ?? "—"}</p>
              </div>
              <div>
                <p className="font-medium text-muted-foreground">Antecedentes sociales</p>
                <p className="mt-0.5 whitespace-pre-wrap">{hc.antecedentesSociales ?? "—"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Examen físico */}
        <Card>
          <CardHeader>
            <CardTitle>Examen físico</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {hc.signosVitales && (
              <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 md:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground">PA (mmHg)</p>
                  <p className="font-medium tabular-nums">
                    {hc.signosVitales.paSistolica ?? "—"}/
                    {hc.signosVitales.paDiastolica ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">FC (lpm)</p>
                  <p className="font-medium tabular-nums">
                    {hc.signosVitales.frecuenciaCardiaca ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">FR (rpm)</p>
                  <p className="font-medium tabular-nums">
                    {hc.signosVitales.frecuenciaRespiratoria ?? "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Temp (°C)</p>
                  <p className="font-medium tabular-nums">
                    {hc.signosVitales.temperatura ?? "—"}
                  </p>
                </div>
              </div>
            )}
            <div>
              <p className="font-medium text-muted-foreground">Hallazgos por aparato</p>
              <p className="mt-0.5 whitespace-pre-wrap">{hc.hallazgosAparato ?? "—"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Diagnósticos */}
        <Card>
          <CardHeader>
            <CardTitle>Diagnósticos (CIE-10)</CardTitle>
          </CardHeader>
          <CardContent>
            {hc.diagnosticos && hc.diagnosticos.length > 0 ? (
              <ul className="space-y-1 text-sm" aria-label="Lista de diagnósticos CIE-10">
                {hc.diagnosticos.map((dx, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">{dx.codigoCie10}</span>
                    <span>{dx.descripcion}</span>
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
            <p className="whitespace-pre-wrap text-sm">{hc.planTerapeutico ?? "—"}</p>
          </CardContent>
        </Card>

        {/* Info firma */}
        {hc.estado !== "BORRADOR" && hc.firmadoEn && (
          <Card>
            <CardHeader>
              <CardTitle>Firma electrónica</CardTitle>
            </CardHeader>
            <CardContent className="text-sm">
              <p>
                <span className="text-muted-foreground">Firmado: </span>
                {dateFmt.format(new Date(hc.firmadoEn))}
              </p>
              {hc.estado === "VALIDADO" && hc.validadoEn && (
                <p className="mt-1">
                  <span className="text-muted-foreground">Validado: </span>
                  {dateFmt.format(new Date(hc.validadoEn))}
                </p>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Modal PIN firma electrónica */}
      <Dialog open={pinOpen} onOpenChange={handlePinClose}>
        <DialogContent aria-describedby="pin-desc">
          <DialogHeader>
            <DialogTitle>Firma electrónica</DialogTitle>
            <DialogDescription id="pin-desc">
              Ingrese su PIN de firma para suscribir esta historia clínica.
              Esta acción no se puede deshacer.
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
