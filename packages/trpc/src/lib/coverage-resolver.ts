/**
 * CC-0028 — Motor de cobertura de seguros, espejo del "Patient Share Rules"
 * de Odoo 18 (módulo ACS HMS, verificado read-only por @Orq). Resuelve, para
 * cada línea de cargo de una liquidación, cuánto cubre la aseguradora y
 * cuánto queda a cargo del paciente.
 *
 * Precedencia (de más a menos específico):
 *   1. CoverageRule ruleOn=CODIGO   ligada a la póliza  (coverageId)
 *   2. CoverageRule ruleOn=CODIGO   ligada al plan       (planId)
 *   3. CoverageRule ruleOn=CATEGORIA ligada a la póliza  (coverageId)
 *   4. CoverageRule ruleOn=CATEGORIA ligada al plan       (planId)
 *   5. PatientCoverageOverride del ámbito de la línea
 *   6. PatientCoverageOverride del ámbito GENERAL
 *   7. InsurancePlanCoverage del ámbito de la línea
 *   8. InsurancePlanCoverage del ámbito GENERAL
 *   9. sin configuración -> cubierto = 0, paciente = total
 * El brief de Odoo solo especifica "regla por CODE > regla por CATEGORIA >
 * config de la póliza > config del plan > GENERAL" sin desambiguar
 * plan-vs-póliza DENTRO de cada nivel de regla; esta implementación aplica
 * el mismo criterio de especificidad que el resto del motor de precios del
 * HIS (price-resolver.ts: ítem > categoría > global) — lo específico de la
 * póliza gana sobre lo genérico del plan en cada nivel.
 *
 * Aritmética:
 *   - PORCENTAJE:           cubierto = total * insuredPercentage / 100.
 *   - MONTO_FIJO:            paciente = copayAmount (tope: total);
 *                            cubierto = total - paciente.
 *   - PORCENTAJE_CON_TOPE:   cubierto = min(total * insuredPercentage / 100, límite
 *                            restante) — el "límite restante" es un presupuesto
 *                            que se consume A TRAVÉS de todas las líneas de ESTA
 *                            liquidación (acumulado POR LIQUIDACIÓN, no histórico
 *                            — v1: no persiste entre llamadas ni entre cuentas).
 *   - copayAmount en PORCENTAJE/PORCENTAJE_CON_TOPE es un modificador opcional
 *     que además resta del lado asegurado hacia el paciente (Odoo lo permite
 *     como copago adicional a la cobertura porcentual).
 *   - Una CoverageRule con fullCover=true cubre el 100% sin mirar ruleType.
 *   - CoverageRule ruleType=MONTO: cubierto = min(total, amount).
 *
 * Póliza activa: entre las PatientCoverage del paciente con active=true y
 * `fecha` dentro de [validFrom, validTo], se elige la de validFrom más
 * reciente (la póliza contratada más recientemente gana sobre una anterior
 * que aún no venció); empate -> createdAt más reciente. Documentado aquí
 * porque el TDR no especifica un criterio de multiplicidad de pólizas.
 *
 * Puro/testeable: recibe un `tx` con la forma mínima de Prisma que necesita
 * (mismo estilo que price-resolver.ts). Debe llamarse DENTRO de una
 * transacción con contexto de tenant aplicado (withTenantContext).
 */

export type Ambito = "CONSULTA" | "FARMACIA" | "GENERAL";

export interface LineaEntrada {
  /** Código de tarifario de la línea (LabTest.code / ServicePriceListItem.code). */
  code: string;
  /** id de ServiceCategory del código, si se conoce. */
  categoria?: string | null;
  ambito: Ambito;
  total: number;
}

