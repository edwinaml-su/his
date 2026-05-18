"use client";

/**
 * US-1.6 — fila de la tabla de organizaciones (admin).
 * Muestra info read-only y un botón "Cambiar moneda" deshabilitado si el
 * usuario no tiene rol ADMIN sobre la org (gating en cliente; el server
 * vuelve a validar en `setFunctionalCurrency`).
 */

import * as React from "react";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { TableCell, TableRow } from "@his/ui/components/table";

type Currency = {
  id: string;
  isoCode: string;
  name: string;
  symbol: string;
};

export type OrgRowData = {
  id: string;
  legalName: string;
  tradeName: string | null;
  taxId: string;
  active: boolean;
  functionalCurrency: string;
  gs1CompanyPrefix: string | null;
  isAdmin: boolean;
  country: { id: string; isoAlpha3: string; name: string } | null;
  functionalCurr: Currency | null;
  reportingCurr: Currency | null;
};

type Props = {
  org: OrgRowData;
  onEditCurrency: (org: OrgRowData) => void;
  onEditGs1Prefix: (org: OrgRowData) => void;
};

export function OrganizationRow({ org, onEditCurrency, onEditGs1Prefix }: Props) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex flex-col">
          <span>{org.tradeName ?? org.legalName}</span>
          {org.tradeName && (
            <span className="text-xs text-muted-foreground">{org.legalName}</span>
          )}
        </div>
      </TableCell>
      <TableCell>
        {org.country ? (
          <span className="text-sm">
            <span className="font-mono text-xs text-muted-foreground">
              {org.country.isoAlpha3}
            </span>{" "}
            {org.country.name}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {org.functionalCurr ? (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono">
              {org.functionalCurr.isoCode}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {org.functionalCurr.symbol}
            </span>
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {org.reportingCurr ? (
          <Badge variant="outline" className="font-mono">
            {org.reportingCurr.isoCode}
          </Badge>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell>
        {org.active ? (
          <Badge variant="default">Activa</Badge>
        ) : (
          <Badge variant="secondary">Inactiva</Badge>
        )}
      </TableCell>
      <TableCell>
        {org.gs1CompanyPrefix ? (
          <span className="font-mono text-sm">{org.gs1CompanyPrefix}</span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEditGs1Prefix(org)}
            disabled={!org.isAdmin || !org.active}
            title={
              !org.isAdmin
                ? "Requiere rol ADMIN en esta organización"
                : !org.active
                  ? "Organización inactiva"
                  : "Configurar prefijo GS1"
            }
          >
            Prefijo GS1
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEditCurrency(org)}
            disabled={!org.isAdmin || !org.active}
            title={
              !org.isAdmin
                ? "Requiere rol ADMIN en esta organización"
                : !org.active
                  ? "Organización inactiva"
                  : "Cambiar moneda funcional"
            }
          >
            Cambiar moneda
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
