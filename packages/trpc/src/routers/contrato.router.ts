/**
 * Router tRPC — Contratos de arrendamiento de consultorio (CC-0036 Ola 2,
 * REQ-HIS-AFIL-001 S2, US.AFIL.1.3 / US.AFIL.1.4).
 *
 * ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-15 que SUPERSEDE §9 del REQ y parte
 * de US.AFIL.1.4 (verbatim: "todo el tema de escritura a nivel transaccional
 * se manejará a nivel de interface por hub de eventos; eso se hará en otra
 * fase"): CERO integración Odoo en esta ola. El devengo llega hasta
 * `DEVENGADO` y emite `contrato.cargo.devengado` al outbox `DomainEvent` — ese
 * ES el "hub de eventos". Los estados `ENVIADO_ODOO`/`FACTURADO`/`PAGADO` de
 * `ContratoCargo.estado` y sus columnas `odooInvoiceId`/`odooSyncedAt`
 * (sql/245) quedan RESERVADOS: ningún código de este router los produce ni
 * los consume.
 *
 * US.AFIL.1.4.5/1.4.6 (confirmación de factura Odoo, mora automática por
 * factura vencida) NO se implementan. En su lugar, `marcarMora`/
 * `desmarcarMora` son un TOGGLE MANUAL con motivo, detrás de
 * `contrato_arrendamiento.editar` — TODO Ola de integración: automatizar vía
 * job cuando exista la confirmación de factura desde Odoo. Es necesario
 * ahora porque la agenda (Épica E2, Ola 3) suspende agendas cuando el
 * contrato está EN_MORA.
 *
 * Antitraslape EXCLUSIVO (US.AFIL.1.3 AC2): el `EXCLUDE` de BD
 * (`excl_contrato_arrendamiento_exclusivo`, sql/245) solo evalúa filas cuyo
 * `estado` satisface su predicado parcial (`VIGENTE`/`EN_MORA`) — un
 * `ContratoArrendamiento` recién creado en `BORRADOR` nunca lo dispara. Por
 * eso `create` hace el chequeo de traslape a nivel de APLICACIÓN
 * (`assertSinTraslapeExclusivo`) contra contratos ya `VIGENTE`/`EN_MORA`, con
 * el mensaje es-SV exacto del REQ (AC2). El `EXCLUDE` de BD sigue siendo la
 * red de seguridad real contra condiciones de carrera entre dos
 * ACTIVACIONES concurrentes (`activar`, el punto donde el estado sí pasa a
 * satisfacer el predicado).
 *
 * No-traslape de `ContratoJornada` (US.AFIL.1.3 AC3): cruza filas de
 * contratos DISTINTOS del mismo consultorio — no modelable en un solo
 * `EXCLUDE` de una tabla sin duplicar el join contra `ContratoArrendamiento`
 * en el constraint. Se valida en el router (`assertJornadaSinTraslape`).
 */
import { TRPCError } from "@trpc/server";
import { emitDomainEvent, type PrismaClient } from "@his/database";
import {
  contratoListSchema,
  contratoGetSchema,
  contratoCreateSchema,
  contratoActivarSchema,
  contratoTerminarSchema,
  contratoMoraSchema,
  contratoJornadaListSchema,
  contratoJornadaCreateSchema,
  contratoJornadaDeleteSchema,
  contratoCargoListSchema,
  contratoCargoGenerarSchema,
  contratoCargoAnularSchema,
} from "@his/contracts";
import { router, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";
import { nextContratoFolio } from "../lib/contrato-folio";
import { calcularDevengoProrrateado } from "../lib/contrato-devengo";

const leerProc = requirePermission("contrato_arrendamiento.leer");
const crearProc = requirePermission("contrato_arrendamiento.crear");
const editarProc = requirePermission("contrato_arrendamiento.editar");
const activarProc = requirePermission("contrato_arrendamiento.activar");
const terminarProc = requirePermission("contrato_arrendamiento.terminar");
const cargoLeerProc = requirePermission("contrato_cargo.leer");
const cargoGenerarProc = requirePermission("contrato_cargo.generar");
const cargoAnularProc = requirePermission("contrato_cargo.anular");

const VIGENTES_CONTRATO: readonly string[] = ["VIGENTE", "EN_MORA"];
/** Sentinela para tratar `fechaFin IS NULL` como "sin fin" en el cálculo de traslape en JS. */
const INFINITY_DATE = new Date("9999-12-31T00:00:00.000Z");

// ---------------------------------------------------------------------------
// Helpers de hora — idénticos a turno.router.ts (no se exportan desde ahí).
// ---------------------------------------------------------------------------

function toTimeColumnValue(hhmm: string): Date {
  const conSegundos = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`1970-01-01T${conSegundos}.000Z`);
}

