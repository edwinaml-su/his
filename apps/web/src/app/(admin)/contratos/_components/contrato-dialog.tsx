"use client";

/**
 * Diálogo de alta de contrato de arrendamiento — CC-0036 Ola 2
 * (REQ-HIS-AFIL-001 US.AFIL.1.3 AC1/AC3). Sigue el patrón de
 * `consultorio-dialog.tsx`: solo alta (sin edición — el contrato en
 * BORRADOR se activa/termina, no se edita en línea en esta ola).
 *
 * Afiliado limitado a estado ACTIVO (AC1) y consultorio limitado a
 * `activeOnly` — el server igual valida ambos, esto es solo UX.
 */
import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const trpcAny = trpc as any;

const DIAS_SEMANA = [
  ["0", "Domingo"],
  ["1", "Lunes"],
  ["2", "Martes"],
  ["3", "Miércoles"],
  ["4", "Jueves"],
  ["5", "Viernes"],
  ["6", "Sábado"],
] as const;

type JornadaDraft = { diaSemana: string; horaInicio: string; horaFin: string };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
};

export function ContratoDialog({ open, onOpenChange, onSaved }: Props) {
  const [medicoAfiliadoId, setMedicoAfiliadoId] = React.useState("");
  const [consultorioId, setConsultorioId] = React.useState("");
  const [modalidad, setModalidad] = React.useState<"EXCLUSIVO" | "COMPARTIDO_POR_JORNADA">(
    "EXCLUSIVO",
  );
  const [fechaInicio, setFechaInicio] = React.useState("");
  const [fechaFin, setFechaFin] = React.useState("");
  const [rentaMensual, setRentaMensual] = React.useState("");
  const [cuotaServicios, setCuotaServicios] = React.useState("");
  const [currencyId, setCurrencyId] = React.useState("");
  const [diaCorte, setDiaCorte] = React.useState("1");
  const [jornadas, setJornadas] = React.useState<JornadaDraft[]>([]);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const afiliados = trpcAny.medicoAfiliado.list.useQuery({ estado: "ACTIVO" }, { enabled: open });
  const consultorios = trpcAny.consultorio.list.useQuery({ activeOnly: true }, { enabled: open });
  const currencies = trpcAny.currency.list.useQuery(undefined, { enabled: open });

  React.useEffect(() => {
    if (!open) return;
    setMedicoAfiliadoId("");
    setConsultorioId("");
    setModalidad("EXCLUSIVO");
    setFechaInicio("");
    setFechaFin("");
    setRentaMensual("");
    setCuotaServicios("");
    setCurrencyId("");
    setDiaCorte("1");
    setJornadas([]);
    setErrorMsg(null);
  }, [open]);

  const createMutation = trpcAny.contrato.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending;
  const canSubmit =
    medicoAfiliadoId.length > 0 &&
    consultorioId.length > 0 &&
    fechaInicio.length > 0 &&
    currencyId.length > 0 &&
    Number(rentaMensual) > 0 &&
    (modalidad === "EXCLUSIVO" || jornadas.length > 0);

  function addJornada() {
    setJornadas((prev) => [...prev, { diaSemana: "1", horaInicio: "08:00", horaFin: "17:00" }]);
  }

  function updateJornada(idx: number, patch: Partial<JornadaDraft>) {
    setJornadas((prev) => prev.map((j, i) => (i === idx ? { ...j, ...patch } : j)));
  }

  function removeJornada(idx: number) {
    setJornadas((prev) => prev.filter((_, i) => i !== idx));
  }

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    createMutation.mutate({
      medicoAfiliadoId,
      consultorioId,
      modalidad,
      fechaInicio,
      fechaFin: fechaFin === "" ? undefined : fechaFin,
      rentaMensual: Number(rentaMensual),
      cuotaServicios: cuotaServicios === "" ? undefined : Number(cuotaServicios),
      currencyId,
      diaCorte: Number(diaCorte),
      ...(modalidad === "COMPARTIDO_POR_JORNADA"
        ? {
            jornadas: jornadas.map((j) => ({
              diaSemana: Number(j.diaSemana),
              horaInicio: j.horaInicio,
              horaFin: j.horaFin,
            })),
          }
        : {}),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo contrato de arrendamiento</DialogTitle>
          <DialogDescription>
            Queda en BORRADOR con folio automático (REQ-HIS-AFIL-001 US.AFIL.1.3). Se activa por
            separado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contrato-afiliado">Médico afiliado (ACTIVO)</Label>
              <Select value={medicoAfiliadoId} onValueChange={setMedicoAfiliadoId} disabled={isPending}>
                <SelectTrigger id="contrato-afiliado">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(afiliados.data ?? []).map((a: { id: string; nombreCompleto: string }) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombreCompleto}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contrato-consultorio">Consultorio</Label>
              <Select value={consultorioId} onValueChange={setConsultorioId} disabled={isPending}>
                <SelectTrigger id="contrato-consultorio">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(consultorios.data ?? []).map((c: { id: string; codigo: string; nombre: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.codigo} — {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contrato-modalidad">Modalidad</Label>
            <Select
              value={modalidad}
              onValueChange={(v) => setModalidad(v as "EXCLUSIVO" | "COMPARTIDO_POR_JORNADA")}
              disabled={isPending}
            >
              <SelectTrigger id="contrato-modalidad">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="EXCLUSIVO">Exclusivo</SelectItem>
                <SelectItem value="COMPARTIDO_POR_JORNADA">Compartido por jornada</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contrato-fecha-inicio">Fecha de inicio</Label>
              <Input
                id="contrato-fecha-inicio"
                type="date"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contrato-fecha-fin">Fecha de fin (opcional)</Label>
              <Input
                id="contrato-fecha-fin"
                type="date"
                value={fechaFin}
                onChange={(e) => setFechaFin(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contrato-renta">Renta mensual</Label>
              <Input
                id="contrato-renta"
                type="number"
                min={0}
                step="0.01"
                value={rentaMensual}
                onChange={(e) => setRentaMensual(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contrato-servicios">Cuota servicios</Label>
              <Input
                id="contrato-servicios"
                type="number"
                min={0}
                step="0.01"
                value={cuotaServicios}
                onChange={(e) => setCuotaServicios(e.target.value)}
                disabled={isPending}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contrato-moneda">Moneda</Label>
              <Select value={currencyId} onValueChange={setCurrencyId} disabled={isPending}>
                <SelectTrigger id="contrato-moneda">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(currencies.data ?? []).map((c: { id: string; isoCode: string }) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.isoCode}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contrato-dia-corte">Día de corte</Label>
              <Input
                id="contrato-dia-corte"
                type="number"
                min={1}
                max={31}
                value={diaCorte}
                onChange={(e) => setDiaCorte(e.target.value)}
                disabled={isPending}
              />
            </div>
          </div>

          {modalidad === "COMPARTIDO_POR_JORNADA" ? (
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <Label>Jornadas contratadas (requerida al menos 1 para activar)</Label>
                <Button type="button" size="sm" variant="outline" onClick={addJornada} disabled={isPending}>
                  + Jornada
                </Button>
              </div>
              {jornadas.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin jornadas agregadas todavía.</p>
              ) : null}
              {jornadas.map((j, idx) => (
                <div key={idx} className="grid grid-cols-4 items-end gap-2">
                  <Select
                    value={j.diaSemana}
                    onValueChange={(v) => updateJornada(idx, { diaSemana: v })}
                    disabled={isPending}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIAS_SEMANA.map(([v, label]) => (
                        <SelectItem key={v} value={v}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    type="time"
                    value={j.horaInicio}
                    onChange={(e) => updateJornada(idx, { horaInicio: e.target.value })}
                    disabled={isPending}
                  />
                  <Input
                    type="time"
                    value={j.horaFin}
                    onChange={(e) => updateJornada(idx, { horaFin: e.target.value })}
                    disabled={isPending}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => removeJornada(idx)}
                    disabled={isPending}
                  >
                    Quitar
                  </Button>
                </div>
              ))}
            </div>
          ) : null}

          {errorMsg && (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{errorMsg}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleSubmit} disabled={isPending || !canSubmit}>
            {isPending ? "Guardando…" : "Guardar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
