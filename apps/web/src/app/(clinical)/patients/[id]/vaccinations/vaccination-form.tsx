"use client";

/**
 * US-4.5 — Form de aplicación de dosis (vacunación PAI).
 *
 * Estado controlado simple (mismo patrón que catalog-form). Submit:
 *  1. trpc.vaccination.recordVaccination con `overrideAllergyAlert=false`.
 *  2. Si BAD_REQUEST con allergy hits → muestra confirm dialog y reintenta con override.
 *  3. Toast de éxito + invalida byPatient.
 *
 * El listado de vacunas viene de `vaccination.listVaccines` (catálogo del país tenant
 * + globales). Requiere router montado en `_app.ts` (cast `as any` mientras tanto).
 */
import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Toast, ToastDescription, ToastTitle } from "@his/ui/components/toast";
import { trpc } from "@/lib/trpc/react";

const ANATOMICAL_SITES = [
  { v: "left-deltoid", l: "Deltoides izquierdo" },
  { v: "right-deltoid", l: "Deltoides derecho" },
  { v: "left-anterolateral-thigh", l: "Muslo anterolateral izquierdo" },
  { v: "right-anterolateral-thigh", l: "Muslo anterolateral derecho" },
  { v: "left-gluteus", l: "Glúteo izquierdo" },
  { v: "right-gluteus", l: "Glúteo derecho" },
  { v: "oral", l: "Oral" },
  { v: "intranasal", l: "Intranasal" },
];

interface VaccinationFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patientId: string;
  presetVaccineId?: string;
}

interface VaccineRow {
  id: string;
  code: string;
  name: string;
  routeOfAdmin: string | null;
}

export function VaccinationForm({
  open,
  onOpenChange,
  patientId,
  presetVaccineId,
}: VaccinationFormProps) {
  // Cast hasta que vaccination router esté wireado en _app.ts.
  const trpcAny = trpc as unknown as {
    vaccination: {
      listVaccines: {
        useQuery: (input: { activeOnly: boolean }) => {
          data?: VaccineRow[];
          isLoading: boolean;
        };
      };
      recordVaccination: {
        useMutation: (opts: {
          onSuccess?: () => void;
          onError?: (err: { message: string }) => void;
        }) => {
          mutate: (input: Record<string, unknown>) => void;
          isPending: boolean;
        };
      };
      byPatient: { invalidate: (input: { patientId: string }) => void };
    };
  };
  const utils = trpc.useUtils() as unknown as {
    vaccination: { byPatient: { invalidate: (input: { patientId: string }) => void } };
  };

  const vaccinesQuery = trpcAny.vaccination.listVaccines.useQuery({ activeOnly: true });

  const [vaccineId, setVaccineId] = React.useState(presetVaccineId ?? "");
  const [doseNumber, setDoseNumber] = React.useState(1);
  const [administeredAt, setAdministeredAt] = React.useState(
    new Date().toISOString().slice(0, 16),
  );
  const [lotNumber, setLotNumber] = React.useState("");
  const [anatomicalSite, setAnatomicalSite] = React.useState("");
  const [reactionsObserved, setReactionsObserved] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [allergyOverridePending, setAllergyOverridePending] = React.useState(false);
  const [toast, setToast] = React.useState<{ title: string; variant?: "success" | "destructive" } | null>(
    null,
  );

  React.useEffect(() => {
    if (open) {
      setVaccineId(presetVaccineId ?? "");
      setDoseNumber(1);
      setAdministeredAt(new Date().toISOString().slice(0, 16));
      setLotNumber("");
      setAnatomicalSite("");
      setReactionsObserved("");
      setNotes("");
      setError(null);
      setAllergyOverridePending(false);
    }
  }, [open, presetVaccineId]);

  const record = trpcAny.vaccination.recordVaccination.useMutation({
    onSuccess: () => {
      utils.vaccination.byPatient.invalidate({ patientId });
      setToast({ title: "Dosis registrada", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => {
      // Heurística: si menciona "alergia(s)", proponemos override.
      if (err.message.toLowerCase().includes("alergia")) {
        setAllergyOverridePending(true);
        setError(err.message);
      } else {
        setError(err.message);
      }
    },
  });

  function submit(override: boolean): void {
    setError(null);
    if (!vaccineId) {
      setError("Selecciona una vacuna.");
      return;
    }
    if (!administeredAt) {
      setError("La fecha de aplicación es requerida.");
      return;
    }
    record.mutate({
      patientId,
      vaccineId,
      doseNumber,
      administeredAt: new Date(administeredAt),
      lotNumber: lotNumber || undefined,
      anatomicalSite: anatomicalSite || undefined,
      reactionsObserved: reactionsObserved || undefined,
      notes: notes || undefined,
      overrideAllergyAlert: override,
    });
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aplicar dosis</DialogTitle>
            <DialogDescription>
              Registra la administración de una dosis siguiendo el calendario PAI.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div>
              <Label htmlFor="vac-vaccine">Vacuna</Label>
              <select
                id="vac-vaccine"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={vaccineId}
                onChange={(e) => setVaccineId(e.target.value)}
                disabled={vaccinesQuery.isLoading}
              >
                <option value="">— Selecciona —</option>
                {(vaccinesQuery.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="vac-dose">Número de dosis</Label>
                <Input
                  id="vac-dose"
                  type="number"
                  min={1}
                  max={20}
                  value={doseNumber}
                  onChange={(e) => setDoseNumber(parseInt(e.target.value, 10) || 1)}
                />
              </div>
              <div>
                <Label htmlFor="vac-date">Fecha y hora</Label>
                <Input
                  id="vac-date"
                  type="datetime-local"
                  value={administeredAt}
                  onChange={(e) => setAdministeredAt(e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="vac-lot">Lote</Label>
                <Input
                  id="vac-lot"
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Ej. AB12345"
                />
              </div>
              <div>
                <Label htmlFor="vac-site">Sitio anatómico</Label>
                <select
                  id="vac-site"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={anatomicalSite}
                  onChange={(e) => setAnatomicalSite(e.target.value)}
                >
                  <option value="">—</option>
                  {ANATOMICAL_SITES.map((s) => (
                    <option key={s.v} value={s.v}>
                      {s.l}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <Label htmlFor="vac-reactions">Reacciones observadas</Label>
              <Input
                id="vac-reactions"
                value={reactionsObserved}
                onChange={(e) => setReactionsObserved(e.target.value)}
                placeholder="(opcional)"
              />
            </div>
            <div>
              <Label htmlFor="vac-notes">Notas</Label>
              <Input
                id="vac-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="(opcional)"
              />
            </div>

            {error && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            {allergyOverridePending ? (
              <Button
                variant="destructive"
                onClick={() => submit(true)}
                disabled={record.isPending}
              >
                Confirmar override y registrar
              </Button>
            ) : (
              <Button onClick={() => submit(false)} disabled={record.isPending}>
                {record.isPending ? "Registrando…" : "Registrar dosis"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {toast && (
        <Toast
          variant={toast.variant ?? "default"}
          open={Boolean(toast)}
          onOpenChange={(o) => !o && setToast(null)}
        >
          <ToastTitle>{toast.title}</ToastTitle>
          <ToastDescription>Vacunación actualizada.</ToastDescription>
        </Toast>
      )}
    </>
  );
}
