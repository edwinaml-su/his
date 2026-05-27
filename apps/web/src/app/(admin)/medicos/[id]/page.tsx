/**
 * /admin/medicos/[id] — Detalle de médico con tabs:
 *   1. Datos básicos
 *   2. Pacientes referidos (CORE B2B2C)
 *   3. Cuenta de acceso
 */
"use client";

import { useParams } from "next/navigation";
import { PersonalSaludDetail } from "../../_components/personal-salud-detail";

export default function MedicoDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";

  if (!id) {
    return (
      <p role="alert" className="text-sm text-destructive">
        ID inválido.
      </p>
    );
  }

  return (
    <PersonalSaludDetail
      personalId={id}
      backHref="/medicos"
      backLabel="Médicos"
    />
  );
}