/** Origen de la config/regla que decidió el reparto de una línea. */
export type OrigenCobertura =
  | { tipo: "regla_codigo"; nivel: "poliza" | "plan"; reglaId: string }
  | { tipo: "regla_categoria"; nivel: "poliza" | "plan"; reglaId: string }
  | { tipo: "ambito_poliza"; ambito: Ambito }
  | { tipo: "ambito_plan"; ambito: Ambito }
  | { tipo: "sin_cobertura" };

export interface LineaResultado {
  cubierto: number;
  paciente: number;
  reglaAplicada: OrigenCobertura;
}

export interface ResultadoCobertura {
  porLinea: LineaResultado[];
  totalAsegurado: number;
  totalPaciente: number;
  polizaId: string | null;
}

interface PolizaRow {
  id: string;
  planId: string;
  organizationId: string;
  validFrom: Date;
  createdAt: Date;
}

/**
 * Los campos `ruleOn`/`ruleType`/`ambito`/`coverageType` se tipan `string`
 * (no como las uniones literales `RuleOn`/`RuleType`/`Ambito`/`CoverageType`)
 * porque en Prisma son columnas `String @db.VarChar` con el dominio
 * enforced por CHECK en SQL 235, no un enum de Postgres — tipar la interfaz
 * de `tx` con las uniones estrictas rompe la asignabilidad del PrismaClient
 * real. Las comparaciones contra literales siguen siendo seguras en runtime.
 */
interface ReglaRow {
  id: string;
  planId: string | null;
  coverageId: string | null;
  ruleOn: string;
  serviceCategoryId: string | null;
  code: string | null;
  ruleType: string;
  percentage: unknown;
  amount: unknown;
  fullCover: boolean;
}

interface AmbitoConfigRow {
  ambito: string;
  coverageType: string;
  insuredPercentage: unknown;
  copayAmount: unknown;
  coverageLimit: unknown;
}

/** Tipo mínimo del cliente de transacción que necesita este helper. */
export type TxForCoverageResolver = {
  patientCoverage: {
    findMany: (args: {
      where: {
        organizationId: string;
        patientId: string;
        active: boolean;
        validFrom: { lte: Date };
        OR: [{ validTo: null }, { validTo: { gte: Date } }];
      };
      select: { id: true; planId: true; organizationId: true; validFrom: true; createdAt: true };
    }) => Promise<PolizaRow[]>;
  };
  coverageRule: {
    findMany: (args: {
      where: { active: boolean; OR: [{ planId: string }, { coverageId: string }] };
    }) => Promise<ReglaRow[]>;
  };
  insurancePlanCoverage: {
    findMany: (args: {
      where: { planId: string; active: boolean };
    }) => Promise<AmbitoConfigRow[]>;
  };
  patientCoverageOverride: {
    findMany: (args: {
      where: { coverageId: string; active: boolean };
    }) => Promise<AmbitoConfigRow[]>;
  };
};

function numero(valor: unknown): number {
  if (valor === null || valor === undefined) return 0;
  return typeof valor === "number" ? valor : Number(valor);
}

function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

/**
 * Elige la póliza vigente del paciente a `fecha`. Ver criterio de
 * multiplicidad en el docstring del módulo.
 */
async function elegirPoliza(
  tx: TxForCoverageResolver,
  organizationId: string,
  patientId: string,
  fecha: Date,
): Promise<PolizaRow | null> {
  const candidatas = await tx.patientCoverage.findMany({
    where: {
      organizationId,
      patientId,
      active: true,
      validFrom: { lte: fecha },
      OR: [{ validTo: null }, { validTo: { gte: fecha } }],
    },
    select: { id: true, planId: true, organizationId: true, validFrom: true, createdAt: true },
  });

  if (candidatas.length === 0) return null;

  const ordenadas = [...candidatas].sort((a, b) => {
    const porFecha = b.validFrom.getTime() - a.validFrom.getTime();
    if (porFecha !== 0) return porFecha;
    return b.createdAt.getTime() - a.createdAt.getTime();
  });
  return ordenadas[0] ?? null;
}

