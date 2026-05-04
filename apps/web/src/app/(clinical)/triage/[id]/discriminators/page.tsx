import { DiscriminatorList } from "./discriminator-list";

interface PageProps {
  params: { id: string };
}

/**
 * US-6.4 — pantalla de discriminadores activos para una evaluación de triage
 * IN_PROGRESS. La id del path es `triageEvaluationId`.
 *
 * Reglas Manchester:
 *  - Se evalúan en orden de `ordinal` (1 = más urgente).
 *  - El PRIMER discriminador positivo determina el nivel sugerido.
 *  - Si nadie es positivo, se cae al `defaultLevelId` del flujograma (BLUE).
 *  - El triagista puede confirmar el nivel (override-able por Sierra desde
 *    triage.router → setAssignedLevel).
 */
export default function DiscriminatorsPage({ params }: PageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Discriminadores Manchester</h1>
        <p className="text-sm text-muted-foreground">
          Evalúa en orden de prioridad. El primer discriminador positivo
          determina el nivel sugerido.
        </p>
      </div>
      <DiscriminatorList triageEvaluationId={params.id} />
    </div>
  );
}
