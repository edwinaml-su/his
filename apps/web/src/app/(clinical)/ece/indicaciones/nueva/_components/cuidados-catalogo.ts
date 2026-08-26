/**
 * CC-0026 Ola 2 — catálogo de "Cuidados de enfermería" (ESP-MOCKUP-0026
 * §CUI_SECTIONS). Valores EXACTOS del mockup (constantes `CUI_SECTIONS`,
 * `INS_ROWS`, `O2_DEVICES`, `VENTURI`, `VM_GRUPOS`, `VMNI_R`, `VMI_MODOS`,
 * `VMI_R`).
 */

export type SeccionKind =
  | "tipo"
  | "sv"
  | "anotar"
  | "movilidad"
  | "respaldo"
  | "multi"
  | "gluco"
  | "o2"
  | "vmni"
  | "vmi"
  | undefined;

export interface CuiSeccion {
  name: string;
  openName?: string;
  kind?: SeccionKind;
  opts?: string[];
  na?: boolean;
  pre?: string;
}

/** Las 19 secciones reales del CPOE (ESP-MOCKUP-0026 numera 20 líneas, la #19 es
 * una nota sobre el bloque respiratorio 16-19, no una sección propia). */
export const CUI_SECTIONS: CuiSeccion[] = [
  { name: "Mantener aislamiento", kind: "tipo", opts: ["Por contacto", "Por gotas", "Por aerosol", "Invertido"], na: true },
  { name: "Tomar signos vitales", kind: "sv" },
  { name: "Llevar balance hídrico y diuresis horaria", kind: "anotar", opts: ["4 Horas", "6 Horas", "8 Horas", "12 Horas", "Día"], na: true },
  { name: "Tomar temperatura", kind: "anotar", opts: ["Hora", "2 Horas", "4 Horas", "6 Horas", "8 Horas", "12 Horas", "Día"], na: true },
  { name: "Movilidad", openName: "Mantener", kind: "movilidad" },
  { name: "Respaldo", openName: "Mantener", kind: "respaldo" },
  { name: "Cambio de posición cada 2 horas", na: true },
  { name: "Colchón antiescaras", na: true },
  { name: "Cuidado de piel y mucosas" },
  { name: "Aseo oral" },
  { name: "Baño diario", kind: "tipo", opts: ["cama", "ducha"], pre: "en" },
  {
    name: "Cuidado de sonda",
    kind: "multi",
    na: true,
    opts: ["Nasogástrica", "Nasoyeyunal", "De gastrostomía", "De ileostomía", "Transuretral"],
  },
  {
    name: "Cuidado de catéter",
    kind: "multi",
    na: true,
    opts: [
      "De venoclisis periférica",
      "Venoso central de inserción central",
      "Venoso central de inserción periférica (PICC)",
      "Venoso central de larga duración (PORT-A-CATH)",
      "Venoso central tunelizado de larga duración (PERM-A-CATH)",
      "Venoso central de doble lumen de corta duración (Mahurkar)",
      "Flexible de cavidad abdominal (Tenckhoff)",
    ],
  },
  { name: "Cuidado de tubo", kind: "multi", na: true, opts: ["Orotraqueal", "De tórax"] },
  { name: "Tomar glucometría capilar", kind: "gluco", na: true },
  { name: "Mantener oxígeno a aire ambiente" },
  { name: "Suministrar oxígeno suplementario", kind: "o2", na: true },
  { name: "Ventilación mecánica no invasiva", kind: "vmni", na: true },
  { name: "Ventilación mecánica invasiva", kind: "vmi", na: true },
];

/** Índices 16-19 (0-based: 15-18) — bloque respiratorio mutuamente excluyente. */
export const RESPIRATORY_BLOCK_INDICES = CUI_SECTIONS.reduce<number[]>((acc, s, i) => {
  if (s.kind === "o2" || s.kind === "vmni" || s.kind === "vmi" || s.name === "Mantener oxígeno a aire ambiente") {
    acc.push(i);
  }
  return acc;
}, []);

export const INS_ROWS: Array<[string, string]> = [
  ["160-200", "2 Unidades"],
  ["201-250", "4 Unidades"],
  ["251-300", "6 Unidades"],
  ["301-350", "8 Unidades"],
  [">350", "10 Unidades"],
];

export const O2_DEVICES = [
  "Cánula nasal de bajo flujo",
  "Mascarilla Venturi",
  "Mascarilla con reservorio",
  "Cánula nasal de alto flujo (CNAF)",
];

export interface VenturiValvula {
  color: string;
  fio2: number;
  min: number;
  max: number;
  rec: number;
}

export const VENTURI: VenturiValvula[] = [
  { color: "Azul", fio2: 24, min: 2, max: 4, rec: 3 },
  { color: "Blanco", fio2: 28, min: 4, max: 6, rec: 5 },
  { color: "Naranja", fio2: 31, min: 6, max: 8, rec: 7 },
  { color: "Amarillo", fio2: 35, min: 8, max: 10, rec: 9 },
  { color: "Rojo", fio2: 40, min: 10, max: 12, rec: 11 },
  { color: "Verde", fio2: 60, min: 15, max: 15, rec: 15 },
];

