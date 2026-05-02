"use client";

/**
 * US-2.4 — Vista informativa de las reglas ABAC vigentes (MVP).
 *
 * MVP: las reglas son hardcoded en `apps/web/src/lib/auth/abac.ts`. Esta
 * pantalla solo las lista para que el admin pueda revisar la lógica de acceso
 * que aplica el sistema. NO es editable: en Sprint 2 se persistirán como
 * `AbacRule` en BD y esta pantalla será CRUD.
 *
 * UX:
 *  - Tabla con: Acción | Recurso | Roles permitidos | Condición | Descripción.
 *  - Filtro rápido por acción.
 *  - Banner explicando que es MVP / no editable.
 */
import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Badge } from "@his/ui/components/badge";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { MVP_ABAC_RULES } from "@/lib/auth/abac";
import type { AbacAction } from "@his/contracts";

const ACTIONS: ReadonlyArray<AbacAction | "ALL"> = [
  "ALL",
  "READ",
  "WRITE",
  "PRESCRIBE",
  "DISPENSE",
  "SIGN",
];

export default function AbacPage() {
  const [filter, setFilter] = React.useState<AbacAction | "ALL">("ALL");

  const rules = React.useMemo(
    () =>
      filter === "ALL"
        ? MVP_ABAC_RULES
        : MVP_ABAC_RULES.filter((r) => r.action === filter),
    [filter],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Reglas ABAC</h1>
        <p className="text-sm text-muted-foreground">
          US-2.4 — control de acceso por servicio / sede / turno (TDR §6.2).
          Vista informativa de las reglas vigentes en MVP.
        </p>
      </div>

      <Alert>
        <AlertTitle>Lectura solamente — MVP</AlertTitle>
        <AlertDescription>
          Las reglas viven hardcoded en{" "}
          <code>apps/web/src/lib/auth/abac.ts</code> y se evalúan en frontend
          (UI defensiva). Sprint 2: persistencia en tabla{" "}
          <code>AbacRule</code> + middleware tRPC <code>abacGuard</code>.
        </AlertDescription>
      </Alert>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Filtrar por acción:</span>
        {ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={() => setFilter(a)}
            className={`rounded-md border px-3 py-1 text-xs ${
              filter === a
                ? "border-primary bg-primary text-primary-foreground"
                : "border-input bg-background hover:bg-accent"
            }`}
          >
            {a}
          </button>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {rules.length} regla(s)
        </span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Reglas vigentes</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Acción</TableHead>
                <TableHead className="w-32">Recurso</TableHead>
                <TableHead>Roles permitidos</TableHead>
                <TableHead>Condición</TableHead>
                <TableHead>Descripción</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center text-sm text-muted-foreground"
                  >
                    Sin reglas para este filtro.
                  </TableCell>
                </TableRow>
              ) : null}
              {rules.map((rule) => (
                <TableRow key={rule.id}>
                  <TableCell>
                    <Badge variant="outline">{rule.action}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {rule.resourceKind}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {rule.allowedRoles.map((r) => (
                        <Badge key={r} variant="secondary" className="text-xs">
                          {r}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {rule.condition}
                  </TableCell>
                  <TableCell className="text-xs">{rule.description}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
