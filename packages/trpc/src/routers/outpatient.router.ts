/**
 * §10 Outpatient — router con hardening layer 1 (Beta.7) + operación de
 * agenda CC-0036 Ola 4 (REQ-HIS-AFIL-001 S4, US.AGE.2.4-2.7).
 *
 * Reglas Beta.7 (legacy, sin agenda):
 *  1. State machine AppointmentStatus con transiciones validadas.
 *  2. Double-booking detection por provider al crear/reprogramar.
 *  3. No-show detection: detectNoShows (dryRun o commit).
 *  4. Consultation linked to appointment: bloquea si appointment no esta
 *     en CHECKED_IN/COMPLETED. Walk-in (appointmentId null) permitido.
 *
 * Reglas Ola 4 (agenda-aware — `reservar`/`reprogramar`/`cancelar`/`checkIn`):
 *  - Se EXTIENDE este router en vez de crear `cita.router.ts` (regla
 *    "adecuar legacy, no duplicar" — `outpatient.appointment` YA es el
 *    dominio OutpatientAppointment).
 *  - `create`/`update`/`cancel` legacy SIGUEN existiendo (citas sin agenda,
 *    walk-ins, tooling) — las mutaciones nuevas son un camino adicional para
 *    citas que sí nacen de una `AgendaMedico` publicada.
 *  - La antirreserva doble real (concurrencia) la garantiza la BD
 *    (`excl_cita_medico`/`excl_cita_consultorio`, sql/247) — la validación
 *    de disponibilidad acá es UX (mensaje temprano), no la única guarda.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  outpatientAppointmentCreateInput,
  outpatientAppointmentUpdateInput,
  outpatientAppointmentListInput,
  outpatientAppointmentCancelInput,
  noShowDetectInput,
  outpatientConsultationCreateInput,
  ALLOWED_TRANSITIONS,
  reservarCitaInput,
  reprogramarCitaInput,
  cancelarCitaInput,
  checkInCitaInput,
  revertirNoShowInput,
  completarCitaInput,
  tableroDiaInput,
  indicadoresAgendaInput,
  type AppointmentStatusType,
} from "@his/contracts";
import { Prisma, emitDomainEvent } from "@his/database";
import type { TenantContext } from "@his/contracts";
import { router, tenantProcedure, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";
import type { PrismaClient } from "@prisma/client";
import {
  isOutOfServiceUnitScope,
  serviceUnitWhereFragment,
} from "../lib/service-unit-scope";
import { estadoEfectivo } from "./agenda.router";
import { nextCuenta } from "../lib/cuenta-numbering";
import { crearEncounterAmbulatorio } from "../lib/admision-ambulatoria";
import { estimarConsulta } from "../lib/cita-estimado";

const leerProc = requirePermission("agenda.leer");
const reservarProc = requirePermission("agenda.reservar");
const reprogramarProc = requirePermission("agenda.reprogramar");
const cancelarProc = requirePermission("agenda.cancelar");

/** Estados desde los que SÍ se puede reprogramar/cancelar (AC6: COMPLETED es terminal). */
const CITA_EDITABLE: readonly AppointmentStatusType[] = ["SCHEDULED", "CONFIRMED"];

function assertCitaEditable(status: AppointmentStatusType, accion: string): void {
  if (!CITA_EDITABLE.includes(status)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `No se puede ${accion} una cita en estado ${status}.`,
    });
  }
}

/** Mapea el error de la BD (EXCLUDE/UNIQUE) a un mensaje accionable (US.AGE.2.4 AC3). */
function rethrowCupoConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "El cupo acaba de ocuparse — actualiza la disponibilidad e intenta de nuevo.",
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/exclusion/i.test(message)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "El cupo acaba de ocuparse — actualiza la disponibilidad e intenta de nuevo.",
    });
  }
  throw err;
}

interface SlotDisponible {
  inicio: Date;
  fin: Date;
  capacidad: number;
  ocupados: number;
  disponible: number;
}

/**
 * Valida que `slotInicio` sea uno de los slots que
 * `fn_agenda_disponibilidad` ofrece para ese día (aplica horario, jornada
 * contratada, feriados, excepciones, anticipación y horizonte — D4, no
 * reabrir). No es la guarda de concurrencia (eso lo hace el EXCLUDE).
 */
async function assertSlotDisponible(
  tx: PrismaClient,
  agendaId: string,
  slotInicio: Date,
): Promise<SlotDisponible> {
  const fecha = slotInicio.toISOString().slice(0, 10);
  const slots = await tx.$queryRaw<SlotDisponible[]>`
    SELECT * FROM public.fn_agenda_disponibilidad(${agendaId}::uuid, ${fecha}::date, ${fecha}::date)
  `;
  const slot = slots.find((s) => s.inicio.getTime() === slotInicio.getTime());
  if (!slot || slot.disponible <= 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ese cupo ya no está disponible. Consulta la disponibilidad actualizada o únete a la lista de espera.",
    });
  }
  return slot;
}

type TipoCitaLiteral = "PRIMERA_VEZ" | "SUBSECUENTE" | "CONTROL_POSTQX" | "PROCEDIMIENTO";
type CanalLiteral = "RECEPCION" | "TELEFONO" | "MEDICO" | "PORTAL";
const TIPO_CITA_VALUES: readonly TipoCitaLiteral[] = [
  "PRIMERA_VEZ",
  "SUBSECUENTE",
  "CONTROL_POSTQX",
  "PROCEDIMIENTO",
];
const CANAL_VALUES: readonly CanalLiteral[] = ["RECEPCION", "TELEFONO", "MEDICO", "PORTAL"];

