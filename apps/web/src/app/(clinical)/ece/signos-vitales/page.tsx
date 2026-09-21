"use client";

/**
 * ECE — Signos Vitales: Historial / Tendencias
 *
 * Lee las tomas reales vía `eceSignosVitales.list` (CC-0012) anclada a
 * `?episodioId=` o `?cuentaId=` — mismo contrato de URL que el capturador
 * `/nueva`. Sin ancla en la URL se ofrece el SelectorCuenta (patrón
 * imaging/lis). Remediación auditoría 2026-09-18: esta página renderizaba
 * MOCK_ROWS hardcodeados con el router ya disponible.
 *
 * Recharts no está en las dependencias del workspace; se usa tabla nativa
 * para mantener zero-dep overhead. Si se añade recharts en el futuro, este
 * componente puede migrar a <LineChart> con el mismo shape de datos.
 *
 * Accesibilidad: caption descriptivo, role="status" en zona de alerta
 * crítica (WCAG 2.2 AA).
 */
import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { DataCardList, type DataCardColumn } from "@his/ui/components/data-card-list";
import { VITAL_THRESHOLDS_ADULT } from "@his/contracts/schemas/inpatient";
import { SelectorCuenta } from "@/components/selector-cuenta";
import { trpc } from "@/lib/trpc/react";

// ---------------------------------------------------------------------------
// Tipos locales
// ---------------------------------------------------------------------------

interface VitalRow {
  id: string;
  capturedAt: string | Date;
  estado: string;
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

function formatDateTime(value: string | Date): string {
  return new Intl.DateTimeFormat("es-SV", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
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
        {row.estado !== "firmado" && row.estado !== "validado" ? (
          <Badge variant="outline" className="text-xs capitalize">{row.estado}</Badge>
        ) : null}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const episodioId = searchParams.get("episodioId") || undefined;
  const cuentaId = searchParams.get("cuentaId") || undefined;
  const conAncla = Boolean(episodioId || cuentaId);

  const query = trpc.eceSignosVitales.list.useQuery(
    { ...(episodioId ? { episodioId } : {}), ...(cuentaId ? { cuentaId } : {}), limit: 50 },
    { enabled: conAncla },
  );

  if (!conAncla) {
    return (
      <SelectorCuenta
        titulo="Signos Vitales — Historial"
        subtitulo="Seleccione la cuenta del paciente para ver su historial de tomas."
        onSelect={(id) => router.replace(`/ece/signos-vitales?cuentaId=${id}`)}
      />
    );
  }

  const rows: VitalRow[] = (query.data?.items ?? []).map((r) => ({
    id: r.id,
    capturedAt: r.fecha_hora_toma,
    estado: r.estado_registro,
    systolicBp: r.presion_sistolica,
    diastolicBp: r.presion_diastolica,
    heartRate: r.frecuencia_cardiaca,
    respiratoryRate: r.frecuencia_respiratoria,
    temperatureC: r.temperatura,
    spo2: r.saturacion_o2,
    painScale: r.escala_dolor,
  }));

  const nuevaHref = episodioId
    ? `/ece/signos-vitales/nueva?episodioId=${episodioId}`
    : `/ece/signos-vitales/nueva?cuentaId=${cuentaId}`;

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
          <Link href={nuevaHref}>Nuevo registro</Link>
        </Button>
      </div>

      {query.error ? (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      ) : null}
      {query.isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando historial…</p>
      ) : null}

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
      {!query.isLoading ? (
        <DataCardList
          data={rows}
          getKey={(row) => row.id}
          columns={COLUMNS}
          emptyMessage='Sin registros. Use "Nuevo registro" para capturar signos vitales.'
        />
      ) : null}
    </div>
  );
}
