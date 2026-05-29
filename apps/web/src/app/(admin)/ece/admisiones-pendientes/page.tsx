"use client";

/**
 * Cola de admisiones pendientes — panel ADM.
 *
 * Lista órdenes de ingreso validadas sin episodio creado.
 * Muestra: paciente, servicio destino, circunstancia, antigüedad.
 * Botón "Admitir" navega al wizard pre-populado (query param ?ordenId=...).
 *
 * HG-13: detecta error FORBIDDEN/UNAUTHORIZED del router y muestra mensaje
 *   de "Acceso restringido" en lugar de pantalla vacía sin contexto.
 * HG-14: verificado — la ruta /ece/hoja-ingreso/nueva existe (page.tsx presente).
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { Badge } from "@his/ui/components/badge";
import { trpc } from "@/lib/trpc/react";

// ── helpers visuales ──────────────────────────────────────────────────────────

function AntiguedadBadge({ minutos }: { minutos: number }) {
  const horas = Math.floor(minutos / 60);
  const label =
    minutos < 60
      ? `${minutos} min`
      : `${horas} h ${minutos % 60} min`;

  const variant =
    minutos > 120 ? "destructive" : minutos > 60 ? "secondary" : "outline";

  return (
    <Badge variant={variant} className="flex items-center gap-1">
      <Clock className="h-3 w-3" aria-hidden />
      {label}
    </Badge>
  );
}

// ── componente principal ──────────────────────────────────────────────────────

export default function AdmisionesPendientesPage() {
  const router = useRouter();
  const [page, setPage] = React.useState(1);

  const { data, isLoading, isError, error, refetch } =
    trpc.eceBridgeAdmision.listOrdenesPendientesAdmision.useQuery(
      { page, pageSize: 25 },
      { refetchInterval: 30_000 }, // auto-refresh cada 30 s
    );

  // HG-13: distinguir error de autorización para informar el rol requerido.
  const isForbidden =
    isError &&
    (error?.data?.code === "FORBIDDEN" || error?.data?.code === "UNAUTHORIZED");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cola de admisiones</h1>
          <p className="text-sm text-muted-foreground">
            Órdenes de ingreso validadas pendientes de admisión hospitalaria.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Actualizar
        </Button>
      </div>

      {/* HG-13: informar rol requerido cuando el router rechaza por autorización. */}
      {isForbidden && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
        >
          <p className="font-medium">Acceso restringido</p>
          <p className="mt-1 text-xs">
            Esta sección requiere el rol de Admisiones (ADM). Contacte al
            administrador del sistema si cree que esto es un error.
          </p>
        </div>
      )}

      {isError && !isForbidden && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          Error al cargar la cola de admisiones. Intente actualizar la página.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardList className="h-5 w-5" aria-hidden />
            {isLoading ? "Cargando…" : `${data?.total ?? 0} órdenes pendientes`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-muted-foreground" role="status">
              Cargando órdenes…
            </p>
          )}

          {!isLoading && !isError && data?.items.length === 0 && (
            <p className="rounded-md border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
              No hay órdenes pendientes de admisión en este momento.
            </p>
          )}

          {data && data.items.length > 0 && (
            <div className="divide-y" role="list" aria-label="Cola de admisiones">
              {data.items.map((orden) => (
                <div
                  key={orden.id}
                  role="listitem"
                  className="flex items-center justify-between gap-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate font-medium text-sm">
                      {orden.pacienteNombre}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {orden.circunstanciaIngreso}
                      {orden.servicioNombre ? ` · ${orden.servicioNombre}` : ""}
                      {" · "}{orden.modalidad}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-3">
                    <AntiguedadBadge minutos={orden.antiguedadMinutos} />
                    <Button
                      size="sm"
                      onClick={() =>
                        router.push(
                          `/ece/hoja-ingreso/nueva?ordenId=${orden.id}`,
                        )
                      }
                      aria-label={`Admitir a ${orden.pacienteNombre}`}
                    >
                      Admitir
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Paginación */}
          {data && data.total > data.pageSize && (
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Anterior
              </Button>
              <span className="flex items-center text-xs text-muted-foreground">
                Página {data.page} de {Math.ceil(data.total / data.pageSize)}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Siguiente
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