/** `tipoCita`/`canal` son `varchar` sin enum Postgres (CHECK, sql/247) — se re-valida al re-emitir en eventos. */
function asTipoCita(v: string | null): TipoCitaLiteral | null {
  return v !== null && (TIPO_CITA_VALUES as readonly string[]).includes(v) ? (v as TipoCitaLiteral) : null;
}
function asCanal(v: string | null): CanalLiteral | null {
  return v !== null && (CANAL_VALUES as readonly string[]).includes(v) ? (v as CanalLiteral) : null;
}

/**
 * US.AGE.2.6 AC1-AC4 — núcleo compartido de `checkIn` y `revertirNoShow`
 * (ambos terminan en CHECKED_IN + Encounter + PatientAccount). Ver docstring
 * de `admision-ambulatoria.ts` para la decisión de NO reusar
 * `encounterRouter.admit()` completo.
 */
async function realizarCheckIn(
  tx: PrismaClient,
  tenant: Pick<TenantContext, "organizationId">,
  userId: string,
  cita: {
    id: string;
    patientId: string;
    tipoCuentaId: string | null;
    establishmentId: string;
    serviceUnitId: string | null;
    consultorioId: string | null;
    notes: string | null;
  },
  notaExtra?: string,
): Promise<{ encounterId: string; cuentaId: string; numeroCuenta: string }> {
  // AC4 — datos mínimos de admisión (no existía un validador reusable — ver
  // decisión documentada en el reporte de la Ola 4; el REQ asume que sí hay
  // uno). Sin escritor de admisión previo que lo consumiera, se crea acá
  // acotado a lo que bloquea la creación del Encounter/cuenta.
  const patient = await tx.patient.findFirst({
    where: { id: cita.patientId, organizationId: tenant.organizationId, deletedAt: null },
    select: { id: true, birthDate: true, traeDocumento: true, documentType: true, documentNumber: true },
  });
  if (!patient) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
  }
  const datosCompletos =
    patient.birthDate !== null &&
    (patient.traeDocumento === false || (patient.documentType !== null && patient.documentNumber !== null));
  if (!datosCompletos) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "El paciente tiene datos incompletos para admisión (fecha de nacimiento o documento de identidad). " +
        "Complételos antes de continuar con el check-in.",
      cause: { patientId: patient.id },
    });
  }

  let establishmentId = cita.establishmentId;
  let serviceUnitId: string | null = cita.serviceUnitId;
  if (cita.consultorioId) {
    const consultorio = await tx.consultorio.findFirst({
      where: { id: cita.consultorioId },
      select: { establishmentId: true, serviceUnitId: true },
    });
    if (consultorio) {
      establishmentId = consultorio.establishmentId;
      serviceUnitId = consultorio.serviceUnitId;
    }
  }

  const encounter = await crearEncounterAmbulatorio(tx, {
    organizationId: tenant.organizationId,
    establishmentId,
    serviceUnitId,
    patientId: cita.patientId,
    admittedAt: new Date(),
    createdBy: userId,
  });

  const numeroCuenta = await nextCuenta(tx, cita.patientId);
  const cuenta = await tx.patientAccount.create({
    data: {
      organizationId: tenant.organizationId,
      patientId: cita.patientId,
      numeroCuenta,
      encounterId: encounter.id,
      tipoCuentaId: cita.tipoCuentaId,
      status: "ABIERTA",
      createdBy: userId,
    },
  });

  await tx.outpatientAppointment.update({
    where: { id: cita.id },
    data: {
      status: "CHECKED_IN",
      llegadaAt: new Date(),
      encounterId: encounter.id,
      notes: notaExtra ? (cita.notes ? `${cita.notes}\n${notaExtra}` : notaExtra) : cita.notes,
      updatedBy: userId,
    },
  });

  return { encounterId: encounter.id, cuentaId: cuenta.id, numeroCuenta: cuenta.numeroCuenta };
}

async function detectAppointmentConflict(
  prisma: PrismaClient,
  organizationId: string,
  providerId: string,
  scheduledAt: Date,
  durationMinutes: number,
  excludeId?: string,
): Promise<boolean> {
  const endAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);

  const conflicting = await prisma.outpatientAppointment.findFirst({
    where: {
      organizationId,
      providerId,
      deletedAt: null,
      status: { notIn: ["CANCELLED"] },
      scheduledAt: {
        lt: endAt,
        gte: new Date(scheduledAt.getTime() - 180 * 60_000),
      },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true, scheduledAt: true, durationMinutes: true },
  });

  if (!conflicting) return false;

  const existingEnd = new Date(
    conflicting.scheduledAt.getTime() + conflicting.durationMinutes * 60_000,
  );
  return existingEnd > scheduledAt;
}

async function detectNoShowCandidates(
  prisma: PrismaClient,
  organizationId: string,
  thresholdMinutes: number,
): Promise<Array<{ id: string; scheduledAt: Date; providerId: string; patientId: string }>> {
  const cutoff = new Date(Date.now() - thresholdMinutes * 60_000);
  return prisma.outpatientAppointment.findMany({
    where: {
      organizationId,
      deletedAt: null,
      status: { in: ["SCHEDULED", "CONFIRMED"] },
      scheduledAt: { lt: cutoff },
    },
    select: { id: true, scheduledAt: true, providerId: true, patientId: true },
    orderBy: { scheduledAt: "asc" },
  });
}

