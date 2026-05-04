"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@his/ui/components/card";
import { Button } from "@his/ui/components/button";
import { trpc } from "@/lib/trpc/react";

type TriageColor = "RED" | "ORANGE" | "YELLOW" | "GREEN" | "BLUE";
type Answer = "POSITIVE" | "NEGATIVE" | null;

interface DiscriminatorOut {
  id: string;
  code: string;
  text: string;
  ordinal: number;
  active: boolean;
  resultLevel: {
    id: string;
    color: TriageColor;
    name: string;
    priority: number;
    maxWaitMinutes: number;
    uiColorHex: string | null;
  };
}

interface ListForTriageOut {
  evaluation: { id: string; status: string };
  flowchart: {
    id: string;
    code: string;
    name: string;
    isPediatric: boolean;
    defaultLevelId: string | null;
    category: "TRAUMA" | "MEDICAL" | "PEDIATRIC" | "PSYCHIATRIC";
  };
  discriminators: DiscriminatorOut[];
}

/**
 * Cast hasta que `_app.ts` registre `triageFlowchart`. Se mantiene narrow.
 */
interface TrpcWithFlowchart {
  triageFlowchart: {
    listForTriage: {
      useQuery: (input: { triageEvaluationId: string }) => {
        data?: ListForTriageOut;
        isLoading: boolean;
        error?: { message: string } | null;
      };
    };
  };
  /**
   * Sierra extiende `triage.setAssignedLevel` en otra historia. Aquí lo dejamos
   * opcional y degradamos a sólo-UI si no existe aún.
   */
  triage: {
    setAssignedLevel?: {
      useMutation: (opts?: {
        onSuccess?: () => void;
      }) => {
        mutate: (input: {
          triageEvaluationId: string;
          assignedLevelId: string;
          overrideJustification?: string;
        }) => void;
        isPending: boolean;
        error?: { message: string } | null;
      };
    };
  };
}

const COLOR_BG: Record<TriageColor, string> = {
  RED: "rgb(220 38 38)",
  ORANGE: "rgb(234 88 12)",
  YELLOW: "rgb(202 138 4)",
  GREEN: "rgb(22 163 74)",
  BLUE: "rgb(37 99 235)",
};

interface Props {
  triageEvaluationId: string;
}

