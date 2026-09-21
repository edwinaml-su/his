/**
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 US.AFIL.1.6) — atribución de producción
 * médica y el cargo de honorario que dispara (Decisión Edwin Martinez
 * 2026-09-16 #2a: "el honorario calculado es TAMBIÉN un cargo en la cuenta
 * del paciente").
 *
 * `atribuirProduccionMedica` es una función de LIBRERÍA (no un procedure
 * tRPC) — se llama DENTRO de la transacción del acto clínico/cargo que la
 * origina, mismo `tx`, igual patrón que `capturarCargo`/
 * `capturarCargoReservaQuirofano`. v1 (Ola 5) la cablean:
 *   - `surgery.router.ts` case.create — CIRUJANO desde `primarySurgeonId`
 *     (User) mapeado a MedicoAfiliado por `userId`, sobre el cargo
 *     USO_INSTALACIONES de la reserva de quirófano (C3-2). AYUDANTE/
 *     ANESTESISTA quedan DIFERIDOS: `SurgeryCase` (schema.prisma) solo tiene
 *     `primarySurgeonId` — no modela ayudante/anestesista como filas propias
 *     todavía (gap fuera de alcance de esta ola, documentado también en el
 *     reporte de entrega).
 *   - `outpatient.router.ts` realizarCheckIn — TRATANTE desde
 *     `cita.medicoAfiliadoId` (Ola 4), sobre un cargo `CONSULTA` nuevo
 *     capturado en el check-in.
 *   - `ece/bridge-cirugia.router.ts` (vía NTEC) queda DIFERIDO — mismo gap
 *     de ayudante/anestesista, más el hecho de que esa vía no trae
 *     `primarySurgeonId` de un `User` HIS mapeable a `MedicoAfiliado` en su
 *     forma actual.
 *
 * Contrato (AC1-AC6 de US.AFIL.1.6):
 *   1. Idempotente por UNIQUE (patientAccountServiceId, medicoAfiliadoId,
 *      rolMedico) — un intento repetido es un no-op (`null`), sin error.
 *   2. Sin monto facturado resuelto (cargo PENDIENTE_TARIFA) -> no atribuye
 *      todavía (`null`) — reprocesar cuando el cargo se resuelva es TODO de
 *      una ola posterior (gap documentado, mismo criterio que R3 "nunca a 0").
 *   3. `MedicoAfiliado.tipoRelacion = STAFF_INTERNO` -> EXCLUIDO
 *      `PERSONAL_DE_PLANTA`, honorario 0, SIN cargo nuevo (AC6).
 *   4. Sin convenio VIGENTE en `fecha` o sin regla que haga match -> EXCLUIDO
 *      `SIN_REGLA` (AC5), honorario 0, SIN cargo nuevo.
 *   5. Con regla: crea `ProduccionMedica` PENDIENTE y, si el honorario
 *      calculado > 0, el cargo `HONORARIO_MEDICO` (Decisión #2a) con
 *      `costCenterId`/`cuentaContableCodigo` de la regla (Decisión #2b) y lo
 *      enlaza en `cargoHonorarioId`.
 *
 * NO usa `capturarCargo`/`resolverPrecio` para el cargo HONORARIO_MEDICO: el
 * monto NO viene de un tarifario (`ServicePriceList`), es el resultado del
 * motor de reglas de honorarios — un INSERT directo consistente con el
 * contrato de `PatientAccountService` (mismo criterio que documenta la
 * consigna de la ola: "capturarCargo... o INSERT consistente con su
 * contrato").
 *
 * El caller es responsable de envolver la llamada en try/catch no-fatal
 * (mismo patrón que los emisores de `emitDomainEvent` en break-glass.router.ts/
 * turno.router.ts) — la atribución de honorarios NUNCA debe bloquear el acto
 * clínico ni la captura del cargo origen que la dispara.
 */
import type { PrismaClient, TipoServicio } from "@prisma/client";
import { emitDomainEvent, type EmitDomainEventTx } from "@his/database";
import { resolverReglaHonorario, calcularHonorario, type ReglaCandidata } from "./honorario-resolver";

const ROLES_ATRIBUCION = [
  "TRATANTE",
  "CIRUJANO",
  "AYUDANTE",
  "ANESTESISTA",
  "INTERPRETE",
  "REFERENTE",
] as const;
export type RolMedicoAtribucion = (typeof ROLES_ATRIBUCION)[number];

