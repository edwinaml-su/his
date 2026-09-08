/**
 * CC-0013 / Rediseño lab 2026-09 — paleta literal de
 * `design/mockup/mockup_examenes_laboratorio.html` (`:root` CSS custom
 * properties, línea 2 del HTML; mismos valores hex que la versión CC-0013
 * previa en `docs/CC/0013/`). El módulo de escogitación/tablero de exámenes
 * de laboratorio es una herramienta operativa interna (no parte del design
 * system de paciente), por lo que estos valores se centralizan aquí en vez
 * de materializarse como tokens Tailwind globales — instrucción explícita
 * del brief CC-0013, confirmada en el rediseño 2026-09 (ver
 * `docs/DESIGN-SPEC.md` §9 "Laboratorio v2"). Compartido entre
 * `/lis/orders/new` (cascada tipo→subtipo→sección) y `/lis/orders` (tablero
 * + vista Estudios).
 */
export const MOCK_LAB_PALETTE = {
  teal: "#2f8a99",
  tealDark: "#2a7d8c",
  /** Rediseño lab 2026-09 — `.rb.sub.active` background (mockup línea 37). */
  tealSub: "#3f9aa8",
  orange: "#e8853d",
  blue: "#2f6fb0",
  ink: "#243642",
  inkSoft: "#4a5b66",
  line: "#d9e0e4",
  /** Rediseño lab 2026-09 — `.rb` border, pills de la cascada (línea 35). */
  rbBorder: "#cdd9db",
  /** Rediseño lab 2026-09 — `.rb:hover` / `.check-item:hover` (líneas 36, 51). */
  rbHoverBg: "#f0f6f7",
  /** Rediseño lab 2026-09 — `.rb .cnt` background, contador de pills (línea 39). */
  cntBg: "#eef4f5",
  /** Rediseño lab 2026-09 — `.config-panel` / `.solicitud-panel` background (líneas 28, 61). */
  panelSoftBg: "#fafcfc",
  /** Rediseño lab 2026-09 — `.selection-bar` background (línea 56). */
  selectionBarBg: "#f7f9fa",
  /** Rediseño lab 2026-09 — `.cfg-hint` color (línea 41). */
  hintColor: "#8b98a0",
  /** Rediseño lab 2026-09 — `.prest-count.zero` background (línea 47). */
  zeroBadgeBg: "#aeb9bf",
  /** Rediseño lab 2026-09 — `.sec-badge` background (línea 53). */
  secBadgeBg: "#e6eef0",
  /** Rediseño lab 2026-09 — `.rm` background/color, botón quitar (línea 73). */
  removeBg: "#fbe4e0",
  removeColor: "#c0392b",
  /** Rediseño lab 2026-09 — `.slider` background estado apagado (línea 21). */
  switchTrackOff: "#c3ccd1",
} as const;

/** Estados editables desde el modal "Solicitud" del tablero (labOrderItemUpdateStatusEnum). */
export const ESTADOS_EDITABLES: { value: "ORDERED" | "IN_PROCESS" | "RESULTED"; label: string }[] = [
  { value: "ORDERED", label: "Pendiente" },
  { value: "IN_PROCESS", label: "En proceso" },
  { value: "RESULTED", label: "Realizado" },
];

/**
 * CC-0013b — pill de estado agrupado para la vista "Estudios" (grid de
 * consulta de todos los estados). Colores literales del mockup CC-0013
 * (`.pill-pend`/`.pill-proc`/`.pill-list`, línea 94 del HTML). Pendiente del
 * modal "Solicitud" ≡ Creado aquí — mismo grupo de estados
 * (DRAFT/ORDERED/COLLECTED), solo se re-etiqueta para esta vista porque
 * Edwin pidió explícitamente Creado/En proceso/Hecho. ANULADO no está en el
 * mockup original (CANCELLED no es alcanzable desde el modal); color propio.
 */
export const ESTUDIO_ESTADO_PILL: Record<
  "CREADO" | "EN_PROCESO" | "HECHO" | "ANULADO",
  { label: string; background: string; color: string }
> = {
  CREADO: { label: "Creado", background: "#fdf1dd", color: "#b9791b" },
  EN_PROCESO: { label: "En proceso", background: "#e2ecfb", color: "#2f6fb0" },
  HECHO: { label: "Hecho", background: "#e0f2e9", color: "#1c7a4a" },
  ANULADO: { label: "Anulado", background: "#f3d9d9", color: "#b3261e" },
};
