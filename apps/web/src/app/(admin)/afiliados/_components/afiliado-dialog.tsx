"use client";

/**
 * Diálogo crear/editar médico afiliado — CC-0036 Ola 1B (REQ-HIS-AFIL-001
 * US.AFIL.1.2). `afiliado === null` → alta (queda en PROSPECTO); con datos →
 * edición de datos generales (JVPM y estado NO se editan acá — ver
 * `afiliados-shell.tsx` para transiciones de estado).
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
import { Switch } from "@his/ui/components/switch";
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

const SIN_ESPECIALIDAD = "__sin_especialidad__";

const TIPOS_RELACION = [
  ["AFILIADO_ARRENDATARIO", "Afiliado arrendatario"],
  ["AFILIADO_SIN_CONSULTORIO", "Afiliado sin consultorio"],
  ["STAFF_INTERNO", "Staff interno"],
] as const;

export type AfiliadoData = {
  id: string;
  nombreCompleto: string;
  jvpmNumero: string;
  especialidadPrincipalId: string | null;
  tipoRelacion: string;
  nit: string | null;
  nrc: string | null;
  esContribuyenteIva: boolean;
  estado: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  afiliado: AfiliadoData | null;
  onSaved: () => void;
};

export function AfiliadoDialog({ open, onOpenChange, afiliado, onSaved }: Props) {
  const isEdit = afiliado !== null;

  const [nombreCompleto, setNombreCompleto] = React.useState("");
  const [jvpmNumero, setJvpmNumero] = React.useState("");
  const [especialidadPrincipalId, setEspecialidadPrincipalId] = React.useState<string>(SIN_ESPECIALIDAD);
  const [tipoRelacion, setTipoRelacion] = React.useState<string>("AFILIADO_ARRENDATARIO");
  const [nit, setNit] = React.useState("");
  const [nrc, setNrc] = React.useState("");
  const [esContribuyenteIva, setEsContribuyenteIva] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const specialties = trpcAny.catalog.list.useQuery(
    { catalog: "medicalSpecialty", activeOnly: true },
    { enabled: open },
  );

  React.useEffect(() => {
    if (!open) return;
    setNombreCompleto(afiliado?.nombreCompleto ?? "");
    setJvpmNumero(afiliado?.jvpmNumero ?? "");
    setEspecialidadPrincipalId(afiliado?.especialidadPrincipalId ?? SIN_ESPECIALIDAD);
    setTipoRelacion(afiliado?.tipoRelacion ?? "AFILIADO_ARRENDATARIO");
    setNit(afiliado?.nit ?? "");
    setNrc(afiliado?.nrc ?? "");
    setEsContribuyenteIva(afiliado?.esContribuyenteIva ?? false);
    setErrorMsg(null);
  }, [open, afiliado]);

  const createMutation = trpcAny.medicoAfiliado.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const updateMutation = trpcAny.medicoAfiliado.update.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const nombreValid = nombreCompleto.trim().length >= 1;
  const jvpmValid = jvpmNumero.trim().length >= 1;
  const canSubmit = nombreValid && (isEdit || jvpmValid);

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    // En edición, un campo opcional vaciado debe viajar como `null` para que
    // el router lo borre (`medicoAfiliadoUpdateSchema` distingue `undefined`
    // = "no tocar" de `null` = "limpiar"). En alta se omite (`undefined`) —
    // `medicoAfiliadoCreateSchema` no acepta `null` en esos campos.
    const empty = isEdit ? null : undefined;
    const nitTrim = nit.trim();
    const nrcTrim = nrc.trim();
    const especialidad = especialidadPrincipalId === SIN_ESPECIALIDAD ? empty : especialidadPrincipalId;

    if (isEdit && afiliado) {
      updateMutation.mutate({
        id: afiliado.id,
        nombreCompleto: nombreCompleto.trim(),
        especialidadPrincipalId: especialidad,
        nit: nitTrim === "" ? empty : nitTrim,
        nrc: nrcTrim === "" ? empty : nrcTrim,
        esContribuyenteIva,
      });
    } else {
      createMutation.mutate({
        nombreCompleto: nombreCompleto.trim(),
        jvpmNumero: jvpmNumero.trim(),
        especialidadPrincipalId: especialidad,
        tipoRelacion: tipoRelacion as never,
        nit: nitTrim === "" ? empty : nitTrim,
        nrc: nrcTrim === "" ? empty : nrcTrim,
        esContribuyenteIva,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar médico afiliado" : "Nuevo médico afiliado"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? afiliado?.nombreCompleto
              : "Alta de un médico afiliado (REQ-HIS-AFIL-001 US.AFIL.1.2). Queda en estado PROSPECTO."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="afiliado-nombre">Nombre completo</Label>
              <Input
                id="afiliado-nombre"
                value={nombreCompleto}
                onChange={(e) => setNombreCompleto(e.target.value)}
                disabled={isPending}
                maxLength={200}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="afiliado-jvpm">JVPM</Label>
              <Input
                id="afiliado-jvpm"
                value={jvpmNumero}
                onChange={(e) => setJvpmNumero(e.target.value)}
                disabled={isPending || isEdit}
                maxLength={30}
                placeholder="Número JVPM"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="afiliado-tipo-relacion">Tipo de relación</Label>
              <Select
                value={tipoRelacion}
                onValueChange={setTipoRelacion}
                disabled={isPending || isEdit}
              >
                <SelectTrigger id="afiliado-tipo-relacion">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_RELACION.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="afiliado-especialidad">Especialidad principal (opcional)</Label>
            <Select value={especialidadPrincipalId} onValueChange={setEspecialidadPrincipalId} disabled={isPending}>
              <SelectTrigger id="afiliado-especialidad">
                <SelectValue placeholder="Sin especialidad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_ESPECIALIDAD}>Sin especialidad</SelectItem>
                {(specialties.data ?? []).map((s: { id: string; name: string }) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="afiliado-nit">NIT (opcional)</Label>
              <Input id="afiliado-nit" value={nit} onChange={(e) => setNit(e.target.value)} disabled={isPending} maxLength={40} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="afiliado-nrc">NRC (opcional)</Label>
              <Input id="afiliado-nrc" value={nrc} onChange={(e) => setNrc(e.target.value)} disabled={isPending} maxLength={20} />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border p-2.5">
            <Label htmlFor="afiliado-iva" className="text-sm font-normal">
              Contribuyente de IVA
            </Label>
            <Switch
              id="afiliado-iva"
              checked={esContribuyenteIva}
              onCheckedChange={setEsContribuyenteIva}
              disabled={isPending}
            />
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
