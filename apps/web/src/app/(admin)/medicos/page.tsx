/**
 * /admin/medicos — Mantenimiento de Médicos (modelo B2B2C).
 *
 * Los médicos son nuestros clientes profesionales que traen a sus pacientes
 * al complejo para procedimientos. Roles ECE: MC, MT, ESP, IC.
 */
import { PersonalSaludScreen } from "../_components/personal-salud-screen";

export default function MedicosPage() {
  return (
    <PersonalSaludScreen
      kind="medicos"
      title="Médicos"
      subtitle="Catálogo de médicos del complejo hospitalario (modelo B2B2C). Incluye médicos de cabecera, de turno, especialistas e interconsultantes."
      noun="médico"
      jvpLabel="JVPM (Junta de Vigilancia)"
      profesionHint="Ej. Cirujano General, Cardiólogo, Anestesiólogo"
      detailBasePath="/medicos"
    />
  );
}
