import * as React from "react";

/**
 * Aviso compartido para toda UI con selector de sede (establecimiento):
 * cuando `establishment.list` devuelve vacío (org tipo holding u org sin
 * establecimientos activos), se muestra este mensaje EN LUGAR del combo
 * vacío. Hallazgo fuera-de-alcance del FIX-establishment-list-uuid §5.
 * Medida interina mientras se decide el filtrado del switcher de
 * organización (holdings / orgs sin sedes) — ver sql/250.
 */
export function SinSedesNotice() {
  return (
    <p className="text-sm text-muted-foreground">
      Esta organización no tiene sedes configuradas.
    </p>
  );
}
