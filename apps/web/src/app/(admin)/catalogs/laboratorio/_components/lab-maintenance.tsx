"use client";

/**
 * Rediseño lab 2026-09 — Mantenimiento de catálogos (área LABORATORIO).
 *
 * Adapta el overlay `#mantScreen` de `design/mockup/mockup_examenes_laboratorio.html`
 * (fuente de verdad de COMPORTAMIENTO, no de estilo — ver CLAUDE.md §Fidelidad de
 * diseño: esta página admin usa Shadcn/@his/ui, no la paleta del mockup) al patrón
 * master-detail existente de `panel-list.tsx`/`test-table.tsx`.
 *
 * 4 sub-tabs (Pruebas/Secciones/Tipos/Subtipos) alimentados por un único query
 * `lis.catalog.cascada` (payload en cascada Tipo→Subtipo→Sección→Pruebas, con
 * conteos ya calculados server-side) — evita 4 queries separadas.
 *
 * Decisión: a diferencia de panel-list.tsx/test-table.tsx (que tienen checkbox
 * "Mostrar inactivos" + Reactivar), este mantenimiento sigue el mockup al pie de
 * la letra: "Eliminar" desactiva (soft-delete, no borra historial clínico) y la
 * fila desaparece de la lista — sin toggle de inactivos ni reactivar, porque el
 * mockup tampoco lo tiene (no fue pedido en el alcance de la tarea).
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Tabs, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Input } from "@his/ui/components/input";
import { Button, buttonVariants } from "@his/ui/components/button";
import { cn } from "@his/ui/lib/utils";
import type { LabCatalogoImportInput } from "@his/contracts";
import { trpc } from "@/lib/trpc/react";
import { PruebasTab } from "./lab-mant-pruebas";
import { SeccionesTab } from "./lab-mant-secciones";
import { TiposTab } from "./lab-mant-tipos";
import { SubtiposTab } from "./lab-mant-subtipos";

export interface CascadaTipo {
  id: string;
  name: string;
  displayOrder: number;
  testCount: number;
}
export interface CascadaSubtipo {
  id: string;
  sampleTypeId: string;
  name: string;
  displayOrder: number;
  testCount: number;
}
export interface CascadaSeccion {
  id: string;
  name: string;
  displayOrder: number;
  testCount: number;
}
export interface CascadaPrueba {
  id: string;
  name: string;
  panelId: string | null;
  sampleTypeId: string | null;
  sampleSubtypeId: string | null;
  defaultQty: number;
  paramCount: number;
  standardPrice: number | null;
}
export interface CascadaData {
  tipos: CascadaTipo[];
  subtipos: CascadaSubtipo[];
  secciones: CascadaSeccion[];
  pruebas: CascadaPrueba[];
}

type TabKey = "pruebas" | "secciones" | "tipos" | "subtipos";

const TAB_SEARCH_LABEL: Record<TabKey, string> = {
  pruebas: "pruebas",
  secciones: "secciones",
  tipos: "tipos de muestra",
  subtipos: "subtipos de muestra",
};

const NEW_LABEL: Record<TabKey, string> = {
  pruebas: "+ Nueva prueba",
  secciones: "+ Nueva sección",
  tipos: "+ Nuevo tipo",
  subtipos: "+ Nuevo subtipo",
};

export function LabMaintenance() {
  const [tab, setTab] = React.useState<TabKey>("pruebas");
  const [search, setSearch] = React.useState("");
  // Incrementa en cada click de "+ Nuevo"; el sub-tab activo escucha el cambio
  // y abre su propio diálogo de creación (ver PruebasTab/SeccionesTab/etc.).
  const [newSignal, setNewSignal] = React.useState(0);
  const [importError, setImportError] = React.useState<string | null>(null);
  const [importSummary, setImportSummary] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const utils = trpc.useUtils();
  const cascada = trpc.lis.catalog.cascada.useQuery();
  const data = cascada.data;

  const totalParametros = React.useMemo(
    () => (data ? data.pruebas.reduce((acc, p) => acc + p.paramCount, 0) : 0),
    [data],
  );

  const handleTabChange = (value: string) => {
    setTab(value as TabKey);
    setSearch("");
  };

  const handleNew = () => setNewSignal((n) => n + 1);

  const importMutation = trpc.lis.catalogo.import.useMutation({
    onSuccess: (res) => {
      utils.lis.catalog.cascada.invalidate();
      setImportError(null);
      setImportSummary(
        `Catálogo importado: ${res.tipos} tipo(s) · ${res.secciones} sección(es) · ${res.pruebas} prueba(s).`,
      );
    },
    onError: (err) => {
      setImportSummary(null);
      setImportError(err.message);
    },
  });

  const handleExport = async () => {
    try {
      const json = await utils.lis.catalogo.export.fetch();
      const blob = new Blob([JSON.stringify(json, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "catalogo_laboratorio.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (err) {
      setImportSummary(null);
      setImportError(err instanceof Error ? err.message : "No se pudo exportar el catálogo.");
    }
  };

  const handleImportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as LabCatalogoImportInput;
        importMutation.mutate(parsed);
      } catch {
        setImportSummary(null);
        setImportError("Archivo no válido. Debe ser un JSON exportado desde este catálogo.");
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base">Mantenimiento de catálogos — Laboratorio</CardTitle>
        {data ? (
          <p className="text-xs text-muted-foreground">
            {data.pruebas.length} pruebas · {data.secciones.length} secciones · {data.tipos.length} tipos ·{" "}
            {data.subtipos.length} subtipos · {totalParametros} parámetros
          </p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={handleTabChange}>
          <TabsList aria-label="Catálogo de mantenimiento">
            <TabsTrigger value="pruebas" data-testid="lab-mant-tab-pruebas">
              Pruebas
            </TabsTrigger>
            <TabsTrigger value="secciones" data-testid="lab-mant-tab-secciones">
              Secciones
            </TabsTrigger>
            <TabsTrigger value="tipos" data-testid="lab-mant-tab-tipos">
              Tipos de muestra
            </TabsTrigger>
            <TabsTrigger value="subtipos" data-testid="lab-mant-tab-subtipos">
              Subtipos de muestra
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Input
            data-testid="lab-mant-search"
            placeholder={`Buscar en ${TAB_SEARCH_LABEL[tab]}...`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button data-testid="lab-mant-new" size="sm" onClick={handleNew}>
              {NEW_LABEL[tab]}
            </Button>
            <Button data-testid="lab-export-btn" size="sm" variant="outline" onClick={handleExport}>
              Exportar
            </Button>
            <label className={cn(buttonVariants({ variant: "outline", size: "sm" }), "cursor-pointer")}>
              Importar
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                data-testid="lab-import-input"
                className="sr-only"
                onChange={handleImportChange}
              />
            </label>
          </div>
        </div>

        {cascada.error ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            Error: {cascada.error.message}
          </p>
        ) : null}
        {importError ? (
          <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            {importError}
          </p>
        ) : null}
        {importSummary ? (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700">
            {importSummary}
          </p>
        ) : null}

        {data && tab === "pruebas" ? <PruebasTab data={data} search={search} newSignal={newSignal} /> : null}
        {data && tab === "secciones" ? (
          <SeccionesTab secciones={data.secciones} search={search} newSignal={newSignal} />
        ) : null}
        {data && tab === "tipos" ? (
          <TiposTab tipos={data.tipos} subtipos={data.subtipos} search={search} newSignal={newSignal} />
        ) : null}
        {data && tab === "subtipos" ? (
          <SubtiposTab tipos={data.tipos} subtipos={data.subtipos} search={search} newSignal={newSignal} />
        ) : null}
      </CardContent>
    </Card>
  );
}
