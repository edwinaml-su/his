"use client";

/**
 * /finance/reportes — Índice de reportes financieros y regulatorios MINSAL.
 *
 * 7 tarjetas que enlazan a cada subruta de reporte.
 */
import * as React from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";

interface ReporteCard {
  numero: number;
  titulo: string;
  descripcion: string;
  href: string;
  badge?: string;
}

const REPORTES: ReporteCard[] = [
  {
    numero: 1,
    titulo: "Estado de Resultados por Centro de Costo",
    descripcion:
      "Ingresos, costo directo, costo indirecto (preview prorrateo) y margen por centro. Antes y después de distribución.",
    href: "/finance/reportes/estado-resultados",
  },
  {
    numero: 2,
    titulo: "Distribución de Centros de Apoyo",
    descripcion:
      "Reglas de asignación de centros de apoyo hacia centros intermedios y productivos con porcentajes y base de distribución.",
    href: "/finance/reportes/distribucion-prorrateo",
  },
  {
    numero: 3,
    titulo: "Costo por Paciente Egresado",
    descripcion:
      "Costo total y por día de estancia para cada paciente egresado en el periodo. Incluye días de estadía.",
    href: "/finance/reportes/costo-paciente",
  },
  {
    numero: 4,
    titulo: "Costo por Procedimiento",
    descripcion:
      "Agrupado por unidad de servicio: procedimientos quirúrgicos y estudios diagnósticos con costo promedio y total.",
    href: "/finance/reportes/costo-procedimiento",
  },
  {
    numero: 5,
    titulo: "Consumo de Insumos y Medicamentos",
    descripcion:
      "Consumo de insumos y medicamentos por centro de costo. Identificación por heurística de descripción.",
    href: "/finance/reportes/consumo-insumos",
  },
  {
    numero: 6,
    titulo: "Planilla Devengada por Centro",
    descripcion:
      "Distribución de planilla por centro de costo. Requiere integración con módulo de nómina.",
    href: "/finance/reportes/distribucion-prorrateo",
    badge: "Pendiente integración",
  },
  {
    numero: 7,
    titulo: "Consolidado MINSAL",
    descripcion:
      "Informe regulatorio consolidado por tipo de centro (productivo / intermedio / apoyo) para reporte MINSAL.",
    href: "/finance/reportes/consolidado-minsal",
  },
];

export default function ReportesIndexPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reportes Financieros y Regulatorios</h1>
        <p className="text-sm text-muted-foreground">
          Reportes de gestión de costos (TDR §23) y cumplimiento regulatorio MINSAL.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {REPORTES.map((r) => (
          <Card key={r.numero} className="flex flex-col">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  Reporte {r.numero}
                </span>
                {r.badge ? (
                  <span className="rounded-full bg-warning/20 px-2 py-0.5 text-xs font-medium text-warning-foreground">
                    {r.badge}
                  </span>
                ) : null}
              </div>
              <CardTitle className="text-base">{r.titulo}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col justify-between gap-4">
              <p className="text-sm text-muted-foreground">{r.descripcion}</p>
              <Button asChild variant="outline" className="w-full">
                <Link href={r.href}>Ver reporte</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