export interface AtribuirProduccionParams {
  organizationId: string;
  establishmentId: string;
  medicoAfiliadoId: string;
  rolMedico: RolMedicoAtribucion;
  /** Cargo ORIGEN (definición REQ) — el que disparó la atribución. */
  patientAccountServiceId: string;
  /** CIRUGIA | CONSULTA | PROCEDIMIENTO | INTERPRETACION | VISITA_HOSPITALARIA | INSUMO. */
  ambito: string;
  serviceCategoryId?: string | null;
  codigoServicio?: string | null;
  fecha: Date;
  actorId: string;
}

export interface AtribuirProduccionResult {
  produccionId: string;
  estado: "PENDIENTE" | "EXCLUIDO";
  honorarioCalculado: number;
  motivoExclusion: "SIN_REGLA" | "PERSONAL_DE_PLANTA" | null;
  cargoHonorarioId: string | null;
}

/** Prisma serializa Decimal como `{toNumber()}`; los mocks de test a veces pasan el number crudo (patrón charge-capture.ts). */
function decimalToNumber(v: { toNumber: () => number } | number | null | undefined): number | null {
  if (v == null) return null;
  return typeof v === "number" ? v : v.toNumber();
}

/**
 * R2.3 (SQL 262) — fallback de `crearCargoHonorarioYEnlazar` cuando el cargo
 * origen no trae `currencyId`: la funcional de la organización dueña de la
 * cuenta (mismo criterio de fallback que `resolverCurrencyIdDelCargo` en
 * charge-capture.ts).
 */
async function resolverCurrencyIdFuncionalDeCuenta(tx: PrismaClient, accountId: string): Promise<string> {
  const cuenta = await tx.patientAccount.findUnique({
    where: { id: accountId },
    select: { organization: { select: { functionalCurrency: true } } },
  });
  if (!cuenta) {
    throw new Error(`resolverCurrencyIdFuncionalDeCuenta: cuenta ${accountId} no encontrada.`);
  }
  return cuenta.organization.functionalCurrency;
}

export interface ResolverHonorarioParaMedicoParams {
  organizationId: string;
  medicoAfiliadoId: string;
  ambito: string;
  rolMedico: string;
  serviceCategoryId?: string | null;
  codigoServicio?: string | null;
  fecha: Date;
  montoFacturado: number;
}

/**
 * Resuelve la regla ganadora (convenio VIGENTE del médico en `fecha` + ámbito)
 * y el honorario calculado. `null` cuando no hay convenio VIGENTE o ninguna
 * regla hace match (SIN_REGLA) — compartido por `atribuirProduccionMedica` y
 * por `produccion.reprocesar` del router (misma resolución, sin duplicar la
 * consulta a convenios/reglas).
 */
export async function resolverHonorarioParaMedico(
  tx: PrismaClient,
  params: ResolverHonorarioParaMedicoParams,
): Promise<{ reglaId: string; honorarioCalculado: number } | null> {
  const convenio = await tx.convenioHonorario.findFirst({
    where: {
      medicoAfiliadoId: params.medicoAfiliadoId,
      organizationId: params.organizationId,
      estado: "VIGENTE",
      vigenciaDesde: { lte: params.fecha },
      OR: [{ vigenciaHasta: null }, { vigenciaHasta: { gte: params.fecha } }],
    },
    select: { id: true },
  });
  if (!convenio) return null;

  const reglas = await tx.reglaHonorario.findMany({
    where: { convenioId: convenio.id, active: true, ambito: params.ambito },
  });

  const reglaGanadora = resolverReglaHonorario(
    reglas.map(
      (r): ReglaCandidata => ({
        id: r.id,
        ambito: r.ambito,
        rolMedico: r.rolMedico,
        serviceCategoryId: r.serviceCategoryId,
        codigoServicio: r.codigoServicio,
        tipoCalculo: r.tipoCalculo as "PORCENTAJE" | "MONTO_FIJO",
        porcentaje: decimalToNumber(r.porcentaje),
        montoFijo: decimalToNumber(r.montoFijo),
        montoMinimo: decimalToNumber(r.montoMinimo),
        montoMaximo: decimalToNumber(r.montoMaximo),
        prioridad: r.prioridad,
        createdAt: r.createdAt,
      }),
    ),
    {
      ambito: params.ambito,
      rolMedico: params.rolMedico,
      serviceCategoryId: params.serviceCategoryId ?? null,
      codigoServicio: params.codigoServicio ?? null,
    },
  );
  if (!reglaGanadora) return null;

  return { reglaId: reglaGanadora.id, honorarioCalculado: calcularHonorario(reglaGanadora, params.montoFacturado) };
}