function toMinutes(hora: Date): number {
  return hora.getUTCHours() * 60 + hora.getUTCMinutes();
}

// Inverso de toTimeColumnValue — vuelve una columna `time` (Date UTC 1970) a
// "HH:MM" para re-usar assertJornadaSinTraslape desde `activar`.
function toTimeInputValue(hora: Date): string {
  const hh = String(hora.getUTCHours()).padStart(2, "0");
  const mm = String(hora.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function appendNota(existing: string | null, entry: string): string {
  return existing ? `${existing}\n${entry}` : entry;
}

// ---------------------------------------------------------------------------
// Antitraslape EXCLUSIVO — chequeo de aplicación (create) + red de BD (activar).
// ---------------------------------------------------------------------------

async function assertSinTraslapeExclusivo(
  tx: PrismaClient,
  params: {
    organizationId: string;
    consultorioId: string;
    fechaInicio: Date;
    fechaFin: Date | null;
    modalidad: string;
    excludeContratoId?: string;
  },
): Promise<void> {
  if (params.modalidad !== "EXCLUSIVO") return;

  const conflicto = await tx.contratoArrendamiento.findFirst({
    where: {
      organizationId: params.organizationId,
      consultorioId: params.consultorioId,
      modalidad: "EXCLUSIVO",
      estado: { in: [...VIGENTES_CONTRATO] },
      ...(params.excludeContratoId ? { id: { not: params.excludeContratoId } } : {}),
      fechaInicio: { lte: params.fechaFin ?? INFINITY_DATE },
      OR: [{ fechaFin: null }, { fechaFin: { gte: params.fechaInicio } }],
    },
    select: { folio: true },
  });

  if (conflicto) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `El consultorio ya está arrendado en ese período (folio ${conflicto.folio}).`,
    });
  }
}

/**
 * Red de seguridad de BD: si `assertSinTraslapeExclusivo` no atrapó una
 * condición de carrera (dos activaciones concurrentes), el `EXCLUDE` de BD
 * sí lo hace en el UPDATE de `activar`. Mensaje genérico (sin folio) — el
 * caso con folio ya lo cubrió el pre-check; esto es el remanente de la
 * carrera. Mismo patrón que `rethrowAsignacionConflict` en turno.router.ts.
 */
function rethrowExclusivoConflict(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  if (/exclusion/i.test(message)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "El consultorio ya está arrendado en ese período (conflicto detectado al activar).",
    });
  }
  throw err;
}

// ---------------------------------------------------------------------------
// No-traslape de ContratoJornada entre contratos VIGENTES del mismo consultorio.
// ---------------------------------------------------------------------------

