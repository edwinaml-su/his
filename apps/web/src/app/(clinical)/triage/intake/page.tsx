import { IntakeForm } from "./intake-form";

/**
 * US-6.1 — Recepción rápida en triage.
 * Pantalla principal con dos caminos: paciente conocido vs. paciente NN.
 */
export default function TriageIntakePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Recepción de triage</h1>
        <p className="text-sm text-muted-foreground">
          Registra al paciente al llegar a urgencias. Si no se puede identificar, usa el
          flujo NN — los datos se completan luego.
        </p>
      </div>
      <IntakeForm />
    </div>
  );
}