export interface CrearCargoHonorarioParams {
  produccionId: string;
  accountId: string;
  tipo: TipoServicio;
  encounterId: string | null;
  rolMedico: string;
  honorarioCalculado: number;
  /**
   * R2.3 (SQL 262) — moneda del cargo ORIGEN que disparó la atribución (el
   * honorario es un derivado de su `montoFacturado`, en la misma moneda). Si
   * viene `null` (cargo origen pre-backfill sin migrar aún), se resuelve la
   * funcional de la organización de la cuenta como fallback.
   */
  currencyId: string | null;
  actorId: string;
}

/**
 * Crea el cargo `HONORARIO_MEDICO` (Decisión Edwin #2a) y lo enlaza en
 * `ProduccionMedica.cargoHonorarioId`. Compartido por `atribuirProduccionMedica`
 * (alta) y `produccion.reprocesar` del router (cuando una producción
 * `EXCLUIDO SIN_REGLA` se resuelve tras corregir/activar una regla) — mismo
 * camino, para que el cargo se genere SIEMPRE que hay honorario > 0, sin
 * importar si vino de la atribución inicial o de un reproceso posterior
 * (hallazgo #2 de la revisión pre-PR).
 *
 * NO usa `capturarCargo`/`resolverPrecio`: el monto viene del motor de reglas
 * de honorarios, no de un tarifario (ver docstring del módulo).
 */
export async function crearCargoHonorarioYEnlazar(
  tx: PrismaClient,
  params: CrearCargoHonorarioParams,
): Promise<string> {
  const currencyId = params.currencyId ?? (await resolverCurrencyIdFuncionalDeCuenta(tx, params.accountId));

  const cargoHonorario = await tx.patientAccountService.create({
    data: {
      accountId: params.accountId,
      tipo: params.tipo,
      descripcion: `Honorario médico — ${params.rolMedico}`,
      encounterId: params.encounterId,
      code: `HON-${params.rolMedico}`,
      quantity: 1,
      unitPrice: params.honorarioCalculado,
      totalPrice: params.honorarioCalculado,
      status: "VIGENTE",
      origen: "HONORARIO_MEDICO",
      priceSource: "manual_override",
      referenciaId: params.produccionId,
      currencyId,
      createdBy: params.actorId,
    },
  });

  // costCenterId/cuentaContableCodigo (el "rubro") viven en la regla —
  // resumenPorRubro los resuelve con un JOIN, no se duplican en el cargo.
  await tx.produccionMedica.update({
    where: { id: params.produccionId },
    data: { cargoHonorarioId: cargoHonorario.id },
  });

  return cargoHonorario.id;
}

/**
 * Atribuye producción médica sobre un cargo ya capturado. Debe llamarse
 * DENTRO de la transacción que capturó (o confirmó) ese cargo.
 *
 * Devuelve `null` cuando no hay nada que hacer todavía (idempotencia AC3,
 * cargo sin monto resuelto) — no es un error.
 */
