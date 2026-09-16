/**
 * Router tRPC — Honorarios médicos (CC-0036 Ola 5, REQ-HIS-AFIL-001 S6,
 * US.AFIL.1.5 / US.AFIL.1.6 / US.AFIL.1.7). sql/248_cc0036_honorarios.sql.
 *
 * ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-15 #1 (hub de eventos, misma que
 * CC-0036 Ola 2): CERO integración con Odoo en esta ola. `aprobar` es el
 * final del flujo — emite `liquidacion.aprobada` al outbox. `ENVIADA_ODOO`/
 * `PAGADA` quedan RESERVADOS sin escritor.
 *
 * ⚠️ DECISIÓN DE EDWIN MARTINEZ 2026-09-16 #2 (verbatim resumido): el HIS
 * deja el acto clínico y pasa al ERP el monto por RUBRO (centro de costo +
 * cuenta contable). `resumenPorRubro` (#2c) agrega hoy con precisión completa
 * SOLO los cargos `HONORARIO_MEDICO` (vía `ReglaHonorario.costCenterId`/
 * `cuentaContableCodigo`, resuelto con JOIN a `ProduccionMedica`); el resto
 * de orígenes (farmacia/lab/imágenes/etc.) se agregan por `origen` con
 * `costCenterId` best-effort desde `Encounter.costCenterId` y
 * `cuentaContableCodigo=null` — **GAP documentado**: no existe todavía un
 * catálogo de mapeo `origen -> cuenta contable` general (fuera de alcance de
 * esta ola; TODO de una ola de integración contable). `reporteCuentaTercero`
 * (#2d) es v1 JSON/tabla — PDF/XLSX quedan TODO (US.AFIL.1.7 AC7 también).
 *
 * Segregación generador≠aprobador (US.AFIL.1.7 AC4): quien `generar` una
 * liquidación (`createdBy`) NO puede `aprobar` esa misma liquidación, sin
 * importar los roles que tenga — es un guard de router, no de permisos (los
 * permisos solo dicen QUÉ acciones puede hacer un rol, no CUÁL fila).
 *
 * "generar reemplaza BORRADOR" (AC3): `uq_liquidacion_periodo_vigente`
 * (sql/248) garantiza a lo sumo una liquidación no-ANULADA por
 * afiliado+período exacto. `generar` NO fija `ProduccionMedica.liquidacionId`
 * — eso ocurre recién en `aprobar` (AC4 lo dice explícito: "la producción
 * incluida pasa a LIQUIDADO con liquidacionId" al aprobar, no al generar).
 * Esto hace que "regenerar reemplaza" sea un simple borrar+recrear del
 * `BORRADOR` (nada quedó enlazado todavía) y que `generar` SIEMPRE recoja la
 * producción PENDIENTE más reciente del período al momento de llamarlo.
 *
 * Compensación (AC2): v1 solo compensa `ContratoCargo` COMPLETOS (no
 * fracciona un cargo individual) en orden de antigüedad (`generadoAt` asc),
 * hasta el máximo que quepa sin dejar `totalNeto` negativo — simplificación
 * documentada porque `ContratoCargo` no tiene columna de saldo parcial.
 *
 * ABAC (REQ §7.3.1): `MEDICO_AFILIADO` (portal, AC8) solo ve SUS PROPIAS
 * liquidaciones/producción — mismo criterio `resolveMedicoAfiliadoScope` que
 * `agenda.router.ts` (duplicado aquí en vez de importado: son ficheros
 * distintos y la función no está exportada allá).
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent, type PrismaClient } from "@his/database";
import type { TenantContext } from "@his/contracts";
import {
  convenioListSchema,
  convenioGetSchema,
  convenioCreateSchema,
  convenioUpdateSchema,
  convenioActivarSchema,
  reglaListSchema,
  reglaCreateSchema,
  reglaUpdateSchema,
  produccionListSchema,
  produccionExcepcionesSchema,
  produccionExcluirSchema,
  produccionReprocesarSchema,
  liquidacionListSchema,
  liquidacionGetSchema,
  liquidacionGenerarSchema,
  liquidacionAprobarSchema,
  liquidacionAnularSchema,
  resumenPorRubroSchema,
  reporteCuentaTerceroSchema,
} from "@his/contracts";
import { router, requirePermission, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import { resolverHonorarioParaMedico, crearCargoHonorarioYEnlazar } from "../lib/produccion-atribucion";
import { nextLiquidacionFolio } from "../lib/liquidacion-folio";
import { calcularResumenRubros } from "../lib/resumen-rubros";

const convenioLeerProc = requirePermission("convenio_honorario.leer");
const convenioCrearProc = requirePermission("convenio_honorario.crear");
const convenioEditarProc = requirePermission("convenio_honorario.editar");
const convenioActivarProc = requirePermission("convenio_honorario.activar");
const produccionLeerProc = requirePermission("produccion_medica.leer");
const produccionExcluirProc = requirePermission("produccion_medica.excluir");
const produccionReprocesarProc = requirePermission("produccion_medica.reprocesar");
const liquidacionLeerProc = requirePermission("liquidacion.leer");
const liquidacionGenerarProc = requirePermission("liquidacion.generar");
const liquidacionAprobarProc = requirePermission("liquidacion.aprobar");
const liquidacionAnularProc = requirePermission("liquidacion.anular");

/** Mapea el `origen` de un cargo al `ambito` de honorarios — solo los orígenes con atribución v1 cableada (Ola 5). */
const ORIGEN_A_AMBITO: Record<string, string> = {
  USO_INSTALACIONES: "CIRUGIA",
  CONSULTA: "CONSULTA",
};

