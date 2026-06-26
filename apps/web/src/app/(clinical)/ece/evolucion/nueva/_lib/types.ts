/**
 * Tipos y helpers puros del draft de Evolución Médica SOAP (CC-0006).
 *
 * Sin dependencias de React ni de tRPC — facilita tests unitarios del reducer.
 */

// ─── Tipos de dominio ────────────────────────────────────────────────────────

export interface EvolucionProblema {
  id: string;
  texto: string;
  /** null = raíz; string = hijo del problema con ese id */
  parentId: string | null;
  orden: number;
}

export interface IndicacionPlan {
  id: string;
  texto: string;
  orden: number;
}

/** R3: especialidad médica (catálogo MedicalSpecialty; id null = texto libre). */
export interface EspecialidadState {
  id: string | null;
  nombre: string;
}

export const ESPECIALIDAD_EMPTY: EspecialidadState = { id: null, nombre: "" };

/**
 * Estado de los signos vitales como strings (facilita inputs controlados).
 * `escalaDolor` es number (slider, no puede quedar vacío).
 *
 * CC-0006 R1: ampliado a FiO₂, Glasgow (3 componentes), glucometría,
 * antropometría (kg/lb, m/ft, cintura), balance hídrico, diuresis y
 * gineco-obstétrico (FUR + fórmula GPPAV).
 */
export interface SignosState {
  // Núcleo (R4) — obligatorio para firmar
  presionSistolica: string;
  presionDiastolica: string;
  frecuenciaCardiaca: string;
  frecuenciaRespiratoria: string;
  temperatura: string;
  saturacionO2: string;
  fio2: string;
  // Estado neurológico y metabólico (R1.2)
  glasgowOcular: string;
  glasgowVerbal: string;
  glasgowMotora: string;
  glucometriaMgdl: string;
  // Antropometría (R1.3)
  pesoKg: string;
  pesoLb: string;
  tallaM: string;
  tallaFt: string;
  perimetroCintura: string;
  // Balance hídrico (R1.4)
  balanceHidrico: string;
  diuresisHoraria: string;
  // Gineco-obstétrico (R1.5)
  fechaUltimaRegla: string;
  gestaG: string;
  partoTermino: string;
  partoPretermino: string;
  abortos: string;
  vivos: string;
  // Dolor (EVA)
  escalaDolor: number;
}

export const SIGNOS_EMPTY: SignosState = {
  presionSistolica: "",
  presionDiastolica: "",
  frecuenciaCardiaca: "",
  frecuenciaRespiratoria: "",
  temperatura: "",
  saturacionO2: "",
  fio2: "",
  glasgowOcular: "",
  glasgowVerbal: "",
  glasgowMotora: "",
  glucometriaMgdl: "",
  pesoKg: "",
  pesoLb: "",
  tallaM: "",
  tallaFt: "",
  perimetroCintura: "",
  balanceHidrico: "",
  diuresisHoraria: "",
  fechaUltimaRegla: "",
  gestaG: "",
  partoTermino: "",
  partoPretermino: "",
  abortos: "",
  vivos: "",
  escalaDolor: 0,
};

export interface DraftState {
  especialidad: EspecialidadState;
  problemas: EvolucionProblema[];
  subjetivo: string;
  objetivo: string;
  analisis: string;
  plan: IndicacionPlan[];
  signos: SignosState;
}

export const DRAFT_EMPTY: DraftState = {
  especialidad: ESPECIALIDAD_EMPTY,
  problemas: [],
  subjetivo: "",
  objetivo: "",
  analisis: "",
  plan: [],
  signos: SIGNOS_EMPTY,
};

// ─── Acciones del reducer ────────────────────────────────────────────────────

export type DraftAction =
  | { type: "SET_ESPECIALIDAD"; especialidad: EspecialidadState }
  | { type: "SET_SUBJETIVO"; texto: string }
  | { type: "SET_OBJETIVO"; texto: string }
  | { type: "SET_ANALISIS"; texto: string }
  | { type: "SET_SIGNOS"; signos: SignosState }
  | { type: "ADD_PROBLEMA"; texto: string }
  | { type: "EDIT_PROBLEMA"; id: string; texto: string }
  | { type: "DELETE_PROBLEMA"; id: string }
  | { type: "GROUP_PROBLEMAS"; ids: string[]; nombrePadre: string }
  | { type: "UNGROUP_PROBLEMA"; parentId: string }
  | { type: "ADD_PLAN"; texto: string }
  | { type: "EDIT_PLAN"; id: string; texto: string }
  | { type: "DELETE_PLAN"; id: string };

// ─── Helpers de numeración (presentación) ────────────────────────────────────

/**
 * Devuelve la etiqueta de numeración para mostrar en la UI:
 *   - problema raíz sin hijos → "1", "2", "3"…
 *   - problema raíz con hijos → muestra ícono de carpeta (el caller lo decide)
 *   - hijo → "1.1", "1.2"…
 *
 * Esta función solo calcula el índice; la UI decide el ícono para padres.
 */
export function calcNumero(
  problema: EvolucionProblema,
  todos: EvolucionProblema[],
): string {
  if (problema.parentId !== null) {
    // es hijo → buscar índice del padre + índice del hijo dentro del padre
    const raices = todos.filter((p) => p.parentId === null);
    const padreIdx = raices.findIndex((p) => p.id === problema.parentId);
    if (padreIdx === -1) return "?";
    const hermanos = todos.filter((p) => p.parentId === problema.parentId);
    const hijoIdx = hermanos.findIndex((p) => p.id === problema.id);
    return `${padreIdx + 1}.${hijoIdx + 1}`;
  }
  // es raíz → número entre todas las raíces
  const raices = todos.filter((p) => p.parentId === null);
  const idx = raices.findIndex((p) => p.id === problema.id);
  return idx === -1 ? "?" : String(idx + 1);
}

