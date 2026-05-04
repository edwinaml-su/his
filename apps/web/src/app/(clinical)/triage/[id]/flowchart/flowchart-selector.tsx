"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Input } from "@his/ui/components/input";
import { Label } from "@his/ui/components/label";
import { Button } from "@his/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@his/ui/components/tabs";
import { trpc } from "@/lib/trpc/react";

/**
 * Cast del cliente tRPC para incluir `triageFlowchart` aunque aún no esté
 * registrado en `_app.ts` durante este sprint. Cuando Sierra integre el router
 * en `_app.ts`, este cast se vuelve inocuo (TypeScript ya lo conocerá).
 */
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
        error?: { message: string } | null;
      };
    };
  };
}

const CATEGORIES: { code: FlowchartCategory | "ALL"; label: string }[] = [
  { code: "ALL", label: "Todas" },
  { code: "MEDICAL", label: "Médico" },
  { code: "TRAUMA", label: "Trauma" },
  { code: "PEDIATRIC", label: "Pediátrico" },
  { code: "PSYCHIATRIC", label: "Psiquiátrico" },
];

interface Props {
  triageEvaluationId: string;
}

export function FlowchartSelector({ triageEvaluationId }: Props) {
  const router = useRouter();
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState<FlowchartCategory | "ALL">(
    "ALL",
  );

  const trpcAny = trpc as unknown as TrpcWithFlowchart;
  const list = trpcAny.triageFlowchart.list.useQuery({
    category: category === "ALL" ? undefined : category,
    search: search.trim() || undefined,
  });

  const onPick = (flowchartId: string) => {
    // El flowchart de la evaluación se setea en quickIntake (US-6.1) — aquí sólo
    // navegamos a discriminadores; el server tomará el flowchart actual de la
    // evaluación. Sierra ampliará triage.router para permitir cambiarlo.
    void flowchartId;
    router.push(`/triage/${triageEvaluationId}/discriminators`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Selecciona flujograma</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="fc-search">Buscar</Label>
          <Input
            id="fc-search"
            placeholder="Ej. dolor torácico, asma, niño..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Tabs
          value={category}
          onValueChange={(v) => setCategory(v as FlowchartCategory | "ALL")}
        >
          <TabsList className="flex-wrap">
            {CATEGORIES.map((c) => (
              <TabsTrigger key={c.code} value={c.code}>
                {c.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {CATEGORIES.map((c) => (
            <TabsContent key={c.code} value={c.code}>
              <FlowchartGrid
                isLoading={list.isLoading}
                error={list.error?.message ?? null}
                items={list.data ?? []}
                onPick={onPick}
              />
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}

function FlowchartGrid({
  items,
  isLoading,
  error,
  onPick,
}: {
  items: FlowchartListItem[];
  isLoading: boolean;
  error: string | null;
  onPick: (id: string) => void;
}) {
  if (isLoading) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Sin flujogramas que coincidan con el filtro.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((f) => (
        <Button
          key={f.id}
          type="button"
          variant="outline"
          className="h-auto justify-between py-3 text-left"
          onClick={() => onPick(f.id)}
        >
          <div className="flex flex-col items-start">
            <span className="font-medium">{f.name}</span>
            <span className="text-[10px] text-muted-foreground">
              {f.code} · {f.discriminatorCount} discriminadores
              {f.isPediatric ? " · pediátrico" : ""}
            </span>
          </div>
          <span
            className="ml-2 rounded-sm px-1.5 py-0.5 text-[10px] uppercase"
            style={{
              background:
                f.category === "TRAUMA"
                  ? "rgb(254 226 226)"
                  : f.category === "PEDIATRIC"
                  ? "rgb(254 240 138)"
                  : f.category === "PSYCHIATRIC"
                  ? "rgb(221 214 254)"
                  : "rgb(219 234 254)",
            }}
          >
            {f.category}
          </span>
        </Button>
      ))}
    </div>
  );
}
