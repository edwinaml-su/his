/**
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 US.AFIL.1.5 AC3/AC4) — resolución de la
 * regla de honorario aplicable a un cargo, patrón `ServicePriceRule`
 * (CC-0021, ver `price-resolver.ts`).
 *
 * Especificidad (de más a menos específica):
 *   1. `codigoServicio` coincide exactamente con el código del cargo.
 *   2. `serviceCategoryId` coincide con la categoría del cargo.
 *   3. Solo `ambito` (regla "genérica" del ámbito).
 * Dentro del mismo nivel de especificidad: `prioridad` desc -> `createdAt` desc.
 *
 * Una regla con `rolMedico` fijo SOLO aplica a ese rol; una regla con
 * `rolMedico=null` aplica a cualquier rol dentro de su ámbito (AC1: el REQ no
 * exige `rolMedico` en toda regla).
 *
 * Puro/testeable — sin acceso a BD. El caller (produccion-atribucion.ts)
 * arma `ReglaCandidata[]` desde `tx.reglaHonorario.findMany(...)` ya
 * filtrado por `convenioId` + `ambito` + `active=true`.
 */

export interface ReglaCandidata {
  id: string;
  ambito: string;
  rolMedico: string | null;
  serviceCategoryId: string | null;
  codigoServicio: string | null;
  tipoCalculo: "PORCENTAJE" | "MONTO_FIJO";
  porcentaje: number | null;
  montoFijo: number | null;
  montoMinimo: number | null;
  montoMaximo: number | null;
  prioridad: number;
  createdAt: Date;
}

export interface ResolverHonorarioInput {
  ambito: string;
  rolMedico: string;
  serviceCategoryId?: string | null;
  codigoServicio?: string | null;
}

function especificidad(regla: ReglaCandidata, input: ResolverHonorarioInput): number | null {
  if (regla.ambito !== input.ambito) return null;
  if (regla.rolMedico !== null && regla.rolMedico !== input.rolMedico) return null;

  if (regla.codigoServicio !== null) {
    return regla.codigoServicio === input.codigoServicio ? 2 : null;
  }
  if (regla.serviceCategoryId !== null) {
    return regla.serviceCategoryId === input.serviceCategoryId ? 1 : null;
  }
  return 0;
}

/** `true` si `a` debe ganarle a `b` (ambos ya con el mismo `score` de especificidad de código/categoría/ámbito). */
function ganaEnEmpate(a: ReglaCandidata, b: ReglaCandidata): boolean {
  // AC3 — un rolMedico ESPECÍFICO es más específico que el comodín (null),
  // dentro del mismo nivel de especificidad de código/categoría/ámbito. Esto
  // va ANTES de prioridad/createdAt: la especificidad siempre gana sobre la
  // configuración manual del creador de la regla.
  const especificoA = a.rolMedico !== null;
  const especificoB = b.rolMedico !== null;
  if (especificoA !== especificoB) return especificoA;

  if (a.prioridad !== b.prioridad) return a.prioridad > b.prioridad;

  return a.createdAt.getTime() > b.createdAt.getTime();
}

/**
 * Elige la regla ganadora entre las candidatas de UN convenio para un cargo
 * dado. `null` si ninguna hace match (AC5 — el caller registra EXCLUIDO
 * `SIN_REGLA`).
 */
export function resolverReglaHonorario(
  reglas: ReglaCandidata[],
  input: ResolverHonorarioInput,
): ReglaCandidata | null {
  let mejor: { regla: ReglaCandidata; score: number } | null = null;

  for (const regla of reglas) {
    const score = especificidad(regla, input);
    if (score === null) continue;

    if (mejor === null || score > mejor.score || (score === mejor.score && ganaEnEmpate(regla, mejor.regla))) {
      mejor = { regla, score };
    }
  }

  return mejor?.regla ?? null;
}

/** Redondea a centavos (moneda de todas las cuentas reales es USD). */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Calcula el honorario de una regla ya resuelta sobre el monto facturado del
 * cargo (AC4 — clamp por montoMinimo/montoMaximo).
 */
export function calcularHonorario(regla: ReglaCandidata, montoFacturado: number): number {
  let honorario =
    regla.tipoCalculo === "PORCENTAJE"
      ? montoFacturado * (regla.porcentaje ?? 0)
      : (regla.montoFijo ?? 0);

  if (regla.montoMinimo !== null) honorario = Math.max(honorario, regla.montoMinimo);
  if (regla.montoMaximo !== null) honorario = Math.min(honorario, regla.montoMaximo);

  return aCentavos(Math.max(honorario, 0));
}