export const outpatientRouter = router({
  appointment: router({
    list: tenantProcedure
      .input(outpatientAppointmentListInput)
      .query(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.outpatientAppointment.findMany({
            where: {
              organizationId: ctx.tenant.organizationId,
              deletedAt: null,
              // Nivel B — restringe a citas del servicio del usuario; incluye
              // nulls porque appointment.serviceUnitId todavía no se popula
              // siempre desde la UI (es opcional al crear).
              ...serviceUnitWhereFragment(ctx.tenant, "serviceUnitId", {
                includeNullable: true,
              }),
              ...(input.providerId && { providerId: input.providerId }),
              ...(input.patientId && { patientId: input.patientId }),
              ...(input.status && { status: input.status }),
              ...(input.fromDate || input.toDate
                ? {
                    scheduledAt: {
                      ...(input.fromDate && { gte: input.fromDate }),
                      ...(input.toDate && { lte: input.toDate }),
                    },
                  }
                : {}),
            },
            include: {
              patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
              provider: { select: { id: true, fullName: true, email: true } },
            },
            orderBy: { scheduledAt: "asc" },
            take: input.limit,
          }),
        );
      }),

    get: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const item = await withTenantContext(ctx.prisma, ctx.tenant, (tx) =>
          tx.outpatientAppointment.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            include: {
              patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
              provider: { select: { id: true, fullName: true, email: true } },
            },
          }),
        );
        if (!item) throw new TRPCError({ code: "NOT_FOUND" });
        return item;
      }),

    create: tenantProcedure
      .input(outpatientAppointmentCreateInput)
      .mutation(async ({ ctx, input }) => {
        // Nivel B — si vino serviceUnitId, debe pertenecer al scope del usuario.
        if (input.serviceUnitId && isOutOfServiceUnitScope(ctx.tenant, input.serviceUnitId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "El servicio seleccionado no está en tus asignaciones.",
          });
        }
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const hasConflict = await detectAppointmentConflict(
            tx,
            ctx.tenant.organizationId,
            input.providerId,
            input.scheduledAt,
            input.durationMinutes,
          );
          if (hasConflict) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
            });
          }

          return tx.outpatientAppointment.create({
            data: {
              organizationId: ctx.tenant.organizationId,
              establishmentId: input.establishmentId,
              patientId: input.patientId,
              providerId: input.providerId,
              specialtyId: input.specialtyId ?? null,
              serviceUnitId: input.serviceUnitId ?? null,
              scheduledAt: input.scheduledAt,
              durationMinutes: input.durationMinutes,
              reason: input.reason ?? null,
              reasonCategory: input.reasonCategory ?? null,
              createdBy: ctx.user.id,
            },
          });
        });
      }),

    update: tenantProcedure
      .input(outpatientAppointmentUpdateInput)
      .mutation(async ({ ctx, input }) => {
        const { id, status: newStatus, scheduledAt, durationMinutes, ...rest } = input;

        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          if (newStatus !== undefined) {
            const current = await tx.outpatientAppointment.findFirst({
              where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
              select: { status: true, providerId: true, scheduledAt: true, durationMinutes: true },
            });
            if (!current) throw new TRPCError({ code: "NOT_FOUND" });

            const allowed = ALLOWED_TRANSITIONS[current.status as AppointmentStatusType];
            if (!allowed.includes(newStatus)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Transicion invalida: ${current.status} -> ${newStatus}. Permitidas: ${allowed.join(", ") || "ninguna (estado terminal)"}`,
              });
            }

            if (scheduledAt !== undefined || durationMinutes !== undefined) {
              const eff = scheduledAt ?? current.scheduledAt;
              const dur = durationMinutes ?? current.durationMinutes;
              const hasConflict = await detectAppointmentConflict(
                tx, ctx.tenant.organizationId, current.providerId, eff, dur, id,
              );
              if (hasConflict) {
                throw new TRPCError({
                  code: "CONFLICT",
                  message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
                });
              }
            }
          } else if (scheduledAt !== undefined || durationMinutes !== undefined) {
            const current = await tx.outpatientAppointment.findFirst({
              where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
              select: { providerId: true, scheduledAt: true, durationMinutes: true },
            });
            if (!current) throw new TRPCError({ code: "NOT_FOUND" });

            const eff = scheduledAt ?? current.scheduledAt;
            const dur = durationMinutes ?? current.durationMinutes;
            const hasConflict = await detectAppointmentConflict(
              tx, ctx.tenant.organizationId, current.providerId, eff, dur, id,
            );
            if (hasConflict) {
              throw new TRPCError({
                code: "CONFLICT",
                message: "El proveedor ya tiene una cita en ese intervalo de tiempo.",
              });
            }
          }

          const updated = await tx.outpatientAppointment.updateMany({
            where: { id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            data: {
              ...(newStatus !== undefined && { status: newStatus }),
              ...(scheduledAt !== undefined && { scheduledAt }),
              ...(durationMinutes !== undefined && { durationMinutes }),
              ...rest,
              updatedBy: ctx.user.id,
            },
          });
          if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
          return { ok: true as const };
        });
      }),

    cancel: tenantProcedure
      .input(outpatientAppointmentCancelInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const current = await tx.outpatientAppointment.findFirst({
            where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            select: { status: true },
          });
          if (!current) throw new TRPCError({ code: "NOT_FOUND" });

          const allowed = ALLOWED_TRANSITIONS[current.status as AppointmentStatusType];
          if (!allowed.includes("CANCELLED")) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `No se puede cancelar una cita en estado ${current.status}.`,
            });
          }

          const updated = await tx.outpatientAppointment.updateMany({
            where: { id: input.id, organizationId: ctx.tenant.organizationId, deletedAt: null },
            data: { status: "CANCELLED", notes: input.reason, updatedBy: ctx.user.id },
          });
          if (updated.count === 0) throw new TRPCError({ code: "NOT_FOUND" });
          return { ok: true as const };
        });
      }),

    detectNoShows: tenantProcedure
      .input(noShowDetectInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const candidates = await detectNoShowCandidates(
            tx,
            ctx.tenant.organizationId,
            input.thresholdMinutes,
          );

          if (!input.commit) {
            return { count: candidates.length, candidates, committed: false };
          }

          if (candidates.length > 0) {
            await tx.outpatientAppointment.updateMany({
              where: {
                id: { in: candidates.map((c) => c.id) },
                organizationId: ctx.tenant.organizationId,
              },
              data: { status: "NO_SHOW", updatedBy: ctx.user.id },
            });
          }

          return { count: candidates.length, candidates, committed: true };
        });
      }),

    // -------------------------------------------------------------------
    // CC-0036 Ola 4 (REQ-HIS-AFIL-001 S4) — agenda-aware. Ver docstring del
    // archivo: `create`/`update`/`cancel` arriba siguen siendo el camino
    // legacy (citas sin agenda); estas mutaciones son el camino nuevo para
    // citas que nacen de una `AgendaMedico` publicada.
    // -------------------------------------------------------------------

    /** US.AGE.2.4 — reserva desde un slot de `agenda.disponibilidad`. */
    reservar: reservarProc.input(reservarCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user, effectivePermissions } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          include: {
            medicoAfiliado: { select: { id: true, userId: true, nombreCompleto: true } },
            consultorio: { select: { id: true, serviceUnitId: true } },
            contrato: { select: { estado: true } },
          },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }
        // D5 del REQ (MedicoAfiliado.userId puede ser null) — ver docstring
        // de agenda.router.ts §ABAC: sin bridge todavía, providerId (NOT
        // NULL) no se puede resolver. Falla explícita, no silenciosa.
        if (!agenda.medicoAfiliado.userId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `El médico afiliado ${agenda.medicoAfiliado.nombreCompleto} no tiene cuenta de usuario en el HIS — no se puede reservar hasta vincular su acceso.`,
          });
        }

        const estado = estadoEfectivo(agenda.estado, agenda.contrato?.estado);
        if (estado === "SUSPENDIDA") {
          const puedeForzar = effectivePermissions.get("agenda.reservar_suspendida") === "ALLOW";
          if (!puedeForzar || !input.motivoReservarSuspendida) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "La agenda está suspendida. Se requiere el permiso agenda.reservar_suspendida y un motivo para reservar de todos modos.",
            });
          }
        } else if (estado !== "PUBLICADA") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La agenda está en estado ${estado}, no admite reservas.`,
          });
        }

        const fecha = input.slotInicio.toISOString().slice(0, 10);
        const inicioDia = new Date(`${fecha}T00:00:00.000Z`);
        const finDia = new Date(`${fecha}T23:59:59.999Z`);

        if (input.esSobrecupo) {
          if (effectivePermissions.get("agenda.sobrecupo") !== "ALLOW") {
            throw new TRPCError({ code: "FORBIDDEN", message: "Permiso requerido: agenda.sobrecupo" });
          }
          if (!input.motivoSobrecupo) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "El sobrecupo requiere un motivo." });
          }
          const sobrecuposHoy = await tx.outpatientAppointment.count({
            where: {
              agendaId: agenda.id,
              esSobrecupo: true,
              deletedAt: null,
              status: { notIn: ["CANCELLED"] },
              scheduledAt: { gte: inicioDia, lte: finDia },
            },
          });
          if (sobrecuposHoy >= agenda.sobrecupoMaximoDia) {
            throw new TRPCError({
              code: "CONFLICT",
              message: `Se alcanzó el tope de sobrecupos del día (${agenda.sobrecupoMaximoDia}).`,
            });
          }
        } else {
          await assertSlotDisponible(tx, agenda.id, input.slotInicio);
        }

        // AC4 — duplicado mismo paciente+agenda+fecha exige confirmación explícita.
        if (!input.confirmarDuplicado) {
          const duplicado = await tx.outpatientAppointment.findFirst({
            where: {
              agendaId: agenda.id,
              patientId: input.patientId,
              status: { in: ["SCHEDULED", "CONFIRMED"] },
              deletedAt: null,
              scheduledAt: { gte: inicioDia, lte: finDia },
            },
            select: { id: true },
          });
          if (duplicado) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "El paciente ya tiene una cita programada en esta agenda para esa fecha. Confirma explícitamente para reservar de todos modos.",
              cause: { citaDuplicadaId: duplicado.id },
            });
          }
        }

        // AC5 — estimado informativo, nunca bloquea la reserva.
        const estimado = await estimarConsulta(tx, {
          organizationId: tenant.organizationId,
          patientId: input.patientId,
          tipoCuentaId: input.tipoCuentaId ?? null,
          fecha: input.slotInicio,
        });

        let cita;
        try {
          cita = await tx.outpatientAppointment.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: agenda.establishmentId,
              patientId: input.patientId,
              providerId: agenda.medicoAfiliado.userId,
              serviceUnitId: agenda.consultorio.serviceUnitId,
              scheduledAt: input.slotInicio,
              durationMinutes: agenda.duracionSlotMin,
              status: "SCHEDULED",
              reason: input.reason ?? null,
              medicoAfiliadoId: agenda.medicoAfiliadoId,
              consultorioId: agenda.consultorioId,
              agendaId: agenda.id,
              tipoCita: input.tipoCita,
              canal: input.canal,
              tipoCuentaId: input.tipoCuentaId ?? null,
              insurerId: input.insurerId ?? null,
              esSobrecupo: input.esSobrecupo ?? false,
              autorizaSobrecupoBy: input.esSobrecupo ? user.id : null,
              notes: input.esSobrecupo
                ? `Sobrecupo: ${input.motivoSobrecupo}`
                : estado === "SUSPENDIDA"
                  ? `Reserva sobre agenda suspendida: ${input.motivoReservarSuspendida}`
                  : null,
              createdBy: user.id,
            },
          });
        } catch (err) {
          rethrowCupoConflict(err);
        }

        await emitDomainEvent(tx, {
          organizationId: tenant.organizationId,
          eventType: "cita.reservada",
          aggregateType: "OutpatientAppointment",
          aggregateId: cita.id,
          emittedById: user.id,
          payload: {
            citaId: cita.id,
            patientId: cita.patientId,
            providerId: cita.providerId,
            medicoAfiliadoId: agenda.medicoAfiliadoId,
            consultorioId: agenda.consultorioId,
            agendaId: agenda.id,
            scheduledAt: cita.scheduledAt.toISOString(),
            tipoCita: input.tipoCita,
            canal: input.canal,
            esSobrecupo: input.esSobrecupo ?? false,
          },
        });

        return { cita, estimado };
      });
    }),

    /** US.AGE.2.5 AC1 — original -> CANCELLED (REPROGRAMADA); nueva con `reprogramadaDeId`. */
    reprogramar: reprogramarProc.input(reprogramarCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const original = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!original) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }
        assertCitaEditable(original.status, "reprogramar");

        const agenda = await tx.agendaMedico.findFirst({
          where: { id: input.agendaId, organizationId: tenant.organizationId },
          include: {
            medicoAfiliado: { select: { id: true, userId: true, nombreCompleto: true } },
            consultorio: { select: { id: true, serviceUnitId: true } },
            contrato: { select: { estado: true } },
          },
        });
        if (!agenda) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
        }
        if (!agenda.medicoAfiliado.userId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `El médico afiliado ${agenda.medicoAfiliado.nombreCompleto} no tiene cuenta de usuario en el HIS.`,
          });
        }
        const estado = estadoEfectivo(agenda.estado, agenda.contrato?.estado);
        if (estado !== "PUBLICADA") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `La agenda está en estado ${estado}, no admite reservas.`,
          });
        }
        await assertSlotDisponible(tx, agenda.id, input.slotInicio);

        await tx.outpatientAppointment.update({
          where: { id: original.id },
          data: {
            status: "CANCELLED",
            motivoCancelacion: "REPROGRAMADA",
            canceladaBy: user.id,
            canceladaAt: new Date(),
            updatedBy: user.id,
          },
        });

        let nueva;
        try {
          nueva = await tx.outpatientAppointment.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: agenda.establishmentId,
              patientId: original.patientId,
              providerId: agenda.medicoAfiliado.userId,
              serviceUnitId: agenda.consultorio.serviceUnitId,
              scheduledAt: input.slotInicio,
              durationMinutes: agenda.duracionSlotMin,
              status: "SCHEDULED",
              reason: original.reason,
              reasonCategory: original.reasonCategory,
              medicoAfiliadoId: agenda.medicoAfiliadoId,
              consultorioId: agenda.consultorioId,
              agendaId: agenda.id,
              tipoCita: original.tipoCita,
              canal: original.canal,
              tipoCuentaId: original.tipoCuentaId,
              insurerId: original.insurerId,
              reprogramadaDeId: original.id,
              notes: input.motivo ? `Reprogramada: ${input.motivo}` : null,
              createdBy: user.id,
            },
          });
        } catch (err) {
          rethrowCupoConflict(err);
        }

        await emitDomainEvent(tx, {
          organizationId: tenant.organizationId,
          eventType: "cita.reservada",
          aggregateType: "OutpatientAppointment",
          aggregateId: nueva.id,
          emittedById: user.id,
          payload: {
            citaId: nueva.id,
            patientId: nueva.patientId,
            providerId: nueva.providerId,
            medicoAfiliadoId: agenda.medicoAfiliadoId,
            consultorioId: agenda.consultorioId,
            agendaId: agenda.id,
            scheduledAt: nueva.scheduledAt.toISOString(),
            tipoCita: asTipoCita(nueva.tipoCita),
            canal: asCanal(nueva.canal),
            esSobrecupo: false,
          },
        });

        return { original: { id: original.id, status: "CANCELLED" as const }, nueva };
      });
    }),

    /** US.AGE.2.5 AC2/AC3/AC6 — cancelación tipificada; libera cupo y notifica ListaEspera. */
    cancelar: cancelarProc.input(cancelarCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cita = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!cita) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }
        assertCitaEditable(cita.status, "cancelar");

        let tardia = false;
        if (cita.agendaId) {
          const agenda = await tx.agendaMedico.findFirst({
            where: { id: cita.agendaId },
            select: { politicaCancelacionHoras: true },
          });
          if (agenda) {
            const horasAntelacion = (cita.scheduledAt.getTime() - Date.now()) / 3_600_000;
            tardia = horasAntelacion < agenda.politicaCancelacionHoras;
          }
        }

        await tx.outpatientAppointment.update({
          where: { id: cita.id },
          data: {
            status: "CANCELLED",
            motivoCancelacion: input.notas ? `${input.motivo}: ${input.notas}` : input.motivo,
            canceladaBy: user.id,
            canceladaAt: new Date(),
            updatedBy: user.id,
          },
        });

        await emitDomainEvent(tx, {
          organizationId: tenant.organizationId,
          eventType: "cita.cancelada",
          aggregateType: "OutpatientAppointment",
          aggregateId: cita.id,
          emittedById: user.id,
          payload: {
            citaId: cita.id,
            patientId: cita.patientId,
            agendaId: cita.agendaId,
            motivo: input.motivo,
            tardia,
          },
        });

        // AC3 — libera el cupo: notifica al primer ListaEspera compatible.
        if (cita.agendaId) {
          const fechaCita = new Date(`${cita.scheduledAt.toISOString().slice(0, 10)}T00:00:00.000Z`);
          const candidatos = await tx.listaEspera.findMany({
            where: {
              agendaId: cita.agendaId,
              estado: "ESPERANDO",
              AND: [
                { OR: [{ fechaDeseadaDesde: null }, { fechaDeseadaDesde: { lte: fechaCita } }] },
                { OR: [{ fechaDeseadaHasta: null }, { fechaDeseadaHasta: { gte: fechaCita } }] },
              ],
            },
            orderBy: { createdAt: "asc" },
            take: 20,
          });
          const pesoPrioridad = (p: string) => (p === "PREFERENTE" ? 0 : 1);
          candidatos.sort((a, b) => pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad));
          const candidato = candidatos[0];

          if (candidato) {
            await tx.listaEspera.update({
              where: { id: candidato.id },
              data: { estado: "CONTACTADO", updatedBy: user.id },
            });
            try {
              const paciente = await tx.patient.findFirst({
                where: { id: candidato.patientId },
                select: { firstName: true, lastName: true, mrn: true },
              });
              await emitDomainEvent(tx, {
                organizationId: tenant.organizationId,
                eventType: "task.action_required",
                aggregateType: "ListaEspera",
                aggregateId: candidato.id,
                emittedById: user.id,
                payload: {
                  taskType: "LISTA_ESPERA_CONTACTAR",
                  sourceType: "LISTA_ESPERA",
                  sourceId: candidato.id,
                  assignedRoleCode: "ADMISSION_CLERK",
                  establishmentId: cita.establishmentId,
                  serviceUnitId: null,
                  dueAt: null,
                  url: "/outpatient/tablero",
                  resumen: paciente
                    ? `Cupo liberado — contactar a ${paciente.firstName} ${paciente.lastName} (${paciente.mrn})`
                    : "Cupo liberado — contactar al paciente en lista de espera",
                },
              });
            } catch (err) {
              console.error(
                `[outpatient.router] emitDomainEvent(task.action_required) falló para ListaEspera ${candidato.id} — la cancelación se registró igual.`,
                err,
              );
            }
          }
        }

        return { ok: true as const, tardia };
      });
    }),

    /** US.AGE.2.6 AC1-AC4 — check-in: idempotente si ya tiene `encounterId`. */
    checkIn: reservarProc.input(checkInCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cita = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!cita) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }

        if (cita.encounterId) {
          const cuenta = await tx.patientAccount.findFirst({
            where: { encounterId: cita.encounterId },
            select: { id: true, numeroCuenta: true },
          });
          return {
            encounterId: cita.encounterId,
            cuentaId: cuenta?.id ?? null,
            numeroCuenta: cuenta?.numeroCuenta ?? null,
            yaExistia: true as const,
          };
        }

        if (cita.status !== "SCHEDULED" && cita.status !== "CONFIRMED") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `No se puede hacer check-in de una cita en estado ${cita.status}.`,
          });
        }

        const resultado = await realizarCheckIn(tx, tenant, user.id, cita);
        return { ...resultado, yaExistia: false as const };
      });
    }),

    /** US.AGE.2.7 AC2 — revertir NO_SHOW directo a CHECKED_IN (mismo core que `checkIn`). */
    revertirNoShow: reservarProc.input(revertirNoShowInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cita = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!cita) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }
        if (cita.status !== "NO_SHOW") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede revertir una cita en NO_SHOW (actual: ${cita.status}).`,
          });
        }
        const resultado = await realizarCheckIn(tx, tenant, user.id, cita, `Revertido de NO_SHOW: ${input.motivo}`);
        return resultado;
      });
    }),

    /**
     * US.AGE.2.6 AC5 (fallback manual) — `OutpatientConsultation.signedAt`
     * no tiene ningún escritor en el codebase todavía (verificado por
     * búsqueda: ningún router asigna esa columna). El hook automático
     * "al firmar la consulta, la cita pasa a COMPLETED" queda documentado
     * acá para cuando exista ese escritor; mientras tanto, `completar` es
     * la única vía y la expone recepción/clínica manualmente.
     */
    completar: tenantProcedure.input(completarCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cita = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!cita) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }
        if (cita.status !== "CHECKED_IN") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede completar una cita CHECKED_IN (actual: ${cita.status}).`,
          });
        }
        return tx.outpatientAppointment.update({
          where: { id: cita.id },
          data: { status: "COMPLETED", finAtencionAt: new Date(), updatedBy: user.id },
        });
      });
    }),

    /**
     * Sin AC propio del REQ — `inicioAtencionAt` está en el modelo (§6.1)
     * pero ninguna historia describe quién la escribe. Se agrega este
     * procedure mínimo para que el bucket "en atención" del tablero
     * (US.AGE.2.7 AC3) refleje datos reales y no quede permanentemente en
     * cero. Sin permiso `agenda.*` propio (el REQ no define uno) — abierto a
     * cualquier usuario del tenant hasta que @PO defina el recurso RBAC.
     */
    iniciarAtencion: tenantProcedure.input(checkInCitaInput).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const cita = await tx.outpatientAppointment.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId, deletedAt: null },
        });
        if (!cita) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
        }
        if (cita.status !== "CHECKED_IN") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Solo se puede iniciar atención de una cita CHECKED_IN (actual: ${cita.status}).`,
          });
        }
        return tx.outpatientAppointment.update({
          where: { id: cita.id },
          data: { inicioAtencionAt: new Date(), updatedBy: user.id },
        });
      });
    }),

    /** US.AGE.2.5 AC1 — cadena de reprogramaciones consultable (hacia atrás y hacia adelante). */
    reprogramacionChain: tenantProcedure
      .input(z.object({ id: z.string().uuid() }))
      .query(async ({ ctx, input }) => {
        const { tenant, prisma } = ctx;
        return withTenantContext(prisma, tenant, async (tx) => {
          const base = await tx.outpatientAppointment.findFirst({
            where: { id: input.id, organizationId: tenant.organizationId },
          });
          if (!base) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
          }

          const cadena = [base];
          let cursor = base;
          while (cursor.reprogramadaDeId) {
            const anterior = await tx.outpatientAppointment.findFirst({
              where: { id: cursor.reprogramadaDeId, organizationId: tenant.organizationId },
            });
            if (!anterior) break;
            cadena.unshift(anterior);
            cursor = anterior;
          }
          cursor = base;
          for (;;) {
            const siguiente = await tx.outpatientAppointment.findFirst({
              where: { reprogramadaDeId: cursor.id, organizationId: tenant.organizationId },
            });
            if (!siguiente) break;
            cadena.push(siguiente);
            cursor = siguiente;
          }
          return cadena;
        });
      }),
  }),

  /** US.AGE.2.4 AC7 — cupos agotados en el rango deseado. */
  listaEspera: router({
    list: leerProc.input(z.object({ agendaId: z.string().uuid() })).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.listaEspera.findMany({
          where: { agendaId: input.agendaId, organizationId: tenant.organizationId },
          include: { patient: { select: { id: true, firstName: true, lastName: true, mrn: true } } },
          orderBy: { createdAt: "asc" },
        }),
      );
    }),

    create: reservarProc
      .input(
        z.object({
          agendaId: z.string().uuid(),
          patientId: z.string().uuid(),
          prioridad: z.enum(["NORMAL", "PREFERENTE"]).default("NORMAL"),
          fechaDeseadaDesde: z.string().date().optional(),
          fechaDeseadaHasta: z.string().date().optional(),
          notas: z.string().trim().max(500).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { tenant, prisma, user } = ctx;
        return withTenantContext(prisma, tenant, async (tx) => {
          const agenda = await tx.agendaMedico.findFirst({
            where: { id: input.agendaId, organizationId: tenant.organizationId },
            select: { id: true },
          });
          if (!agenda) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Agenda no encontrada." });
          }
          return tx.listaEspera.create({
            data: {
              organizationId: tenant.organizationId,
              agendaId: input.agendaId,
              patientId: input.patientId,
              prioridad: input.prioridad,
              fechaDeseadaDesde: input.fechaDeseadaDesde
                ? new Date(`${input.fechaDeseadaDesde}T00:00:00.000Z`)
                : null,
              fechaDeseadaHasta: input.fechaDeseadaHasta
                ? new Date(`${input.fechaDeseadaHasta}T00:00:00.000Z`)
                : null,
              notas: input.notas ?? null,
              createdBy: user.id,
            },
          });
        });
      }),
  }),

  /** US.AGE.2.7 AC3-AC5 — tablero del día + indicadores. */
  tablero: router({
    dia: leerProc.input(tableroDiaInput).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const inicioDia = new Date(`${input.fecha}T00:00:00.000-06:00`);
      const finDia = new Date(`${input.fecha}T23:59:59.999-06:00`);
      return withTenantContext(prisma, tenant, async (tx) => {
        const citas = await tx.outpatientAppointment.findMany({
          where: {
            organizationId: tenant.organizationId,
            deletedAt: null,
            scheduledAt: { gte: inicioDia, lte: finDia },
            ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input.consultorioId ? { consultorioId: input.consultorioId } : {}),
          },
          include: {
            patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
          },
          orderBy: { scheduledAt: "asc" },
        });

        // Joins puntuales — evita relaciones Prisma inversas nuevas en
        // Consultorio/MedicoAfiliado solo para este listado (ver docstring
        // del schema.prisma sobre "FK lógica").
        const consultorioIds = [...new Set(citas.map((c) => c.consultorioId).filter((v): v is string => v !== null))];
        const medicoIds = [...new Set(citas.map((c) => c.medicoAfiliadoId).filter((v): v is string => v !== null))];
        const [consultorios, medicos] = await Promise.all([
          consultorioIds.length
            ? tx.consultorio.findMany({ where: { id: { in: consultorioIds } }, select: { id: true, codigo: true, nombre: true } })
            : Promise.resolve([]),
          medicoIds.length
            ? tx.medicoAfiliado.findMany({ where: { id: { in: medicoIds } }, select: { id: true, nombreCompleto: true } })
            : Promise.resolve([]),
        ]);
        const consultorioMap = new Map(consultorios.map((c) => [c.id, c]));
        const medicoMap = new Map(medicos.map((m) => [m.id, m]));

        const items = citas.map((c) => ({
          id: c.id,
          patientId: c.patientId,
          patientName: `${c.patient.firstName} ${c.patient.lastName}`,
          mrn: c.patient.mrn,
          scheduledAt: c.scheduledAt.toISOString(),
          status: c.status,
          consultorio: c.consultorioId ? (consultorioMap.get(c.consultorioId) ?? null) : null,
          medicoAfiliado: c.medicoAfiliadoId ? (medicoMap.get(c.medicoAfiliadoId) ?? null) : null,
          esSobrecupo: c.esSobrecupo,
          llegadaAt: c.llegadaAt?.toISOString() ?? null,
          inicioAtencionAt: c.inicioAtencionAt?.toISOString() ?? null,
        }));

        const resumen = {
          programadas: citas.filter((c) => c.status === "SCHEDULED" || c.status === "CONFIRMED").length,
          llegadas: citas.filter((c) => c.status === "CHECKED_IN" && c.inicioAtencionAt === null).length,
          enAtencion: citas.filter((c) => c.status === "CHECKED_IN" && c.inicioAtencionAt !== null).length,
          completadas: citas.filter((c) => c.status === "COMPLETED").length,
          noShow: citas.filter((c) => c.status === "NO_SHOW").length,
          sobrecupos: citas.filter((c) => c.esSobrecupo).length,
        };

        return { resumen, items };
      });
    }),

    /** US.AGE.2.7 AC5 — no-show/cancelación tardía/ocupación/espera promedio. */
    indicadores: leerProc.input(indicadoresAgendaInput).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = new Date(`${input.desde}T00:00:00.000Z`);
      const hasta = new Date(`${input.hasta}T23:59:59.999Z`);
      return withTenantContext(prisma, tenant, async (tx) => {
        const where = {
          organizationId: tenant.organizationId,
          deletedAt: null,
          scheduledAt: { gte: desde, lte: hasta },
          ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
          ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
          ...(input.consultorioId ? { consultorioId: input.consultorioId } : {}),
        };
        const citas = await tx.outpatientAppointment.findMany({
          where,
          select: { status: true, llegadaAt: true, inicioAtencionAt: true },
        });
        const total = citas.length;
        const noShow = citas.filter((c) => c.status === "NO_SHOW").length;
        const cancelled = citas.filter((c) => c.status === "CANCELLED").length;

        const esperas = citas
          .filter((c) => c.llegadaAt && c.inicioAtencionAt)
          .map((c) => (c.inicioAtencionAt!.getTime() - c.llegadaAt!.getTime()) / 60_000);
        const tiempoEsperaPromedioMin = esperas.length ? esperas.reduce((a, b) => a + b, 0) / esperas.length : null;

        // Cancelación tardía: se lee del DomainEvent (payload.tardia) — no
        // se persiste una columna aparte en OutpatientAppointment (fuera
        // del §6.1 del REQ).
        const eventosCancelacion = await tx.domainEvent.findMany({
          where: {
            organizationId: tenant.organizationId,
            eventType: "cita.cancelada",
            occurredAt: { gte: desde, lte: hasta },
          },
          select: { payload: true },
        });
        const canceladasTardias = eventosCancelacion.filter(
          (e) => (e.payload as { tardia?: boolean } | null)?.tardia === true,
        ).length;

        // Ocupación — sin matview aún (NFR-2 lo permite): se resuelve
        // llamando `fn_agenda_disponibilidad` por agenda en scope, acotado
        // a 50 agendas como guarda de performance.
        const agendasScope = await tx.agendaMedico.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input.medicoAfiliadoId ? { medicoAfiliadoId: input.medicoAfiliadoId } : {}),
            ...(input.consultorioId ? { consultorioId: input.consultorioId } : {}),
          },
          select: { id: true },
          take: 50,
        });
        let capacidadTotal = 0;
        let ocupadosTotal = 0;
        for (const a of agendasScope) {
          const slots = await tx.$queryRaw<Array<{ capacidad: number; ocupados: number }>>`
            SELECT capacidad, ocupados FROM public.fn_agenda_disponibilidad(${a.id}::uuid, ${input.desde}::date, ${input.hasta}::date)
          `;
          for (const s of slots) {
            capacidadTotal += s.capacidad;
            ocupadosTotal += s.ocupados;
          }
        }

        return {
          total,
          noShowRate: total > 0 ? noShow / total : 0,
          cancelacionTardiaRate: cancelled > 0 ? canceladasTardias / cancelled : 0,
          tiempoEsperaPromedioMin,
          ocupacionRate: capacidadTotal > 0 ? ocupadosTotal / capacidadTotal : null,
        };
      });
    }),
  }),

  consultation: router({
    create: tenantProcedure
      .input(outpatientConsultationCreateInput)
      .mutation(async ({ ctx, input }) => {
        return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
          const enc = await tx.encounter.findFirst({
            where: { id: input.encounterId, organizationId: ctx.tenant.organizationId },
            select: { id: true },
          });
          if (!enc) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Encuentro no existe en la organizacion." });
          }

          if (input.appointmentId !== undefined) {
            const appt = await tx.outpatientAppointment.findFirst({
              where: {
                id: input.appointmentId,
                organizationId: ctx.tenant.organizationId,
                deletedAt: null,
              },
              select: { status: true },
            });
            if (!appt) {
              throw new TRPCError({ code: "NOT_FOUND", message: "Cita no encontrada." });
            }
            if (appt.status !== "CHECKED_IN" && appt.status !== "COMPLETED") {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `La consulta solo puede crearse cuando la cita esta en CHECKED_IN o COMPLETED. Estado actual: ${appt.status}`,
              });
            }
          }

          return tx.outpatientConsultation.create({
            data: {
              appointmentId: input.appointmentId ?? null,
              encounterId: input.encounterId,
              reasonOfVisit: input.reasonOfVisit,
              reasonCategory: input.reasonCategory ?? null,
              subjective: input.subjective ?? null,
              objective: input.objective ?? null,
              assessment: input.assessment ?? null,
              plan: input.plan ?? null,
            },
          });
        });
      }),
  }),
});