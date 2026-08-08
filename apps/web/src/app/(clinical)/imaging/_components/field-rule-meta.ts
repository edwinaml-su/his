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
  dx: {
    label: "Diagnóstico presuntivo (CIE-10)",
    desc: "Código y descripción del diagnóstico que motiva el estudio",
    tipo: "text",
    placeholder: "Ej. M54.5 — Lumbalgia",
  },
  just: {
    label: "Justificación clínica",
    desc: "Motivo / hallazgos que justifican la solicitud",
    tipo: "textarea",
    placeholder: "Describa el motivo clínico del estudio…",
  },
  prio: {
    label: "Prioridad de la solicitud",
    desc: "Rutina, Urgente o STAT (aplica a toda la solicitud)",
    tipo: "select",
    opts: ["Rutina", "Urgente", "STAT"],
  },
  fecha: {
    label: "Fecha deseada del estudio",
    desc: "Fecha propuesta para programación",
    tipo: "date",
  },
  embarazo: {
    label: "¿Posibilidad de embarazo?",
    desc: "Seguridad radiológica en pacientes femeninas",
    tipo: "select",
    opts: ["No aplica", "No", "Sí", "Se desconoce"],
  },
  alergias: {
    label: "Alergias conocidas",
    desc: "Relevante para estudios con medio de contraste",
    tipo: "text",
    placeholder: "Ej. Yodo, mariscos, ninguna conocida…",
  },
  creat: {
    label: "Creatinina sérica (mg/dL)",
    desc: "Se exige cuando hay estudios con contraste",
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
    label: "Habilitar búsqueda global de prestaciones",
    desc: "Muestra el interruptor «Buscar en todas las categorías»",
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
