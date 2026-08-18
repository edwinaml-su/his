import { FlowchartSelector } from "./flowchart-selector";

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * US-6.3 — selección del flujograma Manchester para una evaluación de triage
 * IN_PROGRESS. La id del path es `triageEvaluationId`.
 */
export default async function FlowchartSelectionPage(props: PageProps) {
  const params = await props.params;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Flujograma Manchester</h1>
        <p className="text-sm text-muted-foreground">
          Selecciona el cuadro clínico de presentación. Sólo se muestran
          flujogramas activos en esta organización.
        </p>
      </div>
      <FlowchartSelector triageEvaluationId={params.id} />
    </div>
  );
}
