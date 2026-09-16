/**
 * Router tRPC — Motor de agenda (CC-0036 Ola 3, REQ-HIS-AFIL-001 S3,
 * US.AGE.2.1 / US.AGE.2.2 / US.AGE.2.3). sql/246_cc0036_agenda_core.sql.
 *
 * D4 (no reabrir): disponibilidad DERIVADA por `fn_agenda_disponibilidad`
 * (SQL, NO SECURITY DEFINER — ver cabecera sql/246) — sin tabla de slots.
 *
 * `OutpatientAppointment` NO se altera en esta ola (el ALTER + EXCLUDE de
 * citas es Ola 4/S4). Toda lectura de citas existentes (validación de
 * excepción AC2, disponibilidad paso 5) usa exclusivamente las columnas YA
 * existentes: `providerId`/`scheduledAt`/`durationMinutes`/`status`. El
 * "provider vinculado" de una agenda es `MedicoAfiliado.userId` — si el
 * afiliado no tiene cuenta HIS (D5 del REQ: puede no tenerla), no hay bridge
 * posible todavía y esas comprobaciones simplemente no encuentran citas
 * (documentado también en el comentario de la función SQL).
 *
 * ABAC (REQ §7.3.1) — SECRETARIA_MEDICO_AFILIADO / MEDICO_AFILIADO solo ven
 * agendas de SU médico afiliado. El campo `$user.medicoAfiliadoId` NO existe
 * todavía en `TenantContext` (ver docstring de medico-afiliado.router.ts —
 * deliberadamente diferido hasta la ola del portal, `getTenantContext()` es
 * `cache()`-envuelto y central a 52+ consumidores). Equivalente funcional
 * HASTA esa ola: `resolveMedicoAfiliadoScope` resuelve los
 * `MedicoAfiliado.id` cuyo `userId = ctx.user.id` y filtra por ahí. Un
 * usuario con esos roles que ADEMÁS tenga un rol cross (ADMIN/DIR/
 * ADMIN_CONSULTORIOS) no se acota — mismo criterio "backward compat" que
 * `assertScopeEstablecimiento` en turno.router.ts.
 *
 * Hook de mora (US.AGE.2.1 AC6) — el `estado` SUSPENDIDA por contrato
 * TERMINADO/EN_MORA es un valor DERIVADO calculado en cada lectura
 * (`estadoEfectivo`), NUNCA persistido por un job. `publicar` bloquea si el
 * contrato asociado no está en condición de generar nuevos cupos;
 * `disponibilidad` devuelve cero slots (con el estado efectivo visible) sin
 * borrar la configuración ni las citas ya reservadas.
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@his/database";
import {
  agendaListSchema,
  agendaGetSchema,
  agendaCreateSchema,
  agendaUpdateSchema,
  agendaPublicarSchema,
  agendaSuspenderSchema,
  agendaReactivarSchema,
  agendaHorarioListSchema,
  agendaHorarioCreateSchema,
  agendaHorarioDeleteSchema,
  agendaExcepcionListSchema,
  agendaExcepcionCreateSchema,
  agendaExcepcionDeleteSchema,
  agendaDisponibilidadSchema,
} from "@his/contracts";
import type { TenantContext, AppointmentStatusType } from "@his/contracts";
import { router, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";

const leerProc = requirePermission("agenda.leer");
const configurarProc = requirePermission("agenda.configurar");
const publicarProc = requirePermission("agenda.publicar");

/** Estados de `ContratoArrendamiento` que fuerzan `estadoEfectivo = SUSPENDIDA` (AC6). */
export const CONTRATOS_SUSPENSIVOS: readonly string[] = ["TERMINADO", "EN_MORA"];
const ROLES_MEDICO_SCOPE: readonly string[] = ["SECRETARIA_MEDICO_AFILIADO", "MEDICO_AFILIADO"];
const ROLES_SIN_SCOPE: readonly string[] = ["ADMIN", "DIR", "ADMIN_CONSULTORIOS"];

