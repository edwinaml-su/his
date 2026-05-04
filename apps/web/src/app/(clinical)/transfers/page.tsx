"use client";

/**
 * US-5.3 — Tablero de traslados internos (equipo Lima · Sprint 3).
 *
 * Lista paginada de movimientos recientes de la organización con filtro
 * por servicio destino, y un panel para registrar un nuevo traslado.
 */
import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@his/ui/components/select";
import { trpc } from "@/lib/trpc/react";
import { TransferForm } from "./transfer-form";

export default function TransfersPage() {
  const [page, setPage] = React.useState(1);
  const [serviceFilter, setServiceFilter] = React.useState<string>("ALL");
  const [showForm, setShowForm] = React.useState(false);

  const services = trpc.bed.getMap.useQuery();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (trpc as any).encounterTransfer.listRecent.useQuery({
    serviceUnitId: serviceFilter === "ALL" ? undefined : serviceFilter,
    page,
    pageSize: 20,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const utils = (trpc as any).useUtils?.();

  function handleSuccess() {
    setShowForm(false);
    if (utils?.encounterTransfer?.listRecent?.invalidate) {
      utils.encounterTransfer.listRecent.invalidate();
    } else {
      list.refetch();
    }
  }

  const items = (list.data?.items ?? []) as Array<{
    id: string;
    occurredAt: string | Date;
    fromServiceId: string | null;
    toServiceId: string;
    reason: string;
    encounter: {
      id: string;
      encounterNumber: string;
      patient: {
        firstName: string;
        lastName: string;
        mrn: string;
      };
    };
  }>;

  const total = (list.data?.total as number) ?? 0;
  const pageSize = (list.data?.pageSize as number) ?? 20;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const serviceName = (id: string | null | undefined) => {
    if (!id) return "—";
    return services.data?.find((s) => s.id === id)?.name ?? id.slice(0, 8);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Traslados internos</h1>
          <p className="text-sm text-muted-foreground">
            Movimientos entre servicios y camas del establecimiento
            (US-5.3).
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cerrar" : "Nuevo traslado"}
        </Button>
      </div>

      {showForm ? (
        <Card>
          <CardHeader>
            <CardTitle>Registrar traslado</CardTitle>
          </CardHeader>
          <CardContent>
            <TransferForm
              onCancel={() => setShowForm(false)}
              onSuccess={handleSuccess}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Recientes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="min-w-[260px]">
              <label className="block text-xs text-muted-foreground">
                Filtrar por servicio destino
              </label>
              <Select
                value={serviceFilter}
                onValueChange={(v) => {
                  setServiceFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">Todos los servicios</SelectItem>
                  {services.data?.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code} — {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Sin traslados registrados con este filtro.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {items.map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1 px-3 py-3 text-sm md:flex-row md:items-center md:justify-between"
                >
                  <div>
                    <p className="font-semibold">
                      {t.encounter.encounterNumber}{" "}
                      <span className="text-muted-foreground">
                        · {t.encounter.patient.firstName}{" "}
                        {t.encounter.patient.lastName} (MRN{" "}
                        {t.encounter.patient.mrn})
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t.reason}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">
                      {serviceName(t.fromServiceId)}
                    </Badge>
                    <span className="text-muted-foreground">→</span>
                    <Badge variant="success">
                      {serviceName(t.toServiceId)}
                    </Badge>
                    <span className="ml-3 text-xs text-muted-foreground">
                      {new Date(t.occurredAt).toLocaleString("es-SV")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {totalPages > 1 ? (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Página {page} de {totalPages} · {total} traslados
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                >
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                >
                  Siguiente
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