/** Busca, entre las reglas ya cargadas, la mejor candidata para una línea. */
function elegirRegla(
  reglas: ReglaRow[],
  poliza: PolizaRow,
  linea: LineaEntrada,
): { regla: ReglaRow; nivel: "poliza" | "plan" } | null {
  const porCodigoPoliza = reglas.find(
    (r) => r.coverageId === poliza.id && r.ruleOn === "CODIGO" && r.code === linea.code,
  );
  if (porCodigoPoliza) return { regla: porCodigoPoliza, nivel: "poliza" };

  const porCodigoPlan = reglas.find(
    (r) => r.planId === poliza.planId && r.ruleOn === "CODIGO" && r.code === linea.code,
  );
  if (porCodigoPlan) return { regla: porCodigoPlan, nivel: "plan" };

  if (linea.categoria) {
    const porCategoriaPoliza = reglas.find(
      (r) => r.coverageId === poliza.id && r.ruleOn === "CATEGORIA" && r.serviceCategoryId === linea.categoria,
    );
    if (porCategoriaPoliza) return { regla: porCategoriaPoliza, nivel: "poliza" };

    const porCategoriaPlan = reglas.find(
      (r) => r.planId === poliza.planId && r.ruleOn === "CATEGORIA" && r.serviceCategoryId === linea.categoria,
    );
    if (porCategoriaPlan) return { regla: porCategoriaPlan, nivel: "plan" };
  }

  return null;
}

/** Busca la config de ámbito aplicable (override de póliza > override GENERAL > plan > plan GENERAL). */
function elegirConfigAmbito(
  overrides: AmbitoConfigRow[],
  planConfigs: AmbitoConfigRow[],
  ambito: Ambito,
): { config: AmbitoConfigRow; tipo: "ambito_poliza" | "ambito_plan" } | null {
  const overridePropio = overrides.find((c) => c.ambito === ambito);
  if (overridePropio) return { config: overridePropio, tipo: "ambito_poliza" };

  const overrideGeneral = overrides.find((c) => c.ambito === "GENERAL");
  if (overrideGeneral) return { config: overrideGeneral, tipo: "ambito_poliza" };

  const planPropio = planConfigs.find((c) => c.ambito === ambito);
  if (planPropio) return { config: planPropio, tipo: "ambito_plan" };

  const planGeneral = planConfigs.find((c) => c.ambito === "GENERAL");
  if (planGeneral) return { config: planGeneral, tipo: "ambito_plan" };

  return null;
}

/** Reparto de una CoverageRule (niveles 1-4 de la precedencia). */
function repartirPorRegla(regla: ReglaRow, total: number): { cubierto: number; paciente: number } {
  if (regla.fullCover) return { cubierto: aCentavos(total), paciente: 0 };

  if (regla.ruleType === "PORCENTAJE") {
    const cubierto = aCentavos((total * numero(regla.percentage)) / 100);
    return { cubierto, paciente: aCentavos(total - cubierto) };
  }

  // MONTO: el monto cubierto no puede exceder el total de la línea.
  const cubierto = aCentavos(Math.min(total, numero(regla.amount)));
  return { cubierto, paciente: aCentavos(total - cubierto) };
}

/**
 * Reparto de una config de ámbito (niveles 5-8), con presupuesto acumulado
 * por liquidación para PORCENTAJE_CON_TOPE (`presupuestos`, mutado in-place,
 * llave = id lógico de la config).
 */
