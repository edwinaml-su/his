import { VitalsForm } from "./vitals-form";

interface PageProps {
  params: { id: string };
}

/**
 * US-6.2 — captura de signos vitales para una evaluación de triage
 * IN_PROGRESS. La id del path es `triageEvaluationId`.
 */
export default function TriageVitalsPage({ params }: PageProps) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Signos vitales</h1>
        <p className="text-sm text-muted-foreground">
          Captura inmediata. Las alertas se calculan en vivo conforme escribes.
        </p>
      </div>
      <VitalsForm triageEvaluationId={params.id} />
    </div>
  );
}
