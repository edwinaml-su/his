/**
 * CC-0026 Ola 2 — catálogo de "Movimiento de paciente" (cascada sede → tipo →
 * submenús). Valores EXACTOS del mockup ESP-MOCKUP-0026 (objeto `CATS.mov` +
 * constantes `SEDES`/`MOV_TIPOS`/`MOV_INGRESO`/`MOV_PASE`/`TRAS_HE`/
 * `TRAS_CM_ROOMS`/`MOV_REMISION`).
 */

export type SedeTipo = "HE" | "CM" | "SAT";

/** Nombre real del establecimiento (public."Establishment".name) → sede corta. */
export const SEDES: Record<string, SedeTipo> = {
  "Avante Masferrer - Hospital Especializado": "HE",
  "Avante Beethoven - Centro Médico Especializado": "CM",
  "Avante Surf City - Clínica Médica Satelital": "SAT",
};

/**
 * Resuelve la sede desde el nombre real del establecimiento activo (session).
 * Match por substring (no exacto) para tolerar variaciones menores de
 * capitalización/espacios en el catálogo real vs. el literal del mockup.
 * Default HE si el nombre no matchea ninguna sede conocida (fallback seguro:
 * HE es la sede con más tipos/menús — nunca oculta opciones).
 */
export function resolveSedeTipo(establishmentName: string | null | undefined): SedeTipo {
  if (!establishmentName) return "HE";
  const n = establishmentName.toLowerCase();
  if (n.includes("masferrer")) return "HE";
  if (n.includes("beethoven")) return "CM";
  if (n.includes("surf city")) return "SAT";
  return "HE";
}

export const MOV_TIPOS: Record<SedeTipo, string[]> = {
  HE: ["Ingreso a", "Pase a", "Traslado a", "Referencia a", "Remisión a"],
  CM: ["Ingreso a", "Pase a", "Traslado a", "Referencia a", "Remisión a"],
  SAT: ["Pase a", "Referencia a", "Remisión a"],
};

export const MOV_INGRESO: Partial<Record<SedeTipo, string[]>> = {
  HE: [
    "Hospitalización adultos",
    "Hospitalización pediátrica",
    "Unidad de Cuidados Intensivos (UCI)",
    "Unidad de Cuidados Intermedios (UCINT)",
    "Unidad de Cuidados Especiales (UCE)",
    "Unidad de Intervención en Crisis y Acompañamiento (UICA)",
  ],
  CM: ["Hospitalización adultos"],
};

export const MOV_PASE: Record<SedeTipo, { label: string; opts: string[] }> = {
  HE: {
    label: "Unidad o sala",
    opts: [
      "Unidad de Máxima Urgencia",
      "Unidad de Observación",
      "Unidad de Pequeña Cirugía y Ortopedia Cerrada",
      "Unidad de Procedimientos",
      "Sala de Operaciones",
    ],
  },
  CM: {
    label: "Unidad o sala",
    opts: ["Unidad de Observación", "Unidad de Procedimientos", "Sala de Operaciones"],
  },
  SAT: {
    label: "Área de atención",
    opts: ["Área de Pretratamiento y cumplimiento parenteral", "Área de Procedimiento Menor"],
  },
};

/** Traslado HE: piso → servicio clínico → habitaciones (catálogo real por nombre). */
export const TRAS_HE: Record<string, Record<string, string[]>> = {
  "2do Piso": {
    UICA: ["Suva", "Puerto Moresby"],
    UCI: ["Van Gogh", "Picasso", "Da Vinci", "Miguel Ángel", "Dalí", "Monet"],
    UCINT: ["Van Gogh", "Picasso", "Da Vinci", "Miguel Ángel", "Dalí", "Monet"],
  },
  "3er Piso": {
    UCE: ["Beijing", "Kioto", "Seúl", "Hainan", "Hong Kong"],
    "Hospitalización adultos": [
      "Erevan",
      "Tokio",
      "Yakarta",
      "Bangkok",
      "Himalaya",
      "Singapur",
      "Manila",
    ],
  },
  "4to Nivel": {
    "Hospitalización adultos": [
      "Nakuru",
      "Oshikoto",
      "Harare",
      "Antalaha",
      "Maseru",
      "Centurión",
      "El Cairo",
    ],
    "Hospitalización Pediátrica": [
      "Arusha",
      "Luanda",
      "Constantina",
      "Rabat",
      "Lagos",
      "Nairobi",
      "Dakar",
    ],
  },
};

export const TRAS_CM_ROOMS: string[] = [
  "San Salvador",
  "Suchitoto",
  "Apaneca",
  "Milan",
  "Berlin",
  "Juayua",
  "Lisboa",
  "Paris",
  "La Unión",
  "Morazán",
  "Bruselas",
  "Santorini",
  "Isla de Capri",
  "Barcelona",
  "Atenas",
  "Londres",
  "Madrid",
  "Zurich",
  "Praga",
  "Rio de Janeiro",
  "Buenos Aires",
  "Guadalajara",
  "Lima",
  "Bogotá",
];

export const MOV_REMISION: string[] = [
  "Instituto Salvadoreño del Seguro Social",
  "Red Nacional de Hospitales",
  "Instituto Salvadoreño de Bienestar Magisterial",
];
