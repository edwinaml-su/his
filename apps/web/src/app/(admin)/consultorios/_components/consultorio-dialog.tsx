"use client";

/**
 * Diálogo crear/editar consultorio — CC-0036 Ola 1B (REQ-HIS-AFIL-001
 * US.AFIL.1.1). `consultorio === null` → alta; con datos → edición. Sigue el
 * patrón de `room-dialog.tsx` (/organizations/habitaciones).
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

const SIN_SERVICIO = "__sin_servicio__";
const SIN_ESPECIALIDAD = "__sin_especialidad__";

const TIPOS_USO = [
  ["ARRENDADO", "Arrendado"],
  ["PROPIO", "Propio"],
  ["MIXTO", "Mixto"],
] as const;

export type ConsultorioData = {
  id: string;
  codigo: string;
  nombre: string;
  piso: string | null;
  areaM2: number | string | null;
  tipoUso: string;
  especialidadSugeridaId: string | null;
  capacidadPacientesHora: number | null;
  glnCodigo: string | null;
  establishmentId?: string;
  serviceUnitId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  consultorio: ConsultorioData | null;
  onSaved: () => void;
};

export function ConsultorioDialog({ open, onOpenChange, consultorio, onSaved }: Props) {
  const isEdit = consultorio !== null;

  const [establishmentId, setEstablishmentId] = React.useState("");
  const [serviceUnitId, setServiceUnitId] = React.useState<string>(SIN_SERVICIO);
  const [codigo, setCodigo] = React.useState("");
  const [nombre, setNombre] = React.useState("");
  const [piso, setPiso] = React.useState("");
  const [areaM2, setAreaM2] = React.useState("");
  const [tipoUso, setTipoUso] = React.useState<string>("PROPIO");
  const [especialidadSugeridaId, setEspecialidadSugeridaId] = React.useState<string>(SIN_ESPECIALIDAD);
  const [capacidad, setCapacidad] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const establishments = trpcAny.establishment.list.useQuery(undefined, { enabled: open });
  const serviceUnits = trpcAny.room.listServiceUnits.useQuery(
    { establishmentId },
    { enabled: open && establishmentId.length > 0 },
  );
  const specialties = trpcAny.catalog.list.useQuery(
    { catalog: "medicalSpecialty", activeOnly: true },
    { enabled: open },
  );

  React.useEffect(() => {
    if (!open) return;
    setEstablishmentId(consultorio?.establishmentId ?? "");
    setServiceUnitId(consultorio?.serviceUnitId ?? SIN_SERVICIO);
    setCodigo(consultorio?.codigo ?? "");
    setNombre(consultorio?.nombre ?? "");
    setPiso(consultorio?.piso ?? "");
    setAreaM2(consultorio?.areaM2 != null ? String(consultorio.areaM2) : "");
    setTipoUso(consultorio?.tipoUso ?? "PROPIO");
    setEspecialidadSugeridaId(consultorio?.especialidadSugeridaId ?? SIN_ESPECIALIDAD);
    setCapacidad(consultorio?.capacidadPacientesHora != null ? String(consultorio.capacidadPacientesHora) : "");
    setErrorMsg(null);
  }, [open, consultorio]);

  const createMutation = trpcAny.consultorio.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const updateMutation = trpcAny.consultorio.update.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const codigoValid = codigo.trim().length >= 1;
  const nombreValid = nombre.trim().length >= 1;
  const establishmentValid = establishmentId.length > 0;
  const canSubmit = codigoValid && nombreValid && establishmentValid;

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    // En edición, un campo opcional vaciado debe VIAJAR como `null` para que
    // el router lo borre (`consultorioUpdateSchema` distingue `undefined` =
    // "no tocar" de `null` = "limpiar"). En alta no hay valor previo que
    // borrar, así que se omite (`undefined`) — `consultorioCreateSchema` no
    // acepta `null` en esos campos.
    const empty = isEdit ? null : undefined;
    const pisoTrim = piso.trim();
    const areaNum = areaM2.trim() === "" ? empty : Number(areaM2);
    const capNum = capacidad.trim() === "" ? empty : Number(capacidad);

    const shared = {
      serviceUnitId: serviceUnitId === SIN_SERVICIO ? empty : serviceUnitId,
      nombre: nombre.trim(),
      piso: pisoTrim === "" ? empty : pisoTrim,
      areaM2: areaNum,
      tipoUso: tipoUso as never,
      especialidadSugeridaId:
        especialidadSugeridaId === SIN_ESPECIALIDAD ? empty : especialidadSugeridaId,
      capacidadPacientesHora: capNum,
    };

    if (isEdit && consultorio) {
      updateMutation.mutate({ id: consultorio.id, ...shared });
    } else {
      createMutation.mutate({ establishmentId, codigo: codigo.trim(), ...shared });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar consultorio" : "Nuevo consultorio"}</DialogTitle>
          <DialogDescription>
            {isEdit ? consultorio?.nombre : "Alta de un consultorio del catálogo (REQ-HIS-AFIL-001 US.AFIL.1.1)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-establishment">Sede (establecimiento)</Label>
              <Select
                value={establishmentId}
                onValueChange={(v) => {
                  setEstablishmentId(v);
                  setServiceUnitId(SIN_SERVICIO);
                }}
                disabled={isPending || isEdit}
              >
                <SelectTrigger id="consultorio-establishment">
                  <SelectValue placeholder="Selecciona…" />
                </SelectTrigger>
                <SelectContent>
                  {(establishments.data ?? []).map((e: { id: string; code: string; name: string }) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.code} — {e.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="consultorio-service-unit">Servicio (opcional)</Label>
              <Select value={serviceUnitId} onValueChange={setServiceUnitId} disabled={isPending || !establishmentId}>
                <SelectTrigger id="consultorio-service-unit">
                  <SelectValue placeholder={establishmentId ? "Selecciona…" : "Elige sede primero"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_SERVICIO}>Sin servicio asociado</SelectItem>
                  {(serviceUnits.data ?? []).map((s: { id: string; code: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-codigo">Código</Label>
              <Input
                id="consultorio-codigo"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                disabled={isPending || isEdit}
                maxLength={40}
                placeholder="Ej. CE-201"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="consultorio-nombre">Nombre</Label>
              <Input
                id="consultorio-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                disabled={isPending}
                maxLength={120}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-piso">Piso</Label>
              <Input
                id="consultorio-piso"
                value={piso}
                onChange={(e) => setPiso(e.target.value)}
                disabled={isPending}
                maxLength={20}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-area">Área (m²)</Label>
              <Input
                id="consultorio-area"
                type="number"
                min={0}
                value={areaM2}
                onChange={(e) => setAreaM2(e.target.value)}
                disabled={isPending}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-tipo-uso">Tipo de uso</Label>
              <Select value={tipoUso} onValueChange={setTipoUso} disabled={isPending}>
                <SelectTrigger id="consultorio-tipo-uso">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_USO.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="consultorio-capacidad">Cap./hora</Label>
              <Input
                id="consultorio-capacidad"
                type="number"
                min={1}
                value={capacidad}
                onChange={(e) => setCapacidad(e.target.value)}
                disabled={isPending}
                placeholder="Opcional"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="consultorio-especialidad">Especialidad sugerida (opcional)</Label>
            <Select value={especialidadSugeridaId} onValueChange={setEspecialidadSugeridaId} disabled={isPending}>
              <SelectTrigger id="consultorio-especialidad">
                <SelectValue placeholder="Sin especialidad sugerida" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_ESPECIALIDAD}>Sin especialidad sugerida</SelectItem>
                {(specialties.data ?? []).map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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