// ─── Helper: tiene signos ─────────────────────────────────────────────────────

export function tieneSignos(s: SignosState): boolean {
  const { escalaDolor, ...campos } = s;
  return escalaDolor > 0 || Object.values(campos).some((v) => v.trim() !== "");
}

// ─── Helper: signos vitales núcleo completos ──────────────────────────────────

/**
 * Núcleo de signos vitales obligatorio para firmar (R4): Presión arterial
 * (sistólica + diastólica) y Oxigenación/signos cardiorrespiratorios
 * (FC, FR, Temperatura, SpO₂, FiO₂) = 7 campos. El resto es opcional.
 */
export const SIGNOS_NUCLEO = [
  "presionSistolica",
  "presionDiastolica",
  "frecuenciaCardiaca",
  "frecuenciaRespiratoria",
  "temperatura",
  "saturacionO2",
  "fio2",
] as const;

export function signosNucleoCompletos(s: SignosState): boolean {
  return SIGNOS_NUCLEO.every((k) => s[k].trim() !== "");
}

// ─── Helper: campos obligatorios faltantes ────────────────────────────────────

/**
 * Lista (en orden de pantalla) de campos obligatorios aún sin llenar (R4.2):
 * especialidad + ≥1 problema + signos núcleo (7) + subjetivo + objetivo +
 * análisis + ≥1 indicación de plan.
 */
export function camposFaltantes(draft: DraftState): string[] {
  const faltan: string[] = [];
  if (draft.especialidad.nombre.trim() === "") faltan.push("especialidad");
  if (draft.problemas.length === 0) faltan.push("problema");
  if (draft.subjetivo.trim() === "") faltan.push("subjetivo");
  if (!signosNucleoCompletos(draft.signos)) faltan.push("signos vitales");
  if (draft.objetivo.trim() === "") faltan.push("objetivo");
  if (draft.analisis.trim() === "") faltan.push("análisis");
  if (draft.plan.length === 0) faltan.push("plan");
  return faltan;
}

// ─── Helper: puede firmar ─────────────────────────────────────────────────────

/** Todos los campos obligatorios completos (ver camposFaltantes). */
export function puedeFirmar(draft: DraftState): boolean {
  return camposFaltantes(draft).length === 0;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

function nextOrden(arr: { orden: number }[]): number {
  return arr.length === 0 ? 0 : Math.max(...arr.map((x) => x.orden)) + 1;
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "SET_ESPECIALIDAD":
      return { ...state, especialidad: action.especialidad };
    case "SET_SUBJETIVO":
      return { ...state, subjetivo: action.texto };
    case "SET_OBJETIVO":
      return { ...state, objetivo: action.texto };
    case "SET_ANALISIS":
      return { ...state, analisis: action.texto };
    case "SET_SIGNOS":
      return { ...state, signos: action.signos };

    case "ADD_PROBLEMA": {
      const nuevo: EvolucionProblema = {
        id: crypto.randomUUID(),
        texto: action.texto,
        parentId: null,
        orden: nextOrden(state.problemas),
      };
      return { ...state, problemas: [...state.problemas, nuevo] };
    }

    case "EDIT_PROBLEMA": {
      return {
        ...state,
        problemas: state.problemas.map((p) =>
          p.id === action.id ? { ...p, texto: action.texto } : p,
        ),
      };
    }

    case "DELETE_PROBLEMA": {
      const esRaiz = state.problemas.find((p) => p.id === action.id)?.parentId === null;
      const sinPadre = state.problemas.filter((p) => p.id !== action.id).map((p) =>
        // si borramos un padre, sus hijos vuelven a raíz
        esRaiz && p.parentId === action.id ? { ...p, parentId: null } : p,
      );
      return { ...state, problemas: sinPadre };
    }

    case "GROUP_PROBLEMAS": {
      if (action.ids.length < 2) return state;
      const idxs = state.problemas
        .map((p, i) => (action.ids.includes(p.id) ? i : Infinity))
        .filter((i) => i !== Infinity) as number[];
      const minIdx = Math.min(...idxs);
      const padre: EvolucionProblema = {
        id: crypto.randomUUID(),
        texto: action.nombrePadre,
        parentId: null,
        orden: state.problemas[minIdx]?.orden ?? nextOrden(state.problemas),
      };
      // insertar padre en la posición del primer seleccionado; asignar hijos
      const nuevos = [...state.problemas];
      nuevos.splice(minIdx, 0, padre);
      const conHijos = nuevos.map((p) =>
        action.ids.includes(p.id) ? { ...p, parentId: padre.id } : p,
      );
      return { ...state, problemas: conHijos };
    }

    case "UNGROUP_PROBLEMA": {
      return {
        ...state,
        problemas: state.problemas.map((p) =>
          p.parentId === action.parentId ? { ...p, parentId: null } : p,
        ),
      };
    }

    case "ADD_PLAN": {
      const item: IndicacionPlan = {
        id: crypto.randomUUID(),
        texto: action.texto,
        orden: nextOrden(state.plan),
      };
      return { ...state, plan: [...state.plan, item] };
    }

    case "EDIT_PLAN": {
      return {
        ...state,
        plan: state.plan.map((it) =>
          it.id === action.id ? { ...it, texto: action.texto } : it,
        ),
      };
    }

    case "DELETE_PLAN": {
      return { ...state, plan: state.plan.filter((it) => it.id !== action.id) };
    }

    default:
      return state;
  }
}
