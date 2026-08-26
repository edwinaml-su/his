/**
 * CC-0026 Ola 2 — metadata de las 8 categorías del CPOE (grid + modales).
 *
 * Colores/iconos/labels son valores EXACTOS del mockup ESP-MOCKUP-0026
 * (`docs/CC/0026/avanteindicacionmedicamockup (1).html`, objeto `CATS`).
 *
 * Se centralizan aquí como constantes de módulo — NO como tokens Tailwind
 * globales — siguiendo el precedente ya aprobado en
 * `apps/web/src/app/(clinical)/lis/orders/new/../_lib/mock-palette.ts`
 * (CC-0013): son colores de una herramienta clínica operativa puntual, no
 * parte del design system de paciente, y aplicarlos vía `style` evita
 * inflar `tailwind.config.ts` con 8 tokens de un solo uso.
 */

export type CategoriaKey =
  | "mov"
  | "dieta"
  | "cuidados"
  | "med"
  | "lab"
  | "gab"
  | "proc"
  | "inter";

/** Espejo de tipoIndicacionEnum (SQL 211) — ver indicaciones-medicas.router.ts. */
export type TipoItemBackend =
  | "MEDICAMENTO"
  | "PROCEDIMIENTO"
  | "DIETA"
  | "CUIDADO_GENERAL"
  | "ESTUDIO"
  | "REPOSO"
  | "MOVIMIENTO"
  | "INTERCONSULTA";

export interface CategoriaMeta {
  key: CategoriaKey;
  label: string;
  /** Emoji del mockup — no requiere asset/librería de íconos nueva. */
  icon: string;
  /** Hex EXACTO del mockup (`CATS[key].color`). */
  color: string;
  /** mov y cuidados: cuadro único sin límite de líneas (`freeBox` en el mockup). */
  freeBox: boolean;
  /** Tipo de `ece.indicacion_item.tipo` que produce esta categoría. */
  tipoItem: TipoItemBackend;
  note: string;
}

/** Máximo de líneas visibles por categoría no-freeBox (`MAX_LINES` del mockup). */
export const MAX_LINES = 3;

export const CATEGORIAS: CategoriaMeta[] = [
  {
    key: "mov",
    label: "Movimiento de paciente",
    icon: "🚑",
    color: "#0d9488",
    freeBox: true,
    tipoItem: "MOVIMIENTO",
    note: "La sede del establecimiento se sobreentiende desde el módulo de admisión. El tipo de movimiento es la primera orden y define los menús siguientes según la sede.",
  },
  {
    key: "dieta",
    label: "Dieta",
    icon: "🍽️",
    color: "#ca8a04",
    freeBox: false,
    tipoItem: "DIETA",
    note: "Indicación nutricional del paciente.",
  },
  {
    key: "cuidados",
    label: "Cuidados de enfermería",
    icon: "🩺",
    color: "#7c3aed",
    freeBox: true,
    tipoItem: "CUIDADO_GENERAL",
    note: "Expandí los apartados que apliquen (lo que esté abierto es lo que se registra); lo contraído no se anota. Al agregar, el conjunto completo se registra como una sola indicación médica.",
  },
  {
    key: "med",
    label: "Medicamentos",
    icon: "💊",
    color: "#2563eb",
    freeBox: false,
    tipoItem: "MEDICAMENTO",
    note: "Catálogo real de medicamentos del HIS. Buscá con 3+ letras, elegí y cargá dosis/vía/frecuencia.",
  },
  {
    key: "lab",
    label: "Exámenes de laboratorio",
    icon: "🧪",
    color: "#0891b2",
    freeBox: false,
    tipoItem: "ESTUDIO",
    note: "Solicitud de estudios de laboratorio clínico (catálogo LIS, CC-0013).",
  },
  {
    key: "gab",
    label: "Exámenes de gabinete",
    icon: "🩻",
    color: "#4f46e5",
    freeBox: false,
    tipoItem: "ESTUDIO",
    note: "Estudios de imagen y gabinete (catálogo de imágenes, CC-0016).",
  },
  {
    key: "proc",
    label: "Procedimientos",
    icon: "✂️",
    color: "#db2777",
    freeBox: false,
    tipoItem: "PROCEDIMIENTO",
    note: "Procedimientos médicos o quirúrgicos indicados.",
  },
  {
    key: "inter",
    label: "Interconsultas",
    icon: "👥",
    color: "#ea580c",
    freeBox: false,
    tipoItem: "INTERCONSULTA",
    note: "Solicitud de valoración por otra especialidad.",
  },
];

export const CATEGORIA_BY_KEY: Record<CategoriaKey, CategoriaMeta> = Object.fromEntries(
  CATEGORIAS.map((c) => [c.key, c]),
) as Record<CategoriaKey, CategoriaMeta>;

/** Línea agregada a una categoría — texto (para `descripcion`) + detalle estructurado. */
export interface EntradaCategoria {
  id: string;
  descripcion: string;
  detalle: Record<string, unknown>;
  /** Solo para `med`: FK real al catálogo Drug. */
  drugId?: string;
  /** Solo para `med`: legacy text fields que el router ya soporta. */
  dosis?: string;
  via?: string;
  frecuencia?: string;
  duracion?: string;
}
