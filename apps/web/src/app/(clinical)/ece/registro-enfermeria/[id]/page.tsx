"use client";

/**
 * ECE — MAR (Medication Administration Record) del turno.
 *
 * Vista por paciente (inpatientAdmission.id). Muestra:
 *   1. Indicaciones pendientes (tabla horarios, por prescriptionItem).
 *   2. Modal BCMA: 5 correctos + scan/manual.
 *   3. Historial de administraciones de la jornada.
 *
 * La tabla de indicaciones usa medicationAdmin.list filtrada por prescriptionItemIds
 * del paciente. En MVP los prescriptionItemIds se carga desde el router emar; la
 * integración completa con indicacion_item ECE llega en la siguiente iteración.
 *
 * Rol habilitado: ENF.
 */

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Textarea } from "@his/ui/components/textarea";
import { trpc } from "@/lib/trpc/react";
import { computeScheduledSlot } from "@/lib/medication-slot";

// ─── Tipos internos ─────────────────────────────────────────────────────────

type RouteVia =
  | "ORAL"
  | "IV"
  | "IM"
  | "SC"
  | "TOPICAL"
  | "INHALED"
  | "RECTAL"
  | "SUBLINGUAL"
  | "OPHTHALMIC"
  | "OTIC"
  | "NASAL";

type AdminStatus =
  | "ADMINISTERED"
  | "GIVEN"
  | "HELD"
  | "REFUSED"
  | "MISSED"
  | "DOCUMENTED_LATE"
  | "SCHEDULED";

interface BcmaForm {
  prescriptionItemId: string;
  drugName: string;
  /**
   * Slot programado derivado de `computeScheduledSlot(signedAt, frequency)`.
   * Se envía al endpoint para que la 5R Right Time pueda evaluar la ventana
   * de tiempo real (±N min). `null` cuando no hay grilla (admin manual o
   * frecuencia desconocida) — el guard del backend solo activa cuando llega
   * un Date.
   */
  scheduledTime: Date | null;
  // 5 correctos
  patientBarcodeScanned: boolean;
  drugBarcodeScanned: boolean;
  providerBadgeScanned: boolean;
  // Overrides manuales
  patientManual: string;
  drugManual: string;
  providerManual: string;
  // Datos de administración
  doseAmount: string;
  doseUnit: string;
  route: RouteVia | "";
  site: string;
  notes: string;
}

const BCMA_INITIAL: BcmaForm = {
  prescriptionItemId: "",
  drugName: "",
  scheduledTime: null,
  patientBarcodeScanned: false,
  drugBarcodeScanned: false,
  providerBadgeScanned: false,
  patientManual: "",
  drugManual: "",
  providerManual: "",
  doseAmount: "",
  doseUnit: "",
  route: "",
  site: "",
  notes: "",
};

const ROUTE_OPTS: { value: RouteVia; label: string }[] = [
  { value: "ORAL", label: "Oral" },
  { value: "IV", label: "IV" },
  { value: "IM", label: "IM" },
  { value: "SC", label: "SC" },
  { value: "TOPICAL", label: "Tópica" },
  { value: "INHALED", label: "Inhalada" },
  { value: "RECTAL", label: "Rectal" },
  { value: "SUBLINGUAL", label: "Sublingual" },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const timeFmt = new Intl.DateTimeFormat("es-SV", { timeStyle: "short" });
const dtFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "short",
  timeStyle: "short",
});

