"use client";

/**
 * US-1.8 — Visor de auditoría parametrizado por entidad.
 *
 * Convención de ruta:
 *   /audit/Organization?id=<uuid>
 *   /audit/Establishment?id=<uuid>
 *   /audit/Patient?id=<uuid>
 *   /audit/_any
 *
 * `[entity]` es el tipo (string del enum entity de AuditLog). El `id` viaja
 * por query string para no obligar a tener UUID en path. Si no hay `id` y la
 * entidad es Organization/Establishment, redirigimos mentalmente al usuario a
 * `/organizations/audit` (que tiene filtros más ricos); aquí mostramos un
 * placeholder informativo.
 *
 * Reusa `audit.listByEntity` (ya existente) cuando hay entityId, o
 * `audit.listOrgChanges` cuando entity es Organization/Establishment sin id.
 */

import * as React from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { AuditTrail } from "@his/ui/components/AuditTrail";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import { trpc } from "@/lib/trpc/react";

export default function AuditByEntityPage() {
  const routeParams = useParams<{ entity: string }>();
  const search = useSearchParams();
  const entity = routeParams?.entity ?? "";
  const entityId = search.get("id") ?? "";

  const isStructural = entity === "Organization" || entity === "Establishment";

  const byEntity = trpc.audit.listByEntity.useQuery(
    { entity, entityId, page: 1, pageSize: 100 },
    { enabled: !!entity && !!entityId },
  );

  const structural = trpc.audit.listOrgChanges.useQuery(
    {
      entityKind: entity === "Organization" ? "Organization" : "Establishment",
      page: 1,
      pageSize: 100,
    },
    { enabled: isStructural && !entityId },
  );

  const isLoading =
    (entityId && byEntity.isLoading) ||
    (!entityId && isStructural && structural.isLoading);

  const error = entityId ? byEntity.error : structural.error;

  const items = entityId
    ? (byEntity.data?.items ?? []).map((i) => ({
        id: i.id.toString(),
        occurredAt: i.occurredAt,
        action: i.action,
        entity: i.entity,
        entityId: i.entityId,
        userId: i.userId,
        justification: i.justification,
      }))
    : (structural.data?.items ?? []).map((i) => ({
        id: i.id,
        occurredAt: i.occurredAt,
        action: i.action,
        entity: i.entity,
        entityId: i.entityId,
        userId: i.userId,
        userLabel: i.userLabel,
        justification: i.justification,
      }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">
          Auditoría — {entity || "Entidad"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {entityId ? (
            <>
              Eventos para <span className="font-mono text-xs">{entityId}</span>.
            </>
          ) : (
            <>Vista filtrada por tipo de entidad.</>
          )}
          {isStructural ? (
            <>
              {" "}
              Para filtros avanzados (rango de fechas, acción, usuario) usa{" "}
              <Link
                href="/organizations/audit"
                className="text-primary underline-offset-4 hover:underline"
              >
                /organizations/audit
              </Link>
              .
            </>
          ) : null}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {!entity ? (
            <Alert>
              <AlertTitle>Entidad requerida</AlertTitle>
              <AlertDescription>
                Indica el tipo de entidad en la ruta, por ejemplo{" "}
                <code>/audit/Organization?id=…</code>.
              </AlertDescription>
            </Alert>
          ) : null}

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error.message}</AlertDescription>
            </Alert>
          ) : null}

          {!isLoading && entity && items.length > 0 ? (
            <AuditTrail items={items} />
          ) : null}
          {!isLoading && entity && items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin eventos registrados para esta entidad.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