const DIA_SEMANA_LABEL: readonly string[] = [
  "domingo",
  "lunes",
  "martes",
  "miércoles",
  "jueves",
  "viernes",
  "sábado",
];

const CITAS_ACTIVAS: readonly AppointmentStatusType[] = ["SCHEDULED", "CONFIRMED", "CHECKED_IN"];

// ---------------------------------------------------------------------------
// Helpers de hora — idénticos a contrato.router.ts/turno.router.ts (no se
// exportan desde ahí, ver docstring de ese archivo sobre por qué se duplican).
// ---------------------------------------------------------------------------

function toTimeColumnValue(hhmm: string): Date {
  const conSegundos = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`1970-01-01T${conSegundos}.000Z`);
}

function toMinutes(hora: Date): number {
  return hora.getUTCHours() * 60 + hora.getUTCMinutes();
}

// ---------------------------------------------------------------------------
// Estado efectivo (AC6) — derivado en cada lectura, nunca persistido.
// ---------------------------------------------------------------------------

export function estadoEfectivo(estadoAgenda: string, estadoContrato: string | null | undefined): string {
  if (estadoContrato && CONTRATOS_SUSPENSIVOS.includes(estadoContrato)) return "SUSPENDIDA";
  return estadoAgenda;
}

// ---------------------------------------------------------------------------
// ABAC — scope de médico afiliado (ver docstring del router).
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// US.AGE.2.1 AC2 — el horario debe caer DENTRO de la jornada contratada
// cuando el contrato es COMPARTIDO_POR_JORNADA.
// ---------------------------------------------------------------------------

async function assertHorarioDentroDeJornada(
  tx: PrismaClient,
  params: { contratoId: string; diaSemana: number; horaInicio: string; horaFin: string },
): Promise<void> {
  const jornadas = await tx.contratoJornada.findMany({
    where: { contratoId: params.contratoId, diaSemana: params.diaSemana },
    select: { horaInicio: true, horaFin: true },
    orderBy: { horaInicio: "asc" },
  });

  const nuevoInicio = toMinutes(toTimeColumnValue(params.horaInicio));
  const nuevoFin = toMinutes(toTimeColumnValue(params.horaFin));
  const diaLabel = DIA_SEMANA_LABEL[params.diaSemana];

  if (jornadas.length === 0) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `El médico no tiene jornada contratada los ${diaLabel} para este consultorio.`,
    });
  }

  // Fusiona jornadas contiguas/solapadas del mismo día antes de exigir
  // contención completa (mismo criterio que `plantilla.cobertura` en turno.router.ts).
  const merged: Array<[number, number]> = [];
  for (const j of jornadas) {
    const s = toMinutes(j.horaInicio);
    const e = toMinutes(j.horaFin);
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) {
      last[1] = Math.max(last[1], e);
    } else {
      merged.push([s, e]);
    }
  }

  const contenido = merged.some(([s, e]) => nuevoInicio >= s && nuevoFin <= e);
  if (!contenido) {
    const primeraJornada = jornadas[0]!;
    throw new TRPCError({
      code: "CONFLICT",
      message:
        `El horario está fuera de la jornada contratada para este consultorio ` +
        `(${diaLabel} ${primeraJornada.horaInicio.toISOString().slice(11, 16)}–${primeraJornada.horaFin.toISOString().slice(11, 16)}).`,
    });
  }
}

// ---------------------------------------------------------------------------
// US.AGE.2.1 AC4 — un médico no puede estar en dos consultorios a la vez:
// no-traslape entre horarios de OTRAS agendas del mismo médico.
// ---------------------------------------------------------------------------