function statusBadge(s: AdminStatus) {
  const map: Record<AdminStatus, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    ADMINISTERED: { label: "Administrado", variant: "default" },
    GIVEN:        { label: "Dado", variant: "default" },
    HELD:         { label: "Pendiente", variant: "secondary" },
    REFUSED:      { label: "Rechazado", variant: "destructive" },
    MISSED:       { label: "Omitido", variant: "destructive" },
    DOCUMENTED_LATE: { label: "Doc. tardía", variant: "outline" },
    SCHEDULED:    { label: "Programado", variant: "secondary" },
  };
  const cfg = map[s] ?? { label: s, variant: "outline" as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function ScanField({
  id,
  label,
  scanned,
  onScan,
  manualValue,
  onManual,
}: {
  id: string;
  label: string;
  scanned: boolean;
  onScan: () => void;
  manualValue: string;
  onManual: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label htmlFor={id}>{label}</Label>
        <Badge variant={scanned ? "default" : "outline"}>
          {scanned ? "Verificado" : "Pendiente"}
        </Badge>
      </div>
      <div className="flex gap-2">
        <Input
          id={id}
          placeholder="Escanear o ingresar código"
          value={manualValue}
          onChange={(e) => onManual(e.target.value)}
          className="font-mono text-sm"
          aria-label={`Código ${label}`}
        />
        <Button
          type="button"
          size="sm"
          variant={scanned ? "outline" : "default"}
          onClick={onScan}
          aria-pressed={scanned}
        >
          {scanned ? "Quitar" : "Verificar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Usa el lector de código de barras o ingresa el código manualmente.
      </p>
    </div>
  );
}

// ─── Modal BCMA ──────────────────────────────────────────────────────────────

function BcmaModal({
  open,
  form,
  onClose,
  onFormChange,
  onSubmit,
  isSubmitting,
  error,
}: {
  open: boolean;
  form: BcmaForm;
  onClose: () => void;
  onFormChange: <K extends keyof BcmaForm>(key: K, value: BcmaForm[K]) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  error: string | null;
}) {
  const bcmaComplete =
    form.patientBarcodeScanned &&
    form.drugBarcodeScanned &&
    form.providerBadgeScanned;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Administrar medicamento — BCMA</DialogTitle>
          <DialogDescription>
            Verifique los 5 correctos antes de administrar:
            paciente, medicamento, dosis, vía y hora.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Datos del medicamento */}
          <div className="rounded-md bg-muted/40 p-3 text-sm">
            <p>
              <span className="font-medium">Medicamento:</span>{" "}
              {form.drugName || "—"}
            </p>
            <p>
              <span className="font-medium">Hora programada:</span>{" "}
              {form.scheduledTime ? dtFmt.format(form.scheduledTime) : "—"}
            </p>
          </div>

          {/* Los 5 correctos — Scans */}
          <section aria-label="Verificación BCMA">
            <p className="mb-2 text-sm font-semibold text-foreground">
              Verificación BCMA (5 correctos)
            </p>
            <div className="space-y-3">
              <ScanField
                id="bcma-patient"
                label="1. Paciente (brazalete)"
                scanned={form.patientBarcodeScanned}
                onScan={() => onFormChange("patientBarcodeScanned", !form.patientBarcodeScanned)}
                manualValue={form.patientManual}
                onManual={(v) => onFormChange("patientManual", v)}
              />
              <ScanField
                id="bcma-drug"
                label="2. Medicamento"
                scanned={form.drugBarcodeScanned}
                onScan={() => onFormChange("drugBarcodeScanned", !form.drugBarcodeScanned)}
                manualValue={form.drugManual}
                onManual={(v) => onFormChange("drugManual", v)}
              />
              <ScanField
                id="bcma-provider"
                label="3. Proveedor (gafete)"
                scanned={form.providerBadgeScanned}
                onScan={() => onFormChange("providerBadgeScanned", !form.providerBadgeScanned)}
                manualValue={form.providerManual}
                onManual={(v) => onFormChange("providerManual", v)}
              />
            </div>
          </section>

          {/* Dosis y vía (correctos 4 y 5) */}
          <section aria-label="Dosis y vía">
            <p className="mb-2 text-sm font-semibold text-foreground">
              4. Dosis &amp; 5. Vía de administración
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="modal-dose-amount">Dosis administrada</Label>
                <Input
                  id="modal-dose-amount"
                  type="number"
                  step="0.0001"
                  min="0"
                  value={form.doseAmount}
                  onChange={(e) => onFormChange("doseAmount", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="modal-dose-unit">Unidad</Label>
                <Input
                  id="modal-dose-unit"
                  placeholder="mg, ml, UI"
                  value={form.doseUnit}
                  onChange={(e) => onFormChange("doseUnit", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="modal-route">Vía</Label>
                <select
                  id="modal-route"
                  value={form.route}
                  onChange={(e) => onFormChange("route", e.target.value as RouteVia | "")}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  <option value="">Sin especificar</option>
                  {ROUTE_OPTS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="modal-site">Sitio anatómico</Label>
                <Input
                  id="modal-site"
                  placeholder="brazo izq., abdomen..."
                  value={form.site}
                  onChange={(e) => onFormChange("site", e.target.value)}
                />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="modal-notes">Notas</Label>
                <textarea
                  id="modal-notes"
                  rows={2}
                  value={form.notes}
                  onChange={(e) => onFormChange("notes", e.target.value)}
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                />
              </div>
            </div>
          </section>

          {/* Estado BCMA */}
          {!bcmaComplete && (
            <p role="status" className="text-sm text-amber-600">
              Faltan verificaciones BCMA. Los 3 scans son obligatorios para
              registrar como &quot;Administrado&quot;.
            </p>
          )}

          {error && (
            <p role="alert" aria-live="assertive" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={onSubmit}
            disabled={isSubmitting || !bcmaComplete}
            aria-disabled={!bcmaComplete}
          >
            {isSubmitting ? "Registrando…" : "Confirmar administración"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── SBAR Handoff ─────────────────────────────────────────────────────────────

interface SbarForm {
  situation:      string;
  background:     string;
  assessment:     string;
  recommendation: string;
}

const SBAR_EMPTY: SbarForm = {
  situation:      "",
  background:     "",
  assessment:     "",
  recommendation: "",
};

/** Tooltip inline con la definición de cada componente SBAR. */
function SbarTooltip({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="font-medium text-sm">{label}</span>
      <span className="text-xs text-muted-foreground">— {hint}</span>
    </div>
  );
}

/**
 * Modal de cierre de turno con formulario SBAR.
 * JCI Standard: IPSG.2 ME 4 — structured handoff.
 */
function CierreTurnoModal({
  open,
  registroId,
  onClose,
}: {
  open:       boolean;
  registroId: string;
  onClose:    () => void;
}) {
  const [form, setForm] = React.useState<SbarForm>(SBAR_EMPTY);
  const [skipSbar, setSkipSbar] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);

  const cerrarMutation = trpc.eceRegistroEnfermeria.cerrarTurno.useMutation({
    onSuccess: (data: unknown) => {
      const result = data as { warning?: string };
      if (result.warning) {
        setWarning(result.warning);
      } else {
        onClose();
      }
    },
    onError: (err: { message: string }) => {
      setWarning(err.message);
    },
  });

  function updateField(field: keyof SbarForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  function submit() {
    const sbarValido =
      !skipSbar &&
      form.situation.trim().length >= 10 &&
      form.background.trim().length >= 10 &&
      form.assessment.trim().length >= 10 &&
      form.recommendation.trim().length >= 10;

    // SBAR es siempre required en el contrato (eceCierreSchema). Si el usuario
    // marcó skipSbar (turno sin paciente activo) o algún campo no llega a 10
    // chars, el servidor lo rechaza vía Zod min(5). Bloqueamos en UI primero
    // como defensa en profundidad — UX más amigable que el round-trip al server.
    if (!sbarValido) {
      setWarning(
        skipSbar
          ? "SBAR es obligatorio (JCI IPSG.2 ME 4). Desmarque 'omitir SBAR' y complete el handoff."
          : "Cada campo SBAR requiere mínimo 10 caracteres.",
      );
      return;
    }

    cerrarMutation.mutate({
      id:   registroId,
      sbar: form,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cierre de turno — Handoff SBAR</DialogTitle>
          <DialogDescription>
            JCI IPSG.2 ME 4: registre el handoff estructurado para el enfermero/a entrante.
            Cada campo requiere mínimo 10 caracteres.
          </DialogDescription>
        </DialogHeader>

        {!skipSbar && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <SbarTooltip
                label="S — Situación"
                hint="Estado actual del paciente al cierre de turno."
              />
              <Textarea
                id="sbar-situation"
                rows={3}
                placeholder="Ej: Paciente post-quirúrgico, hemodinámicamente estable…"
                value={form.situation}
                onChange={(e) => updateField("situation", e.target.value)}
                aria-label="Situación SBAR"
              />
            </div>

            <div className="space-y-1.5">
              <SbarTooltip
                label="B — Background (antecedentes)"
                hint="Información clínica relevante para el turno entrante."
              />
              <Textarea
                id="sbar-background"
                rows={3}
                placeholder="Ej: Colecistectomía laparoscópica hace 6h, sin alergias conocidas…"
                value={form.background}
                onChange={(e) => updateField("background", e.target.value)}
                aria-label="Antecedentes SBAR"
              />
            </div>

            <div className="space-y-1.5">
              <SbarTooltip
                label="A — Assessment (evaluación)"
                hint="Juicio clínico de enfermería: tendencias y preocupaciones."
              />
              <Textarea
                id="sbar-assessment"
                rows={3}
                placeholder="Ej: Dolor controlado EVA 3/10, signos vitales estables…"
                value={form.assessment}
                onChange={(e) => updateField("assessment", e.target.value)}
                aria-label="Evaluación SBAR"
              />
            </div>

            <div className="space-y-1.5">
              <SbarTooltip
                label="R — Recommendation"
                hint="Acciones pendientes o recomendadas para el siguiente turno."
              />
              <Textarea
                id="sbar-recommendation"
                rows={3}
                placeholder="Ej: Control de signos vitales c/4h, analgesia PRN, deambulación al despertar…"
                value={form.recommendation}
                onChange={(e) => updateField("recommendation", e.target.value)}
                aria-label="Recomendaciones SBAR"
              />
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            id="skip-sbar"
            type="checkbox"
            checked={skipSbar}
            onChange={(e) => setSkipSbar(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          <label htmlFor="skip-sbar">
            Cerrar sin SBAR (sin enfermero/a entrante disponible)
          </label>
        </div>

        {warning && (
          <p role="status" className="text-sm text-amber-600 rounded-md bg-amber-50 p-2">
            {warning}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={cerrarMutation.isPending}>
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={cerrarMutation.isPending}
          >
            {cerrarMutation.isPending ? "Cerrando…" : "Confirmar cierre de turno"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const admissionId = params.id;

  // Historial de administraciones de la jornada (últimas 50 del turno actual)
  const historyQuery = trpc.medicationAdmin.list.useQuery({
    limit: 50,
  });

  // Estado del modal SBAR cierre de turno
  const [cierreOpen, setCierreOpen] = React.useState(false);

  // Estado del modal BCMA
  const [modalOpen, setModalOpen] = React.useState(false);
  const [bcmaForm, setBcmaForm] = React.useState<BcmaForm>(BCMA_INITIAL);
  const [bcmaError, setBcmaError] = React.useState<string | null>(null);

  const recordMutation = trpc.medicationAdmin.record.useMutation({
    onSuccess: () => {
      setModalOpen(false);
      setBcmaForm(BCMA_INITIAL);
      setBcmaError(null);
      void historyQuery.refetch();
    },
    onError: (err: { message: string }) => {
      setBcmaError(err.message);
    },
  });

  function openBcmaModal(prescriptionItemId: string, drugName: string, scheduledTime: Date | null) {
    setBcmaForm({
      ...BCMA_INITIAL,
      prescriptionItemId,
      drugName,
      scheduledTime,
    });
    setBcmaError(null);
    setModalOpen(true);
  }

  function updateBcma<K extends keyof BcmaForm>(key: K, value: BcmaForm[K]) {
    setBcmaForm((f) => ({ ...f, [key]: value }));
  }

  function submitBcma() {
    if (!bcmaForm.prescriptionItemId) {
      setBcmaError("Item de prescripción no definido.");
      return;
    }
    if (!bcmaForm.patientBarcodeScanned || !bcmaForm.drugBarcodeScanned || !bcmaForm.providerBadgeScanned) {
      setBcmaError("Complete los 3 scans BCMA antes de administrar.");
      return;
    }
    recordMutation.mutate({
      prescriptionItemId: bcmaForm.prescriptionItemId,
      status: "ADMINISTERED",
      patientBarcodeScanned: bcmaForm.patientBarcodeScanned,
      drugBarcodeScanned: bcmaForm.drugBarcodeScanned,
      providerBadgeScanned: bcmaForm.providerBadgeScanned,
      patientWristbandScanned: bcmaForm.patientBarcodeScanned,
      doseAmount: bcmaForm.doseAmount ? Number(bcmaForm.doseAmount) : undefined,
      doseUnit: bcmaForm.doseUnit || undefined,
      route: bcmaForm.route || undefined,
      site: bcmaForm.site || undefined,
      notes: bcmaForm.notes || undefined,
      // Sólo enviar scheduledTime cuando se conoce el slot (admin desde
      // pendingRows). En admin manual queda `null` y el backend omite la
      // regla Right Time.
      scheduledTime: bcmaForm.scheduledTime ?? undefined,
    });
  }

  /**
   * Tabla de horarios pendientes — MVP stub.
   * En producción se obtendrá de ece.indicacion_item; el `scheduledTime` de
   * cada fila se calculará con `computeScheduledSlot(signedAt, frequency)`
   * (no con `new Date()`) para que la regla 5R Right Time del backend
   * funcione efectivamente. Hoy la lista queda vacía y se utiliza el botón
   * "Administrar manual" que crea un slot null (sin Right Time).
   */
  const pendingRows: { id: string; drugName: string; dose: string; route: string; scheduledTime: Date }[] = [];

  const historyRows = historyQuery.data ?? [];

  return (
    <>
      <CierreTurnoModal
        open={cierreOpen}
        registroId={admissionId}
        onClose={() => setCierreOpen(false)}
      />

      <BcmaModal
        open={modalOpen}
        form={bcmaForm}
        onClose={() => setModalOpen(false)}
        onFormChange={updateBcma}
        onSubmit={submitBcma}
        isSubmitting={recordMutation.isPending}
        error={bcmaError}
      />

      <div className="space-y-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">MAR — Registro de administración</h1>
            <p className="text-sm text-muted-foreground">
              Medication Administration Record — Admisión{" "}
              <span className="font-mono text-xs">{admissionId}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setCierreOpen(true)}
            >
              Cerrar turno
            </Button>
            <Button type="button" variant="outline" onClick={() => router.back()}>
              Volver
            </Button>
          </div>
        </div>

        {/* Horarios pendientes */}
        <Card>
          <CardHeader>
            <CardTitle>Indicaciones pendientes</CardTitle>
          </CardHeader>
          <CardContent>
            {pendingRows.length === 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Sin indicaciones programadas para este turno.
                </p>
                <p className="text-xs text-muted-foreground">
                  La integración con indicacion_item ECE se completa en la
                  siguiente iteración. Use el botón &quot;Administrar manual&quot; para
                  registrar una administración con prescriptionItemId conocido.
                </p>
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openBcmaModal("", "Medicamento manual", null)}
                >
                  Administrar manual
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Medicamento</TableHead>
                    <TableHead>Dosis</TableHead>
                    <TableHead>Vía</TableHead>
                    <TableHead>Hora prog.</TableHead>
                    <TableHead className="sr-only">Acción</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.drugName}</TableCell>
                      <TableCell>{row.dose}</TableCell>
                      <TableCell>{row.route}</TableCell>
                      <TableCell className="tabular-nums">{dtFmt.format(row.scheduledTime)}</TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          onClick={() =>
                            openBcmaModal(row.id, row.drugName, row.scheduledTime)
                          }
                        >
                          Administrar
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Historial del turno */}
        <Card>
          <CardHeader>
            <CardTitle>Historial de administraciones — jornada</CardTitle>
          </CardHeader>
          <CardContent>
            {historyQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Cargando…</p>
            )}
            {historyQuery.error && (
              <p role="alert" className="text-sm text-destructive">
                {historyQuery.error.message}
              </p>
            )}
            {!historyQuery.isLoading && historyRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Sin administraciones registradas en la jornada actual.
              </p>
            )}
            {historyRows.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Medicamento</TableHead>
                    <TableHead>Administrado por</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Dosis</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {historyRows.map((a) => {
                    const drugName =
                      a.prescriptionItem?.drug?.genericName ?? "—";
                    const adminName = a.administeredBy?.fullName ?? "—";
                    return (
                      <TableRow key={a.id}>
                        <TableCell className="tabular-nums">
                          {timeFmt.format(new Date(a.administeredAt))}
                        </TableCell>
                        <TableCell>{drugName}</TableCell>
                        <TableCell>{adminName}</TableCell>
                        <TableCell>{statusBadge(a.status as AdminStatus)}</TableCell>
                        <TableCell className="tabular-nums">
                          {a.doseAmount
                            ? `${String(a.doseAmount)} ${a.doseUnit ?? ""}`.trim()
                            : "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