export const O2_NOTES: Record<string, string> = {
  "Cánula nasal de bajo flujo":
    "Relación acoplada: FiO₂ = 20 + 4 × flujo · 1–6 L/min → 24–44%. Flujo > 6 L/min: forzar cambio de dispositivo.",
  "Cánula nasal de alto flujo (CNAF)": "Flujo 10–60 L/min · FiO₂ 21–100%.",
  "Mascarilla Venturi":
    "FiO₂ determinada por la válvula de color (tabla de válvulas); el flujo se ajusta al rango recomendado de cada válvula.",
  "Mascarilla con reservorio":
    "Relación acoplada: FiO₂ = 80 + 4 × (flujo − 10) · 10–15 L/min → 80–100% (estimada). Nunca < 10 L/min.",
};

export const VM_GRUPOS = ["Adulto", "Pediátrico", "Neonato"] as const;
export type VmGrupo = (typeof VM_GRUPOS)[number];

type Rango = [number, number];

/**
 * Tipado con claves explícitas (no `Record<string, ...>`) a propósito: con
 * `noUncheckedIndexedAccess` (tsconfig.base.json), un `Record<string, X>`
 * hace que hasta el acceso `VMNI_R.ipap` (no solo `[grupo]`) resuelva a
 * `X | undefined`, obligando a un `!` extra que no aporta seguridad real
 * (las 5 claves son fijas y siempre existen).
 */
export const VMNI_R: {
  cpap: Partial<Record<VmGrupo, Rango>>;
  ipap: Partial<Record<VmGrupo, Rango>>;
  epap: Partial<Record<VmGrupo, Rango>>;
  frr: Partial<Record<VmGrupo, Rango>>;
  ti: Partial<Record<VmGrupo, Rango>>;
} = {
  cpap: { Neonato: [4, 8], Pediátrico: [4, 10], Adulto: [4, 20] },
  ipap: { Pediátrico: [8, 20], Adulto: [8, 30] },
  epap: { Pediátrico: [4, 10], Adulto: [4, 20] },
  frr: { Pediátrico: [10, 40], Adulto: [8, 30] },
  ti: { Pediátrico: [0.5, 1.2], Adulto: [0.5, 2.0] },
};

export const VMI_MODOS: Record<VmGrupo, string[]> = {
  Neonato: ["PC-CMV", "VC-CMV", "SIMV-PC", "SIMV-VC", "PSV", "CPAP"],
  Pediátrico: ["VCV", "PCV", "SIMV-VC", "SIMV-PC", "PSV", "CPAP"],
  Adulto: ["VCV", "PCV", "SIMV-VC", "SIMV-PC", "PSV", "CPAP", "Bilevel / DuoPAP", "VS"],
};

export const VMI_R: Record<string, Record<VmGrupo, Rango>> = {
  vt: { Neonato: [5, 50], Pediátrico: [20, 400], Adulto: [200, 800] },
  fr: { Neonato: [20, 80], Pediátrico: [10, 50], Adulto: [6, 40] },
  peep: { Neonato: [3, 10], Pediátrico: [3, 15], Adulto: [0, 24] },
  fio2: { Neonato: [21, 100], Pediátrico: [21, 100], Adulto: [21, 100] },
  flujo: { Neonato: [2, 20], Pediátrico: [5, 60], Adulto: [20, 120] },
  pi: { Neonato: [5, 30], Pediátrico: [5, 35], Adulto: [5, 35] },
  ps: { Neonato: [4, 20], Pediátrico: [4, 25], Adulto: [5, 30] },
  ti: { Neonato: [0.2, 0.6], Pediátrico: [0.4, 1.2], Adulto: [0.3, 3.0] },
};

export const VMI_META: Record<string, { pre: string; unit: string; step: number }> = {
  vt: { pre: "Vt", unit: "mL", step: 1 },
  fr: { pre: "FR", unit: "rpm", step: 1 },
  peep: { pre: "PEEP", unit: "cmH₂O", step: 1 },
  fio2: { pre: "FiO₂", unit: "%", step: 1 },
  flujo: { pre: "flujo insp.", unit: "L/min", step: 1 },
  pi: { pre: "PI", unit: "cmH₂O", step: 1 },
  ps: { pre: "PS", unit: "cmH₂O", step: 1 },
  ti: { pre: "Ti", unit: "s", step: 0.1 },
};

/** Parámetros que aplican a cada modo VMI (sin el trigger, que es aparte). */
export function vmiModeParams(modo: string): string[] {
  if (modo === "VCV" || modo === "VC-CMV" || modo === "SIMV-VC") return ["vt", "fr", "peep", "fio2", "flujo"];
  if (modo === "PCV" || modo === "PC-CMV" || modo === "SIMV-PC" || modo === "Bilevel / DuoPAP")
    return ["pi", "ti", "fr", "peep", "fio2"];
  if (modo === "PSV") return ["ps", "peep", "fio2"];
  if (modo === "VS") return ["vt", "peep", "fio2"];
  return ["peep", "fio2"]; // CPAP
}

export function rangoMedio(r: Rango, step: number): number {
  const m = (r[0] + r[1]) / 2;
  return step < 1 ? Math.round(m * 10) / 10 : Math.round(m);
}
