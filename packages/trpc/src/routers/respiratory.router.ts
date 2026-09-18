/**
 * §21 Respiratory — router (Wave 8 / Beta.12 hardening layer 1).
 *
 * Beta.12 additions:
 *   - State machine enforcement for VentilatorSession (ACTIVE→WEANING→EXTUBATED…).
 *   - Ventilator parameter range validation at the router boundary.
 *   - order.renew: extends expiresAt by 24 h.
 *   - order.getExpired: returns orders past expiresAt without renewal.
 *   - MedicalGasUsage: create-only (no update/delete mutations exposed; DB trigger enforces append-only).
 *   - ventilator.transition: explicit state-machine transition mutation.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { emitDomainEvent, Prisma } from "@his/database";
import {
  trOrdenCrearInput,
  trOrdenListarPorCuentaInput,
  trOrdenDetalleInput,
  trSesionEjecutarInput,
  trSupervisionInput,
  trSlaConfigUpsertInput,
  trProcedimientoUpdateInput,
  trMedicamentoUpdateInput,
  type LabSlaEstado,
  respiratoryOrderCreateInput,
  respiratoryOrderListInput,
  respiratoryOrderCompleteInput,
  respiratoryOrderCancelInput,
  respiratoryOrderRenewInput,
  getExpiredOrdersInput,
  ventilatorSessionCreateInput,
  ventilatorSessionEndInput,
  ventilatorSessionListInput,
  ventilatorSessionTransitionInput,
  medicalGasUsageCreateInput,
  medicalGasUsageListInput,
  PEEP_MIN,
  PEEP_MAX,
  FIO2_MIN,
  FIO2_MAX,
  RR_MIN,
  RR_MAX,
  VT_ABS_MIN,
  VT_ABS_MAX,
} from "@his/contracts";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { capturarCargo } from "../lib/charge-capture";
import {
  resolveTrSlaMap,
  DEFAULT_TR_SLA,
  CARE_TASK_PRIORITY_BY_LAB_PRIORITY,
  type LabPriorityKey,
} from "../lib/lab-sla";

// ---------------------------------------------------------------------------
// State machine transition table
// ---------------------------------------------------------------------------

type VentilatorStatus = "ACTIVE" | "WEANING" | "EXTUBATED" | "ESCALATED" | "FAILED_EXTUBATION";

const ALLOWED_TRANSITIONS: Record<VentilatorStatus, VentilatorStatus[]> = {
  ACTIVE: ["WEANING"],
  WEANING: ["EXTUBATED", "ESCALATED", "FAILED_EXTUBATION"],
  ESCALATED: ["ACTIVE"],
  EXTUBATED: [],
  FAILED_EXTUBATION: [],
};

function assertTransitionAllowed(from: VentilatorStatus, to: VentilatorStatus): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Transición inválida: ${from} → ${to}. Permitidas: ${ALLOWED_TRANSITIONS[from].join(", ") || "ninguna"}.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Vent-parameter range guard (used on create; fio2 stored as fraction 0.21–1.0)
// ---------------------------------------------------------------------------

function assertVentParamsInRange(params: {
  peep?: number | null;
  fio2?: number | null;
  rrSet?: number | null;
  tidalVolume?: number | null;
}): void {
  if (params.peep !== undefined && params.peep !== null) {
    if (params.peep < PEEP_MIN || params.peep > PEEP_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `PEEP ${params.peep} cmH2O fuera de rango seguro (${PEEP_MIN}–${PEEP_MAX}).`,
      });
    }
  }
  if (params.fio2 !== undefined && params.fio2 !== null) {
    if (params.fio2 < FIO2_MIN || params.fio2 > FIO2_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `FiO2 ${params.fio2} fuera de rango seguro (${FIO2_MIN}–${FIO2_MAX}).`,
      });
    }
  }
  if (params.rrSet !== undefined && params.rrSet !== null) {
    if (params.rrSet < RR_MIN || params.rrSet > RR_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `RR ${params.rrSet} resp/min fuera de rango seguro (${RR_MIN}–${RR_MAX}).`,
      });
    }
  }
  if (params.tidalVolume !== undefined && params.tidalVolume !== null) {
    if (params.tidalVolume < VT_ABS_MIN || params.tidalVolume > VT_ABS_MAX) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Vt ${params.tidalVolume} mL fuera de rango seguro (${VT_ABS_MIN}–${VT_ABS_MAX} mL).`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Order expiry helper
// ---------------------------------------------------------------------------

function buildExpiredWhereClause(organizationId: string, asOf: Date): object {
  return {
    organizationId,
    status: "ACTIVE",
    expiresAt: { lt: asOf },
    OR: [{ renewedAt: null }, { renewedAt: { lt: asOf } }],
  };
}

const ORDER_DEFAULT_DURATION_MS = 24 * 60 * 60 * 1000; // 24 h

// ---------------------------------------------------------------------------
// CC-0042 / REQ-HIS-TR-001 (S1) — CPOE-TR sobre este mismo router (adecuar
// legacy, no duplicar). Mockup: docs/CC/CC0042/MOCK-HIS-TR-001.html.
// ---------------------------------------------------------------------------

/** Prescribe la orden: médico (o ADMIN override operativo, criterio lis/imaging). */
const trPrescriptorProc = requireRole(["PHYSICIAN", "ADMIN"]);
/** Ejecuta sesiones: terapeuta respiratorio (rol CC-0042; inerte hasta crearse
 *  en prod, convención LAB_TECHNICIAN), enfermería y médico. */
