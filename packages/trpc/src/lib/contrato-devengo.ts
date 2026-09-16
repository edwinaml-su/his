/**
 * CC-0036 Ola 2 (REQ-HIS-AFIL-001 US.AFIL.1.3.4 / US.AFIL.1.3.7) — prorrateo
 * de devengo de `ContratoArrendamiento` cuando la fecha efectiva (activación
 * a mitad de mes, o término anticipado) no coincide con el primer/último día
 * del mes calendario.
 *
 * Decisión de diseño: `ContratoCargo.periodo` es SIEMPRE el primer día del
 * mes calendario que contiene la fecha efectiva — `diaCorte` solo determina
 * QUÉ DÍA del mes corre el cron mensual (sql/245, `contrato_devengo_mensual`),
 * NO los límites de un ciclo de facturación "de corte a corte". Por eso el
 * prorrateo compara contra los días del MES calendario, no contra un ciclo
 * de `diaCorte` días. Esto evita mantener dos nociones distintas de
 * "período" entre el cron (mensual calendario) y este helper.
 *
 * Función pura — sin acceso a BD ni a `Date.now()` — para poder testear los
 * casos dorados del REQ §12 ("Prorrateo de devengo cuando el contrato inicia
 * a mitad de período") sin fixtures de Prisma.
 */

export type DevengoLado = "INICIO" | "FIN";

export interface DevengoProrrateadoInput {
  /** `ContratoArrendamiento.rentaMensual`. */
  rentaMensual: number;
  /** `ContratoArrendamiento.cuotaServicios` — 0 o `undefined` = sin cargo de servicios. */
  cuotaServicios?: number;
  /** Fecha efectiva: `fechaInicio` del contrato (lado INICIO) o fecha de término (lado FIN). */
  fecha: Date;
  /**
   * INICIO: se devenga desde `fecha` hasta el fin del mes calendario.
   * FIN: se devenga desde el inicio del mes calendario hasta `fecha`.
   */
  lado: DevengoLado;
}

export interface DevengoProrrateadoResultado {
  /** Primer día del mes calendario que contiene `fecha` — valor a persistir en `ContratoCargo.periodo`. */
  periodo: Date;
  diasEnMes: number;
  diasCubiertos: number;
  /** `diasCubiertos / diasEnMes`, en [0, 1]. */
  factor: number;
  /** `false` cuando `fecha` cae exactamente en el borde del mes (factor = 1) — no hace falta prorratear. */
  esProrrateo: boolean;
  montoRenta: number;
  /** `null` si no aplica cuota de servicios (evita generar un `ContratoCargo` concepto SERVICIOS en $0). */
  montoServicios: number | null;
}

/** Redondeo a 2 decimales (numeric(14,2), NFR-9 del REQ — nada de flotantes sin redondear). */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Calcula el devengo prorrateado de un período parcial. `fecha` se interpreta
 * en UTC (mismo criterio que las columnas `date` de Prisma, que llegan como
 * medianoche UTC sin componente de hora — ver `fechaIngreso` en
 * medico-afiliado.router.ts).
 */
export function calcularDevengoProrrateado(
  input: DevengoProrrateadoInput,
): DevengoProrrateadoResultado {
  const { fecha, lado } = input;
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();

  const diasEnMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const diasCubiertos = lado === "INICIO" ? diasEnMes - dia + 1 : dia;
  const factor = diasCubiertos / diasEnMes;
  const periodo = new Date(Date.UTC(anio, mes, 1));

  const montoRenta = round2(input.rentaMensual * factor);
  const montoServicios =
    input.cuotaServicios !== undefined && input.cuotaServicios > 0
      ? round2(input.cuotaServicios * factor)
      : null;

  return {
    periodo,
    diasEnMes,
    diasCubiertos,
    factor,
    esProrrateo: factor < 1,
    montoRenta,
    montoServicios,
  };
}
