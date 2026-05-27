/**
 * /admin/profesionales-salud/[id] — Detalle profesional no-médico.
 *
 * Reusa el mismo componente que /admin/medicos/[id] — el modelo de datos es
 * idéntico (ece.personal_salud), solo cambia el contexto y los roles.
 */
"use client";

import { useParams } from "next/navigation";
import { PersonalSaludDetail } from "../../_components/personal-salud-detail";

export default function ProfesionalSaludDetailPage() {
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
      backHref="/profesionales-salud"
      backLabel="Profesionales de la Salud"
    />
  );
}
