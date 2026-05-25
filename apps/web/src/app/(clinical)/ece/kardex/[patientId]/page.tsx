"use client";

/**
 * Kardex de administraciones por paciente — US.F2.6.31-33.
 *
 * Vista cronológica de MedicationAdministration para un paciente.
 * Columna BCMA: verificado (gtinScanned != null) vs manual.
 * Permite cancelar con motivo (ENF / MEDICO).
 * No duplica /emar — ese listado es por PrescriptionItem; este es por Patient.
 */
import * as React from "react";
import { useParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { Button } from "@his/ui/components/button";
import { Label } from "@his/ui/components/label";
import { Input } from "@his/ui/components/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@his/ui/components/dialog";
import { Badge } from "@his/ui/components/badge";
import { DataCardList, type DataCardColumn } from "@his/ui/components/data-card-list";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Types (mirrored from schema — evita importar Prisma en client components)
// ---------------------------------------------------------------------------
type MedAdminStatus =
  | "SCHEDULED"
  | "ADMINISTERED"
  | "GIVEN"
  | "HELD"
  | "REFUSED"
  | "MISSED"
  | "DOCUMENTED_LATE"
  | "CANCELED";

const STATUS_LABEL: Record<MedAdminStatus, string> = {
  SCHEDULED:       "Programado",
  ADMINISTERED:    "Administrado",
  GIVEN:           "Dado",
  HELD:            "Retenido",
  REFUSED:         "Rechazado",
  MISSED:          "Omitido",
  DOCUMENTED_LATE: "Doc. tardía",
  CANCELED:        "Cancelado",
};

const STATUS_VARIANT: Record<
  MedAdminStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  SCHEDULED:       "outline",
  ADMINISTERED:    "default",
  GIVEN:           "default",
  HELD:            "secondary",
  REFUSED:         "secondary",
  MISSED:          "destructive",
  DOCUMENTED_LATE: "secondary",
  CANCELED:        "destructive",
};

const dateFmt = new Intl.DateTimeFormat("es-SV", {
  dateStyle: "medium",
  timeStyle: "short",
});

const STATUS_OPTIONS: { value: MedAdminStatus | "ALL"; label: string }[] = [
  { value: "ALL",           label: "Todos" },
  { value: "ADMINISTERED",  label: "Administrado" },
  { value: "CANCELED",      label: "Cancelado" },
  { value: "SCHEDULED",     label: "Programado" },
  { value: "HELD",          label: "Retenido" },
  { value: "REFUSED",       label: "Rechazado" },
  { value: "MISSED",        label: "Omitido" },
  { value: "DOCUMENTED_LATE", label: "Doc. tardía" },
];

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------
type KardexRow = {
  id: string;
  administeredAt: Date | string;
  status: string;
  prescriptionItem?: { drug?: { genericName?: string } };
  administeredBy?: { fullName?: string };
  gtinScanned?: string | null;
  loteScanned?: string | null;
  serieScanned?: string | null;
  cancelReason?: string | null;
};

const KARDEX_COLUMNS: DataCardColumn<KardexRow>[] = [
  {
    id: "medicamento",
    header: "Medicamento",
    primary: true,
    cell: (row) =>
      row.prescriptionItem?.drug?.genericName ?? "-",
  },
  {
    id: "fecha",
    header: "Fecha / hora",
    cell: (row) => (
      <span className="whitespace-nowrap">
        {dateFmt.format(new Date(row.administeredAt))}
      </span>
    ),
  },
  {
    id: "enfermera",
    header: "Enfermera",
    cell: (row) => row.administeredBy?.fullName ?? "-",
  },
  {
    id: "estado",
    header: "Estado",
    cell: (row) => {
      const status = row.status as MedAdminStatus;
      return (
        <Badge variant={STATUS_VARIANT[status]}>
          {STATUS_LABEL[status] ?? status}
        </Badge>
      );
    },
  },
  {
    id: "bcma",
    header: "BCMA",
    align: "center",
    hideOnMobile: true,
    cell: (row) =>
      row.gtinScanned ? (
        <span
          className="text-green-600 font-semibold"
          title="Administración verificada BCMA (scan bedside)"
        >
          Verificado
        </span>
      ) : (
        <span
          className="text-amber-600"
          title="Administración manual sin scan GS1"
        >
          Manual
        </span>
      ),
  },
  {
    id: "lote",
    header: "Lote / serie",
    hideOnMobile: true,
    className: "font-mono",
    cell: (row) =>
      row.loteScanned
        ? `${row.loteScanned} / ${row.serieScanned ?? "-"}`
        : "-",
  },
  {
    id: "cancelReason",
    header: "Motivo cancelación",
    className: "max-w-xs truncate text-muted-foreground",
    cell: (row) => (row.cancelReason ? String(row.cancelReason) : "-"),
  },
];