const trEjecutorProc = requireRole(["RESP_THERAPIST", "NURSE", "PHYSICIAN", "ADMIN"]);
/** Panel de configuración del módulo: solo administración. */
const trConfigProc = requireRole(["ADMIN", "DIR"]);

type TrAerosolConfig = {
  hint?: string;
  meds: string[];
  unidades: string[];
  diluyentes: string[];
  diluyenteDefault?: number;
  extra?: { label: string; opciones: string[]; default?: number };
};

/** Catálogo efectivo: override del tenant gana sobre la fila global por código. */
function catalogoEfectivo<T extends { codigo?: string; clave?: string; organizationId: string | null }>(
  rows: T[],
): T[] {
  const byKey = new Map<string, T>();
  for (const r of rows) {
    const key = (r.codigo ?? r.clave)!;
    const prev = byKey.get(key);
    if (!prev || (prev.organizationId === null && r.organizationId !== null)) byKey.set(key, r);
  }
  return [...byKey.values()];
}

export const respiratoryRouter = router({
  tr: router({
    /** Catálogos del módulo (procedimientos + medicamentos inhalados), efectivos por tenant. */
    catalogo: router({
      list: tenantProcedure.query(async ({ ctx }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const [procs, meds] = await Promise.all([
            tx.trProcedimiento.findMany({
              where: { OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }] },
              orderBy: [{ displayOrder: "asc" }, { codigo: "asc" }],
            }),
            tx.trMedicamentoInhalado.findMany({
              where: { OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }] },
              orderBy: [{ displayOrder: "asc" }, { clave: "asc" }],
            }),
          ]);
          return {
            procedimientos: catalogoEfectivo(procs).map((p) => ({
              id: p.id,
              codigo: p.codigo,
              nombre: p.nombre,
              categoria: p.categoria,
              seccionOrden: p.seccionOrden,
              subSeccion: p.subSeccion,
              unidadCobro: p.unidadCobro,
              requiereConsentimiento: p.requiereConsentimiento,
              delegablePorProtocolo: p.delegablePorProtocolo,
              pareoCon: p.pareoCon,
              tiempoEstandarMin: p.tiempoEstandarMin,
              tarifaBase: p.tarifaBase != null ? Number(p.tarifaBase) : null,
              aerosolConfig: (p.aerosolConfig as TrAerosolConfig | null) ?? null,
              displayOrder: p.displayOrder,
              activo: p.activo,
              esOverrideTenant: p.organizationId !== null,
            })),
            medicamentos: catalogoEfectivo(meds).map((m) => ({
              id: m.id,
              clave: m.clave,
              nombre: m.nombre,
              unidadBase: m.unidadBase,
              dosisMin: Number(m.dosisMin),
              dosisMax: Number(m.dosisMax),
              dosisDefault: Number(m.dosisDefault),
              altoRiesgo: m.altoRiesgo,
              precaucion: m.precaucion,
              mensaje: m.mensaje,
              activo: m.activo,
              esOverrideTenant: m.organizationId !== null,
            })),
          };
        });
      }),

      /** Panel de configuración — editar una fila GLOBAL materializa el override del tenant. */
      updateProcedimiento: trConfigProc.input(trProcedimientoUpdateInput).mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const row = await tx.trProcedimiento.findFirst({
            where: {
              id: input.id,
              OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
            },
          });
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Procedimiento no encontrado." });
          const { id: _id, ...patch } = input;
          const data = {
            ...(patch.nombre !== undefined && { nombre: patch.nombre }),
            ...(patch.tarifaBase !== undefined && { tarifaBase: patch.tarifaBase }),
            ...(patch.tiempoEstandarMin !== undefined && { tiempoEstandarMin: patch.tiempoEstandarMin }),
            ...(patch.requiereConsentimiento !== undefined && {
              requiereConsentimiento: patch.requiereConsentimiento,
            }),
            ...(patch.delegablePorProtocolo !== undefined && {
              delegablePorProtocolo: patch.delegablePorProtocolo,
            }),
            ...(patch.activo !== undefined && { activo: patch.activo }),
          };
          if (row.organizationId !== null) {
            return tx.trProcedimiento.update({ where: { id: row.id }, data });
          }
          // Fila global: se copia como override del tenant (la global queda intacta).
          const { id: _rowId, createdAt: _c, updatedAt: _u, aerosolConfig, ...base } = row;
          return tx.trProcedimiento.create({
            data: {
              ...base,
              aerosolConfig:
                aerosolConfig === null ? Prisma.DbNull : (aerosolConfig as Prisma.InputJsonValue),
              ...data,
              organizationId: ctx.tenant.organizationId,
            },
          });
        });
      }),

      updateMedicamento: trConfigProc.input(trMedicamentoUpdateInput).mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const row = await tx.trMedicamentoInhalado.findFirst({
            where: {
              id: input.id,
              OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
            },
          });
          if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Medicamento no encontrado." });
          if (
            (input.dosisMin ?? Number(row.dosisMin)) > (input.dosisMax ?? Number(row.dosisMax))
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La dosis mínima no puede superar la dosis máxima.",
            });
          }
          const { id: _id, ...patch } = input;
          const data = {
            ...(patch.nombre !== undefined && { nombre: patch.nombre }),
            ...(patch.dosisMin !== undefined && { dosisMin: patch.dosisMin }),
            ...(patch.dosisMax !== undefined && { dosisMax: patch.dosisMax }),
            ...(patch.dosisDefault !== undefined && { dosisDefault: patch.dosisDefault }),
            ...(patch.altoRiesgo !== undefined && { altoRiesgo: patch.altoRiesgo }),
            ...(patch.precaucion !== undefined && { precaucion: patch.precaucion }),
            ...(patch.mensaje !== undefined && { mensaje: patch.mensaje }),
            ...(patch.activo !== undefined && { activo: patch.activo }),
          };
          if (row.organizationId !== null) {
            return tx.trMedicamentoInhalado.update({ where: { id: row.id }, data });
          }
          const { id: _rowId, createdAt: _c, updatedAt: _u, ...base } = row;
          return tx.trMedicamentoInhalado.create({
            data: { ...base, ...data, organizationId: ctx.tenant.organizationId },
          });
        });
      }),
    }),

    /** SLA parametrizable por prioridad (espejo lis.sla / imagingRequest.sla). */
    sla: router({
      list: tenantProcedure.query(async ({ ctx }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const rows = await tx.trSlaConfig.findMany({
            where: { organizationId: ctx.tenant.organizationId },
            select: { priority: true, slaMinutes: true, warningMinutes: true },
          });
          const byPriority = new Map(rows.map((r) => [r.priority, r]));
          return (["STAT", "URGENT", "ROUTINE"] as const).map((priority) => {
            const custom = byPriority.get(priority);
            const efectivo = custom ?? DEFAULT_TR_SLA[priority];
            return {
              priority,
              slaMinutes: efectivo.slaMinutes,
              warningMinutes: efectivo.warningMinutes,
              esDefault: !custom,
            };
          });
        });
      }),
      upsert: trConfigProc.input(trSlaConfigUpsertInput).mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          return tx.trSlaConfig.upsert({
            where: {
              organizationId_priority: {
                organizationId: ctx.tenant.organizationId,
                priority: input.priority,
              },
            },
            create: {
              organizationId: ctx.tenant.organizationId,
              priority: input.priority,
              slaMinutes: input.slaMinutes,
              warningMinutes: input.warningMinutes,
            },
            update: { slaMinutes: input.slaMinutes, warningMinutes: input.warningMinutes },
          });
        });
      }),
    }),

    orden: router({
      /**
       * Crea y FIRMA la orden CPOE-TR (mockup: firmarOrden). Valida server-side
       * RN-TR-31..36 contra el catálogo efectivo del tenant. Crea una CareTask
       * RESP_THERAPIST por ítem (worklist / tablero de supervisión) con SLA
       * parametrizado. NO devenga cargos: RN-TR-24 los devenga `sesion.ejecutar`.
       */
      crear: trPrescriptorProc.input(trOrdenCrearInput).mutation(async ({ ctx, input }) => {
        if (!ctx.tenant.establishmentId) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Selecciona un establecimiento antes de continuar.",
          });
        }
        const establishmentId = ctx.tenant.establishmentId;

        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const organizationId = ctx.tenant.organizationId;

          const account = await tx.patientAccount.findFirst({
            where: { id: input.cuentaId, organizationId },
            select: { id: true, patientId: true, encounterId: true },
          });
          if (!account) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de paciente no encontrada." });
          }

          // Catálogo efectivo (tenant override > global), solo activos.
          const procRows = await tx.trProcedimiento.findMany({
            where: { OR: [{ organizationId: null }, { organizationId }] },
          });
          const procByCodigo = new Map(
            catalogoEfectivo(procRows)
              .filter((p) => p.activo)
              .map((p) => [p.codigo, p]),
          );
          const medRows = await tx.trMedicamentoInhalado.findMany({
            where: { OR: [{ organizationId: null }, { organizationId }] },
          });
          const medByClave = new Map(
            catalogoEfectivo(medRows)
              .filter((m) => m.activo)
              .map((m) => [m.clave, m]),
          );

          // RN-TR-33 — pareo indivisible: agrega el acompañante si falta.
          const codigos = new Set(input.items.map((i) => i.codigo));
          for (const codigo of [...codigos]) {
            const pareo = procByCodigo.get(codigo)?.pareoCon;
            if (pareo && !codigos.has(pareo)) {
              codigos.add(pareo);
              input.items.push({ codigo: pareo });
            }
          }
          if (codigos.has("TR-OXI-01") && codigos.has("TR-OXI-03")) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "La sección de Oxigenoterapia admite una sola elección: bajo flujo O alto flujo, no ambos.",
            });
          }

          // Resolver y validar cada ítem contra el catálogo.
          const itemsResueltos = input.items.map((i) => {
            const proc = procByCodigo.get(i.codigo);
            if (!proc) {
              throw new TRPCError({
                code: "NOT_FOUND",
                message: `El procedimiento ${i.codigo} no existe o está retirado del catálogo activo.`,
              });
            }
            if (proc.seccionOrden === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${proc.codigo} no se ofrece desde la orden CPOE-TR (flujo de worklist/UCI).`,
              });
            }
            return { input: i, proc };
          });

          const deSeccion = (n: number) => itemsResueltos.filter((r) => r.proc.seccionOrden === n);

          // RN-TR-32/35 — declaración por sección, exactamente una de dos.
          const secciones = [
            { key: "oxigenoterapia" as const, n: 1, nombre: "Oxigenoterapia" },
            { key: "aerosolterapia" as const, n: 2, nombre: "Aerosolterapia" },
            {
              key: "seccion3" as const,
              n: 3,
              nombre: "Fisioterapia respiratoria · Vía aérea · Pruebas funcionales",
            },
          ];
          for (const s of secciones) {
            const declarada = input.declaraciones[s.key];
            const nItems = deSeccion(s.n).length;
            if (declarada === "NO_REQUIERE" && nItems > 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La sección «${s.nombre}» está declarada como no requerida pero trae procedimientos seleccionados.`,
              });
            }
            if (declarada === "SELECCIONADA" && nItems === 0) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Debe seleccionar al menos una opción válida en la sección de «${s.nombre}», o bien marcar su casilla de no requerido.`,
              });
            }
          }

          // RF-TR-E114 — aerosolterapia de selección única.
          if (deSeccion(2).length > 1) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "La orden admite un solo procedimiento de aerosolterapia a la vez.",
            });
          }

          // RN-TR-34 — meta de saturación obligatoria con oxigenoterapia.
          const oxiSeleccionada = input.declaraciones.oxigenoterapia === "SELECCIONADA";
          if (oxiSeleccionada) {
            if (!input.meta) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "La meta de saturación es obligatoria en oxigenoterapia.",
              });
            }
            if (input.meta.tipo === "OTRO") {
              const { min, max, justificacion } = input.meta;
              if (min == null || max == null || min < 70 || max > 100 || min >= max) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "Capture un rango válido de saturación (mínimo menor que máximo, entre 70 % y 100 %).",
                });
              }
              if ((justificacion ?? "").trim().length < 15) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message:
                    "La justificación clínica es obligatoria cuando la meta se aparta de las metas institucionales.",
                });
              }
            }
          } else if (input.meta) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No corresponde meta de saturación cuando el paciente no requiere oxigenoterapia.",
            });
          }

          // RN-TR-36 — bloque de medicamento dependiente del procedimiento.
          for (const { input: item, proc } of itemsResueltos) {
            const cfg = (proc.aerosolConfig as TrAerosolConfig | null) ?? null;
            if (!cfg) {
              if (item.medicamento) {
                throw new TRPCError({
                  code: "BAD_REQUEST",
                  message: `${proc.codigo} no admite bloque de medicamento.`,
                });
              }
              continue;
            }
            if (!item.medicamento) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${proc.codigo} requiere el bloque de medicamento (principio activo, dosis y diluyente).`,
              });
            }
            const med = medByClave.get(item.medicamento.clave);
            if (!med || !cfg.meds.includes(item.medicamento.clave)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `El principio activo no es válido para ${proc.codigo}.`,
              });
            }
            const nombreCorto = med.nombre.split(" — ")[0]!;
            const { dosis, unidad, diluyente } = item.medicamento;
            const dosisMax = Number(med.dosisMax);
            const dosisMin = Number(med.dosisMin);
            // Bloqueo duro del REQ §6.3 (incidente «Tropium 0.5 g»).
            if (unidad === "g") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Unidad no válida para un medicamento inhalado. Use miligramos o microgramos. Dosis habitual de ${nombreCorto}: ${dosisMax} mg (${dosisMax * 1000} µg).`,
              });
            }
            const base = med.unidadBase;
            if (unidad !== base && !(base === "mg" && unidad === "µg")) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `${nombreCorto} se dosifica en ${base}. Cambie la unidad a ${base}.`,
              });
            }
            const eq = base === "mg" && unidad === "µg" ? dosis / 1000 : dosis;
            if (eq > dosisMax * 2) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Dosis por encima del máximo permitido de ${nombreCorto} (${dosisMax} ${base}). No es posible firmar la orden.`,
              });
            }
            if (eq < dosisMin * 0.5) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Dosis por debajo del rango habitual de ${nombreCorto} (${dosisMin} a ${dosisMax} ${base}). Requiere justificación del prescriptor.`,
              });
            }
            // RF-TR-E118 — diluyente de lista cerrada.
            if (!cfg.diluyentes.includes(diluyente)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `El diluyente debe elegirse de la lista parametrizada de ${proc.codigo}.`,
              });
            }
          }

          // Tipo legacy derivado (columna NOT NULL del modelo §21).
          const type =
            deSeccion(1).length > 0
              ? ("OXYGEN_THERAPY" as const)
              : deSeccion(2).length > 0
                ? ("AEROSOL" as const)
                : ("CHEST_PHYSIO" as const);

          const now = new Date();
          const orden = await tx.respiratoryOrder.create({
            data: {
              organizationId,
              encounterId: account.encounterId ?? null,
              patientId: account.patientId,
              prescriberId: ctx.user.id,
              type,
              status: "ACTIVE",
              startedAt: now,
              expiresAt: input.vigenciaHoras
                ? new Date(now.getTime() + input.vigenciaHoras * 60 * 60 * 1000)
                : null,
              createdBy: ctx.user.id,
              patientAccountId: account.id,
              dxCodigo: input.dxCodigo,
              dxDescripcion: input.dxDescripcion,
              prioridad: input.prioridad,
              metaSaturacion: oxiSeleccionada ? (input.meta?.tipo ?? null) : null,
              metaMin: input.meta?.tipo === "OTRO" ? input.meta.min : null,
              metaMax: input.meta?.tipo === "OTRO" ? input.meta.max : null,
              metaJustificacion:
                input.meta?.tipo === "OTRO" ? (input.meta.justificacion?.trim() ?? null) : null,
              declaraciones: input.declaraciones,
              esCpoeTr: true,
              vigenciaHoras: input.vigenciaHoras,
              firmadoEn: now,
              notes: input.observaciones ?? null,
            },
          });

          // Ítems + tareas de supervisión (una CareTask RESP_THERAPIST por
          // sesión, SLA parametrizado TrSlaConfig). El cargo NO se devenga
          // aquí (RN-TR-24: al ejecutar la sesión).
          const slaMap = await resolveTrSlaMap(tx, organizationId);
          const sla = slaMap[input.prioridad as LabPriorityKey] ?? slaMap.ROUTINE;
          const dueAt = new Date(Date.now() + sla.slaMinutes * 60_000);
          const serviceUnit = await tx.serviceUnit.findFirst({
            where: { establishmentId, areaType: "TERAPIA_RESPIRATORIA", active: true },
            select: { id: true },
          });

          const itemsCreados: { id: string; codigo: string; nombre: string }[] = [];
          let primeraTareaId: string | null = null;
          for (const { input: item, proc } of itemsResueltos) {
            const medSnapshot = item.medicamento
              ? {
                  ...item.medicamento,
                  nombre: medByClave.get(item.medicamento.clave)?.nombre ?? item.medicamento.clave,
                }
              : null;
            const creado = await tx.respiratoryOrderItem.create({
              data: {
                orderId: orden.id,
                procedimientoCodigo: proc.codigo,
                procedimientoNombre: proc.nombre,
                seccionOrden: proc.seccionOrden,
                medicamento: medSnapshot ?? undefined,
                estado: "PROGRAMADA",
              },
            });
            itemsCreados.push({ id: creado.id, codigo: proc.codigo, nombre: proc.nombre });

            const tarea = await tx.careTask.create({
              data: {
                organizationId,
                establishmentId,
                serviceUnitId: serviceUnit?.id ?? null,
                assignedRoleCode: "RESP_THERAPIST",
                patientId: account.patientId,
                encounterId: account.encounterId ?? null,
                patientAccountId: account.id,
                sourceType: "TR_ORDEN_ITEM",
                sourceId: creado.id,
                taskType: "TR_EJECUTAR",
                title: `${proc.codigo} · ${proc.nombre}`.slice(0, 200),
                priority:
                  CARE_TASK_PRIORITY_BY_LAB_PRIORITY[input.prioridad as LabPriorityKey] ?? "NORMAL",
                slaMinutes: sla.slaMinutes,
                dueAt,
                status: "PENDIENTE",
                createdBy: ctx.user.id,
              },
            });
            primeraTareaId ??= tarea.id;
          }

          // CC-0031 — UNA notificación por orden (no por sesión). Best-effort.
          if (primeraTareaId) {
            try {
              await emitDomainEvent(tx, {
                organizationId,
                eventType: "task.action_required",
                aggregateType: "CareTask",
                aggregateId: primeraTareaId,
                emittedById: ctx.user.id,
                payload: {
                  taskType: "TR_EJECUTAR",
                  sourceType: "TR_ORDEN_ITEM",
                  sourceId: itemsCreados[0]!.id,
                  assignedRoleCode: "RESP_THERAPIST",
                  establishmentId,
                  serviceUnitId: serviceUnit?.id ?? null,
                  dueAt: dueAt.toISOString(),
                  url: "/respiratory?vista=worklist",
                  resumen: `Orden de terapia respiratoria: ${itemsCreados.length} sesión(es) programada(s)`,
                },
              });
            } catch (err) {
              console.error(
                `[CC-0042 tr.orden.crear] emitDomainEvent(task.action_required) falló para la orden ${orden.id} — ` +
                  "las tareas se crearon igual, solo no se emitió la notificación.",
                err,
              );
            }
          }

          return { id: orden.id, items: itemsCreados };
        });
      }),

      listarPorCuenta: tenantProcedure.input(trOrdenListarPorCuentaInput).query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const ordenes = await tx.respiratoryOrder.findMany({
            where: {
              patientAccountId: input.cuentaId,
              organizationId: ctx.tenant.organizationId,
              esCpoeTr: true,
            },
            include: { items: { select: { estado: true } } },
            orderBy: { startedAt: "desc" },
          });
          return ordenes.map((o) => ({
            id: o.id,
            fecha: o.startedAt,
            dx: o.dxCodigo ? `${o.dxCodigo} — ${o.dxDescripcion ?? ""}` : null,
            prioridad: o.prioridad ?? "ROUTINE",
            status: o.status,
            metaSaturacion: o.metaSaturacion,
            nSesiones: o.items.length,
            ejecutadas: o.items.filter((i) => i.estado === "EJECUTADA").length,
            pendientes: o.items.filter((i) => i.estado === "PROGRAMADA").length,
          }));
        });
      }),

      detalle: tenantProcedure.input(trOrdenDetalleInput).query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const o = await tx.respiratoryOrder.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
            include: {
              items: { orderBy: { createdAt: "asc" } },
              patient: { select: { firstName: true, lastName: true, expediente: true, mrn: true } },
            },
          });
          if (!o) throw new TRPCError({ code: "NOT_FOUND" });
          return o;
        });
      }),
    }),

    sesion: router({
      /**
       * Cierra una sesión del worklist. EJECUTADA ⇒ devenga el cargo a la
       * cuenta (RN-TR-24: capturarCargo, precio por lista del tipo de cuenta
       * con fallback a la tarifa base del catálogo) y cumple su CareTask.
       * NO_EJECUTADA ⇒ causa codificada obligatoria, SIN cargo, tarea cancelada.
       */
      ejecutar: trEjecutorProc.input(trSesionEjecutarInput).mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const item = await tx.respiratoryOrderItem.findFirst({
            where: {
              id: input.itemId,
              order: { organizationId: ctx.tenant.organizationId },
            },
            include: {
              order: {
                select: { id: true, patientId: true, encounterId: true, patientAccountId: true, status: true },
              },
            },
          });
          if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Sesión no encontrada." });
          if (item.estado !== "PROGRAMADA") {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Solo se puede cerrar una sesión PROGRAMADA. Estado actual: '${item.estado}'.`,
            });
          }
          if (item.order.status !== "ACTIVE") {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "La orden ya no está activa (vencida, completada o cancelada).",
            });
          }

          const now = new Date();
          let cargoId: string | null = null;
          let cargoStatus: "VIGENTE" | "PENDIENTE_TARIFA" | null = null;
          let unitPrice: number | null = null;

          if (input.resultado === "EJECUTADA") {
            // RN-TR-24 — el cargo nace de la EJECUCIÓN, en la misma tx.
            const cargo = await capturarCargo(tx, {
              organizationId: ctx.tenant.organizationId,
              patientId: item.order.patientId,
              encounterId: item.order.encounterId,
              accountId: item.order.patientAccountId,
              code: item.procedimientoCodigo,
              descripcion: item.procedimientoNombre,
              quantity: 1,
              origen: "TERAPIA_RESPIRATORIA",
              referenciaId: item.id,
              actorId: ctx.user.id,
            });
            cargoId = cargo.cargoId;
            cargoStatus = cargo.status;
            unitPrice = cargo.unitPrice;
          }

          await tx.respiratoryOrderItem.update({
            where: { id: item.id },
            data: {
              estado: input.resultado,
              ejecutadaEn: now,
              ejecutadaPor: ctx.user.id,
              causaNoEjecucion: input.resultado === "NO_EJECUTADA" ? input.causaNoEjecucion : null,
              observaciones: input.observaciones ?? null,
              cargoId,
            },
          });

          // Sincroniza la tarea de supervisión de la sesión.
          await tx.careTask.updateMany({
            where: {
              sourceType: "TR_ORDEN_ITEM",
              sourceId: item.id,
              status: { in: ["PENDIENTE", "EN_PROCESO"] },
            },
            data:
              input.resultado === "EJECUTADA"
                ? { status: "CUMPLIDA", completedById: ctx.user.id, completedAt: now }
                : { status: "CANCELADA", cancelReason: input.causaNoEjecucion ?? "No ejecutada" },
          });

          return { ok: true as const, cargoId, cargoStatus, unitPrice };
        });
      }),
    }),

    /**
     * Worklist / tablero de supervisión del área (espejo CC-0040/41): un row
     * por sesión con semáforo SLA. Vista de área — no requiere cuenta.
     */
    supervision: tenantProcedure.input(trSupervisionInput).query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const items = await tx.respiratoryOrderItem.findMany({
          where: {
            order: { organizationId: ctx.tenant.organizationId, esCpoeTr: true },
            estado: input.incluirCompletados
              ? { not: "CANCELADA" }
              : { in: ["PROGRAMADA"] },
          },
          include: {
            order: {
              select: {
                id: true,
                prioridad: true,
                startedAt: true,
                encounterId: true,
                dxCodigo: true,
                patient: { select: { firstName: true, lastName: true, expediente: true, mrn: true } },
              },
            },
          },
          orderBy: [{ createdAt: "desc" }],
          take: input.limit,
        });

        // numeroCuenta vía PatientAccount (columna sin relación Prisma).
        const accountIds = [
          ...new Set(
            (
              await tx.respiratoryOrder.findMany({
                where: { id: { in: items.map((i) => i.orderId) } },
                select: { id: true, patientAccountId: true },
              })
            ).map((o) => [o.id, o.patientAccountId] as const),
          ),
        ];
        const accountByOrder = new Map(accountIds);
        const cuentas = await tx.patientAccount.findMany({
          where: { id: { in: [...accountByOrder.values()].filter((v): v is string => !!v) } },
          select: { id: true, numeroCuenta: true },
        });
        const numeroByAccount = new Map(cuentas.map((c) => [c.id, c.numeroCuenta]));

        const tareas = await tx.careTask.findMany({
          where: { sourceType: "TR_ORDEN_ITEM", sourceId: { in: items.map((i) => i.id) } },
          select: { sourceId: true, status: true, dueAt: true, slaMinutes: true, completedAt: true },
        });
        const tareaByItem = new Map(tareas.map((t) => [t.sourceId, t]));
        const slaMap = await resolveTrSlaMap(tx, ctx.tenant.organizationId);
        const now = Date.now();

        let rows = items.map((i) => {
          const tarea = tareaByItem.get(i.id) ?? null;
          const prioridad = ((i.order.prioridad ?? "ROUTINE") as LabPriorityKey) ?? "ROUTINE";
          const sla = slaMap[prioridad] ?? slaMap.ROUTINE;
          const terminado = i.estado === "EJECUTADA" || i.estado === "NO_EJECUTADA";
          const finAt = i.ejecutadaEn ?? tarea?.completedAt ?? null;
          const dueAt =
            tarea?.dueAt ?? new Date(i.order.startedAt.getTime() + sla.slaMinutes * 60_000);

          let slaEstado: LabSlaEstado;
          if (i.estado === "NO_EJECUTADA") {
            // Gris del mockup: cerrada con causa, sin cargo — se reporta como
            // cumplida a tiempo del lado del semáforo (no vence ni computa fuga).
            slaEstado = "CUMPLIDO_A_TIEMPO";
          } else if (terminado || tarea?.status === "CUMPLIDA") {
            slaEstado =
              finAt && finAt.getTime() > dueAt.getTime() ? "CUMPLIDO_TARDE" : "CUMPLIDO_A_TIEMPO";
          } else if (now > dueAt.getTime()) {
            slaEstado = "VENCIDO";
          } else if (now > dueAt.getTime() - sla.warningMinutes * 60_000) {
            slaEstado = "POR_VENCER";
          } else {
            slaEstado = "EN_TIEMPO";
          }

          const accountId = accountByOrder.get(i.orderId) ?? null;
          return {
            itemId: i.id,
            orderId: i.order.id,
            procedimiento: `${i.procedimientoCodigo} · ${i.procedimientoNombre}`,
            codigo: i.procedimientoCodigo,
            medicamento: i.medicamento as Record<string, unknown> | null,
            paciente: {
              nombre: `${i.order.patient.firstName} ${i.order.patient.lastName}`.trim(),
              expediente: i.order.patient.expediente ?? i.order.patient.mrn,
            },
            cuenta: accountId ? (numeroByAccount.get(accountId) ?? null) : null,
            atencion: i.order.encounterId ? ("HOSPITALARIO" as const) : ("AMBULATORIO" as const),
            dx: i.order.dxCodigo,
            prioridad,
            estado: i.estado,
            causaNoEjecucion: i.causaNoEjecucion,
            slaEstado,
            dueAt,
            ejecutadaEn: i.ejecutadaEn,
            cargoId: i.cargoId,
          };
        });

        const search = input.search?.trim().toLowerCase();
        if (search) {
          rows = rows.filter(
            (r) =>
              r.paciente.nombre.toLowerCase().includes(search) ||
              (r.paciente.expediente ?? "").toLowerCase().includes(search) ||
              (r.cuenta ?? "").toLowerCase().includes(search) ||
              r.procedimiento.toLowerCase().includes(search),
          );
        }
        if (input.slaEstado) rows = rows.filter((r) => r.slaEstado === input.slaEstado);

        const kpis = {
          total: rows.length,
          programadas: rows.filter((r) => r.estado === "PROGRAMADA").length,
          ejecutadas: rows.filter((r) => r.estado === "EJECUTADA").length,
          noEjecutadas: rows.filter((r) => r.estado === "NO_EJECUTADA").length,
          porVencer: rows.filter((r) => r.slaEstado === "POR_VENCER").length,
          vencidas: rows.filter((r) => r.slaEstado === "VENCIDO").length,
        };

        return { kpis, rows };
      });
    }),
  }),

  order: router({
    list: tenantProcedure
      .input(respiratoryOrderListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.respiratoryOrder.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              ...(input.encounterId && { encounterId: input.encounterId }),
              ...(input.patientId && { patientId: input.patientId }),
              ...(input.status && { status: input.status }),
              ...(input.type && { type: input.type }),
            },
            include: {
              patient: {
                select: { id: true, firstName: true, lastName: true, mrn: true },
              },
              prescriber: { select: { id: true, fullName: true } },
            },
            orderBy: { startedAt: "desc" },
            take: input.limit,
          }),
        );
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.respiratoryOrder.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId },
          }),
        );
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(respiratoryOrderCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const enc = await tx.encounter.findFirst({
            where: {
              id: input.encounterId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true, patientId: true },
          });
          if (!enc) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Encuentro no existe en la organización.",
            });
          }
          if (enc.patientId !== input.patientId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "patientId no coincide con encounter.",
            });
          }

          const now = new Date();
          const expiresAt = input.expiresAt ?? new Date(now.getTime() + ORDER_DEFAULT_DURATION_MS);

          return tx.respiratoryOrder.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              encounterId: input.encounterId,
              patientId: input.patientId,
              prescriberId: input.prescriberId,
              type: input.type,
              flowRate: input.flowRate ?? null,
              fio2: input.fio2 ?? null,
              notes: input.notes ?? null,
              startedAt: now,
              expiresAt,
              createdBy: ctx.user.id,
            },
          });
        });
      }),

    complete: tenantProcedure
      .input(respiratoryOrderCompleteInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const updated = await tx.respiratoryOrder.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["ACTIVE", "ON_HOLD"] },
            },
            data: {
              status: "COMPLETED",
              endedAt: new Date(),
              updatedBy: ctx.user.id,
            },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no existe o ya está cerrada.",
            });
          }
          return { ok: true as const };
        });
      }),

    cancel: tenantProcedure
      .input(respiratoryOrderCancelInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const updated = await tx.respiratoryOrder.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              status: { in: ["ACTIVE", "ON_HOLD"] },
            },
            data: {
              status: "CANCELLED",
              endedAt: new Date(),
              updatedBy: ctx.user.id,
            },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden no existe o ya está cerrada.",
            });
          }
          return { ok: true as const };
        });
      }),

    /** Beta.12 — renew: sets renewedAt = now() and expiresAt = now() + 24 h. */
    renew: tenantProcedure
      .input(respiratoryOrderRenewInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const now = new Date();
          const updated = await tx.respiratoryOrder.updateMany({
            where: {
              id: input.id,
              organizationId: ctx.tenant.organizationId,
              status: "ACTIVE",
            },
            data: {
              renewedAt: now,
              expiresAt: new Date(now.getTime() + ORDER_DEFAULT_DURATION_MS),
              updatedBy: ctx.user.id,
            },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden activa no encontrada.",
            });
          }
          return { ok: true as const };
        });
      }),

    /** Beta.12 — returns ACTIVE orders past expiresAt without renewal. */
    getExpired: tenantProcedure
      .input(getExpiredOrdersInput)
      .query(async ({ ctx, input }) => {
        const asOf = input.asOf ?? new Date();
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.respiratoryOrder.findMany({
            where: buildExpiredWhereClause(
              input.organizationId ?? ctx.tenant.organizationId,
              asOf,
            ),
            orderBy: { expiresAt: "asc" },
            take: input.limit,
          }),
        );
      }),
  }),

  ventilator: router({
    list: tenantProcedure
      .input(ventilatorSessionListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.ventilatorSession.findMany({
            where: {
              order: { organizationId: ctx.tenant.organizationId },
              ...(input.orderId && { orderId: input.orderId }),
              ...(input.statusSM && { statusSM: input.statusSM }),
            },
            orderBy: { startedAt: "desc" },
            take: input.limit,
          }),
        );
      }),

    /**
     * Beta.12: validates vent params within safe medical ranges before persisting.
     */
    create: tenantProcedure
      .input(ventilatorSessionCreateInput)
      .mutation(async ({ ctx, input }) => {
        assertVentParamsInRange({
          peep: input.peep,
          fio2: input.fio2,
          rrSet: input.rrSet,
          tidalVolume: input.tidalVolume,
        });

        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.respiratoryOrder.findFirst({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
              type: "MECHANICAL_VENT",
              status: "ACTIVE",
            },
            select: { id: true },
          });
          if (!order) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden de ventilación mecánica activa no encontrada.",
            });
          }

          return tx.ventilatorSession.create({
            data: {
              orderId: input.orderId,
              mode: input.mode,
              tidalVolume: input.tidalVolume ?? null,
              rrSet: input.rrSet ?? null,
              peep: input.peep ?? null,
              fio2: input.fio2 ?? null,
              patientWeightKg: input.patientWeightKg ?? null,
              notes: input.notes ?? null,
            },
          });
        });
      }),

    end: tenantProcedure
      .input(ventilatorSessionEndInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const updated = await tx.ventilatorSession.updateMany({
            where: {
              id: input.id,
              order: { organizationId: ctx.tenant.organizationId },
              endedAt: null,
            },
            data: { endedAt: new Date() },
          });
          if (updated.count === 0) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Sesión no existe o ya finalizada.",
            });
          }
          return { ok: true as const };
        });
      }),

    /** Beta.12 — advance state machine with graph validation. */
    transition: tenantProcedure
      .input(ventilatorSessionTransitionInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const session = await tx.ventilatorSession.findFirst({
            where: {
              id: input.id,
              order: { organizationId: ctx.tenant.organizationId },
            },
            select: { id: true, statusSM: true, endedAt: true },
          });

          if (!session) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Sesión de ventilación no encontrada." });
          }
          if (session.endedAt !== null) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "No se puede transicionar una sesión ya finalizada.",
            });
          }

          assertTransitionAllowed(session.statusSM as VentilatorStatus, input.to as VentilatorStatus);

          return tx.ventilatorSession.update({
            where: { id: input.id },
            data: {
              statusSM: input.to,
              notes: input.notes ?? undefined,
            },
          });
        });
      }),
  }),

  gas: router({
    list: tenantProcedure
      .input(medicalGasUsageListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.medicalGasUsage.findMany({
            where: {
              order: { organizationId: ctx.tenant.organizationId },
              ...(input.orderId && { orderId: input.orderId }),
              ...(input.gasType && { gasType: input.gasType }),
              ...((input.fromDate || input.toDate) && {
                measuredAt: {
                  ...(input.fromDate && { gte: input.fromDate }),
                  ...(input.toDate && { lte: input.toDate }),
                },
              }),
            },
            orderBy: { measuredAt: "desc" },
            take: input.limit,
          }),
        );
      }),

    /**
     * Append-only create; no update/delete mutations exposed.
     * DB trigger (36_respiratory_hardening.sql) also blocks UPDATE/DELETE.
     */
    create: tenantProcedure
      .input(medicalGasUsageCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const order = await tx.respiratoryOrder.findFirst({
            where: {
              id: input.orderId,
              organizationId: ctx.tenant.organizationId,
            },
            select: { id: true },
          });
          if (!order) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Orden respiratoria no existe en la organización.",
            });
          }
          return tx.medicalGasUsage.create({
            data: {
              orderId: input.orderId,
              gasType: input.gasType,
              volumeLiters: input.volumeLiters,
              recordedById: ctx.user.id,
              notes: input.notes ?? null,
            },
          });
        });
      }),
  }),
});
