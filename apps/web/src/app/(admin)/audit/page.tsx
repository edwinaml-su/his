"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { AuditTrail } from "@his/ui/components/AuditTrail";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

export default function AuditPage() {
  const [entity, setEntity] = React.useState("Patient");
  const [entityId, setEntityId] = React.useState("");
  const [committed, setCommitted] = React.useState<{ entity: string; entityId: string } | null>(
    null,
  );

  const query = trpc.audit.listByEntity.useQuery(
    committed ? { entity: committed.entity, entityId: committed.entityId, page: 1, pageSize: 50 } : (undefined as never),
    { enabled: !!committed },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Auditoría</h1>
        <p className="text-sm text-muted-foreground">Visor del audit log (TDR §6.3).</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Buscar por entidad</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (entity && entityId) setCommitted({ entity, entityId });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="entity">Entidad</Label>
              <Input
                id="entity"
                value={entity}
                onChange={(e) => setEntity(e.target.value)}
                placeholder="Patient"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="entityId">ID</Label>
              <Input
                id="entityId"
                value={entityId}
                onChange={(e) => setEntityId(e.target.value)}
                placeholder="UUID"
                className="w-[320px]"
              />
            </div>
            <Button type="submit">Consultar</Button>
          </form>
          <div className="mt-4">
            {query.data && (
              <AuditTrail
                items={query.data.items.map((i) => ({
                  id: i.id,
                  occurredAt: i.occurredAt,
                  action: i.action,
                  entity: i.entity,
                  entityId: i.entityId,
                  userId: i.userId,
                  justification: i.justification,
                }))}
              />
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
