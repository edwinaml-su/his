/**
 * US-1.2 — Vista jerárquica Holding -> Empresa -> Establecimiento (read-only).
 *
 * MVP scope reducido: tree view sin drag-drop, sin edición inline.
 * El render real (recursivo + expand/collapse) vive en el Client Component
 * `org-tree.tsx`; esta página sólo es el shell del módulo.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { OrgTree } from "./org-tree";

export default function OrganizationsTreePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Estructura organizativa</h1>
        <p className="text-sm text-muted-foreground">
          Jerarquía Holding → Empresa → Establecimiento. Solo lectura en este
          sprint; edición y reorganización drag-drop quedan para Sprint 2 (TDR
          §5.2).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Árbol organizativo</CardTitle>
        </CardHeader>
        <CardContent>
          <OrgTree />
        </CardContent>
      </Card>
    </div>
  );
}