// ---------------------------------------------------------------------------
// ABAC — scope de médico afiliado (portal propio, mismo patrón que agenda.router.ts).
// ---------------------------------------------------------------------------

const ROLES_MEDICO_SCOPE: readonly string[] = ["MEDICO_AFILIADO"];
const ROLES_SIN_SCOPE: readonly string[] = ["ADMIN", "DIR", "ANALISTA_HONORARIOS", "GERENTE_FINANCIERO"];

async function resolveMedicoAfiliadoScope(
  tx: PrismaClient,
  tenant: TenantContext,
  userId: string,
): Promise<string[] | null> {
  const acotado = tenant.roleCodes.some((r) => ROLES_MEDICO_SCOPE.includes(r));
  if (!acotado) return null;
  if (tenant.roleCodes.some((r) => ROLES_SIN_SCOPE.includes(r))) return null;
  const afiliados = await tx.medicoAfiliado.findMany({
    where: { organizationId: tenant.organizationId, userId },
    select: { id: true },
  });
  return afiliados.map((a) => a.id);
}

function decimalToNumber(v: { toNumber: () => number } | number | null | undefined): number {
  if (v == null) return 0;
  return typeof v === "number" ? v : v.toNumber();
}

// ---------------------------------------------------------------------------
// Liquidacion — generación (US.AFIL.1.7 AC1-AC3).
// ---------------------------------------------------------------------------

async function resolverCurrencyId(tx: PrismaClient, organizationId: string, medicoAfiliadoId: string): Promise<string> {
  const contrato = await tx.contratoArrendamiento.findFirst({
    where: { organizationId, medicoAfiliadoId },
    orderBy: { createdAt: "desc" },
    select: { currencyId: true },
  });
  if (contrato) return contrato.currencyId;

  const org = await tx.organization.findUnique({
    where: { id: organizationId },
    select: { functionalCurrency: true },
  });
  if (!org) throw new TRPCError({ code: "NOT_FOUND", message: "Organización no encontrada." });
  return org.functionalCurrency;
}

interface CompensacionCandidata {
  contratoCargoId: string;
  monto: number;
}

