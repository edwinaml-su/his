/**
 * CC-0006 §2/§6 — paleta avante4 (valores EXACTOS del mockup). Fuente única de
 * verdad para preservar la línea gráfica en todas las tarjetas y sub-bloques de
 * la evolución médica SOAP.
 *
 * Dos formas según el uso:
 *  - Clases Tailwind estáticas (arbitrary values) para el chrome fijo de tarjetas:
 *    el JIT las detecta porque son literales de string en este archivo.
 *  - Hex sueltos para colores aplicados dinámicamente vía `style` (clasificaciones
 *    clínicas, iconos de sexo, sellos) donde Tailwind no puede generar la clase.
 */

/** §6 — chrome por sección: borde de tarjeta, tinte del encabezado y badge. */
export interface SeccionChrome {
  /** Borde de la tarjeta (color `-bd` de §6; incl. variante oscura). */
  card: string;
  /** Fondo tintado del encabezado `.card__head` (color `-soft` de §6). */
  head: string;
  /** Fondo del cuadro-badge; la letra/ícono va en blanco encima. */
  badge: string;
}

/**
 * §6 — tabla de colores de encabezado y badges. Subjetivo=índigo/purple-soft,
 * Objetivo=teal/green-soft, Análisis=ámbar/amber-soft, Plan=slate/gray-soft,
 * Problemas=azul/blue-soft, Especialidad=avante-green sobre blanco. Las
 * variantes `dark:` usan los tokens de §2.2 para preservar la línea en oscuro.
 */
export const SECCION: Record<
  "especialidad" | "problemas" | "subjetivo" | "objetivo" | "analisis" | "plan",
  SeccionChrome
> = {
  especialidad: { card: "border-[#e5e9f0] dark:border-[#1d2942]", head: "bg-white dark:bg-[#0f1a2e]", badge: "bg-[#00a14b]" },
  problemas: { card: "border-[#bfdbfe] dark:border-[#23406e]", head: "bg-[#eff6ff] dark:bg-[#0f1f3a]", badge: "bg-[#3b82f6]" },
  subjetivo: { card: "border-[#e9d5ff] dark:border-[#3b2d63]", head: "bg-[#faf5ff] dark:bg-[#1e1633]", badge: "bg-[#6366f1]" },
  objetivo: { card: "border-[#bbf7d0] dark:border-[#1e4d36]", head: "bg-[#dcfce7] dark:bg-[#0e2a1c]", badge: "bg-[#0d9488]" },
  analisis: { card: "border-[#fde68a] dark:border-[#4a3a13]", head: "bg-[#fffbeb] dark:bg-[#241c08]", badge: "bg-[#f59e0b]" },
  plan: { card: "border-[#cbd5e1] dark:border-[#2a3a57]", head: "bg-[#f1f5f9] dark:bg-[#131d31]", badge: "bg-[#1e293b]" },
};

/**
 * §6 — títulos de sub-área (Signos vitales, Registro de objetivo, Antecedentes,
 * Plan de manejo, Misceláneos): texto e ícono en teal, 12.5px, peso 800, mayúsculas.
 */
export const SUBTITULO_TEAL =
  "text-[12.5px] font-extrabold uppercase tracking-wide text-[#0d9488]";

/**
 * §9 — color de acento por sección (hex) para el cue "+ Registrar …" del cuadro
 * vacío clickeable. Mismo valor del badge de §6 (índigo / teal / ámbar).
 */
export const SECCION_ACCENT = {
  subjetivo: "#6366f1",
  objetivo: "#0d9488",
  analisis: "#f59e0b",
} as const;

/** §5 — iconografía de sexo (color dinámico → aplicar vía style). */
export const SEX_ICON_COLOR = { F: "#ec4899", M: "#1e3a8a" } as const;

/** §5.2 / §10.3 — lila del nombre de pila / banner LGBTIQ+. */
export const PILA_LILA = {
  text: "#7e22ce",
  bg: "#faf5ff",
  border: "#e9d5ff",
  focus: "#9333ea",
} as const;

/** §2.3 — sello "registrado por" / hint de éxito (verde sobre green-soft/green-bd). */
export const SELLO_VERDE = { text: "#15803d", bg: "#dcfce7", border: "#bbf7d0" } as const;

/** §5.1 — banner de alergias en estado peligro (rojo sobre red-soft/red-bd). */
export const ALERGIA_DANGER = { text: "#dc2626", bg: "#fee2e2", border: "#fecaca" } as const;

/**
 * §2.3 / §10.7 — colores de clasificación clínica (IMC / ICT / Glasgow / EVA),
 * aplicados dinámicamente vía `style` según la categoría calculada.
 */
export const CLINICO = {
  azul: "#2563eb",
  verde: "#16a34a",
  lima: "#65a30d",
  naranja: "#ea580c",
  rojo: "#dc2626",
  rojoIntenso: "#b91c1c",
} as const;
