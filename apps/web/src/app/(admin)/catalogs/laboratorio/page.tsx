"use client";

/**
 * CC-0011 WS-C — Admin: catálogo de exámenes (paneles + exámenes) por área
 * LABORATORIO / RADIOLOGIA / CARDIOLOGIA. Alimenta la sección 7 (Misceláneos)
 * de la historia clínica vía `lis.test.listByArea` (wizard de solicitud).
 *
 * No usa el editor genérico `/catalogs/[catalog]` (catalog-table/catalog-form)
 * porque este catálogo es jerárquico (panel → exámenes) — master-detail en
 * vez de una tabla plana. Router/schemas ya existían en la rama:
 * `packages/trpc/src/routers/lis.router.ts` (sub-routers panel y test) +
 * `packages/contracts/src/schemas/lis-catalogo.ts`.
 */
import * as React from "react";
import { FlaskConical } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { labCatalogAreaEnum, type LabCatalogArea } from "@his/contracts";
import { AREA_LABEL, PanelList, type LabPanelRow } from "./_components/panel-list";
import { TestTable } from "./_components/test-table";

const AREA_OPTIONS = labCatalogAreaEnum.options;

export default function LaboratorioCatalogPage() {
  const [area, setArea] = React.useState<LabCatalogArea>("LABORATORIO");
  const [selectedPanel, setSelectedPanel] = React.useState<LabPanelRow | undefined>(undefined);

  const handleAreaChange = (value: string) => {
    setArea(value as LabCatalogArea);
    setSelectedPanel(undefined);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-6 w-6 text-primary" aria-hidden="true" />
        <div>
          <h1 className="text-2xl font-bold">Catálogo de laboratorio y estudios</h1>
          <p className="text-sm text-muted-foreground">
            Paneles y exámenes parametrizables para solicitudes (laboratorio, radiología, cardiología).
          </p>
        </div>
      </div>

      <Tabs value={area} onValueChange={handleAreaChange}>
        <TabsList aria-label="Área del catálogo">
          {AREA_OPTIONS.map((a) => (
            <TabsTrigger key={a} value={a}>
              {AREA_LABEL[a]}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <PanelList
          area={area}
          selectedPanelId={selectedPanel?.id ?? null}
          onSelect={setSelectedPanel}
        />
        <TestTable panel={selectedPanel} />
      </div>
    </div>
  );
}
