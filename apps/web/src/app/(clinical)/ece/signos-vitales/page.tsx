/**
 * ECE — Signos Vitales: Historial / Tendencias
 *
 * Muestra tabla tabular de los últimos registros del paciente seleccionado.
 * Recharts no está en las dependencias del workspace; se usa tabla nativa
 * para mantener zero-dep overhead. Si se añade recharts en el futuro, este
 * componente puede migrar a <LineChart> con el mismo shape de datos.
 *
 * Accesibilidad: tabla con scope="col", caption descriptivo, role="status"
 * en zona de alerta crítica (WCAG 2.2 AA).
 */
import Link from "next/link";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { DataCardList, type DataCardColumn } from "@his/ui/components/data-card-list";
import { VITAL_THRESHOLDS_ADULT } from "@his/contracts/schemas/inpatient";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

interface VitalRow {
  id: string;
  capturedAt: string; // ISO-8601
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  temperatureC: number | null;
  spo2: number | null;
  painScale: number | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCritical(field: keyof typeof VITAL_THRESHOLDS_ADULT, value: number | null): boolean {
  if (value === null) return false;
  const t = VITAL_THRESHOLDS_ADULT[field];
  return value <= t.criticalLow || value >= t.criticalHigh;
}

function CellValue({
  field,
  value,
  unit,
}: {
  field: keyof typeof VITAL_THRESHOLDS_ADULT;
  value: number | null;
  unit: string;
}) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const critical = isCritical(field, value);
  return (
    <span
      className={critical ? "font-semibold text-destructive" : undefined}
      aria-label={critical ? `Alerta crítica: ${value} ${unit}` : undefined}
    >
      {value}
      <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Datos mock — reemplazar con api.eceSignosVitales.list cuando el router
// esté cableado al cliente tRPC.
// ---------------------------------------------------------------------------

const MOCK_ROWS: VitalRow[] = [
  {
    id: "1",
    capturedAt: "2026-05-17T08:00:00",
    systolicBp: 120,
    diastolicBp: 80,
    heartRate: 72,
    respiratoryRate: 16,
    temperatureC: 36.8,
    spo2: 98,
    painScale: 2,
  },
  {
    id: "2",
    capturedAt: "2026-05-17T12:00:00",
    systolicBp: 95,
    diastolicBp: 62,
    heartRate: 105,
    respiratoryRate: 22,
    temperatureC: 38.7,
    spo2: 91,
    painScale: 6,
  },
  {
    id: "3",
    capturedAt: "2026-05-17T16:00:00",
    systolicBp: 85,
    diastolicBp: 55,
    heartRate: 118,
    respiratoryRate: 28,
    temperatureC: 39.2,
    spo2: 89,
    painScale: 8,
  },
];

function hasCriticalAlert(row: VitalRow): boolean {
  return (
    isCritical("systolicBp", row.systolicBp) ||
    isCritical("diastolicBp", row.diastolicBp) ||
    isCritical("heartRate", row.heartRate) ||
    isCritical("respiratoryRate", row.respiratoryRate) ||
    isCritical("temperatureC", row.temperatureC) ||
    isCritical("spo2", row.spo2)
  );
}

function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// Columnas DataCardList
// ---------------------------------------------------------------------------

const COLUMNS: DataCardColumn<VitalRow>[] = [
  {
    id: "fechaHora",
    header: "Fecha / Hora",
    primary: true,
    cell: (row) => (
      <span className="flex items-center gap-2 whitespace-nowrap">
        {formatDateTime(row.capturedAt)}
        {hasCriticalAlert(row) ? (
          <Badge variant="destructive" className="text-xs">Crítico</Badge>
        ) : (
          <Badge variant="secondary" className="text-xs">Normal</Badge>
        )}
      </span>
    ),
  },
  {
    id: "ta",
    header: "TA (S/D)",
    cell: (row) => (
      <span>
        <CellValue field="systolicBp" value={row.systolicBp} unit="" />
        {" / "}
        <CellValue field="diastolicBp" value={row.diastolicBp} unit="mmHg" />
      </span>
    ),
  },
  {
    id: "fc",
    header: "FC",
    cell: (row) => <CellValue field="heartRate" value={row.heartRate} unit="lpm" />,
  },
  {
    id: "fr",
    header: "FR",
    cell: (row) => <CellValue field="respiratoryRate" value={row.respiratoryRate} unit="rpm" />,
  },
  {
    id: "temp",
    header: "Temp.",
    cell: (row) => <CellValue field="temperatureC" value={row.temperatureC} unit="°C" />,
  },
  {
    id: "spo2",
    header: "SpO₂",
    cell: (row) => <CellValue field="spo2" value={row.spo2} unit="%" />,
  },
  {
    id: "dolor",
    header: "Dolor",
    cell: (row) =>
      row.painScale !== null ? (
        <span>{row.painScale}/10</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
  },
];

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

export default function SignosVitalesPage() {
  const rows = MOCK_ROWS;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Signos Vitales</h1>
          <p className="text-sm text-muted-foreground">
            Historial de registros · ECE
          </p>
        </div>
        <Button asChild>
          <Link href="/ece/signos-vitales/nueva">Nuevo registro</Link>
        </Button>
      </div>

      {/* Zona de alerta crítica */}
      {rows.some(hasCriticalAlert) && (
        <div
          role="status"
          aria-live="assertive"
          className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          <Badge variant="destructive">Alerta crítica</Badge>
          Uno o más registros presentan valores fuera de rango crítico. Revise la tabla.
        </div>
      )}

      {/* Lista responsiva de signos vitales */}
      <DataCardList
        data={rows}
        getKey={(row) => row.id}
        columns={COLUMNS}
        emptyMessage='Sin registros. Use "Nuevo registro" para capturar signos vitales.'
      />
    </div>
  );
}