// ---------------------------------------------------------------------------
// Cancel dialog
// ---------------------------------------------------------------------------
interface CancelDialogProps {
  adminId: string;
  onClose: () => void;
}

function CancelDialog({ adminId, onClose }: CancelDialogProps) {
  const [motivo, setMotivo] = React.useState("");
  const utils = trpc.useUtils();
  const cancel = trpc.medicationAdmin.cancelAdmin.useMutation({
    onSuccess: () => {
      utils.medicationAdmin.listByPatient.invalidate();
      onClose();
    },
  });

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancelar administración</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="cancel-reason">
            Motivo de cancelación <span className="text-destructive">*</span>
          </Label>
          <Input
            id="cancel-reason"
            placeholder="Describa el motivo (mínimo 10 caracteres)"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          {cancel.error && (
            <p className="text-sm text-destructive">{cancel.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button
            variant="destructive"
            disabled={motivo.trim().length < 10 || cancel.isPending}
            onClick={() =>
              cancel.mutate({ adminId, cancelReason: motivo.trim() })
            }
          >
            {cancel.isPending ? "Cancelando..." : "Cancelar administración"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function KardexPage() {
  const params = useParams<{ patientId: string }>();
  const patientId = params.patientId;

  const [statusFilter, setStatusFilter] = React.useState<
    MedAdminStatus | "ALL"
  >("ALL");
  const [fromDate, setFromDate] = React.useState("");
  const [toDate, setToDate] = React.useState("");
  const [cancelTarget, setCancelTarget] = React.useState<string | null>(null);

  const { data, isLoading, isError } = trpc.medicationAdmin.listByPatient.useQuery(
    {
      patientId,
      status:   statusFilter === "ALL" ? undefined : statusFilter,
      fromDate: fromDate ? new Date(fromDate) : undefined,
      toDate:   toDate   ? new Date(toDate)   : undefined,
      limit:    100,
    },
    { enabled: Boolean(patientId) },
  );

  return (
    <main className="container mx-auto py-6 space-y-4">
      <h1 className="text-2xl font-semibold">Kardex de administraciones</h1>

      {/* Filtros */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filtros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="status-filter">Estado</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter(v as MedAdminStatus | "ALL")
                }
              >
                <SelectTrigger id="status-filter" className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label htmlFor="from-date">Desde</Label>
              <Input
                id="from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="w-40"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="to-date">Hasta</Label>
              <Input
                id="to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="w-40"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabla / Cards */}
      <Card>
        <CardContent className="pt-4">
          {isLoading && (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Cargando...
            </p>
          )}
          {isError && (
            <p className="text-sm text-destructive py-8 text-center">
              Error al cargar el kardex.
            </p>
          )}
          {!isLoading && !isError && (
            <DataCardList
              data={(data ?? []) as KardexRow[]}
              getKey={(row) => row.id}
              columns={KARDEX_COLUMNS}
              actions={(row) => {
                const status = row.status as MedAdminStatus;
                const cancelable = status !== "CANCELED" && status !== "MISSED";
                return cancelable ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setCancelTarget(row.id)}
                  >
                    Cancelar
                  </Button>
                ) : null;
              }}
              emptyMessage="Sin registros para los filtros seleccionados."
            />
          )}
        </CardContent>
      </Card>

      {cancelTarget && (
        <CancelDialog
          adminId={cancelTarget}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </main>
  );
}
