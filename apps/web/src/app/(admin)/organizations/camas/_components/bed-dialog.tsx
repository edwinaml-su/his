"use client";

/**
 * Diálogo crear/editar cama — extensión admin (roomId/bedType/billingClass/
 * glnCodigo, espejo Odoo ACS HMS hospital.bed + custom camas.config).
 * Encargo Edwin 2026-09-11. `bed === null` → modo alta; `bed` con datos →
 * edición. Sigue el patrón de `establishment-dialog.tsx` / `room-dialog.tsx`.
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

const SIN_ROOM = "__sin_habitacion__";
const SIN_TIPO = "__sin_tipo__";
const SIN_CLASE = "__sin_clase__";
const SIN_GLN = "__sin_gln__";

const BED_TYPES = [
  ["GATCH", "Gatch"],
  ["ELECTRICA", "Eléctrica"],
  ["CAMILLA", "Camilla"],
  ["BAJA", "Baja"],
  ["BAJA_PERDIDA_AIRE", "Baja de pérdida de aire"],
  ["CIRCO_ELECTRICA", "Circo-eléctrica"],
  ["CLINITRON", "Clinitron"],
] as const;

const BILLING_CLASSES = [
  ["GENERAL", "General"],
  ["ISBM", "ISBM"],
] as const;

export type BedData = {
  id: string;
  code: string;
  isolation: string | null;
  bedType: string | null;
  billingClass: string | null;
  glnCodigo: string | null;
  establishmentId?: string;
  serviceUnitId?: string;
  roomId?: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bed: BedData | null;
  onSaved: () => void;
};

export function BedDialog({ open, onOpenChange, bed, onSaved }: Props) {
  const isEdit = bed !== null;

  const [establishmentId, setEstablishmentId] = React.useState("");
  const [serviceUnitId, setServiceUnitId] = React.useState("");
  const [code, setCode] = React.useState("");
  const [roomId, setRoomId] = React.useState<string>(SIN_ROOM);
  const [bedType, setBedType] = React.useState<string>(SIN_TIPO);
  const [billingClass, setBillingClass] = React.useState<string>(SIN_CLASE);
  const [isolation, setIsolation] = React.useState("");
  const [glnCodigo, setGlnCodigo] = React.useState<string>(SIN_GLN);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const establishments = trpcAny.establishment.list.useQuery(undefined, { enabled: open });
  const serviceUnits = trpcAny.room.listServiceUnits.useQuery(
    { establishmentId },
    { enabled: open && establishmentId.length > 0 },
  );
  const rooms = trpcAny.room.list.useQuery(
    { establishmentId, serviceUnitId, activeOnly: true },
    { enabled: open && establishmentId.length > 0 && serviceUnitId.length > 0 },
  );
  const glns = trpcAny.gs1GlnHierarchy.glnsDisponibles.useQuery(
    { tipos: ["cama"] },
    { enabled: open },
  );

  React.useEffect(() => {
    if (!open) return;
    setEstablishmentId(bed?.establishmentId ?? "");
    setServiceUnitId(bed?.serviceUnitId ?? "");
    setCode(bed?.code ?? "");
    setRoomId(bed?.roomId ?? SIN_ROOM);
    setBedType(bed?.bedType ?? SIN_TIPO);
    setBillingClass(bed?.billingClass ?? SIN_CLASE);
    setIsolation(bed?.isolation ?? "");
    setGlnCodigo(bed?.glnCodigo ?? SIN_GLN);
    setErrorMsg(null);
  }, [open, bed]);

  const createMutation = trpcAny.bed.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const updateMutation = trpcAny.bed.update.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const codeValid = code.trim().length >= 1;
  const establishmentValid = establishmentId.length > 0;
  const serviceUnitValid = serviceUnitId.length > 0;
  const canSubmit = codeValid && establishmentValid && serviceUnitValid;

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);

    const shared = {
      serviceUnitId,
      roomId: roomId === SIN_ROOM ? undefined : roomId,
      isolation: isolation.trim() === "" ? undefined : isolation.trim(),
      bedType: bedType === SIN_TIPO ? undefined : (bedType as never),
      billingClass: billingClass === SIN_CLASE ? undefined : (billingClass as never),
      glnCodigo: glnCodigo === SIN_GLN ? undefined : glnCodigo,
    };

    if (isEdit && bed) {
      updateMutation.mutate({ id: bed.id, code: code.trim(), ...shared });
    } else {
      createMutation.mutate({ establishmentId, code: code.trim(), ...shared });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cama" : "Nueva cama"}</DialogTitle>
          <DialogDescription>
            {isEdit ? bed?.code : "Alta de una cama — tipo y clase de facturación espejo Odoo."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bed-establishment">Establecimiento</Label>
              <Select
                value={establishmentId}
                onValueChange={(v) => {
                  setEstablishmentId(v);
                  setServiceUnitId("");
                  setRoomId(SIN_ROOM);
                }}
                disabled={isPending}
              >
                <SelectTrigger id="bed-establishment">
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
              <Label htmlFor="bed-service-unit">Servicio</Label>
              <Select
                value={serviceUnitId}
                onValueChange={(v) => {
                  setServiceUnitId(v);
                  setRoomId(SIN_ROOM);
                }}
                disabled={isPending || !establishmentId}
              >
                <SelectTrigger id="bed-service-unit">
                  <SelectValue placeholder={establishmentId ? "Selecciona…" : "Elige establecimiento primero"} />
                </SelectTrigger>
                <SelectContent>
                  {(serviceUnits.data ?? []).map((s: { id: string; code: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bed-code">Código</Label>
              <Input
                id="bed-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isPending}
                maxLength={40}
                placeholder="Ej. CAMA_1"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bed-room">Habitación</Label>
              <Select value={roomId} onValueChange={setRoomId} disabled={isPending || !serviceUnitId}>
                <SelectTrigger id="bed-room">
                  <SelectValue placeholder={serviceUnitId ? "Sin habitación" : "Elige servicio primero"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_ROOM}>Sin habitación</SelectItem>
                  {(rooms.data ?? []).map((r: { id: string; code: string; name: string }) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.code} — {r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bed-type">Tipo de cama</Label>
              <Select value={bedType} onValueChange={setBedType} disabled={isPending}>
                <SelectTrigger id="bed-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_TIPO}>Sin especificar</SelectItem>
                  {BED_TYPES.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bed-billing">Clase de facturación</Label>
              <Select value={billingClass} onValueChange={setBillingClass} disabled={isPending}>
                <SelectTrigger id="bed-billing">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_CLASE}>Sin especificar</SelectItem>
                  {BILLING_CLASSES.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bed-isolation">Aislamiento</Label>
              <Input
                id="bed-isolation"
                value={isolation}
                onChange={(e) => setIsolation(e.target.value)}
                disabled={isPending}
                maxLength={40}
                placeholder="Ej. contacto, gotitas…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bed-gln">GLN (GS1)</Label>
              <Select value={glnCodigo} onValueChange={setGlnCodigo} disabled={isPending}>
                <SelectTrigger id="bed-gln">
                  <SelectValue placeholder="Sin GLN" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_GLN}>Sin GLN</SelectItem>
                  {(glns.data ?? []).map(
                    (g: { codigo: string; descripcion: string; asignadoA: string | null }) => (
                      <SelectItem key={g.codigo} value={g.codigo}>
                        {g.codigo} — {g.descripcion}
                        {g.asignadoA && g.codigo !== bed?.glnCodigo ? ` (ya asignado a ${g.asignadoA})` : ""}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
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