export async function atribuirProduccionMedica(
  tx: PrismaClient,
  params: AtribuirProduccionParams,
): Promise<AtribuirProduccionResult | null> {
  const existente = await tx.produccionMedica.findFirst({
    where: {
      patientAccountServiceId: params.patientAccountServiceId,
      medicoAfiliadoId: params.medicoAfiliadoId,
      rolMedico: params.rolMedico,
    },
    select: { id: true },
  });
  if (existente) return null; // AC3 — idempotente, sin efecto.

  const cargo = await tx.patientAccountService.findUnique({
    where: { id: params.patientAccountServiceId },
    select: { accountId: true, totalPrice: true, encounterId: true, tipo: true, currencyId: true },
  });
  const montoFacturado = cargo ? decimalToNumber(cargo.totalPrice) : null;
  if (!cargo || montoFacturado == null) return null; // sin monto resuelto todavía (PENDIENTE_TARIFA).

  const medico = await tx.medicoAfiliado.findFirst({
    where: { id: params.medicoAfiliadoId, organizationId: params.organizationId },
    select: { tipoRelacion: true },
  });
  if (!medico) return null;

  const base = {
    organizationId: params.organizationId,
    establishmentId: params.establishmentId,
    medicoAfiliadoId: params.medicoAfiliadoId,
    rolMedico: params.rolMedico,
    patientAccountServiceId: params.patientAccountServiceId,
    encounterId: cargo.encounterId,
    fecha: params.fecha,
    montoFacturado,
    createdBy: params.actorId,
  };

  if (medico.tipoRelacion === "STAFF_INTERNO") {
    const produccion = await tx.produccionMedica.create({
      data: { ...base, honorarioCalculado: 0, estado: "EXCLUIDO", motivoExclusion: "PERSONAL_DE_PLANTA" },
    });
    return {
      produccionId: produccion.id,
      estado: "EXCLUIDO",
      honorarioCalculado: 0,
      motivoExclusion: "PERSONAL_DE_PLANTA",
      cargoHonorarioId: null,
    };
  }

  const resuelto = await resolverHonorarioParaMedico(tx, {
    organizationId: params.organizationId,
    medicoAfiliadoId: params.medicoAfiliadoId,
    ambito: params.ambito,
    rolMedico: params.rolMedico,
    serviceCategoryId: params.serviceCategoryId,
    codigoServicio: params.codigoServicio,
    fecha: params.fecha,
    montoFacturado,
  });

  if (!resuelto) {
    const produccion = await tx.produccionMedica.create({
      data: { ...base, honorarioCalculado: 0, estado: "EXCLUIDO", motivoExclusion: "SIN_REGLA" },
    });
    return {
      produccionId: produccion.id,
      estado: "EXCLUIDO",
      honorarioCalculado: 0,
      motivoExclusion: "SIN_REGLA",
      cargoHonorarioId: null,
    };
  }

  const { reglaId, honorarioCalculado } = resuelto;

  const produccion = await tx.produccionMedica.create({
    data: {
      ...base,
      honorarioCalculado,
      estado: "PENDIENTE",
      reglaHonorarioId: reglaId,
    },
  });

  const cargoHonorarioId =
    honorarioCalculado > 0
      ? await crearCargoHonorarioYEnlazar(tx, {
          produccionId: produccion.id,
          accountId: cargo.accountId,
          tipo: cargo.tipo,
          encounterId: cargo.encounterId,
          rolMedico: params.rolMedico,
          honorarioCalculado,
          currencyId: cargo.currencyId,
          actorId: params.actorId,
        })
      : null;

  await emitDomainEvent(tx as unknown as EmitDomainEventTx, {
    eventType: "produccion.registrada",
    aggregateType: "ProduccionMedica",
    aggregateId: produccion.id,
    emittedById: params.actorId,
    organizationId: params.organizationId,
    payload: {
      produccionId: produccion.id,
      medicoAfiliadoId: params.medicoAfiliadoId,
      rolMedico: params.rolMedico,
      patientAccountServiceId: params.patientAccountServiceId,
      estado: "PENDIENTE",
      honorarioCalculado,
      motivoExclusion: null,
    },
  });

  return {
    produccionId: produccion.id,
    estado: "PENDIENTE",
    honorarioCalculado,
    motivoExclusion: null,
    cargoHonorarioId,
  };
}

/**
 * Reversión simétrica a `revertirCargo` (AC4) — se invoca con el id de la
 * línea REVERSION (no el cargo original): `revertirCargo` crea esa fila con
 * `reversalOfId` apuntando al cargo original, y ESE es el vínculo que esta
 * función sigue para encontrar la producción a revertir.
 *
 * PENDIENTE -> REVERSADO sin más. LIQUIDADO -> REVERSADO + una fila NUEVA de
 * producción NEGATIVA anclada al cargo REVERSION (no al original: la UNIQUE
 * (patientAccountServiceId, medicoAfiliadoId, rolMedico) ya está ocupada por
 * la fila original) — esa fila negativa se arrastra PENDIENTE a la siguiente
 * liquidación (AC4).
 */
export async function revertirProduccionMedica(
  tx: PrismaClient,
  params: { reversionCargoId: string; actorId: string },
): Promise<void> {
  const reversion = await tx.patientAccountService.findUnique({
    where: { id: params.reversionCargoId },
    select: { reversalOfId: true },
  });
  if (!reversion?.reversalOfId) return;

  const originales = await tx.produccionMedica.findMany({
    where: { patientAccountServiceId: reversion.reversalOfId },
  });

  for (const original of originales) {
    if (original.estado === "EXCLUIDO" || original.estado === "REVERSADO") continue;

    await tx.produccionMedica.update({
      where: { id: original.id },
      data: { estado: "REVERSADO" },
    });

    if (original.estado === "LIQUIDADO") {
      await tx.produccionMedica.create({
        data: {
          organizationId: original.organizationId,
          establishmentId: original.establishmentId,
          medicoAfiliadoId: original.medicoAfiliadoId,
          rolMedico: original.rolMedico,
          patientAccountServiceId: params.reversionCargoId,
          encounterId: original.encounterId,
          fecha: new Date(),
          montoFacturado: -(decimalToNumber(original.montoFacturado) ?? 0),
          honorarioCalculado: -(decimalToNumber(original.honorarioCalculado) ?? 0),
          reglaHonorarioId: original.reglaHonorarioId,
          estado: "PENDIENTE",
          createdBy: params.actorId,
        },
      });
    }
  }
}