async function assertJornadaSinTraslape(
  tx: PrismaClient,
  params: {
    consultorioId: string;
    contratoId: string;
    diaSemana: number;
    horaInicio: string;
    horaFin: string;
  },
): Promise<void> {
  const nuevoInicio = toMinutes(toTimeColumnValue(params.horaInicio));
  const nuevoFin = toMinutes(toTimeColumnValue(params.horaFin));

  const jornadas = await tx.contratoJornada.findMany({
    where: {
      diaSemana: params.diaSemana,
      contrato: {
        consultorioId: params.consultorioId,
        // EN_MORA sigue ocupando la jornada (el contrato no se libera por
        // mora) — hallazgo del pre-pr-review de la Ola 3.
        estado: { in: [...VIGENTES_CONTRATO] },
        id: { not: params.contratoId },
      },
    },
    select: { horaInicio: true, horaFin: true, contrato: { select: { folio: true } } },
  });

  for (const j of jornadas) {
    const jInicio = toMinutes(j.horaInicio);
    const jFin = toMinutes(j.horaFin);
    if (nuevoInicio < jFin && jInicio < nuevoFin) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `La jornada se traslapa con otro contrato vigente del mismo consultorio (folio ${j.contrato.folio}).`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Devengo — genera ContratoCargo(s) DEVENGADO idempotentes + emite
// contrato.cargo.devengado por cargo. aggregateId = cargoId (NO contratoId):
// RENTA y SERVICIOS son 2 eventos del mismo contrato y comparten eventType —
// uq_domain_event_pending_dedup (sql/97) es único por (organizationId,
// aggregateId, eventType) mientras el evento esté pending, así que
// contratoId como aggregateId chocaría en el segundo INSERT (misma lección
// 241b documentada en sql/243).
// ---------------------------------------------------------------------------

interface GenerarCargosPeriodoParams {
  organizationId: string;
  contratoId: string;
  folio: string;
  currencyId: string;
  periodo: Date;
  montoRenta: number;
  montoServicios: number | null;
  emittedById: string;
}

async function generarCargosPeriodo(
  tx: PrismaClient,
  p: GenerarCargosPeriodoParams,
): Promise<Array<{ id: string; concepto: string }>> {
  const conceptos: Array<{ concepto: "RENTA" | "SERVICIOS"; monto: number }> = [
    { concepto: "RENTA", monto: p.montoRenta },
  ];
  if (p.montoServicios !== null && p.montoServicios > 0) {
    conceptos.push({ concepto: "SERVICIOS", monto: p.montoServicios });
  }

  const creados: Array<{ id: string; concepto: string }> = [];

  for (const c of conceptos) {
    const existente = await tx.contratoCargo.findUnique({
      where: {
        contratoId_periodo_concepto: {
          contratoId: p.contratoId,
          periodo: p.periodo,
          concepto: c.concepto,
        },
      },
      select: { id: true },
    });
    if (existente) continue; // idempotencia (US.AFIL.1.4 AC2).

    const cargo = await tx.contratoCargo.create({
      data: {
        organizationId: p.organizationId,
        contratoId: p.contratoId,
        periodo: p.periodo,
        concepto: c.concepto,
        monto: c.monto,
        currencyId: p.currencyId,
        estado: "DEVENGADO",
      },
    });

    await emitDomainEvent(tx, {
      organizationId: p.organizationId,
      eventType: "contrato.cargo.devengado",
      aggregateType: "ContratoCargo",
      aggregateId: cargo.id,
      emittedById: p.emittedById,
      payload: {
        contratoId: p.contratoId,
        cargoId: cargo.id,
        folio: p.folio,
        concepto: c.concepto,
        monto: c.monto,
        periodo: p.periodo.toISOString().slice(0, 10),
      },
    });

    creados.push({ id: cargo.id, concepto: c.concepto });
  }

  return creados;
}

const contratoInclude = {
  jornadas: { orderBy: [{ diaSemana: "asc" as const }, { horaInicio: "asc" as const }] },
  medicoAfiliado: { select: { id: true, nombreCompleto: true, jvpmNumero: true } },
  consultorio: { select: { id: true, codigo: true, nombre: true } },
};

export const contratoRouter = router({
  list: leerProc.input(contratoListSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, (tx) =>
      tx.contratoArrendamiento.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(input?.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
          ...(input?.consultorioId ? { consultorioId: input.consultorioId } : {}),
          ...(input?.estado ? { estado: input.estado } : {}),
        },
        include: {
          medicoAfiliado: { select: { id: true, nombreCompleto: true } },
          consultorio: { select: { id: true, codigo: true, nombre: true } },
        },
        orderBy: { createdAt: "desc" },
      }),
    );
  }),

  get: leerProc.input(contratoGetSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    const contrato = await withTenantContext(prisma, tenant, (tx) =>
      tx.contratoArrendamiento.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        include: contratoInclude,
      }),
    );
    if (!contrato) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
    }
    return contrato;
  }),

  /** US.AFIL.1.3 AC1/AC2/AC3 — alta en BORRADOR + folio + traslape EXCLUSIVO + jornadas iniciales. */
  create: crearProc.input(contratoCreateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const afiliado = await tx.medicoAfiliado.findFirst({
        where: { id: input.medicoAfiliadoId, organizationId: tenant.organizationId },
        select: { id: true, estado: true },
      });
      if (!afiliado) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });
      }
      if (afiliado.estado !== "ACTIVO") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `El médico afiliado debe estar ACTIVO para arrendar un consultorio (estado actual: ${afiliado.estado}).`,
        });
      }

      const consultorio = await tx.consultorio.findFirst({
        where: { id: input.consultorioId, organizationId: tenant.organizationId },
        select: { id: true, active: true },
      });
      if (!consultorio) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Consultorio no encontrado." });
      }
      if (!consultorio.active) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El consultorio está inactivo." });
      }

      const fechaInicio = new Date(`${input.fechaInicio}T00:00:00.000Z`);
      const fechaFin = input.fechaFin ? new Date(`${input.fechaFin}T00:00:00.000Z`) : null;

      await assertSinTraslapeExclusivo(tx, {
        organizationId: tenant.organizationId,
        consultorioId: input.consultorioId,
        fechaInicio,
        fechaFin,
        modalidad: input.modalidad,
      });

      const folio = await nextContratoFolio(tx, tenant.organizationId);

      const contrato = await tx.contratoArrendamiento.create({
        data: {
          organizationId: tenant.organizationId,
          medicoAfiliadoId: input.medicoAfiliadoId,
          consultorioId: input.consultorioId,
          folio,
          modalidad: input.modalidad,
          fechaInicio,
          fechaFin,
          plazoMeses: input.plazoMeses ?? null,
          rentaMensual: input.rentaMensual,
          cuotaServicios: input.cuotaServicios ?? 0,
          currencyId: input.currencyId,
          diaCorte: input.diaCorte ?? 1,
          plazoPagoDias: input.plazoPagoDias ?? 5,
          ivaAplica: input.ivaAplica ?? true,
          indexacionAnualPct: input.indexacionAnualPct ?? null,
          depositoGarantia: input.depositoGarantia ?? 0,
          renovacionAutomatica: input.renovacionAutomatica ?? false,
          mesesPreavisoTermino: input.mesesPreavisoTermino ?? 2,
          costCenterId: input.costCenterId ?? null,
          notas: input.notas ?? null,
          estado: "BORRADOR",
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      if (input.modalidad === "COMPARTIDO_POR_JORNADA") {
        for (const j of input.jornadas ?? []) {
          await assertJornadaSinTraslape(tx, {
            consultorioId: input.consultorioId,
            contratoId: contrato.id,
            diaSemana: j.diaSemana,
            horaInicio: j.horaInicio,
            horaFin: j.horaFin,
          });
          await tx.contratoJornada.create({
            data: {
              contratoId: contrato.id,
              diaSemana: j.diaSemana,
              horaInicio: toTimeColumnValue(j.horaInicio),
              horaFin: toTimeColumnValue(j.horaFin),
              createdBy: user.id,
            },
          });
        }
      }

      return tx.contratoArrendamiento.findFirst({
        where: { id: contrato.id },
        include: contratoInclude,
      });
    });
  }),

  /**
   * BORRADOR -> VIGENTE (US.AFIL.1.3 AC4). Genera el devengo prorrateado del
   * período en curso, emite `contrato.activado`, y — gate cerrado del TODO de
   * medico-afiliado.router.ts — si el afiliado está PROSPECTO lo pasa a
   * ACTIVO (el contrato VIGENTE es la condición que le faltaba).
   */
  activar: activarProc.input(contratoActivarSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const contrato = await tx.contratoArrendamiento.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        include: { jornadas: true },
      });
      if (!contrato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
      }
      if (contrato.estado !== "BORRADOR") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El contrato está en estado ${contrato.estado}, no se puede activar desde ahí.`,
        });
      }
      if (contrato.modalidad === "COMPARTIDO_POR_JORNADA" && contrato.jornadas.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "El contrato COMPARTIDO_POR_JORNADA requiere al menos una jornada registrada antes de activarse.",
        });
      }

      await assertSinTraslapeExclusivo(tx, {
        organizationId: tenant.organizationId,
        consultorioId: contrato.consultorioId,
        fechaInicio: contrato.fechaInicio,
        fechaFin: contrato.fechaFin,
        modalidad: contrato.modalidad,
        excludeContratoId: contrato.id,
      });

      // Re-validar las jornadas al activar (hallazgo del pre-pr-review de la
      // Ola 3): entre el alta en BORRADOR y la activacion pudo activarse otro
      // contrato del mismo consultorio con jornadas que ahora traslapan; el
      // check del alta ya no cubre esa carrera y no hay EXCLUDE de BD para
      // jornadas (cruza contratos).
      if (contrato.modalidad === "COMPARTIDO_POR_JORNADA") {
        for (const j of contrato.jornadas) {
          await assertJornadaSinTraslape(tx, {
            consultorioId: contrato.consultorioId,
            contratoId: contrato.id,
            diaSemana: j.diaSemana,
            horaInicio: toTimeInputValue(j.horaInicio),
            horaFin: toTimeInputValue(j.horaFin),
          });
        }
      }

      let activado;
      try {
        activado = await tx.contratoArrendamiento.update({
          where: { id: contrato.id },
          data: { estado: "VIGENTE", updatedBy: user.id },
        });
      } catch (err) {
        rethrowExclusivoConflict(err);
      }

      const prorrateo = calcularDevengoProrrateado({
        rentaMensual: contrato.rentaMensual.toNumber(),
        cuotaServicios: contrato.cuotaServicios.toNumber(),
        fecha: contrato.fechaInicio,
        lado: "INICIO",
      });

      await generarCargosPeriodo(tx, {
        organizationId: tenant.organizationId,
        contratoId: contrato.id,
        folio: contrato.folio,
        currencyId: contrato.currencyId,
        periodo: prorrateo.periodo,
        montoRenta: prorrateo.montoRenta,
        montoServicios: prorrateo.montoServicios,
        emittedById: user.id,
      });

      await emitDomainEvent(tx, {
        organizationId: tenant.organizationId,
        eventType: "contrato.activado",
        aggregateType: "ContratoArrendamiento",
        aggregateId: contrato.id,
        emittedById: user.id,
        payload: {
          contratoId: contrato.id,
          folio: contrato.folio,
          medicoAfiliadoId: contrato.medicoAfiliadoId,
          consultorioId: contrato.consultorioId,
          modalidad: contrato.modalidad as "EXCLUSIVO" | "COMPARTIDO_POR_JORNADA",
          fechaInicio: contrato.fechaInicio.toISOString().slice(0, 10),
        },
      });

      const afiliado = await tx.medicoAfiliado.findFirst({
        where: { id: contrato.medicoAfiliadoId },
        select: { estado: true },
      });
      if (afiliado?.estado === "PROSPECTO") {
        await tx.medicoAfiliado.update({
          where: { id: contrato.medicoAfiliadoId },
          data: { estado: "ACTIVO", updatedBy: user.id },
        });
      }

      return activado;
    });
  }),

  /**
   * VIGENTE/EN_MORA -> TERMINADO (US.AFIL.1.3 AC7). Devengo prorrateado del
   * período parcial — si ya existe un cargo RENTA para ese período (el cron
   * ya devengó el mes completo antes del término), NO se emite un ajuste
   * negativo: cero integración Odoo implica cero nota de crédito automática
   * en esta ola (TODO Ola de integración).
   */
  terminar: terminarProc.input(contratoTerminarSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const contrato = await tx.contratoArrendamiento.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!contrato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
      }
      if (!VIGENTES_CONTRATO.includes(contrato.estado)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `El contrato está en estado ${contrato.estado}, solo se termina desde VIGENTE o EN_MORA.`,
        });
      }

      const fechaEfectiva = new Date(`${input.fechaEfectiva}T00:00:00.000Z`);
      if (fechaEfectiva < contrato.fechaInicio) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha efectiva de término no puede ser anterior al inicio del contrato.",
        });
      }

      const terminado = await tx.contratoArrendamiento.update({
        where: { id: contrato.id },
        data: {
          estado: "TERMINADO",
          fechaFin: fechaEfectiva,
          notas: appendNota(contrato.notas, `[TERMINADO ${input.fechaEfectiva}] ${input.motivo}`),
          updatedBy: user.id,
        },
      });

      const prorrateo = calcularDevengoProrrateado({
        rentaMensual: contrato.rentaMensual.toNumber(),
        cuotaServicios: contrato.cuotaServicios.toNumber(),
        fecha: fechaEfectiva,
        lado: "FIN",
      });

      await generarCargosPeriodo(tx, {
        organizationId: tenant.organizationId,
        contratoId: contrato.id,
        folio: contrato.folio,
        currencyId: contrato.currencyId,
        periodo: prorrateo.periodo,
        montoRenta: prorrateo.montoRenta,
        montoServicios: prorrateo.montoServicios,
        emittedById: user.id,
      });

      await emitDomainEvent(tx, {
        organizationId: tenant.organizationId,
        eventType: "contrato.terminado",
        aggregateType: "ContratoArrendamiento",
        aggregateId: contrato.id,
        emittedById: user.id,
        payload: {
          contratoId: contrato.id,
          folio: contrato.folio,
          fechaEfectiva: input.fechaEfectiva,
          motivo: input.motivo,
        },
      });

      return terminado;
    });
  }),

  /**
   * VIGENTE -> EN_MORA, TOGGLE MANUAL con motivo (TODO Ola de integración:
   * automatizar cuando exista confirmación de factura desde Odoo — ver
   * docstring del router).
   */
  marcarMora: editarProc.input(contratoMoraSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const contrato = await tx.contratoArrendamiento.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!contrato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
      }
      if (contrato.estado !== "VIGENTE") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se marca EN_MORA un contrato VIGENTE (estado actual: ${contrato.estado}).`,
        });
      }
      return tx.contratoArrendamiento.update({
        where: { id: contrato.id },
        data: {
          estado: "EN_MORA",
          notas: appendNota(
            contrato.notas,
            `[EN_MORA manual ${new Date().toISOString().slice(0, 10)}] ${input.motivo}`,
          ),
          updatedBy: user.id,
        },
      });
    });
  }),

  desmarcarMora: editarProc.input(contratoMoraSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const contrato = await tx.contratoArrendamiento.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!contrato) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
      }
      if (contrato.estado !== "EN_MORA") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Solo se desmarca EN_MORA un contrato que esté EN_MORA (estado actual: ${contrato.estado}).`,
        });
      }
      return tx.contratoArrendamiento.update({
        where: { id: contrato.id },
        data: {
          estado: "VIGENTE",
          notas: appendNota(
            contrato.notas,
            `[EN_MORA levantada ${new Date().toISOString().slice(0, 10)}] ${input.motivo}`,
          ),
          updatedBy: user.id,
        },
      });
    });
  }),

  jornada: router({
    list: leerProc.input(contratoJornadaListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const contrato = await tx.contratoArrendamiento.findFirst({
          where: { id: input.contratoId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!contrato) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
        }
        return tx.contratoJornada.findMany({
          where: { contratoId: input.contratoId },
          orderBy: [{ diaSemana: "asc" }, { horaInicio: "asc" }],
        });
      });
    }),

    /** US.AFIL.1.3 AC3 — solo COMPARTIDO_POR_JORNADA; valida no-traslape contra otros contratos vigentes del mismo consultorio. */
    create: editarProc.input(contratoJornadaCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const contrato = await tx.contratoArrendamiento.findFirst({
          where: { id: input.contratoId, organizationId: tenant.organizationId },
        });
        if (!contrato) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
        }
        if (contrato.modalidad !== "COMPARTIDO_POR_JORNADA") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Las jornadas solo aplican a contratos COMPARTIDO_POR_JORNADA.",
          });
        }
        await assertJornadaSinTraslape(tx, {
          consultorioId: contrato.consultorioId,
          contratoId: contrato.id,
          diaSemana: input.diaSemana,
          horaInicio: input.horaInicio,
          horaFin: input.horaFin,
        });
        return tx.contratoJornada.create({
          data: {
            contratoId: input.contratoId,
            diaSemana: input.diaSemana,
            horaInicio: toTimeColumnValue(input.horaInicio),
            horaFin: toTimeColumnValue(input.horaFin),
            createdBy: user.id,
          },
        });
      });
    }),

    delete: editarProc.input(contratoJornadaDeleteSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const jornada = await tx.contratoJornada.findFirst({
          where: { id: input.id, contrato: { organizationId: tenant.organizationId } },
        });
        if (!jornada) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Jornada no encontrada." });
        }
        await tx.contratoJornada.delete({ where: { id: input.id } });
        return { id: input.id };
      });
    }),
  }),

  cargo: router({
    list: cargoLeerProc.input(contratoCargoListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const contrato = await tx.contratoArrendamiento.findFirst({
          where: { id: input.contratoId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!contrato) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
        }
        return tx.contratoCargo.findMany({
          where: {
            contratoId: input.contratoId,
            ...(input.periodoDesde
              ? { periodo: { gte: new Date(`${input.periodoDesde}T00:00:00.000Z`) } }
              : {}),
            ...(input.periodoHasta
              ? { periodo: { lte: new Date(`${input.periodoHasta}T00:00:00.000Z`) } }
              : {}),
          },
          orderBy: [{ periodo: "desc" }, { concepto: "asc" }],
        });
      });
    }),

    /** US.AFIL.1.4 — generación manual del período, idempotente (mismo helper que activar/terminar). */
    generar: cargoGenerarProc.input(contratoCargoGenerarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const contrato = await tx.contratoArrendamiento.findFirst({
          where: { id: input.contratoId, organizationId: tenant.organizationId },
        });
        if (!contrato) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Contrato no encontrado." });
        }
        if (!VIGENTES_CONTRATO.includes(contrato.estado)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se genera devengo manual de un contrato VIGENTE o EN_MORA (estado actual: ${contrato.estado}).`,
          });
        }

        const periodo = new Date(`${input.periodo}T00:00:00.000Z`);
        if (periodo.getUTCDate() !== 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "El período debe ser el primer día del mes (YYYY-MM-01).",
          });
        }

        const cuotaServicios = contrato.cuotaServicios.toNumber();
        const creados = await generarCargosPeriodo(tx, {
          organizationId: tenant.organizationId,
          contratoId: contrato.id,
          folio: contrato.folio,
          currencyId: contrato.currencyId,
          periodo,
          montoRenta: contrato.rentaMensual.toNumber(),
          montoServicios: cuotaServicios > 0 ? cuotaServicios : null,
          emittedById: user.id,
        });

        if (creados.length === 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe el devengo del período ${input.periodo} para este contrato (idempotente).`,
          });
        }

        return tx.contratoCargo.findMany({ where: { contratoId: contrato.id, periodo } });
      });
    }),

    /** US.AFIL.1.4.7 adaptado — solo DEVENGADO es anulable (los estados Odoo no existen en esta ola). */
    anular: cargoAnularProc.input(contratoCargoAnularSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cargo = await tx.contratoCargo.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!cargo) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cargo no encontrado." });
        }
        if (cargo.estado !== "DEVENGADO") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se anula un cargo DEVENGADO (estado actual: ${cargo.estado}).`,
          });
        }
        return tx.contratoCargo.update({
          where: { id: cargo.id },
          data: { estado: "ANULADO", motivoAnulacion: input.motivo },
        });
      });
    }),
  }),
});
