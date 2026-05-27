/**
 * /admin/profesionales-salud — Mantenimiento de Profesionales de la Salud
 * (no-médicos).
 *
 * Incluye enfermería (licenciadas/os, técnicos), personal de archivo
 * (ESDOMED), atención al cliente y administrativos. Asisten al médico
 * en el modelo B2B2C. Roles ECE: ENF, ARCH, AC, ADM.
 */
import { PersonalSaludScreen } from "../_components/personal-salud-screen";

export default function ProfesionalesSaludPage() {
  return (
    <PersonalSaludScreen
      kind="no_medicos"
      title="Profesionales de la Salud"
      subtitle="Personal no-médico: enfermería, archivo, atención al cliente y administrativos. Soporte clínico y operacional al médico tratante."
      noun="profesional"
      jvpLabel="JVP / Registro JNR"
      profesionHint="Ej. Licenciada en Enfermería, Auxiliar de Archivo, Anestesista Técnico"
    />
  );
}
