"use client";

/**
 * CC-0016 — Tab «⚙️ Parametrización» (mockup view-param). Sub-tabs:
 * Categorías / Catálogo de exámenes / Opciones de llenado / Reglas generales.
 * Visible solo ADMIN/DIR (gating hecho por el padre `modulo-imagenes.tsx`).
 */
import * as React from "react";
import { Card, CardContent } from "@his/ui/components/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { Categorias } from "./parametrizacion/categorias";
import { Catalogo } from "./parametrizacion/catalogo";
import { OpcionesLlenado } from "./parametrizacion/opciones-llenado";
import { Reglas } from "./parametrizacion/reglas";

export function Parametrizacion() {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="pt-4 text-xs text-muted-foreground">
          ⚙️ Los cambios aquí se reflejan de inmediato en la pantalla «Nueva Solicitud» (categorías
          activas, catálogo de exámenes y comportamiento de los campos de llenado).
        </CardContent>
      </Card>

      <Tabs defaultValue="cat">
        <TabsList aria-label="Parametrización del módulo">
          <TabsTrigger value="cat">🗂 Categorías</TabsTrigger>
          <TabsTrigger value="cata">🩻 Catálogo de exámenes</TabsTrigger>
          <TabsTrigger value="campos">📝 Opciones de llenado</TabsTrigger>
          <TabsTrigger value="reglas">🔧 Reglas generales</TabsTrigger>
        </TabsList>
        <TabsContent value="cat">
          <Categorias />
        </TabsContent>
        <TabsContent value="cata">
          <Catalogo />
        </TabsContent>
        <TabsContent value="campos">
          <OpcionesLlenado />
        </TabsContent>
        <TabsContent value="reglas">
          <Reglas />
        </TabsContent>
      </Tabs>
    </div>
  );
}
