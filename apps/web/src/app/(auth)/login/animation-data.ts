/**
 * Datos geométricos/temporales de la animación de login AxisMed — portados
 * literal desde `docs/CC/0010/axismedlogin.html` (líneas 435-497 del mockup).
 * NO alterar coordenadas/fórmulas: son la fuente de verdad visual.
 */

export type TracePoint = readonly [number, number];

/** 8 trazos del circuito que convergen en el nodo central (640,360). */
export const TRACES: readonly TracePoint[][] = [
  [[60, 80], [340, 80], [340, 250], [560, 250], [560, 360], [640, 360]],
  [[1220, 80], [940, 80], [940, 250], [720, 250], [720, 360], [640, 360]],
  [[60, 640], [340, 640], [340, 470], [560, 470], [560, 360], [640, 360]],
  [[1220, 640], [940, 640], [940, 470], [720, 470], [720, 360], [640, 360]],
  [[200, 30], [200, 210], [470, 210], [470, 320], [600, 320], [600, 360], [640, 360]],
  [[1080, 30], [1080, 210], [810, 210], [810, 320], [680, 320], [680, 360], [640, 360]],
  [[200, 690], [200, 510], [470, 510], [470, 400], [600, 400], [600, 360], [640, 360]],
  [[1080, 690], [1080, 510], [810, 510], [810, 400], [680, 400], [680, 360], [640, 360]],
] as const;

export type BlockColor = "N" | "M" | "B";

/** 12 bloques de la cruz: [columna, fila, color] en grilla 4x4. */
export const BLOCKS: readonly (readonly [number, number, BlockColor])[] = [
  [1, 0, "B"], [2, 0, "N"], [0, 1, "N"], [1, 1, "M"], [2, 1, "M"], [3, 1, "B"],
  [0, 2, "B"], [1, 2, "M"], [2, 2, "M"], [3, 2, "N"], [1, 3, "N"], [2, 3, "B"],
] as const;

export const COLORS: Record<BlockColor, string> = {
  N: "#232349",
  M: "#1D4F9C",
  B: "#0C74C2",
};

export function pathD(pts: readonly TracePoint[]): string {
  return "M " + pts.map((p) => `${p[0]} ${p[1]}`).join(" L ");
}

/** Easing cúbico in-out — idéntico al `easeIO` del mockup. */
export function easeIO(x: number): number {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Progreso del HUD (0-100) en función del tiempo transcurrido (segundos). */
export function pct(t: number): number {
  if (t <= 2.4) return 38 * easeIO(t / 2.4);
  if (t <= 6.4) return 38 + 38 * easeIO((t - 2.4) / 4);
  return Math.min(100, 76 + 24 * easeIO((t - 6.4) / 1.5));
}

export type CircuitBlock = {
  key: string;
  left: number;
  top: number;
  background: string;
  dx: string;
  dy: string;
  delay: string;
};

/** Precalcula la geometría de los bloques de la cruz (posición + offset de llegada). */
export function buildBlocks(): CircuitBlock[] {
  return BLOCKS.map(([c, r, col], i) => {
    const bx = (c + 0.5) * 75 - 150;
    const by = (r + 0.5) * 75 - 150;
    const dist = Math.hypot(bx, by);
    const ux = bx / dist;
    const uy = by / dist;
    const delay = (0.18 + (dist / 135) * 0.55).toFixed(3);
    return {
      key: `${c}-${r}-${i}`,
      left: c * 75,
      top: r * 75,
      background: COLORS[col],
      dx: `${(ux * 120).toFixed(1)}px`,
      dy: `${(uy * 120).toFixed(1)}px`,
      delay: `${delay}s`,
    };
  });
}

export type CircuitTrace = {
  key: string;
  d: string;
  traceDelay: string;
  ringCx: number;
  ringCy: number;
  pads: { key: string; cx: number; cy: number; delay: string }[];
  pulseDelay: string;
};

/** Precalcula trazos, pads/rings y delay de pulsos por trazo. */
export function buildTraces(): CircuitTrace[] {
  return TRACES.map((pts, i) => {
    const traceDelay = (i * 0.045).toFixed(3);
    const inner = pts.slice(1, -1);
    return {
      key: `trace-${i}`,
      d: pathD(pts),
      traceDelay: `${traceDelay}s`,
      ringCx: pts[0]![0],
      ringCy: pts[0]![1],
      pads: inner.map((p, j) => ({
        key: `pad-${i}-${j}`,
        cx: p[0],
        cy: p[1],
        delay: `${(i * 0.045 + 0.15 + j * 0.12).toFixed(3)}s`,
      })),
      pulseDelay: `${(0.45 + i * 0.045).toFixed(3)}s`,
    };
  });
}
