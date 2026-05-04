"use client";

import * as React from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@his/ui/components/table";
import { Button } from "@his/ui/components/button";
import { Input } from "@his/ui/components/input";
import { trpc } from "@/lib/trpc/react";

type FlowchartCategory = "TRAUMA" | "MEDICAL" | "PEDIATRIC" | "PSYCHIATRIC";

interface FlowchartListItem {
  id: string;
  code: string;
  name: string;
  isPediatric: boolean;
  active: boolean;
  category: FlowchartCategory;
  discriminatorCount: number;
}

interface TrpcWithFlowchart {
  triageFlowchart: {
    list: {
      useQuery: (input?: {
        category?: FlowchartCategory;
        search?: string;
        includeInactive?: boolean;
      }) => {
        data?: FlowchartListItem[];
        isLoading: boolean;
        refetch: () => void;
        error?: { message: string } | null;
      };
    };
    setActive: {
      useMutation: (opts?: { onSuccess?: () => void }) => {
        mutate: (input: { id: string; active: boolean }) => void;
        isPending: boolean;
      };
    };
  };
}

/**
 * US-6.3 / admin — config de flujogramas Manchester por organización.
 * Permite activar / desactivar cada flujograma; los inactivos no aparecen
 * en el selector clínico (`/triage/[id]/flowchart`).
 */
export default function TriageConfigPage() {
  const trpcAny = trpc as unknown as TrpcWithFlowchart;
  const [search, setSearch] = React.useState("");
  const list = trpcAny.triageFlowchart.list.useQuery({
    search: search.trim() || undefined,
    includeInactive: true,
  });
  const setActive = trpcAny.triageFlowchart.setActive.useMutation({
    onSuccess: () => list.refetch(),
  });

  const sorted = React.useMemo(
    () =>
      [...(list.data ?? [])].sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name, "es");
      }),
    [list.data],
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Configuración de Triage Manchester</h1>
        <p className="text-sm text-muted-foreground">
          Activa o desactiva los flujogramas disponibles para tu organización.
          Los inactivos no aparecerán en el selector clínico.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Flujogramas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Buscar por nombre o código…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {list.isLoading ? (
            <p className="text-sm text-muted-foreground">Cargando…</p>
          ) : list.error ? (
            <p className="text-sm text-destructive">{list.error.message}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead className="text-right">Discriminadores</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acción</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="font-medium">{f.name}</TableCell>
                    <TableCell className="font-mono text-xs">{f.code}</TableCell>
                    <TableCell>
                      {f.category}
                      {f.isPediatric ? " · ped" : ""}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {f.discriminatorCount}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-[10px] uppercase ${
                          f.active
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-zinc-200 text-zinc-700"
                        }`}
                      >
                        {f.active ? "Activo" : "Inactivo"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant={f.active ? "outline" : "default"}
                        disabled={setActive.isPending}
                        onClick={() =>
                          setActive.mutate({ id: f.id, active: !f.active })
                        }
                      >
                        {f.active ? "Desactivar" : "Activar"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {sorted.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center text-sm text-muted-foreground"
                    >
                      Sin flujogramas. Ejecuta{" "}
                      <code className="font-mono">pnpm db:seed:manchester</code>.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
