import { PatientShellBar } from "@/components/patient-shell-bar";

/**
 * Layout del expediente del paciente (vista 360° + históricos).
 *
 * Monta el segundo header persistente (PatientShellBar) para TODAS las
 * subrutas de /patients/[id]/* — vista 360, alergias, historial, vacunas,
 * GSRN, recién nacido — según el contrato de visibilidad CC-0008 §B y
 * docs/42_design_system_v2.md §4 ("rutas del expediente clínico
 * /patients/[id]/* y equivalentes"). Antes solo la página índice lo montaba.
 */
export default async function PatientRecordLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <>
      <PatientShellBar patientId={id} />
      {children}
    </>
  );
}
