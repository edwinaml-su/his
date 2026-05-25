"use client";

/**
 * Dashboard Ejecutivo HIS Multiorganizacional.
 *
 * Implementa el catálogo de 36 KPIs en 7 categorías, con secciones
 * colapsables, filtro de fechas, descripciones aclaratorias por KPI,
 * y exportes (Imprimir / CSV / PDF / Correo).
 *
 * Wave 0 (este PR): arquitectura completa + 36 KPIs renderizados con
 * datos reales donde existen o mocks documentados con badge
 * "Pendiente integración". Wave 1+ reemplazará los mocks por queries
 * reales por KPI.
 *
 * Multi-org: la visibilidad cross-org está disponible para roles directivos
 * (DIR/ADM/JEFE/GERENTE) via cookie `his.orgs` (PR #241). Los queries
 * pueden consumirlo en Wave 1 para consolidar entre orgs.
 */
import * as React from "react";
import { KPI_CATALOG, CATEGORIA_LABELS, CATEGORIA_ORDER, type Categoria } from "./_lib/kpi-catalog";
import { computeKpiValue } from "./_lib/compute-kpis";
import { KpiCard, type KpiValue } from "./_components/kpi-card";
import { KpiSection } from "./_components/kpi-section";
import { Toolbar } from "./_components/toolbar";
import { computeAdopcion } from "./_actions/compute-adopcion";
import { computeCalidad } from "./_actions/compute-calidad";
import { computeAsistenciales } from "./_actions/compute-asistenciales";
import { computeSeguridad } from "./_actions/compute-seguridad";
import { computeTecnicos } from "./_actions/compute-tecnicos";
import { computeFinancieros } from "./_actions/compute-financieros";
import { computeGobierno } from "./_actions/compute-gobierno";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}
function isoMinus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function DashboardEjecutivoPage() {
  const [fechaDesde, setFechaDesde] = React.useState(isoMinus(30));
  const [fechaHasta, setFechaHasta] = React.useState(isoToday());

  // Snapshot inicial: valores sync (mock/pending) — los "real" se sobreescriben
  // cuando llegan los resultados async de los server actions paralelos.
  const baseSnapshot = React.useMemo(() => {
    const ctx = {
      organizationIds: [],
      fechaDesde: new Date(fechaDesde),
      fechaHasta: new Date(fechaHasta),
    };
    return KPI_CATALOG.map((kpi) => ({
      kpi,
      value: computeKpiValue(kpi, ctx) as KpiValue | null,
    }));
  }, [fechaDesde, fechaHasta]);

  // Overrides async (Wave 1): valores reales calculados server-side.
  const [realOverrides, setRealOverrides] = React.useState<Record<string, KpiValue | null>>({});

  React.useEffect(() => {
    let cancelled = false;
    const req = { organizationIds: [], fechaDesde, fechaHasta };
    Promise.allSettled([
      computeAdopcion(req),
      computeCalidad(req),
      computeAsistenciales(req),
      computeSeguridad(req),
      computeTecnicos(req),
      computeFinancieros(req),
      computeGobierno(req),
    ]).then((results) => {
      if (cancelled) return;
      const merged: Record<string, KpiValue | null> = {};
      for (const r of results) {
        if (r.status === "fulfilled") Object.assign(merged, r.value);
      }
      setRealOverrides(merged);
    });
    return () => { cancelled = true; };
  }, [fechaDesde, fechaHasta]);

  // Merge: override por kpi.id si hay valor async; fallback al base.
  const snapshot = React.useMemo(
    () => baseSnapshot.map(({ kpi, value }) => ({
      kpi,
      value: (realOverrides[kpi.id] ?? value) as KpiValue | null,
    })),
    [baseSnapshot, realOverrides],
  );

  const snapshotByCategoria = React.useMemo(() => {
    const grouped = new Map<Categoria, typeof snapshot>();
    for (const item of snapshot) {
      const list = grouped.get(item.kpi.categoria) ?? [];
      list.push(item);
      grouped.set(item.kpi.categoria, list);
    }
    return grouped;
  }, [snapshot]);

  function onFechasChange(desde: string, hasta: string) {
    if (desde && hasta && desde <= hasta) {
      setFechaDesde(desde);
      setFechaHasta(hasta);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <header className="space-y-1">
        <h1 className="text-2xl font-bold leading-tight">Dashboard Ejecutivo HIS</h1>
        <p className="text-sm text-muted-foreground">
          Catálogo multiorganizacional de {KPI_CATALOG.length} indicadores en
          {" "}7 categorías. Periodo:{" "}
          <span className="font-medium text-foreground">{fechaDesde}</span>
          {" → "}
          <span className="font-medium text-foreground">{fechaHasta}</span>.
        </p>
      </header>

      {/* Toolbar */}
      <Toolbar
        fechaDesde={fechaDesde}
        fechaHasta={fechaHasta}
        onFechasChange={onFechasChange}
        snapshot={snapshot}
      />

      {/* Capa 1 ejecutiva — destacada al inicio */}
      <KpiSection
        id="capa-ejecutiva"
        titulo="⭐ Capa Ejecutiva (Top KPIs estratégicos)"
        count={snapshot.filter((s) => s.kpi.capaEjecutiva).length}
        defaultOpen={true}
      >
        {snapshot
          .filter((s) => s.kpi.capaEjecutiva)
          .map(({ kpi, value }) => (
            <KpiCard key={kpi.id} kpi={kpi} value={value} />
          ))}
      </KpiSection>

      {/* Secciones por categoría — todas colapsables */}
      {CATEGORIA_ORDER.map((cat) => {
        const items = snapshotByCategoria.get(cat) ?? [];
        if (items.length === 0) return null;
        return (
          <KpiSection
            key={cat}
            id={`section-${cat}`}
            titulo={CATEGORIA_LABELS[cat]}
            count={items.length}
            defaultOpen={cat === "asistenciales"}
          >
            {items.map(({ kpi, value }) => (
              <KpiCard key={kpi.id} kpi={kpi} value={value} />
            ))}
          </KpiSection>
        );
      })}

      {/* Nota de wave */}
      <footer className="rounded-md border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground print:hidden">
        <p>
          <strong className="text-foreground">Wave 0 — arquitectura entregada.</strong>{" "}
          Los {KPI_CATALOG.filter((k) => k.dataSource === "real").length} KPIs marcados
          "datos reales" se cablearán a Prisma en Wave 1.{" "}
          {KPI_CATALOG.filter((k) => k.dataSource === "pending").length} KPIs requieren
          integración externa (APM, finance, ITSM, NPS) — Wave 2+.
        </p>
      </footer>
    </div>
  );
}
