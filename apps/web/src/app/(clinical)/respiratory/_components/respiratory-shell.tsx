"use client";

/**
 * CC-0042 — Shell del módulo de Terapia Respiratoria (adecuar legacy §21):
 * pestañas «➕ Nueva orden» (CPOE-TR, requiere cuenta — patrón SelectorCuenta
 * de imaging/lis) · «🗂 Worklist» (vista de área, sin cuenta) · «📋 Órdenes
 * legacy» · «⚙ Configuración» (solo ADMIN/DIR). Deep-link:
 * /respiratory?vista=worklist abre el worklist sin exigir cuenta.
 */
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { SelectorCuenta } from "@/components/selector-cuenta";
import { OrdenTr } from "./orden-tr";
import { WorklistTr } from "./worklist-tr";
import { OrdenesLegacy } from "./ordenes-legacy";
import { ParametrizacionTr } from "./parametrizacion-tr";

export function RespiratoryShell({ roleCodes }: { roleCodes: string[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const cuentaId = searchParams.get("cuentaId");
  const vistaParam = searchParams.get("vista");
  const isAdmin = roleCodes.includes("ADMIN") || roleCodes.includes("DIR");

  const [tab, setTab] = React.useState<"orden" | "worklist" | "legacy" | "config">(
    vistaParam === "worklist" ? "worklist" : "orden",
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Terapia respiratoria</h1>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList aria-label="Módulo de terapia respiratoria">
          <TabsTrigger value="orden">➕ Nueva orden</TabsTrigger>
          <TabsTrigger value="worklist">🗂 Worklist / Supervisión</TabsTrigger>
          <TabsTrigger value="legacy">📋 Órdenes legacy</TabsTrigger>
          {isAdmin ? <TabsTrigger value="config">⚙ Configuración</TabsTrigger> : null}
        </TabsList>

        <TabsContent value="orden">
          {cuentaId ? (
            <OrdenTr cuentaId={cuentaId} onGuardado={() => setTab("worklist")} />
          ) : (
            <SelectorCuenta
              titulo="Terapia respiratoria"
              subtitulo="Seleccione la cuenta del paciente para crear la orden de terapia respiratoria."
              onSelect={(id) => router.replace(`/respiratory?cuentaId=${id}`)}
            />
          )}
        </TabsContent>

        <TabsContent value="worklist">
          <WorklistTr />
        </TabsContent>

        <TabsContent value="legacy">
          <OrdenesLegacy />
        </TabsContent>

        {isAdmin ? (
          <TabsContent value="config">
            <ParametrizacionTr />
          </TabsContent>
        ) : null}
      </Tabs>
    </div>
  );
}