async function assertSinTraslapeAgendaMedico(
  tx: PrismaClient,
  params: {
    medicoAfiliadoId: string;
    diaSemana: number;
    horaInicio: string;
    horaFin: string;
    excludeAgendaId?: string;
  },
): Promise<void> {
  const nuevoInicio = toMinutes(toTimeColumnValue(params.horaInicio));
  const nuevoFin = toMinutes(toTimeColumnValue(params.horaFin));

  const horarios = await tx.agendaHorario.findMany({
    where: {
      diaSemana: params.diaSemana,
      agenda: {
        medicoAfiliadoId: params.medicoAfiliadoId,
        estado: { not: "CERRADA" },
        ...(params.excludeAgendaId ? { id: { not: params.excludeAgendaId } } : {}),
      },
    },
    select: { horaInicio: true, horaFin: true, agenda: { select: { consultorio: { select: { codigo: true } } } } },
  });

  for (const h of horarios) {
    const hInicio = toMinutes(h.horaInicio);
    const hFin = toMinutes(h.horaFin);
    if (nuevoInicio < hFin && hInicio < nuevoFin) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `El médico ya tiene un horario asignado en el consultorio ${h.agenda.consultorio.codigo} que se traslapa con este horario.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// US.AGE.2.2 AC2 — excepción sobre fecha con citas ya reservadas exige
// confirmación explícita (`forzar:true`) tras listar las citas afectadas.
// ---------------------------------------------------------------------------

interface CitaAfectada {
  id: string;
  scheduledAt: string;
  patientId: string;
}

async function findCitasAfectadas(
  tx: PrismaClient,
  params: { medicoUserId: string | null; fecha: Date; horaInicio?: string; horaFin?: string },
): Promise<CitaAfectada[]> {
  if (!params.medicoUserId) return [];

  const inicioDia = new Date(`${params.fecha.toISOString().slice(0, 10)}T00:00:00.000-06:00`);
  const finDia = new Date(`${params.fecha.toISOString().slice(0, 10)}T23:59:59.999-06:00`);

  const citas = await tx.outpatientAppointment.findMany({
    where: {
      providerId: params.medicoUserId,
      status: { in: [...CITAS_ACTIVAS] },
      deletedAt: null,
      scheduledAt: { gte: inicioDia, lte: finDia },
    },
    select: { id: true, scheduledAt: true, durationMinutes: true, patientId: true },
  });

  if (params.horaInicio === undefined) {
    return citas.map((c) => ({ id: c.id, scheduledAt: c.scheduledAt.toISOString(), patientId: c.patientId }));
  }

  const excInicio = toMinutes(toTimeColumnValue(params.horaInicio));
  const excFin = toMinutes(toTimeColumnValue(params.horaFin!));

  return citas
    .filter((c) => {
      const localHHMM = c.scheduledAt.toISOString().slice(11, 16);
      const citaInicio = toMinutes(toTimeColumnValue(localHHMM));
      const citaFin = citaInicio + c.durationMinutes;
      return citaInicio < excFin && excInicio < citaFin;
    })
    .map((c) => ({ id: c.id, scheduledAt: c.scheduledAt.toISOString(), patientId: c.patientId }));
}

const agendaInclude = {
  medicoAfiliado: { select: { id: true, nombreCompleto: true, userId: true } },
  consultorio: { select: { id: true, codigo: true, nombre: true } },
  contrato: { select: { id: true, folio: true, modalidad: true, estado: true } },
  horarios: { orderBy: [{ diaSemana: "asc" as const }, { horaInicio: "asc" as const }] },
};

export const agendaRouter = router({
  list: leerProc.input(agendaListSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);
      const rows = await tx.agendaMedico.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
          ...(input?.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
          ...(input?.consultorioId ? { consultorioId: input.consultorioId } : {}),
          ...(input?.establishmentId ? { establishmentId: input.establishmentId } : {}),
          ...(input?.specialtyId ? { specialtyId: input.specialtyId } : {}),
          ...(input?.estado ? { estado: input.estado } : {}),
        },
        include: {
          medicoAfiliado: { select: { id: true, nombreCompleto: true } },
          consultorio: { select: { id: true, codigo: true, nombre: true } },
          contrato: { select: { estado: true } },
        },
        orderBy: { createdAt: "desc" },
      });
      return rows.map((r) => ({ ...r, estadoEfectivo: estadoEfectivo(r.estado, r.contrato?.estado) }));
    });
  }),

  get: leerProc.input(agendaGetSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);
      const agenda = await tx.agendaMedico.findFirst({
        where: {
          id: input.id,
          organizationId: tenant.organizationId,
          ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
        },
        include: agendaInclude,
      });
      if (!agenda) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
      }
      return { ...agenda, estadoEfectivo: estadoEfectivo(agenda.estado, agenda.contrato?.estado) };
    });
  }),

  /** US.AGE.2.1 AC1 — exige contrato VIGENTE del médico sobre el consultorio; hereda contratoId. */
  create: configurarProc.input(agendaCreateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const consultorio = await tx.consultorio.findFirst({
        where: { id: input.consultorioId, organizationId: tenant.organizationId },
        select: { id: true, establishmentId: true, active: true },
      });
      if (!consultorio) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Consultorio no encontrado." });
      }
      if (!consultorio.active) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "El consultorio está inactivo." });
      }

      const contrato = await tx.contratoArrendamiento.findFirst({
        where: {
          organizationId: tenant.organizationId,
          medicoAfiliadoId: input.medicoAfiliadoId,
          consultorioId: input.consultorioId,
          estado: "VIGENTE",
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (!contrato) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "El médico afiliado no tiene un contrato VIGENTE sobre este consultorio.",
        });
      }

      const agenda = await tx.agendaMedico.create({
        data: {
          organizationId: tenant.organizationId,
          establishmentId: consultorio.establishmentId,
          medicoAfiliadoId: input.medicoAfiliadoId,
          consultorioId: input.consultorioId,
          contratoId: contrato.id,
          specialtyId: input.specialtyId ?? null,
          vigenciaDesde: new Date(`${input.vigenciaDesde}T00:00:00.000Z`),
          vigenciaHasta: input.vigenciaHasta ? new Date(`${input.vigenciaHasta}T00:00:00.000Z`) : null,
          duracionSlotMin: input.duracionSlotMin ?? 20,
          capacidadPorSlot: input.capacidadPorSlot ?? 1,
          sobrecupoMaximoDia: input.sobrecupoMaximoDia ?? 0,
          anticipacionMinimaHoras: input.anticipacionMinimaHoras ?? 0,
          horizonteMaximoDias: input.horizonteMaximoDias ?? 90,
          politicaCancelacionHoras: input.politicaCancelacionHoras ?? 24,
          permiteAutoagenda: input.permiteAutoagenda ?? false,
          estado: "BORRADOR",
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      return tx.agendaMedico.findFirst({ where: { id: agenda.id }, include: agendaInclude });
    });
  }),

  /** US.AGE.2.1 AC5 — cambios de configuración; `duracionSlotMin`/`capacidadPorSlot` en PUBLICADA exigen `confirmar` si hay citas futuras del médico. */
  update: configurarProc.input(agendaUpdateSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const agenda = await tx.agendaMedico.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        include: { medicoAfiliado: { select: { userId: true } } },
      });
      if (!agenda) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
      }

      const cambiaSlot =
        (input.duracionSlotMin !== undefined && input.duracionSlotMin !== agenda.duracionSlotMin) ||
        (input.capacidadPorSlot !== undefined && input.capacidadPorSlot !== agenda.capacidadPorSlot);

      if (agenda.estado === "PUBLICADA" && cambiaSlot && !input.confirmar) {
        const hoy = new Date().toISOString().slice(0, 10);
        const citasFuturas = agenda.medicoAfiliado.userId
          ? await tx.outpatientAppointment.count({
              where: {
                providerId: agenda.medicoAfiliado.userId,
                status: { in: [...CITAS_ACTIVAS] },
                deletedAt: null,
                scheduledAt: { gte: new Date(`${hoy}T00:00:00.000-06:00`) },
              },
            })
          : 0;
        if (citasFuturas > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Este cambio afecta ${citasFuturas} cita(s) futura(s) del médico. Confirma explícitamente para continuar.`,
            cause: { citasFuturasAfectadas: citasFuturas },
          });
        }
      }

      return tx.agendaMedico.update({
        where: { id: input.id },
        data: {
          ...(input.specialtyId !== undefined ? { specialtyId: input.specialtyId } : {}),
          ...(input.vigenciaHasta !== undefined
            ? { vigenciaHasta: input.vigenciaHasta ? new Date(`${input.vigenciaHasta}T00:00:00.000Z`) : null }
            : {}),
          ...(input.duracionSlotMin !== undefined ? { duracionSlotMin: input.duracionSlotMin } : {}),
          ...(input.capacidadPorSlot !== undefined ? { capacidadPorSlot: input.capacidadPorSlot } : {}),
          ...(input.sobrecupoMaximoDia !== undefined ? { sobrecupoMaximoDia: input.sobrecupoMaximoDia } : {}),
          ...(input.anticipacionMinimaHoras !== undefined
            ? { anticipacionMinimaHoras: input.anticipacionMinimaHoras }
            : {}),
          ...(input.horizonteMaximoDias !== undefined ? { horizonteMaximoDias: input.horizonteMaximoDias } : {}),
          ...(input.politicaCancelacionHoras !== undefined
            ? { politicaCancelacionHoras: input.politicaCancelacionHoras }
            : {}),
          ...(input.permiteAutoagenda !== undefined ? { permiteAutoagenda: input.permiteAutoagenda } : {}),
          updatedBy: user.id,
        },
      });
    });
  }),

  /** US.AGE.2.1 AC3/AC6 — BORRADOR -> PUBLICADA; exige >=1 horario y contrato en condición de generar cupos. */
  publicar: publicarProc.input(agendaPublicarSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const agenda = await tx.agendaMedico.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        include: { horarios: { select: { id: true } }, contrato: { select: { estado: true } } },
      });
      if (!agenda) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
      }
      if (agenda.estado !== "BORRADOR") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `La agenda está en estado ${agenda.estado}, solo se publica desde BORRADOR.`,
        });
      }
      if (agenda.horarios.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La agenda requiere al menos un horario registrado antes de publicarse.",
        });
      }
      if (agenda.contrato && CONTRATOS_SUSPENSIVOS.includes(agenda.contrato.estado)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `El contrato asociado está ${agenda.contrato.estado} — no se pueden publicar nuevos cupos.`,
        });
      }
      return tx.agendaMedico.update({
        where: { id: input.id },
        data: { estado: "PUBLICADA", updatedBy: user.id },
      });
    });
  }),

  /** Suspensión manual (independiente del derivado por mora — ver docstring). */
  suspender: configurarProc.input(agendaSuspenderSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const agenda = await tx.agendaMedico.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
      });
      if (!agenda) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
      }
      if (agenda.estado === "CERRADA") {
        throw new TRPCError({ code: "CONFLICT", message: "No se puede suspender una agenda CERRADA." });
      }
      return tx.agendaMedico.update({
        where: { id: input.id },
        data: { estado: "SUSPENDIDA", updatedBy: user.id },
      });
    });
  }),

  reactivar: configurarProc.input(agendaReactivarSchema).mutation(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    return withTenantContext(prisma, tenant, async (tx) => {
      const agenda = await tx.agendaMedico.findFirst({
        where: { id: input.id, organizationId: tenant.organizationId },
        include: { contrato: { select: { estado: true } } },
      });
      if (!agenda) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
      }
      if (agenda.estado !== "SUSPENDIDA") {
        throw new TRPCError({ code: "CONFLICT", message: "Solo se reactiva una agenda SUSPENDIDA." });
      }
      if (agenda.contrato && CONTRATOS_SUSPENSIVOS.includes(agenda.contrato.estado)) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `El contrato asociado sigue ${agenda.contrato.estado} — no se puede reactivar todavía.`,
        });
      }
      return tx.agendaMedico.update({
        where: { id: input.id },
        data: { estado: "PUBLICADA", updatedBy: user.id },
      });
    });
  }),

  horario: router({
    list: leerProc.input(agendaHorarioListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }
        return tx.agendaHorario.findMany({
          where: { agendaId: input.agendaId },
          orderBy: [{ diaSemana: "asc" }, { horaInicio: "asc" }],
        });
      });
    }),

    /** US.AGE.2.1 AC2/AC4 — jornada contratada + no-traslape entre agendas del mismo médico. */
    create: configurarProc.input(agendaHorarioCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          include: { contrato: { select: { id: true, modalidad: true } } },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }

        if (agenda.contrato && agenda.contrato.modalidad === "COMPARTIDO_POR_JORNADA") {
          await assertHorarioDentroDeJornada(tx, {
            contratoId: agenda.contrato.id,
            diaSemana: input.diaSemana,
            horaInicio: input.horaInicio,
            horaFin: input.horaFin,
          });
        }

        await assertSinTraslapeAgendaMedico(tx, {
          medicoAfiliadoId: agenda.medicoAfiliadoId,
          diaSemana: input.diaSemana,
          horaInicio: input.horaInicio,
          horaFin: input.horaFin,
          excludeAgendaId: agenda.id,
        });

        return tx.agendaHorario.create({
          data: {
            agendaId: input.agendaId,
            diaSemana: input.diaSemana,
            horaInicio: toTimeColumnValue(input.horaInicio),
            horaFin: toTimeColumnValue(input.horaFin),
            createdBy: user.id,
          },
        });
      });
    }),

    delete: configurarProc.input(agendaHorarioDeleteSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const horario = await tx.agendaHorario.findFirst({
          where: { id: input.id, agenda: { organizationId: tenant.organizationId } },
        });
        if (!horario) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Horario no encontrado." });
        }
        await tx.agendaHorario.delete({ where: { id: input.id } });
        return { id: input.id };
      });
    }),
  }),

  excepcion: router({
    list: leerProc.input(agendaExcepcionListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          select: { id: true },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }
        return tx.agendaExcepcion.findMany({
          where: {
            agendaId: input.agendaId,
            ...(input.desde ? { fecha: { gte: new Date(`${input.desde}T00:00:00.000Z`) } } : {}),
            ...(input.hasta ? { fecha: { lte: new Date(`${input.hasta}T00:00:00.000Z`) } } : {}),
          },
          orderBy: { fecha: "asc" },
        });
      });
    }),

    /** US.AGE.2.2 AC1/AC2/AC4 — citas afectadas exigen `forzar:true`. */
    create: configurarProc.input(agendaExcepcionCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          include: { medicoAfiliado: { select: { userId: true } } },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }

        if (input.tipo !== "EXTENSION" && !input.forzar) {
          const citas = await findCitasAfectadas(tx, {
            medicoUserId: agenda.medicoAfiliado.userId,
            fecha: new Date(`${input.fecha}T00:00:00.000Z`),
            horaInicio: input.horaInicio,
            horaFin: input.horaFin,
          });
          if (citas.length > 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `Hay ${citas.length} cita(s) reservada(s) en esa fecha/horario. Confirma explícitamente (reprogramar o cancelar por separado) para continuar.`,
              cause: { causas: citas },
            });
          }
        }

        return tx.agendaExcepcion.create({
          data: {
            agendaId: input.agendaId,
            fecha: new Date(`${input.fecha}T00:00:00.000Z`),
            tipo: input.tipo,
            horaInicio: input.horaInicio ? toTimeColumnValue(input.horaInicio) : null,
            horaFin: input.horaFin ? toTimeColumnValue(input.horaFin) : null,
            motivo: input.motivo,
            createdBy: user.id,
          },
        });
      });
    }),

    /** US.AGE.2.2 AC5 — eliminación auditada (createdBy en la fila + trigger de auditoría registra quién elimina). */
    delete: configurarProc.input(agendaExcepcionDeleteSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const excepcion = await tx.agendaExcepcion.findFirst({
          where: { id: input.id, agenda: { organizationId: tenant.organizationId } },
        });
        if (!excepcion) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Excepción no encontrada." });
        }
        await tx.agendaExcepcion.delete({ where: { id: input.id } });
        return { id: input.id };
      });
    }),
  }),

  /**
   * US.AGE.2.3 — disponibilidad por agenda, médico o especialidad.
   * NFR-1: p95 < 300ms (30 días, un médico) — cap de 180 días por consulta
   * como defensa adicional de performance (no especificado por el REQ, pero
   * evita consultas de rango arbitrario contra `fn_agenda_disponibilidad`).
   */
  disponibilidad: leerProc.input(agendaDisponibilidadSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma, user } = ctx;
    const desde = new Date(`${input.desde}T00:00:00.000Z`);
    const hasta = new Date(`${input.hasta}T00:00:00.000Z`);
    const diffDias = Math.round((hasta.getTime() - desde.getTime()) / 86_400_000);
    if (diffDias > 180) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Rango máximo de consulta: 180 días." });
    }

    return withTenantContext(prisma, tenant, async (tx) => {
      const scope = await resolveMedicoAfiliadoScope(tx, tenant, user.id);

      const agendas = await tx.agendaMedico.findMany({
        where: {
          organizationId: tenant.organizationId,
          ...(scope !== null ? { medicoAfiliadoId: { in: scope } } : {}),
          ...(input.agendaId ? { id: input.agendaId } : {}),
          ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
          ...(input.specialtyId ? { specialtyId: input.specialtyId } : {}),
        },
        include: {
          medicoAfiliado: { select: { id: true, nombreCompleto: true } },
          consultorio: { select: { id: true, codigo: true, nombre: true } },
          contrato: { select: { estado: true } },
        },
      });

      const resultados = await Promise.all(
        agendas.map(async (agenda) => {
          const estado = estadoEfectivo(agenda.estado, agenda.contrato?.estado);
          const hoy = new Date();
          const excedeHorizonte =
            Math.round((hasta.getTime() - hoy.getTime()) / 86_400_000) > agenda.horizonteMaximoDias;

          if (estado !== "PUBLICADA") {
            return {
              agendaId: agenda.id,
              medicoAfiliadoId: agenda.medicoAfiliado.id,
              medicoNombre: agenda.medicoAfiliado.nombreCompleto,
              consultorioId: agenda.consultorio.id,
              consultorioNombre: agenda.consultorio.nombre,
              establishmentId: agenda.establishmentId,
              estadoEfectivo: estado,
              advertencias:
                estado === "SUSPENDIDA"
                  ? ["Esta agenda está suspendida — no se publican nuevos cupos."]
                  : [],
              slots: [] as Array<{
                inicio: string;
                fin: string;
                capacidad: number;
                ocupados: number;
                disponible: number;
              }>,
            };
          }

          const slots = await tx.$queryRaw<
            Array<{ inicio: Date; fin: Date; capacidad: number; ocupados: number; disponible: number }>
          >`SELECT * FROM public.fn_agenda_disponibilidad(${agenda.id}::uuid, ${input.desde}::date, ${input.hasta}::date)`;

          return {
            agendaId: agenda.id,
            medicoAfiliadoId: agenda.medicoAfiliado.id,
            medicoNombre: agenda.medicoAfiliado.nombreCompleto,
            consultorioId: agenda.consultorio.id,
            consultorioNombre: agenda.consultorio.nombre,
            establishmentId: agenda.establishmentId,
            estadoEfectivo: estado,
            advertencias: excedeHorizonte
              ? [
                  `El rango consultado excede el horizonte de publicación de esta agenda (${agenda.horizonteMaximoDias} días).`,
                ]
              : [],
            slots: slots.map((s) => ({
              inicio: s.inicio.toISOString(),
              fin: s.fin.toISOString(),
              capacidad: s.capacidad,
              ocupados: s.ocupados,
              disponible: s.disponible,
            })),
          };
        }),
      );

      // US.AGE.2.3 AC2 — al buscar por especialidad, ordenar por proximidad
      // temporal (agendas sin cupos libres van al final).
      if (input.specialtyId && !input.medicoAfiliadoId && !input.agendaId) {
        resultados.sort((a, b) => {
          const proximoA = a.slots.find((s) => s.disponible > 0)?.inicio ?? "9999";
          const proximoB = b.slots.find((s) => s.disponible > 0)?.inicio ?? "9999";
          return proximoA.localeCompare(proximoB);
        });
      }

      return resultados;
    });
  }),
});
