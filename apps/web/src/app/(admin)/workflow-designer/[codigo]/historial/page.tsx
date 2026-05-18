"use client";

/**
 * Historial de publicaciones de un workflow.
 * US.F2.2.20
 *
 * Tabla paginada con: versión, acción, usuario, timestamp, motivo, link al diff, restaurar.
 * Ruta: /admin/workflow-designer/[codigo]/historial
 */
import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@his/ui/components/badge";
import { Button } from "@his/ui/components/button";
import { Alert, AlertDescription, AlertTitle } from "@his/ui/components/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { trpc } from "@/lib/trpc/react";
import { RollbackDialog } from "../../_components/rollback-dialog";

const PAGE_SIZE = 20;

export default function WorkflowHistorialPage() {
  const params = useParams();
  const codigo = typeof params.codigo === "string" ? params.codigo : "";

  const [page, setPage] = React.useState(1);
  const [rollbackTarget, setRollbackTarget] = React.useState<{
    id: string;
    version: number;
  } | null>(null);

  // Resolver tipo_doc_id desde codigo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tiposDocs } = (trpc as any).workflowTipoDoc.list.useQuery({
    soloActivos: false,
  });

  const tipoDoc = tiposDocs?.find(
    (d: { codigo: string; id: string; nombre: string }) => d.codigo === codigo,
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, isLoading, refetch } = (trpc as any).workflowPublicacion.listVersions.useQuery(
    {
      tipDocumentoId: tipoDoc?.id ?? "",
      page,
      pageSize: PAGE_SIZE,
    },
    { enabled: !!tipoDoc?.id },
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rollbackMutation = (trpc as any).workflowPublicacion.rollback.useMutation({
    onSuccess: () => {
      setRollbackTarget(null);
      void refetch();
    },
  });

  if (!tipoDoc && !isLoading) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Tipo de documento no encontrado</AlertTitle>
        <AlertDescription>
          No existe un tipo de documento con código <code>{codigo}</code>.{" "}
          <Link href="/workflow-designer" className="underline">
            Volver
          </Link>
        </AlertDescription>
      </Alert>
    );
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 1;

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">
            Historial — {tipoDoc?.nombre ?? codigo}
          </h1>
          <p className="text-sm text-muted-foreground">
            Registro auditable de publicaciones (Art. 55-56 NTEC). Solo lectura.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              if (!data?.items) return;
              exportCsv(data.items, tipoDoc?.nombre ?? codigo);
            }}
          >
            Exportar CSV
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={`/workflow-designer/${codigo}`}>Ver workflow</Link>
          </Button>
        </div>
      </div>

      {/* Tabla */}
      {isLoading ? (
        <div className="h-40 animate-pulse rounded bg-muted" aria-hidden />
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Versión</TableHead>
                <TableHead className="text-xs">Estado</TableHead>
                <TableHead className="text-xs">Fecha</TableHead>
                <TableHead className="text-xs">Autor</TableHead>
                <TableHead className="text-xs">Motivo</TableHead>
                <TableHead className="text-xs">Restaurado de</TableHead>
                <TableHead className="text-xs" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                    Sin publicaciones registradas aún.
                  </TableCell>
                </TableRow>
              )}
              {(data?.items ?? []).map(
                (row: {
                  id: string;
                  version: number;
                  estado: string;
                  publicado_por_id: string | null;
                  publicado_en: Date | null;
                  motivo_cambio: string | null;
                  restored_from_id: string | null;
                  chain_hash: string | null;
                }) => (
                  <TableRow key={row.id} data-testid={`version-row-${row.version}`}>
                    <TableCell className="font-mono text-xs font-semibold">
                      v{row.version}
                    </TableCell>
                    <TableCell>
                      <EstadoBadge estado={row.estado} />
                    </TableCell>
                    <TableCell className="text-xs">
                      {row.publicado_en
                        ? new Date(row.publicado_en).toLocaleString("es-SV", {
                            dateStyle: "medium",
                            timeStyle: "medium",
                          })
                        : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.publicado_por_id
                        ? row.publicado_por_id.slice(0, 8) + "…"
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-xs text-xs">
                      <span className="line-clamp-2">{row.motivo_cambio ?? "—"}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {row.restored_from_id
                        ? row.restored_from_id.slice(0, 8) + "…"
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {row.estado === "HISTORICO" && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-xs"
                          aria-label={`Restaurar versión ${row.version}`}
                          onClick={() =>
                            setRollbackTarget({ id: row.id, version: row.version })
                          }
                        >
                          Restaurar
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Paginación */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {data?.total ?? 0} eventos en total
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <span className="flex items-center px-2">
              {page} / {totalPages}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      )}

      {/* Breadcrumb */}
      <p className="text-xs text-muted-foreground">
        <Link href="/workflow-designer" className="underline">
          Tipos de documento
        </Link>{" "}
        /{" "}
        <Link href={`/workflow-designer/${codigo}`} className="underline">
          {tipoDoc?.nombre ?? codigo}
        </Link>{" "}
        / Historial
      </p>

      {/* Dialog rollback */}
      <RollbackDialog
        open={rollbackTarget !== null}
        version={rollbackTarget?.version ?? 0}
        onClose={() => setRollbackTarget(null)}
        onConfirm={(motivo: string) => {
          if (!rollbackTarget || !tipoDoc) return;
          rollbackMutation.mutate({
            tipDocumentoId: tipoDoc.id,
            targetVersionId: rollbackTarget.id,
            motivoCambio: motivo,
          });
        }}
        isPending={rollbackMutation.isPending}
      />
    </div>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const config: Record<string, { label: string; className: string }> = {
    PUBLICADO: {
      label: "Activo",
      className: "bg-green-100 text-green-700 border-green-300",
    },
    HISTORICO: {
      label: "Histórico",
      className: "bg-gray-100 text-gray-600 border-gray-300",
    },
    BORRADOR: {
      label: "Borrador",
      className: "bg-yellow-100 text-yellow-700 border-yellow-300",
    },
  };
  const { label, className } = config[estado] ?? {
    label: estado,
    className: "",
  };
  return (
    <Badge variant="outline" className={`text-xs ${className}`}>
      {label}
    </Badge>
  );
}

function exportCsv(
  items: Array<{
    version: number;
    estado: string;
    publicado_en: Date | null;
    publicado_por_id: string | null;
    motivo_cambio: string | null;
    chain_hash: string | null;
  }>,
  nombre: string,
) {
  const header = ["Version", "Estado", "Fecha", "Autor", "Motivo", "Hash"].join(",");
  const rows = items.map((r) =>
    [
      r.version,
      r.estado,
      r.publicado_en ? new Date(r.publicado_en).toISOString() : "",
      r.publicado_por_id ?? "",
      `"${(r.motivo_cambio ?? "").replace(/"/g, '""')}"`,
      r.chain_hash ?? "",
    ].join(","),
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const fecha = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `workflow-${nombre}-historial-${fecha}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
