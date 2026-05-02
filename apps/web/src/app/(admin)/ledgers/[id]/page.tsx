"use client";

/**
 * US-1.4 — /ledgers/[id] — Detalle del libro contable + tabs.
 *
 * Tabs:
 *   1) General         : metadata (kind, name, currency, organización, estado).
 *   2) Plan de cuentas : placeholder. Botón "Agregar cuenta — Sprint 5"
 *                        deshabilitado. La jerarquía se modelará con
 *                        `ChartOfAccounts` (parent_id self-ref) en Sprint 5.
 *   3) Política redondeo : `RoundingPolicyForm` (stub MVP, readonly).
 *
 * Decisión de diseño:
 *   - 3 tabs en lugar de Cards apiladas → la página puede crecer (Sprint 5
 *     traerá miles de cuentas en su tab) sin reorganizar el layout.
 *   - El tab "Plan de cuentas" se renderiza como Empty State con CTA Sprint 5
 *     porque la tabla `ChartOfAccounts` aún no existe (no hay schema).
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Button } from "@his/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Badge } from "@his/ui/components/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";
import { RoundingPolicyForm } from "../rounding-policy-form";

type LedgerKind =
  | "FISCAL_LOCAL"
  | "IFRS"
  | "US_GAAP"
  | "MANAGEMENT"
  | "BUDGET"
  | "STATISTICAL";

const KIND_LABELS: Record<LedgerKind, string> = {
  FISCAL_LOCAL: "Libro Fiscal Local",
  IFRS: "Libro NIIF (IFRS)",
  US_GAAP: "Libro US GAAP",
  MANAGEMENT: "Libro Gerencial",
  BUDGET: "Libro Presupuestario",
  STATISTICAL: "Libro Estadístico",
};

const KIND_VARIANT: Record<
  LedgerKind,
  "critical" | "info" | "secondary" | "success" | "warning" | "outline"
> = {
  FISCAL_LOCAL: "critical",
  IFRS: "info",
  US_GAAP: "secondary",
  MANAGEMENT: "success",
  BUDGET: "warning",
  STATISTICAL: "outline",
};

export default function LedgerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trpcAny = trpc as any;
  const query = trpcAny.ledger.get.useQuery({ id }, { enabled: Boolean(id) });

  const ledger = query.data as
    | {
        id: string;
        kind: LedgerKind;
        code: string;
        name: string;
        active: boolean;
        currencyId: string;
        accountsCount: number;
        currency: { isoCode: string; name: string; symbol: string };
        organization: { id: string; legalName: string; tradeName: string | null };
        createdAt: string | Date;
      }
    | undefined;

  if (query.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando libro…</p>;
  }

  if (query.error || !ledger) {
    return (
      <div className="space-y-3">
        <Button asChild variant="outline" size="sm">
          <Link href="/ledgers">← Volver</Link>
        </Button>
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {(query.error as { message?: string })?.message ?? "Libro no encontrado."}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Button asChild variant="ghost" size="sm">
            <Link href="/ledgers">← Libros contables</Link>
          </Button>
          <h1 className="flex items-center gap-3 text-2xl font-bold">
            {ledger.name}
            {ledger.active ? (
              <Badge variant="success">Activo</Badge>
            ) : (
              <Badge variant="outline">Inactivo</Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground">
            <Badge variant={KIND_VARIANT[ledger.kind]}>{KIND_LABELS[ledger.kind]}</Badge>{" "}
            · {ledger.organization.tradeName ?? ledger.organization.legalName} ·{" "}
            {ledger.currency.isoCode} ({ledger.currency.symbol})
          </p>
        </div>
      </div>

      <Tabs defaultValue="general" className="space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="accounts">Plan de cuentas</TabsTrigger>
          <TabsTrigger value="rounding">Política de redondeo</TabsTrigger>
        </TabsList>

        <TabsContent value="general">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Información general</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Tipo</dt>
                  <dd>
                    <Badge variant={KIND_VARIANT[ledger.kind]}>
                      {KIND_LABELS[ledger.kind]}
                    </Badge>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Código</dt>
                  <dd className="font-mono text-xs">{ledger.code}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Nombre</dt>
                  <dd>{ledger.name}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Moneda funcional
                  </dt>
                  <dd className="font-mono text-xs">
                    {ledger.currency.isoCode} — {ledger.currency.name} (
                    {ledger.currency.symbol})
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Organización
                  </dt>
                  <dd>{ledger.organization.tradeName ?? ledger.organization.legalName}</dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">Creado</dt>
                  <dd className="font-mono text-xs">
                    {new Date(ledger.createdAt).toISOString().slice(0, 10)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-muted-foreground">
                    Cuentas asociadas
                  </dt>
                  <dd>
                    {ledger.accountsCount}{" "}
                    <span className="text-xs text-muted-foreground">
                      (jerarquía completa Sprint 5)
                    </span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Plan de cuentas</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-dashed py-12 text-center">
                <p className="text-sm font-medium">Plan de cuentas vacío</p>
                <p className="max-w-md text-xs text-muted-foreground">
                  La jerarquía completa de cuentas (padre/hijo, niveles, naturaleza
                  débito/crédito, mapeo a NIIF/Fiscal) se implementará en Sprint 5
                  con la tabla <code>ChartOfAccounts</code>. En MVP el libro queda
                  activado como cimiento contable.
                </p>
                <Button disabled variant="outline" title="Disponible en Sprint 5">
                  + Agregar cuenta — Sprint 5
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rounding">
          <RoundingPolicyForm ledgerId={ledger.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