/** AC2 — compensa ContratoCargo COMPLETOS (sin fraccionar), más antiguos primero, sin dejar netoDisponible negativo. */
async function resolverCompensaciones(
  tx: PrismaClient,
  params: { organizationId: string; medicoAfiliadoId: string; netoDisponible: number },
): Promise<{ compensaciones: CompensacionCandidata[]; totalCompensado: number }> {
  if (params.netoDisponible <= 0) return { compensaciones: [], totalCompensado: 0 };

  const cargosVencidos = await tx.contratoCargo.findMany({
    where: {
      organizationId: params.organizationId,
      estado: "DEVENGADO",
      contrato: { medicoAfiliadoId: params.medicoAfiliadoId, estado: { in: ["VIGENTE", "EN_MORA"] } },
    },
    orderBy: { generadoAt: "asc" },
    select: { id: true, monto: true },
  });

  const compensaciones: CompensacionCandidata[] = [];
  let restante = params.netoDisponible;
  for (const cargo of cargosVencidos) {
    const monto = decimalToNumber(cargo.monto);
    if (monto <= 0 || monto > restante) continue;
    compensaciones.push({ contratoCargoId: cargo.id, monto });
    restante -= monto;
    if (restante <= 0) break;
  }

  return { compensaciones, totalCompensado: params.netoDisponible - restante };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const honorarioRouter = router({
  convenio: router({
    list: convenioLeerProc.input(convenioListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.convenioHonorario.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input?.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
            ...(input?.estado ? { estado: input.estado } : {}),
          },
          include: { medicoAfiliado: { select: { id: true, nombreCompleto: true } } },
          orderBy: { createdAt: "desc" },
        }),
      );
    }),

    get: convenioLeerProc.input(convenioGetSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const convenio = await withTenantContext(prisma, tenant, (tx) =>
        tx.convenioHonorario.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: { reglas: { orderBy: [{ ambito: "asc" }, { prioridad: "desc" }] } },
        }),
      );
      if (!convenio) throw new TRPCError({ code: "NOT_FOUND", message: "Convenio no encontrado." });
      return convenio;
    }),

    /** US.AFIL.1.5 AC1 — alta en BORRADOR (activar exige >=1 regla active). */
    create: convenioCrearProc.input(convenioCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const afiliado = await tx.medicoAfiliado.findFirst({
          where: { id: input.medicoAfiliadoId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!afiliado) throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });

        return tx.convenioHonorario.create({
          data: {
            organizationId: tenant.organizationId,
            medicoAfiliadoId: input.medicoAfiliadoId,
            vigenciaDesde: input.vigenciaDesde,
            vigenciaHasta: input.vigenciaHasta,
            retencionRentaPct: input.retencionRentaPct,
            aplicaIvaRetenido: input.aplicaIvaRetenido,
            periodicidadLiquidacion: input.periodicidadLiquidacion,
            createdBy: user.id,
          },
        });
      });
    }),

    /** US.AFIL.1.5 AC6 — actualizar parámetros NO recalcula producción ya liquidada. */
    update: convenioEditarProc.input(convenioUpdateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const convenio = await tx.convenioHonorario.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!convenio) throw new TRPCError({ code: "NOT_FOUND", message: "Convenio no encontrado." });

        return tx.convenioHonorario.update({
          where: { id: convenio.id },
          data: {
            retencionRentaPct: input.retencionRentaPct,
            aplicaIvaRetenido: input.aplicaIvaRetenido,
            periodicidadLiquidacion: input.periodicidadLiquidacion,
            updatedBy: user.id,
          },
        });
      });
    }),

    /** US.AFIL.1.5 AC1 — solo activa con >=1 regla active. EXCLUDE gist detecta traslape VIGENTE. */
    activar: convenioActivarProc.input(convenioActivarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const convenio = await tx.convenioHonorario.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: { reglas: { where: { active: true }, select: { id: true } } },
        });
        if (!convenio) throw new TRPCError({ code: "NOT_FOUND", message: "Convenio no encontrado." });
        if (convenio.estado !== "BORRADOR") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `El convenio está en estado ${convenio.estado}, no se puede activar desde ahí.`,
          });
        }
        if (convenio.reglas.length === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El convenio requiere al menos una regla activa antes de activarse.",
          });
        }

        try {
          return await tx.convenioHonorario.update({
            where: { id: convenio.id },
            data: { estado: "VIGENTE", updatedBy: user.id },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (/exclusion/i.test(message)) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "El médico afiliado ya tiene un convenio VIGENTE que se traslapa en ese período.",
            });
          }
          throw err;
        }
      });
    }),
  }),

  regla: router({
    list: convenioLeerProc.input(reglaListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const convenio = await tx.convenioHonorario.findFirst({
          where: { id: input.convenioId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!convenio) throw new TRPCError({ code: "NOT_FOUND", message: "Convenio no encontrado." });
        return tx.reglaHonorario.findMany({
          where: { convenioId: input.convenioId },
          orderBy: [{ ambito: "asc" }, { prioridad: "desc" }, { createdAt: "desc" }],
        });
      });
    }),

    create: convenioEditarProc.input(reglaCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const convenio = await tx.convenioHonorario.findFirst({
          where: { id: input.convenioId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!convenio) throw new TRPCError({ code: "NOT_FOUND", message: "Convenio no encontrado." });

        return tx.reglaHonorario.create({
          data: {
            convenioId: input.convenioId,
            ambito: input.ambito,
            rolMedico: input.rolMedico,
            serviceCategoryId: input.serviceCategoryId,
            codigoServicio: input.codigoServicio,
            tipoCalculo: input.tipoCalculo,
            porcentaje: input.porcentaje,
            montoFijo: input.montoFijo,
            montoMinimo: input.montoMinimo,
            montoMaximo: input.montoMaximo,
            prioridad: input.prioridad ?? 0,
            costCenterId: input.costCenterId,
            cuentaContableCodigo: input.cuentaContableCodigo,
            createdBy: user.id,
          },
        });
      });
    }),

    /** US.AFIL.1.5 AC6 — cambio de regla NO recalcula producción ya liquidada (solo aplica a PENDIENTE futura). */
    update: convenioEditarProc.input(reglaUpdateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const regla = await tx.reglaHonorario.findFirst({
          where: { id: input.id, convenio: { organizationId: tenant.organizationId } },
        });
        if (!regla) throw new TRPCError({ code: "NOT_FOUND", message: "Regla no encontrada." });

        return tx.reglaHonorario.update({
          where: { id: regla.id },
          data: {
            porcentaje: input.porcentaje,
            montoFijo: input.montoFijo,
            montoMinimo: input.montoMinimo,
            montoMaximo: input.montoMaximo,
            prioridad: input.prioridad,
            costCenterId: input.costCenterId,
            cuentaContableCodigo: input.cuentaContableCodigo,
            active: input.active,
            updatedBy: user.id,
          },
        });
      });
    }),
  }),

  produccion: router({
    list: produccionLeerProc.input(produccionListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);
        if (scope !== null && scope.length === 0) return [];

        return tx.produccionMedica.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
            ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
            ...(input.estado ? { estado: input.estado } : {}),
            ...(input.fechaDesde || input.fechaHasta
              ? {
                  fecha: {
                    ...(input.fechaDesde && { gte: input.fechaDesde }),
                    ...(input.fechaHasta && { lte: input.fechaHasta }),
                  },
                }
              : {}),
          },
          include: { medicoAfiliado: { select: { id: true, nombreCompleto: true } } },
          orderBy: { fecha: "desc" },
        });
      });
    }),

    /** US.AFIL.1.5 AC5 — reporte de excepciones SIN_REGLA/PERSONAL_DE_PLANTA obligatorio antes de la primera liquidación real. */
    excepciones: produccionLeerProc.input(produccionExcepcionesSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.produccionMedica.findMany({
          where: {
            organizationId: tenant.organizationId,
            estado: "EXCLUIDO",
            ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
          },
          include: { medicoAfiliado: { select: { id: true, nombreCompleto: true } } },
          orderBy: { fecha: "desc" },
        }),
      );
    }),

    excluir: produccionExcluirProc.input(produccionExcluirSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const produccion = await tx.produccionMedica.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!produccion) throw new TRPCError({ code: "NOT_FOUND", message: "Producción no encontrada." });
        if (produccion.estado !== "PENDIENTE") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se puede excluir producción PENDIENTE (estado actual: ${produccion.estado}).`,
          });
        }

        return tx.produccionMedica.update({
          where: { id: produccion.id },
          data: {
            estado: "EXCLUIDO",
            honorarioCalculado: 0,
            // MANUAL (no SIN_REGLA) — la revisión pre-PR marcó que hardcodear
            // SIN_REGLA acá era engañoso: esta exclusión la decide un
            // analista, no la ausencia de una regla. El texto que la
            // sustenta va en motivoDetalle.
            motivoExclusion: "MANUAL",
            motivoDetalle: input.motivo,
            updatedBy: user.id,
          },
        });
      });
    }),

    /**
     * Reintenta la resolución de regla sobre una producción EXCLUIDA
     * `SIN_REGLA` (p.ej. tras corregir/activar la regla que faltaba). El
     * `ambito` se deriva del `origen` del cargo original — solo los orígenes
     * con atribución v1 cableada (USO_INSTALACIONES/CONSULTA) son
     * reprocesables; el resto rechaza con BAD_REQUEST (gap documentado en la
     * cabecera del router).
     */
    reprocesar: produccionReprocesarProc.input(produccionReprocesarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const produccion = await tx.produccionMedica.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!produccion) throw new TRPCError({ code: "NOT_FOUND", message: "Producción no encontrada." });
        if (produccion.estado !== "EXCLUIDO") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se puede reprocesar producción EXCLUIDO (estado actual: ${produccion.estado}).`,
          });
        }

        const cargo = await tx.patientAccountService.findUnique({
          where: { id: produccion.patientAccountServiceId },
          select: { origen: true, accountId: true, tipo: true, encounterId: true },
        });
        const ambito = cargo?.origen ? ORIGEN_A_AMBITO[cargo.origen] : undefined;
        if (!ambito) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede determinar el ámbito de honorario para el origen '${cargo?.origen ?? "desconocido"}'.`,
          });
        }

        const resuelto = await resolverHonorarioParaMedico(tx, {
          organizationId: tenant.organizationId,
          medicoAfiliadoId: produccion.medicoAfiliadoId,
          ambito,
          rolMedico: produccion.rolMedico,
          fecha: produccion.fecha,
          montoFacturado: decimalToNumber(produccion.montoFacturado),
        });

        if (!resuelto) {
          return tx.produccionMedica.update({
            where: { id: produccion.id },
            data: { motivoExclusion: "SIN_REGLA", updatedBy: user.id },
          });
        }

        const actualizada = await tx.produccionMedica.update({
          where: { id: produccion.id },
          data: {
            estado: "PENDIENTE",
            honorarioCalculado: resuelto.honorarioCalculado,
            reglaHonorarioId: resuelto.reglaId,
            motivoExclusion: null,
            motivoDetalle: null,
            updatedBy: user.id,
          },
        });

        // Hallazgo #2 (revisión pre-PR): reprocesar debe crear el mismo
        // cargo HONORARIO_MEDICO que crea la atribución inicial — mismo
        // camino compartido (crearCargoHonorarioYEnlazar), no solo actualizar
        // el estado de la fila.
        if (resuelto.honorarioCalculado > 0 && cargo) {
          const cargoHonorarioId = await crearCargoHonorarioYEnlazar(tx, {
            produccionId: actualizada.id,
            accountId: cargo.accountId,
            tipo: cargo.tipo,
            encounterId: cargo.encounterId,
            rolMedico: actualizada.rolMedico,
            honorarioCalculado: resuelto.honorarioCalculado,
            actorId: user.id,
          });
          return { ...actualizada, cargoHonorarioId };
        }

        return actualizada;
      });
    }),
  }),

  liquidacion: router({
    list: liquidacionLeerProc.input(liquidacionListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);
        if (scope !== null && scope.length === 0) return [];

        return tx.liquidacion.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
            ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
            ...(input.estado ? { estado: input.estado } : {}),
          },
          include: { medicoAfiliado: { select: { id: true, nombreCompleto: true } } },
          orderBy: { createdAt: "desc" },
        });
      });
    }),

    /** US.AFIL.1.7 AC7 — detalle por producción incluida (v1 JSON; PDF/XLSX TODO). */
    get: liquidacionLeerProc.input(liquidacionGetSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);
        const liquidacion = await tx.liquidacion.findFirst({
          where: {
            id: input.id,
            organizationId: tenant.organizationId,
            ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
          },
          include: {
            medicoAfiliado: { select: { id: true, nombreCompleto: true } },
            compensaciones: true,
          },
        });
        if (!liquidacion) throw new TRPCError({ code: "NOT_FOUND", message: "Liquidación no encontrada." });

        const producciones = await tx.produccionMedica.findMany({
          where: { liquidacionId: liquidacion.id },
          orderBy: { fecha: "asc" },
        });

        return { ...liquidacion, producciones };
      });
    }),

    /** US.AFIL.1.7 AC1-AC3 — genera/reemplaza el BORRADOR del período (ver docstring del router). */
    generar: liquidacionGenerarProc.input(liquidacionGenerarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const afiliado = await tx.medicoAfiliado.findFirst({
          where: { id: input.medicoAfiliadoId, organizationId: tenant.organizationId },
          select: { id: true, permiteCompensacion: true },
        });
        if (!afiliado) throw new TRPCError({ code: "NOT_FOUND", message: "Médico afiliado no encontrado." });

        const convenio = await tx.convenioHonorario.findFirst({
          where: {
            medicoAfiliadoId: input.medicoAfiliadoId,
            organizationId: tenant.organizationId,
            estado: "VIGENTE",
          },
          select: { retencionRentaPct: true },
        });
        if (!convenio) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El médico afiliado no tiene un convenio de honorarios VIGENTE.",
          });
        }

        // Totales ANTES de tocar cualquier BORRADOR existente — si el guard de
        // neto negativo (abajo) dispara, no queremos haber borrado nada.
        const produccionesPendientes = await tx.produccionMedica.findMany({
          where: {
            organizationId: tenant.organizationId,
            medicoAfiliadoId: input.medicoAfiliadoId,
            estado: "PENDIENTE",
            fecha: { gte: input.periodoDesde, lte: input.periodoHasta },
          },
          select: { honorarioCalculado: true },
        });

        const totalBruto = produccionesPendientes.reduce((acc, p) => acc + decimalToNumber(p.honorarioCalculado), 0);
        const totalRetenciones = Math.round(totalBruto * decimalToNumber(convenio.retencionRentaPct) * 100) / 100;
        const netoAntesCompensacion = totalBruto - totalRetenciones;

        // Hallazgo #3 (revisión pre-PR): un bruto negativo (producción
        // REVERSADA de una liquidación previa ya aprobada, US.AFIL.1.6 AC4)
        // NUNCA se clampea silenciosamente a 0 — es una situación que
        // requiere decisión de negocio (¿arrastra al siguiente período? ¿se
        // cobra al afiliado?), sin política definida todavía (§15 del REQ).
        if (netoAntesCompensacion < 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `La liquidación del período resulta negativa por reversiones (${netoAntesCompensacion.toFixed(2)}); requiere revisión manual — política de arrastre pendiente de decisión de negocio.`,
          });
        }

        const existente = await tx.liquidacion.findFirst({
          where: {
            medicoAfiliadoId: input.medicoAfiliadoId,
            periodoDesde: input.periodoDesde,
            periodoHasta: input.periodoHasta,
            estado: { not: "ANULADA" },
          },
          select: { id: true, estado: true },
        });
        if (existente && existente.estado !== "BORRADOR") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Ya existe una liquidación ${existente.estado} para ese período — anúlela antes de regenerar.`,
          });
        }
        if (existente) {
          // AC3 — "generar reemplaza BORRADOR": nada quedó enlazado todavía
          // (liquidacionId solo se fija en `aprobar`), así que borrar+recrear
          // es seguro y conserva trazabilidad en audit.AuditLog (DELETE+INSERT).
          await tx.liquidacion.delete({ where: { id: existente.id } });
        }

        const { compensaciones, totalCompensado } = afiliado.permiteCompensacion
          ? await resolverCompensaciones(tx, {
              organizationId: tenant.organizationId,
              medicoAfiliadoId: input.medicoAfiliadoId,
              netoDisponible: netoAntesCompensacion,
            })
          : { compensaciones: [], totalCompensado: 0 };

        const totalNeto = Math.max(netoAntesCompensacion - totalCompensado, 0);
        const currencyId = await resolverCurrencyId(tx, tenant.organizationId, input.medicoAfiliadoId);
        const folio = await nextLiquidacionFolio(tx, tenant.organizationId);

        const liquidacion = await tx.liquidacion.create({
          data: {
            organizationId: tenant.organizationId,
            medicoAfiliadoId: input.medicoAfiliadoId,
            folio,
            periodoDesde: input.periodoDesde,
            periodoHasta: input.periodoHasta,
            totalBruto,
            totalRetenciones,
            totalCompensaciones: totalCompensado,
            totalNeto,
            currencyId,
            estado: "BORRADOR",
            createdBy: user.id,
          },
        });

        if (compensaciones.length > 0) {
          await tx.liquidacionCompensacion.createMany({
            data: compensaciones.map((c) => ({
              liquidacionId: liquidacion.id,
              contratoCargoId: c.contratoCargoId,
              monto: c.monto,
            })),
          });
        }

        return liquidacion;
      });
    }),

    /** US.AFIL.1.7 AC4 — aprobar sella y mueve la producción del período a LIQUIDADO. Segregación generador≠aprobador. */
    aprobar: liquidacionAprobarProc.input(liquidacionAprobarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const liquidacion = await tx.liquidacion.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!liquidacion) throw new TRPCError({ code: "NOT_FOUND", message: "Liquidación no encontrada." });
        if (liquidacion.estado !== "BORRADOR") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La liquidación está en estado ${liquidacion.estado}, no se puede aprobar desde ahí.`,
          });
        }
        if (liquidacion.createdBy === user.id) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Quien genera una liquidación no puede aprobarla (segregación de funciones).",
          });
        }

        const aprobada = await tx.liquidacion.update({
          where: { id: liquidacion.id },
          data: { estado: "APROBADA", aprobadaBy: user.id, aprobadaAt: new Date(), updatedBy: user.id },
        });

        await tx.produccionMedica.updateMany({
          where: {
            organizationId: tenant.organizationId,
            medicoAfiliadoId: liquidacion.medicoAfiliadoId,
            estado: "PENDIENTE",
            fecha: { gte: liquidacion.periodoDesde, lte: liquidacion.periodoHasta },
          },
          data: { estado: "LIQUIDADO", liquidacionId: liquidacion.id },
        });

        await emitDomainEvent(tx, {
          organizationId: tenant.organizationId,
          eventType: "liquidacion.aprobada",
          aggregateType: "Liquidacion",
          aggregateId: aprobada.id,
          emittedById: user.id,
          payload: {
            liquidacionId: aprobada.id,
            medicoAfiliadoId: aprobada.medicoAfiliadoId,
            folio: aprobada.folio,
            periodoDesde: aprobada.periodoDesde.toISOString().slice(0, 10),
            periodoHasta: aprobada.periodoHasta.toISOString().slice(0, 10),
            totalBruto: decimalToNumber(aprobada.totalBruto),
            totalRetenciones: decimalToNumber(aprobada.totalRetenciones),
            totalCompensaciones: decimalToNumber(aprobada.totalCompensaciones),
            totalNeto: decimalToNumber(aprobada.totalNeto),
            aprobadaById: user.id,
          },
        });

        return aprobada;
      });
    }),

    /** US.AFIL.1.7 AC5 — anular una APROBADA devuelve su producción a PENDIENTE. */
    anular: liquidacionAnularProc.input(liquidacionAnularSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const liquidacion = await tx.liquidacion.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!liquidacion) throw new TRPCError({ code: "NOT_FOUND", message: "Liquidación no encontrada." });
        if (liquidacion.estado !== "APROBADA") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Solo se puede anular una liquidación APROBADA (estado actual: ${liquidacion.estado}).`,
          });
        }

        await tx.produccionMedica.updateMany({
          where: { liquidacionId: liquidacion.id },
          data: { estado: "PENDIENTE", liquidacionId: null },
        });

        return tx.liquidacion.update({
          where: { id: liquidacion.id },
          data: { estado: "ANULADA", motivoAnulacion: input.motivo, updatedBy: user.id },
        });
      });
    }),
  }),

  /**
   * Decisión Edwin 2026-09-16 #2c — agregado por rubro (centro de costo +
   * cuenta contable) de una cuenta, para el ERP. Precisión completa solo en
   * HONORARIO_MEDICO (ver cabecera del router para el gap de los demás orígenes).
   */
  resumenPorRubro: liquidacionLeerProc.input(resumenPorRubroSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const cuenta = await tx.patientAccount.findFirst({
        where: { id: input.accountId, organizationId: tenant.organizationId },
        select: { id: true },
      });
      if (!cuenta) throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });

      return calcularResumenRubros(tx, { organizationId: tenant.organizationId, accountId: cuenta.id });
    });
  }),

  /**
   * Decisión Edwin 2026-09-16 #2d — detalle clínico de la cuenta por pagador,
   * para cumplimiento de terceros (ISBM/Doctor SV). v1 JSON/tabla; PDF/XLSX TODO.
   */
  reporteCuentaTercero: liquidacionLeerProc.input(reporteCuentaTerceroSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const cuenta = await tx.patientAccount.findFirst({
        where: { id: input.accountId, organizationId: tenant.organizationId },
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          tipoCuenta: { select: { nombre: true, insurerId: true } },
          servicios: {
            where: { status: { in: ["VIGENTE", "REVERSION"] } },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      if (!cuenta) throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });

      const medicoIds = Array.from(
        new Set(
          (
            await tx.produccionMedica.findMany({
              where: { patientAccountServiceId: { in: cuenta.servicios.map((s) => s.id) } },
              select: { medicoAfiliadoId: true },
            })
          ).map((p) => p.medicoAfiliadoId),
        ),
      );
      const medicos = medicoIds.length
        ? await tx.medicoAfiliado.findMany({
            where: { id: { in: medicoIds } },
            select: { id: true, nombreCompleto: true, jvpmNumero: true },
          })
        : [];

      return {
        cuenta: { id: cuenta.id, numeroCuenta: cuenta.numeroCuenta, tipoCuenta: cuenta.tipoCuenta?.nombre ?? null },
        paciente: cuenta.patient,
        servicios: cuenta.servicios.map((s) => ({
          fecha: s.createdAt,
          descripcion: s.descripcion,
          origen: s.origen,
          monto: decimalToNumber(s.totalPrice),
        })),
        medicos,
      };
    });
  }),

  /** US.AFIL.1.7 AC8 — portal del afiliado: sus propias liquidaciones (ABAC, sin permiso genérico). */
  misLiquidaciones: tenantProcedure.query(async ({ ctx }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const propio = await tx.medicoAfiliado.findFirst({
        where: { organizationId: tenant.organizationId, userId: user.id },
        select: { id: true },
      });
      if (!propio) return [];

      return tx.liquidacion.findMany({
        where: { organizationId: tenant.organizationId, medicoAfiliadoId: propio.id },
        orderBy: { periodoDesde: "desc" },
      });
    });
  }),
});