function repartirPorAmbito(
  config: AmbitoConfigRow,
  total: number,
  llavePresupuesto: string,
  presupuestos: Map<string, number>,
): { cubierto: number; paciente: number } {
  let cubierto: number;

  if (config.coverageType === "MONTO_FIJO") {
    const paciente = aCentavos(Math.min(total, numero(config.copayAmount)));
    cubierto = aCentavos(total - paciente);
    return { cubierto, paciente };
  }

  if (config.coverageType === "PORCENTAJE_CON_TOPE") {
    if (!presupuestos.has(llavePresupuesto)) {
      presupuestos.set(llavePresupuesto, numero(config.coverageLimit));
    }
    const restante = presupuestos.get(llavePresupuesto)!;
    const porPorcentaje = (total * numero(config.insuredPercentage)) / 100;
    cubierto = aCentavos(Math.min(porPorcentaje, restante));
    presupuestos.set(llavePresupuesto, aCentavos(restante - cubierto));
  } else {
    // PORCENTAJE
    cubierto = aCentavos((total * numero(config.insuredPercentage)) / 100);
  }

  // copayAmount es un modificador adicional (además del % ya aplicado):
  // resta del lado asegurado hacia el paciente.
  const copay = numero(config.copayAmount);
  if (copay > 0) cubierto = aCentavos(Math.max(0, cubierto - copay));

  return { cubierto, paciente: aCentavos(total - cubierto) };
}

export async function resolverCobertura(
  tx: TxForCoverageResolver,
  params: {
    organizationId: string;
    patientId: string;
    fecha: Date;
    lineas: LineaEntrada[];
  },
): Promise<ResultadoCobertura> {
  const { organizationId, patientId, fecha, lineas } = params;

  const poliza = await elegirPoliza(tx, organizationId, patientId, fecha);

  if (!poliza) {
    const porLinea = lineas.map((l) => ({
      cubierto: 0,
      paciente: aCentavos(l.total),
      reglaAplicada: { tipo: "sin_cobertura" as const },
    }));
    return {
      porLinea,
      totalAsegurado: 0,
      totalPaciente: aCentavos(lineas.reduce((acc, l) => acc + l.total, 0)),
      polizaId: null,
    };
  }

  const [reglas, planConfigs, overrides] = await Promise.all([
    tx.coverageRule.findMany({
      where: { active: true, OR: [{ planId: poliza.planId }, { coverageId: poliza.id }] },
    }),
    tx.insurancePlanCoverage.findMany({ where: { planId: poliza.planId, active: true } }),
    tx.patientCoverageOverride.findMany({ where: { coverageId: poliza.id, active: true } }),
  ]);

  const presupuestos = new Map<string, number>();
  const porLinea: LineaResultado[] = [];

  for (const linea of lineas) {
    const porRegla = elegirRegla(reglas, poliza, linea);
    if (porRegla) {
      const { regla, nivel } = porRegla;
      const { cubierto, paciente } = repartirPorRegla(regla, linea.total);
      porLinea.push({
        cubierto,
        paciente,
        reglaAplicada: {
          tipo: regla.ruleOn === "CODIGO" ? "regla_codigo" : "regla_categoria",
          nivel,
          reglaId: regla.id,
        },
      });
      continue;
    }

    const porAmbito = elegirConfigAmbito(overrides, planConfigs, linea.ambito);
    if (porAmbito) {
      const { config, tipo } = porAmbito;
      const llavePresupuesto = `${tipo}:${config.ambito}`;
      const { cubierto, paciente } = repartirPorAmbito(config, linea.total, llavePresupuesto, presupuestos);
      // config.ambito viene de la BD como `string` (CHECK, no enum — ver
      // comentario de ReglaRow/AmbitoConfigRow); el dominio real es Ambito.
      porLinea.push({ cubierto, paciente, reglaAplicada: { tipo, ambito: config.ambito as Ambito } });
      continue;
    }

    porLinea.push({ cubierto: 0, paciente: aCentavos(linea.total), reglaAplicada: { tipo: "sin_cobertura" } });
  }

  const totalAsegurado = aCentavos(porLinea.reduce((acc, l) => acc + l.cubierto, 0));
  const totalPaciente = aCentavos(porLinea.reduce((acc, l) => acc + l.paciente, 0));

  return { porLinea, totalAsegurado, totalPaciente, polizaId: poliza.id };
}
