/**
 * CC-0016 — Metadatos de UI (label/desc) para los 8 campos del formulario de
 * solicitud y las 7 reglas generales del módulo (mockup FIELDS/RULES).
 * Compartido entre `nueva-solicitud.tsx` (renderiza el formulario) y
 * `parametrizacion.tsx` (edita label/desc + estado/enabled).
 */
import type { ImagingFieldKey, ImagingRuleKey } from "@his/contracts";

export const FIELD_META: Record<
  ImagingFieldKey,
  { label: string; desc: string; tipo: "text" | "textarea" | "select" | "date"; placeholder?: string; opts?: string[] }
> = {
  // CC-0041 RF-03 — el dx pasa de texto libre CIE-10 a selector CIE-11
  // poblado desde el expediente (HC / Evolución) + «Otro» con BuscadorCie11.
  dx: {
    label: "Diagnóstico presuntivo (CIE-11)",
    desc: "Se obtiene de la Historia Clínica, Evolución Clínica o Indicaciones Médicas del expediente",
    tipo: "text",
    placeholder: "Ej. ME84.2 — Dolor de la región lumbar",
  },
  just: {
    label: "Justificación clínica",
    desc: "Motivo / hallazgos que justifican la solicitud",
    tipo: "textarea",
    placeholder: "Describa el motivo clínico del estudio…",
  },
  prio: {
    label: "Prioridad de la solicitud",
    desc: "Patrón de colores: STAT = rojo, Urgente = amarillo, Rutina = verde",
    tipo: "select",
    opts: ["Rutina", "Urgente", "STAT"],
  },
  fecha: {
    label: "Fecha de la solicitud (programación)",
    desc: "Se habilita únicamente cuando la prioridad es Rutina",
    tipo: "date",
  },
  embarazo: {
    label: "¿Posibilidad de embarazo?",
    desc: "Obligatorio. En pacientes masculinos se asigna «No aplica» automáticamente",
    tipo: "select",
    opts: ["No aplica", "No", "Sí", "Se desconoce"],
  },
  alergias: {
    label: "Alergias conocidas",
    desc: "Se obtiene automáticamente de la Historia Clínica",
    tipo: "text",
  },
  creat: {
    label: "Creatinina sérica (mg/dL)",
    desc: "Obligatoria para todos los estudios que requieran medio de contraste",
    tipo: "text",
    placeholder: "Ej. 0.9",
  },
  obs: {
    label: "Observaciones para el técnico",
    desc: "Indicaciones adicionales de realización",
    tipo: "textarea",
    placeholder: "Ej. Paciente con marcapasos, claustrofobia…",
  },
};

export const RULE_META: Record<ImagingRuleKey, { label: string; desc: string }> = {
  multi: {
    label: "Permitir varias categorías en una misma solicitud",
    desc: "Si se apaga, cambiar de categoría limpia la selección",
  },
  global: {
    label: "Habilitar «Buscar por Nombre»",
    desc: "Búsqueda por nombre en todas las categorías — estándar del módulo de Laboratorio",
  },
  codigo: {
    label: "Mostrar código de la prestación en el listado",
    desc: "Prefijo + correlativo junto al nombre",
  },
  flags: {
    label: "Mostrar etiquetas de contraste / ayuno",
    desc: "Ayudas visuales en el listado de prestaciones",
  },
  dupWarn: {
    label: "Alertar prestaciones duplicadas en solicitudes previas",
    desc: "Aviso si el estudio ya fue solicitado en los últimos 30 días",
  },
  firma: {
    label: "Requerir firma electrónica al guardar",
    desc: "Solicita PIN del médico antes de registrar",
  },
  maxN: {
    label: "Límite de prestaciones por solicitud",
    desc: "Límite configurable por perfil de usuario",
  },
};

/**
 * CC-0041 RF-04 — patrón de colores obligatorio de la prioridad en TODO el
 * módulo: STAT rojo (#dc2626) · Urgente amarillo (#f59e0b) · Rutina verde
 * (#059669). Fondos/textos "on" del mockup v2 (.prio-seg .p-*.on).
 */
export const PRIO_SEGMENT: Record<
  "Rutina" | "Urgente" | "STAT",
  { dot: string; onBg: string; onColor: string }
> = {
  Rutina: { dot: "#059669", onBg: "#d1fae5", onColor: "#065f46" },
  Urgente: { dot: "#f59e0b", onBg: "#fef3c7", onColor: "#92400e" },
  STAT: { dot: "#dc2626", onBg: "#fee2e2", onColor: "#991b1b" },
};

export const PRIO_LABEL_TO_VALUE: Record<string, "ROUTINE" | "URGENT" | "STAT"> = {
  Rutina: "ROUTINE",
  Urgente: "URGENT",
  STAT: "STAT",
};
export const PRIO_VALUE_TO_LABEL: Record<string, string> = {
  ROUTINE: "Rutina",
  URGENT: "Urgente",
  STAT: "STAT",
};
