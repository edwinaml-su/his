"use client";

/**
 * US-1.4 — /ledgers — Listado de libros contables por organización.
 *
 * Resuelve la organización activa vía `trpc.organization.current` (tenant
 * context). Si el usuario aún no ha seleccionado tenant, mostramos hint para
 * usar el OrgSwitcher del shell.
 *
 * El listado, los filtros y el botón "Nuevo libro" viven en `LedgerTable`.
 * Esta página es un wrapper Card + cabecera + descripción del story.
 */
import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { trpc } from "@/lib/trpc/react";
import { LedgerTable } from "./ledger-table";

export default function LedgersPage() {
  const orgQuery = trpc.organization.current.useQuery();
  const org = orgQuery.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Libros contables</h1>
        <p className="text-sm text-muted-foreground">
          Activación y configuración de libros contables por organización.
          Cada libro tiene su propia moneda funcional, plan de cuentas (Sprint 5)
          y política de redondeo. Sólo puede existir un libro activo por tipo
          (Fiscal Local, NIIF, US GAAP, Gerencial, Presupuesto, Estadístico).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {org ? (
              <>
                Libros de <span className="font-mono">{org.tradeName ?? org.legalName}</span>
              </>
            ) : (
              "Selecciona una organización"
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {orgQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando organización…</p>
          ) : !org ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
              No hay tenant activo. Selecciona una organización desde el switcher
              del menú superior para ver y gestionar sus libros contables.
            </p>
          ) : (
            <LedgerTable organizationId={org.id} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
