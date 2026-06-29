/**
 * Mapa corporal de 22 regiones — REQ-ECE-LCE-001 §IV.
 * Geometría tomada del mockup historia-clinica-lesion-causa-externa.html.
 *
 * Las etiquetas están corregidas al lado anatómico del paciente:
 *   - anterior  → A = derecho,   B = izquierdo
 *   - posterior → A = izquierdo, B = derecho
 *
 * viewBox del SVG: "0 0 240 680".
 */

export type VistaCuerpo = "front" | "back";

export interface RegionCuerpo {
  id: string;
  /** Path SVG explícito (para regiones curvas); si falta se deriva de `pts`. */
  d?: string;
  /** Polígono como lista de puntos [x, y]. */
  pts?: ReadonlyArray<readonly [number, number]>;
  front: string;
  back: string;
}

export const VIEWBOX = "0 0 240 680" as const;

export const REGIONES: readonly RegionCuerpo[] = [
  { id: "cranio", d: "M96 68 A24 42 0 0 1 144 68 Z", front: "Cráneo (frontal)", back: "Cráneo (posterior)" },
  { id: "cara", d: "M96 68 A24 42 0 0 0 144 68 Z", front: "Cara", back: "Nuca" },
  { id: "neck", pts: [[108, 108], [132, 108], [132, 140], [108, 140]], front: "Cuello (anterior)", back: "Cuello (posterior)" },
  { id: "shoulderA", pts: [[74, 140], [120, 140], [120, 170], [82, 170]], front: "Hombro derecho", back: "Hombro izquierdo" },
  { id: "shoulderB", pts: [[166, 140], [120, 140], [120, 170], [158, 170]], front: "Hombro izquierdo", back: "Hombro derecho" },
  { id: "torax", pts: [[82, 170], [158, 170], [153, 255], [87, 255]], front: "Tórax", back: "Región dorsal (espalda alta)" },
  { id: "abdomen", pts: [[87, 255], [153, 255], [156, 330], [84, 330]], front: "Abdomen", back: "Región lumbar (espalda baja)" },
  { id: "pelvis", pts: [[84, 330], [156, 330], [153, 395], [124, 395], [120, 360], [116, 395], [87, 395]], front: "Pelvis / genitales", back: "Glúteos / región sacra" },
  { id: "brazoA", pts: [[60, 175], [80, 172], [80, 285], [62, 288]], front: "Brazo derecho", back: "Brazo izquierdo" },
  { id: "antebrazoA", pts: [[62, 288], [80, 285], [78, 400], [60, 403]], front: "Antebrazo derecho", back: "Antebrazo izquierdo" },
  { id: "manoA", pts: [[58, 403], [78, 400], [80, 448], [56, 452]], front: "Mano derecha", back: "Mano izquierda (dorso)" },
  { id: "brazoB", pts: [[180, 175], [160, 172], [160, 285], [178, 288]], front: "Brazo izquierdo", back: "Brazo derecho" },
  { id: "antebrazoB", pts: [[178, 288], [160, 285], [162, 400], [180, 403]], front: "Antebrazo izquierdo", back: "Antebrazo derecho" },
  { id: "manoB", pts: [[182, 403], [162, 400], [160, 448], [184, 452]], front: "Mano izquierda", back: "Mano derecha (dorso)" },
  { id: "musloA", pts: [[88, 395], [116, 395], [112, 505], [92, 505]], front: "Muslo derecho", back: "Muslo izquierdo (posterior)" },
  { id: "rodillaA", pts: [[92, 505], [112, 505], [110, 535], [94, 535]], front: "Rodilla derecha", back: "Hueco poplíteo izquierdo" },
  { id: "piernaA", pts: [[94, 535], [110, 535], [106, 630], [98, 630]], front: "Pierna derecha", back: "Pantorrilla izquierda" },
  { id: "pieA", pts: [[98, 630], [106, 630], [116, 658], [90, 658]], front: "Pie derecho", back: "Talón izquierdo" },
  { id: "musloB", pts: [[152, 395], [124, 395], [128, 505], [150, 505]], front: "Muslo izquierdo", back: "Muslo derecho (posterior)" },
  { id: "rodillaB", pts: [[148, 505], [128, 505], [130, 535], [146, 535]], front: "Rodilla izquierda", back: "Hueco poplíteo derecho" },
  { id: "piernaB", pts: [[146, 535], [130, 535], [134, 630], [142, 630]], front: "Pierna izquierda", back: "Pantorrilla derecha" },
  { id: "pieB", pts: [[142, 630], [134, 630], [124, 658], [150, 658]], front: "Pie izquierdo", back: "Talón derecho" },
];

/** Convierte una lista de puntos en un atributo `d` de path cerrado. */
export function ptsToPath(pts: ReadonlyArray<readonly [number, number]>): string {
  return "M " + pts.map((p) => `${p[0]} ${p[1]}`).join(" L ") + " Z";
}

export function regionPath(r: RegionCuerpo): string {
  return r.d ?? ptsToPath(r.pts ?? []);
}

/** Un sitio anatómico marcado: clave estable "vista:id" + etiqueta legible. */
export interface SitioCorporal {
  key: string;
  label: string;
}
