"use client";

/**
 * Diálogo crear/editar habitación (Room, espejo hospital.ward de Odoo) —
 * encargo Edwin 2026-09-11. `room === null` → modo alta; `room` con datos →
 * edición. Sigue el patrón de `establishment-dialog.tsx`.
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
import { Textarea } from "@his/ui/components/textarea";
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

const SIN_GLN = "__sin_gln__";

const ROOM_TYPES = [
  ["GENERAL", "General"],
  ["SEMI_ESPECIAL", "Semi-especial"],
  ["DELUXE", "Deluxe"],
  ["SUPER_DELUXE", "Super deluxe"],
  ["SUITE", "Suite"],
  ["COMPARTIDA", "Compartida"],
  ["UCI", "UCI"],
  ["DIALISIS", "Diálisis"],
  ["RECUPERACION", "Recuperación"],
] as const;

const GENDER_POLICIES = [
  ["UNISEX", "Unisex"],
  ["HOMBRES", "Hombres"],
  ["MUJERES", "Mujeres"],
] as const;

const INVOICE_POLICIES = [
  ["DIA", "Por día"],
  ["HORA", "Por hora"],
] as const;

const AMENITIES: Array<[keyof AmenityState, string]> = [
  ["airConditioning", "Aire acondicionado"],
  ["television", "Televisión"],
  ["telephone", "Teléfono"],
  ["privateBathroom", "Baño privado"],
  ["internet", "Internet"],
  ["refrigerator", "Refrigeradora"],
  ["microwave", "Microondas"],
  ["guestSofa", "Sofá cama acompañante"],
];

type AmenityState = {
  airConditioning: boolean;
  television: boolean;
  telephone: boolean;
  privateBathroom: boolean;
  internet: boolean;
  refrigerator: boolean;
  microwave: boolean;
  guestSofa: boolean;
};

export type RoomData = {
  id: string;
  code: string;
  name: string;
  floor: string | null;
  roomType: string;
  genderPolicy: string;
  private: boolean;
  bioHazard: boolean;
  airConditioning: boolean;
  television: boolean;
  telephone: boolean;
  privateBathroom: boolean;
  internet: boolean;
  refrigerator: boolean;
  microwave: boolean;
  guestSofa: boolean;
  chargeCode: string | null;
  invoicePolicy: string;
  glnCodigo: string | null;
  notes: string | null;
  establishmentId?: string;
  serviceUnitId?: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  room: RoomData | null;
  onSaved: () => void;
};

const EMPTY_AMENITIES: AmenityState = {
  airConditioning: false,
  television: false,
  telephone: false,
  privateBathroom: false,
  internet: false,
  refrigerator: false,
  microwave: false,
  guestSofa: false,
};

export function RoomDialog({ open, onOpenChange, room, onSaved }: Props) {
  const isEdit = room !== null;

  const [establishmentId, setEstablishmentId] = React.useState("");
  const [serviceUnitId, setServiceUnitId] = React.useState("");
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [floor, setFloor] = React.useState("");
  const [roomType, setRoomType] = React.useState<string>("GENERAL");
  const [genderPolicy, setGenderPolicy] = React.useState<string>("UNISEX");
  const [invoicePolicy, setInvoicePolicy] = React.useState<string>("DIA");
  const [isPrivate, setIsPrivate] = React.useState(false);
  const [bioHazard, setBioHazard] = React.useState(false);
  const [amenities, setAmenities] = React.useState<AmenityState>(EMPTY_AMENITIES);
  const [chargeCode, setChargeCode] = React.useState("");
  const [glnCodigo, setGlnCodigo] = React.useState<string>(SIN_GLN);
  const [notes, setNotes] = React.useState("");
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const establishments = trpcAny.establishment.list.useQuery(undefined, { enabled: open });
  const serviceUnits = trpcAny.room.listServiceUnits.useQuery(
    { establishmentId },
    { enabled: open && establishmentId.length > 0 },
  );
  const glns = trpcAny.gs1GlnHierarchy.glnsDisponibles.useQuery(
    { tipos: ["cama"] },
    { enabled: open },
  );

  React.useEffect(() => {
    if (!open) return;
    setEstablishmentId(room?.establishmentId ?? "");
    setServiceUnitId(room?.serviceUnitId ?? "");
    setCode(room?.code ?? "");
    setName(room?.name ?? "");
    setFloor(room?.floor ?? "");
    setRoomType(room?.roomType ?? "GENERAL");
    setGenderPolicy(room?.genderPolicy ?? "UNISEX");
    setInvoicePolicy(room?.invoicePolicy ?? "DIA");
    setIsPrivate(room?.private ?? false);
    setBioHazard(room?.bioHazard ?? false);
    setAmenities({
      airConditioning: room?.airConditioning ?? false,
      television: room?.television ?? false,
      telephone: room?.telephone ?? false,
      privateBathroom: room?.privateBathroom ?? false,
      internet: room?.internet ?? false,
      refrigerator: room?.refrigerator ?? false,
      microwave: room?.microwave ?? false,
      guestSofa: room?.guestSofa ?? false,
    });
    setChargeCode(room?.chargeCode ?? "");
    setGlnCodigo(room?.glnCodigo ?? SIN_GLN);
    setNotes(room?.notes ?? "");
    setErrorMsg(null);
  }, [open, room]);

  const createMutation = trpcAny.room.create.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const updateMutation = trpcAny.room.update.useMutation({
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
    onError: (err: { message: string }) => setErrorMsg(err.message),
  });

  const isPending = createMutation.isPending || updateMutation.isPending;
  const codeValid = code.trim().length >= 1;
  const nameValid = name.trim().length >= 1;
  const establishmentValid = establishmentId.length > 0;
  const serviceUnitValid = serviceUnitId.length > 0;
  const canSubmit = codeValid && nameValid && establishmentValid && serviceUnitValid;

  function handleSubmit() {
    if (!canSubmit) return;
    setErrorMsg(null);
    const floorTrim = floor.trim();
    const chargeCodeTrim = chargeCode.trim();
    const notesTrim = notes.trim();
    const gln = glnCodigo === SIN_GLN ? undefined : glnCodigo;

    const shared = {
      serviceUnitId,
      name: name.trim(),
      floor: floorTrim === "" ? undefined : floorTrim,
      roomType: roomType as never,
      genderPolicy: genderPolicy as never,
      private: isPrivate,
      bioHazard,
      ...amenities,
      chargeCode: chargeCodeTrim === "" ? undefined : chargeCodeTrim,
      invoicePolicy: invoicePolicy as never,
      glnCodigo: gln,
      notes: notesTrim === "" ? undefined : notesTrim,
    };

    if (isEdit && room) {
      updateMutation.mutate({ id: room.id, ...shared });
    } else {
      createMutation.mutate({
        establishmentId,
        code: code.trim(),
        ...shared,
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar habitación" : "Nueva habitación"}</DialogTitle>
          <DialogDescription>
            {isEdit ? room?.name : "Alta de una habitación — espejo del modelo de Odoo (hospital.ward)."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="room-establishment">Establecimiento</Label>
              <Select
                value={establishmentId}
                onValueChange={(v) => {
                  setEstablishmentId(v);
                  setServiceUnitId("");
                }}
                disabled={isPending || isEdit}
              >
                <SelectTrigger id="room-establishment">
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
              <Label htmlFor="room-service-unit">Servicio</Label>
              <Select
                value={serviceUnitId}
                onValueChange={setServiceUnitId}
                disabled={isPending || !establishmentId}
              >
                <SelectTrigger id="room-service-unit">
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

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="room-code">Código</Label>
              <Input
                id="room-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={isPending || isEdit}
                maxLength={40}
                placeholder="Ej. SYDNEY"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="room-name">Nombre</Label>
              <Input
                id="room-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={isPending}
                maxLength={120}
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="room-floor">Piso</Label>
              <Input
                id="room-floor"
                value={floor}
                onChange={(e) => setFloor(e.target.value)}
                disabled={isPending}
                maxLength={10}
                placeholder="Opcional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-type">Tipo</Label>
              <Select value={roomType} onValueChange={setRoomType} disabled={isPending}>
                <SelectTrigger id="room-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROOM_TYPES.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-gender">Política de género</Label>
              <Select value={genderPolicy} onValueChange={setGenderPolicy} disabled={isPending}>
                <SelectTrigger id="room-gender">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_POLICIES.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-invoice">Facturación</Label>
              <Select value={invoicePolicy} onValueChange={setInvoicePolicy} disabled={isPending}>
                <SelectTrigger id="room-invoice">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVOICE_POLICIES.map(([v, label]) => (
                    <SelectItem key={v} value={v}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex items-center justify-between rounded-md border p-2.5">
              <Label htmlFor="room-private" className="text-sm font-normal">
                Habitación privada
              </Label>
              <Switch id="room-private" checked={isPrivate} onCheckedChange={setIsPrivate} disabled={isPending} />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2.5">
              <Label htmlFor="room-biohazard" className="text-sm font-normal">
                Riesgo biológico
              </Label>
              <Switch id="room-biohazard" checked={bioHazard} onCheckedChange={setBioHazard} disabled={isPending} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Amenidades</Label>
            <div className="grid grid-cols-2 gap-2">
              {AMENITIES.map(([key, label]) => (
                <div key={key} className="flex items-center justify-between rounded-md border p-2.5">
                  <Label htmlFor={`room-amenity-${key}`} className="text-sm font-normal">
                    {label}
                  </Label>
                  <Switch
                    id={`room-amenity-${key}`}
                    checked={amenities[key]}
                    onCheckedChange={(checked) =>
                      setAmenities((prev) => ({ ...prev, [key]: checked }))
                    }
                    disabled={isPending}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="room-charge-code">Código de cargo (tarifario)</Label>
              <Input
                id="room-charge-code"
                value={chargeCode}
                onChange={(e) => setChargeCode(e.target.value)}
                disabled={isPending}
                maxLength={40}
                placeholder="Opcional — pendiente cableado charge-capture"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="room-gln">GLN (GS1)</Label>
              <Select value={glnCodigo} onValueChange={setGlnCodigo} disabled={isPending}>
                <SelectTrigger id="room-gln">
                  <SelectValue placeholder="Sin GLN" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_GLN}>Sin GLN</SelectItem>
                  {(glns.data ?? []).map(
                    (g: { codigo: string; descripcion: string; asignadoA: string | null }) => (
                      <SelectItem key={g.codigo} value={g.codigo}>
                        {g.codigo} — {g.descripcion}
                        {g.asignadoA && g.codigo !== room?.glnCodigo ? ` (ya asignado a ${g.asignadoA})` : ""}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="room-notes">Notas</Label>
            <Textarea
              id="room-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={isPending}
              maxLength={2000}
              placeholder="Opcional"
              rows={2}
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