export function DiscriminatorList({ triageEvaluationId }: Props) {
  const router = useRouter();
  const trpcAny = trpc as unknown as TrpcWithFlowchart;
  const data = trpcAny.triageFlowchart.listForTriage.useQuery({
    triageEvaluationId,
  });
  const setLevel = trpcAny.triage.setAssignedLevel?.useMutation({
    onSuccess: () => router.replace(`/triage`),
  });

  const [answers, setAnswers] = React.useState<Record<string, Answer>>({});

  const sorted = React.useMemo(
    () =>
      [...(data.data?.discriminators ?? [])].sort(
        (a, b) => a.ordinal - b.ordinal,
      ),
    [data.data],
  );

  /**
   * Primer positivo en orden de ordinal → nivel sugerido.
   * Si nadie marcó positivo, default = BLUE/priority 5 (placeholder lógico
   * — el server toma defaultLevelId del flujograma).
   */
  const firstPositive = React.useMemo(
    () => sorted.find((d) => answers[d.id] === "POSITIVE"),
    [answers, sorted],
  );

  const allAnswered = sorted.length > 0 && sorted.every((d) => answers[d.id] != null);
  const noPositive = allAnswered && !firstPositive;

  const setAnswer = (id: string, val: Answer) =>
    setAnswers((p) => ({ ...p, [id]: val }));

  if (data.isLoading) {
    return <p className="text-sm text-muted-foreground">Cargando discriminadores…</p>;
  }
  if (data.error) {
    return <p className="text-sm text-destructive">{data.error.message}</p>;
  }
  if (!data.data) return null;

  const { flowchart } = data.data;

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>
            {flowchart.name}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              ({flowchart.code} · {flowchart.category}
              {flowchart.isPediatric ? " · pediátrico" : ""})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {sorted.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este flujograma no tiene discriminadores activos. Se aplicará el
              nivel por defecto.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {sorted.map((d) => {
                const ans = answers[d.id];
                const isFirstPos = firstPositive?.id === d.id;
                return (
                  <li
                    key={d.id}
                    className={`flex items-center justify-between rounded-md border p-2 ${
                      isFirstPos ? "border-primary ring-1 ring-primary" : ""
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="inline-block h-3 w-3 rounded-sm"
                        style={{ background: COLOR_BG[d.resultLevel.color] }}
                        aria-label={`Nivel ${d.resultLevel.color}`}
                      />
                      <span className="text-xs font-mono text-muted-foreground">
                        #{d.ordinal}
                      </span>
                      <span className="text-sm">{d.text}</span>
                    </div>
                    <fieldset className="flex items-center gap-3">
                      <legend className="sr-only">{d.text}</legend>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          name={`disc-${d.id}`}
                          value="POSITIVE"
                          checked={ans === "POSITIVE"}
                          onChange={() => setAnswer(d.id, "POSITIVE")}
                        />
                        Positivo
                      </label>
                      <label className="flex items-center gap-1 text-xs">
                        <input
                          type="radio"
                          name={`disc-${d.id}`}
                          value="NEGATIVE"
                          checked={ans === "NEGATIVE"}
                          onChange={() => setAnswer(d.id, "NEGATIVE")}
                        />
                        Negativo
                      </label>
                    </fieldset>
                  </li>
                );
              })}
            </ol>
          )}
        </CardContent>
      </Card>

      <SuggestionBanner
        firstPositive={firstPositive}
        noPositive={noPositive}
      />

      <div className="flex gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Volver
        </Button>
        <Button
          type="button"
          disabled={
            (!firstPositive && !noPositive) ||
            !!setLevel?.isPending
          }
          onClick={() => {
            const targetLevelId = firstPositive?.resultLevel.id;
            if (!targetLevelId) {
              // Sin positivo — el server aplicará el defaultLevelId; sólo
              // navegamos. Cuando Sierra exponga `triage.setAssignedLevel`,
              // mandaremos el default explícito.
              router.replace(`/triage`);
              return;
            }
            if (setLevel?.mutate) {
              setLevel.mutate({
                triageEvaluationId,
                assignedLevelId: targetLevelId,
              });
            } else {
              // Stub: la mutación aún no está expuesta.
              router.replace(`/triage`);
            }
          }}
        >
          {setLevel?.isPending ? "Confirmando…" : "Confirmar nivel"}
        </Button>
      </div>
      {setLevel?.error ? (
        <p className="text-xs text-destructive">{setLevel.error.message}</p>
      ) : null}
    </div>
  );
}

function SuggestionBanner({
  firstPositive,
  noPositive,
}: {
  firstPositive: DiscriminatorOut | undefined;
  noPositive: boolean;
}) {
  if (!firstPositive && !noPositive) return null;
  if (firstPositive) {
    return (
      <div
        role="status"
        className="rounded-md border-2 p-3 text-sm font-medium"
        style={{
          borderColor: COLOR_BG[firstPositive.resultLevel.color],
          background: COLOR_BG[firstPositive.resultLevel.color] + "20",
        }}
      >
        Nivel sugerido:{" "}
        <span className="font-bold">{firstPositive.resultLevel.name}</span>{" "}
        <span className="text-xs font-normal text-muted-foreground">
          (espera máx. {firstPositive.resultLevel.maxWaitMinutes} min ·
          discriminador #{firstPositive.ordinal} {firstPositive.code})
        </span>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="rounded-md border border-sky-500 bg-sky-50 p-3 text-sm dark:bg-sky-950/40"
    >
      Sin discriminadores positivos. Se aplicará el nivel por defecto del
      flujograma (típicamente <span className="font-bold">AZUL — No urgente</span>).
    </div>
  );
}
