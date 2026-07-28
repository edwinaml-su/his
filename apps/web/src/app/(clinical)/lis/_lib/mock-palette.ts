/**
 * CC-0013 — paleta literal de docs/CC/0013/mockup_examenes_laboratorio.html
 * (`:root` CSS custom properties, línea 8 del HTML). El módulo de
 * escogitación/tablero de exámenes de laboratorio es una herramienta
 * operativa interna (no parte del design system de paciente), por lo que
 * estos valores se centralizan aquí en vez de materializarse como tokens
 * Tailwind globales — instrucción explícita del brief CC-0013. Compartido
 * entre `/lis/orders/new` y `/lis/orders` (tablero).
 */
export const MOCK_LAB_PALETTE = {
  teal: "#2f8a99",
  tealDark: "#2a7d8c",
  orange: "#e8853d",
  blue: "#2f6fb0",
  ink: "#243642",
  inkSoft: "#4a5b66",
  line: "#d9e0e4",
} as const;

/** Estados editables desde el modal "Solicitud" del tablero (labOrderItemUpdateStatusEnum). */
export const ESTADOS_EDITABLES: { value: "ORDERED" | "IN_PROCESS" | "RESULTED"; label: string }[] = [
  { value: "ORDERED", label: "Pendiente" },
  { value: "IN_PROCESS", label: "En proceso" },
  { value: "RESULTED", label: "Realizado" },
];
