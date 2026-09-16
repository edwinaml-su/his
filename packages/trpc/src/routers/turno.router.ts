/**
 * Router tRPC — Turnos 24/7 (CC-0036 Ola 1A, Bloque C de REQ-HIS-AFIL-001).
 *
 * PlantillaTurno (turno tipo por sede) / ProgramacionTurno (período
 * mensual/quincenal) / AsignacionTurno (médico/enfermero ↔ turno ↔ fecha) +
 * `fn_medico_de_turno` (sql/243_cc0036_turnos.sql).
 *
 * RBAC: recurso `turno` (leer|programar|publicar|sustituir|autorizar_descubierto,
 * sql/243 §3). ABAC (REQ §7.3.2): JEFE_MEDICO_SEDE solo programa
 * establecimientos donde tiene asignación de servicio vigente — reutiliza
 * `ctx.tenant.assignedServiceUnitIds`/`isCrossServiceRole` (Nivel A,
 * `nav-visibility.ts`), el único mecanismo de "usuario ↔ sede" que existe
 * hoy en el repo (`UserServiceUnitAssignment` es por `ServiceUnit`, no hay
 * tabla de asignación directa a `Establishment`). Un usuario CROSS_SERVICE o
 * sin asignaciones (`assignedServiceUnitIds.length === 0`) NO se restringe
 * — mismo criterio de "backward compat" que `isItemVisible`.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { Prisma, emitDomainEvent, type PrismaClient } from "@his/database";
import {
  plantillaTurnoListSchema,
  plantillaTurnoCreateSchema,
  plantillaTurnoUpdateSchema,
  plantillaTurnoSetActiveSchema,
  plantillaTurnoCoberturaSchema,
  programacionTurnoListSchema,
  programacionTurnoGetSchema,
  programacionTurnoCreateSchema,
  programacionTurnoPublicarSchema,
  programacionTurnoCerrarSchema,
  asignacionTurnoListSchema,
  asignacionTurnoAsignarSchema,
  asignacionTurnoQuitarSchema,
  asignacionTurnoSustituirSchema,
  asignacionTurnoMarcarInicioSchema,
  asignacionTurnoMarcarFinSchema,
  medicoDeTurnoSchema,
} from "@his/contracts";
import type { TenantContext } from "@his/contracts";
import { router, tenantProcedure, requirePermission } from "../trpc";
import { withTenantContext } from "../rls-context";

const leerProc = requirePermission("turno.leer");
const programarProc = requirePermission("turno.programar");
const publicarProc = requirePermission("turno.publicar");
const sustituirProc = requirePermission("turno.sustituir");

const VIGENTES: readonly string[] = ["PROGRAMADO", "CONFIRMADO", "EN_CURSO"];

// ---------------------------------------------------------------------------
// Helpers de tiempo — America/El_Salvador es UTC-6 fijo (sin DST, NFR-6).
// Las columnas `@db.Time` de Prisma llegan como Date en época 1970-01-01 con
// los dígitos de hora tal cual se guardaron (no aplican zona horaria).
// ---------------------------------------------------------------------------

function hhmmss(hora: Date): string {
  return hora.toISOString().slice(11, 19);
}

/**
 * Construye el `Date` que Prisma persiste en una columna `@db.Time` a partir
 * de "HH:MM" o "HH:MM:SS". CRÍTICO: el sufijo `Z` es obligatorio — sin él,
 * `new Date("1970-01-01THH:MM")` se interpreta en la zona horaria LOCAL del
 * proceso Node (no UTC), y como `hhmmss()`/`toMinutes()` leen de vuelta con
 * `getUTCHours`/`getUTCMinutes`, cualquier proceso que no corra en UTC
 * persistiría horas corridas (hallazgo de revisión pre-PR — "funciona por
 * accidente" en Vercel porque su runtime es UTC, pero rompe en dev local con
 * TZ=America/El_Salvador y en cualquier despliegue Docker/k8s sin TZ fijado).
 */
function toTimeColumnValue(hhmm: string): Date {
  const conSegundos = hhmm.length === 5 ? `${hhmm}:00` : hhmm;
  return new Date(`1970-01-01T${conSegundos}.000Z`);
}

function toMinutes(hora: Date): number {
  return hora.getUTCHours() * 60 + hora.getUTCMinutes();
}

function fromMinutes(min: number): string {
  const h = Math.floor(min / 60)
    .toString()
    .padStart(2, "0");
  const m = (min % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Combina fecha (YYYY-MM-DD) + hora (Date de columna Time) en un instante UTC-6 real. */
function combinarFechaHora(fecha: string, hora: Date): Date {
  return new Date(`${fecha}T${hhmmss(hora)}-06:00`);
}

/** Calcula [inicioProgramado, finProgramado] absolutos para una asignación. */
function calcularRangoTurno(
  fecha: string,
  plantilla: { horaInicio: Date; horaFin: Date; cruzaMedianoche: boolean },
): { inicioProgramado: Date; finProgramado: Date } {
  const inicioProgramado = combinarFechaHora(fecha, plantilla.horaInicio);
  const fechaFin = plantilla.cruzaMedianoche ? addDays(fecha, 1) : fecha;
  const finProgramado = combinarFechaHora(fechaFin, plantilla.horaFin);
  return { inicioProgramado, finProgramado };
}

// ---------------------------------------------------------------------------
// ABAC — JEFE_MEDICO_SEDE acotado a sus establecimientos asignados.
// ---------------------------------------------------------------------------

async function assertScopeEstablecimiento(
  tx: PrismaClient,
  tenant: TenantContext,
  establishmentId: string,
): Promise<void> {
  if (tenant.isCrossServiceRole) return;
  if (tenant.assignedServiceUnitIds.length === 0) return; // backward-compat, sin asignaciones = sin restricción
  const su = await tx.serviceUnit.findFirst({
    where: { id: { in: tenant.assignedServiceUnitIds }, establishmentId },
    select: { id: true },
  });
  if (!su) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "No tienes asignación de servicio vigente en este establecimiento.",
    });
  }
}

function rethrowAsignacionConflict(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Ese usuario ya tiene una asignación a este turno en esa fecha.",
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (/exclusion/i.test(message)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "El usuario ya tiene un turno asignado que se traslapa con este horario.",
    });
  }
  throw err;
}

function rethrowCodigoDuplicado(err: unknown, codigo: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Ya existe una plantilla de turno con el código ${codigo} en este establecimiento.`,
    });
  }
  throw err;
}

/**
 * US.AFIL.1.10.3 — advertencia bloqueante si el usuario acumularía >24h
 * continuas de turno. Fusiona el rango nuevo con las asignaciones vigentes
 * del usuario en una ventana de ±24h (suficiente para detectar cadenas que
 * cruzan el nuevo turno) y mide la cadena continua/solapada más larga.
 */
async function assertSinExceso24h(
  tx: PrismaClient,
  params: {
    userId: string;
    inicioProgramado: Date;
    finProgramado: Date;
    justificacion24h?: string;
    excludeAsignacionId?: string;
  },
): Promise<void> {
  const ventanaDesde = new Date(params.inicioProgramado.getTime() - 24 * 3_600_000);
  const ventanaHasta = new Date(params.finProgramado.getTime() + 24 * 3_600_000);
  const vecinos = await tx.asignacionTurno.findMany({
    where: {
      userId: params.userId,
      estado: { in: [...VIGENTES] },
      inicioProgramado: { lt: ventanaHasta },
      finProgramado: { gt: ventanaDesde },
      ...(params.excludeAsignacionId ? { id: { not: params.excludeAsignacionId } } : {}),
    },
    select: { inicioProgramado: true, finProgramado: true },
  });

  const intervalos = [
    ...vecinos,
    { inicioProgramado: params.inicioProgramado, finProgramado: params.finProgramado },
  ].sort((a, b) => a.inicioProgramado.getTime() - b.inicioProgramado.getTime());

  let cadenaInicio = intervalos[0]!.inicioProgramado;
  let cadenaFin = intervalos[0]!.finProgramado;
  let maxCadenaMs = 0;
  for (let i = 1; i < intervalos.length; i++) {
    const cur = intervalos[i]!;
    if (cur.inicioProgramado.getTime() <= cadenaFin.getTime()) {
      if (cur.finProgramado.getTime() > cadenaFin.getTime()) cadenaFin = cur.finProgramado;
    } else {
      maxCadenaMs = Math.max(maxCadenaMs, cadenaFin.getTime() - cadenaInicio.getTime());
      cadenaInicio = cur.inicioProgramado;
      cadenaFin = cur.finProgramado;
    }
  }
  maxCadenaMs = Math.max(maxCadenaMs, cadenaFin.getTime() - cadenaInicio.getTime());
  const horas = maxCadenaMs / 3_600_000;

  if (horas > 24 && !params.justificacion24h) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Esta asignación deja al usuario con ${horas.toFixed(1)}h continuas de turno (> 24h). Requiere justificación explícita del jefe médico.`,
      cause: { horasContinuas: horas },
    });
  }
}

interface DotacionShortfall {
  plantillaTurnoId: string;
  nombre: string;
  fecha: string;
  dotacionRequerida: number;
  dotacionActual: number;
}

/** US.AFIL.1.10.4 — dotación por debajo de `dotacionRequerida` para algún día/turno del período. */
async function computeDotacionShortfalls(
  tx: PrismaClient,
  prog: { id: string; establishmentId: string; periodoDesde: Date; periodoHasta: Date },
): Promise<DotacionShortfall[]> {
  const plantillas = await tx.plantillaTurno.findMany({
    where: { establishmentId: prog.establishmentId, active: true },
    select: { id: true, nombre: true, dotacionRequerida: true },
  });
  if (plantillas.length === 0) return [];

  const asignaciones = await tx.asignacionTurno.findMany({
    where: { programacionId: prog.id, estado: { not: "AUSENTE" } },
    select: { plantillaTurnoId: true, fecha: true },
  });
  const countByKey = new Map<string, number>();
  for (const a of asignaciones) {
    const key = `${a.plantillaTurnoId}|${a.fecha.toISOString().slice(0, 10)}`;
    countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
  }

  const shortfalls: DotacionShortfall[] = [];
  const hasta = prog.periodoHasta.toISOString().slice(0, 10);
  for (let d = prog.periodoDesde.toISOString().slice(0, 10); d <= hasta; d = addDays(d, 1)) {
    for (const pt of plantillas) {
      const actual = countByKey.get(`${pt.id}|${d}`) ?? 0;
      if (actual < pt.dotacionRequerida) {
        shortfalls.push({
          plantillaTurnoId: pt.id,
          nombre: pt.nombre,
          fecha: d,
          dotacionRequerida: pt.dotacionRequerida,
          dotacionActual: actual,
        });
      }
    }
  }
  return shortfalls;
}

export const turnoRouter = router({
  plantilla: router({
    list: leerProc.input(plantillaTurnoListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.plantillaTurno.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input?.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input?.tipo ? { tipo: input.tipo } : {}),
            ...(input?.activeOnly ? { active: true } : {}),
          },
          orderBy: [{ establishmentId: "asc" }, { horaInicio: "asc" }],
        }),
      );
    }),

    create: programarProc.input(plantillaTurnoCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        await assertScopeEstablecimiento(tx, tenant, input.establishmentId);
        try {
          return await tx.plantillaTurno.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: input.establishmentId,
              serviceUnitId: input.serviceUnitId ?? null,
              codigo: input.codigo,
              nombre: input.nombre,
              horaInicio: toTimeColumnValue(input.horaInicio),
              horaFin: toTimeColumnValue(input.horaFin),
              tipo: input.tipo,
              dotacionRequerida: input.dotacionRequerida,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
        } catch (err) {
          rethrowCodigoDuplicado(err, input.codigo);
        }
      });
    }),

    update: programarProc.input(plantillaTurnoUpdateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.plantillaTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla de turno no encontrada." });
        }
        await assertScopeEstablecimiento(tx, tenant, existing.establishmentId);
        return tx.plantillaTurno.update({
          where: { id: input.id },
          data: {
            ...(input.serviceUnitId !== undefined ? { serviceUnitId: input.serviceUnitId } : {}),
            ...(input.nombre !== undefined ? { nombre: input.nombre } : {}),
            ...(input.horaInicio !== undefined
              ? { horaInicio: toTimeColumnValue(input.horaInicio) }
              : {}),
            ...(input.horaFin !== undefined ? { horaFin: toTimeColumnValue(input.horaFin) } : {}),
            ...(input.dotacionRequerida !== undefined
              ? { dotacionRequerida: input.dotacionRequerida }
              : {}),
            updatedBy: user.id,
          },
        });
      });
    }),

    /** US.AFIL.1.9.3 — no se puede desactivar con asignaciones futuras. */
    setActive: programarProc.input(plantillaTurnoSetActiveSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const existing = await tx.plantillaTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Plantilla de turno no encontrada." });
        }
        if (existing.active === input.active) return existing;

        if (!input.active) {
          const hoy = new Date().toISOString().slice(0, 10);
          const futuras = await tx.asignacionTurno.count({
            where: {
              plantillaTurnoId: input.id,
              fecha: { gte: new Date(`${hoy}T00:00:00Z`) },
              estado: { in: [...VIGENTES] },
            },
          });
          if (futuras > 0) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: `No se puede desactivar: tiene ${futuras} asignación(es) futura(s) vigente(s).`,
            });
          }
        }
        return tx.plantillaTurno.update({
          where: { id: input.id },
          data: { active: input.active, updatedBy: user.id },
        });
      });
    }),

    /** US.AFIL.1.9.2 — huecos horarios no cubiertos en un día tipo de 24h. */
    cobertura: leerProc.input(plantillaTurnoCoberturaSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const plantillas = await withTenantContext(prisma, tenant, (tx) =>
        tx.plantillaTurno.findMany({
          where: {
            organizationId: tenant.organizationId,
            establishmentId: input.establishmentId,
            tipo: input.tipo,
            active: true,
          },
          orderBy: { horaInicio: "asc" },
        }),
      );

      const intervalos: Array<[number, number]> = [];
      for (const pt of plantillas) {
        const s = toMinutes(pt.horaInicio);
        const e = toMinutes(pt.horaFin);
        if (pt.cruzaMedianoche) {
          intervalos.push([s, 1440]);
          intervalos.push([0, e]);
        } else {
          intervalos.push([s, e]);
        }
      }
      intervalos.sort((a, b) => a[0] - b[0]);

      const merged: Array<[number, number]> = [];
      for (const [s, e] of intervalos) {
        const last = merged[merged.length - 1];
        if (last && s <= last[1]) {
          last[1] = Math.max(last[1], e);
        } else {
          merged.push([s, e]);
        }
      }

      const huecos: Array<{ desde: string; hasta: string }> = [];
      let cursor = 0;
      for (const [s, e] of merged) {
        if (s > cursor) huecos.push({ desde: fromMinutes(cursor), hasta: fromMinutes(s) });
        cursor = Math.max(cursor, e);
      }
      if (cursor < 1440) huecos.push({ desde: fromMinutes(cursor), hasta: "24:00" });

      return { plantillas, huecos };
    }),
  }),

  programacion: router({
    list: leerProc.input(programacionTurnoListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.programacionTurno.findMany({
          where: {
            organizationId: tenant.organizationId,
            ...(input.establishmentId ? { establishmentId: input.establishmentId } : {}),
            ...(input.estado ? { estado: input.estado } : {}),
          },
          orderBy: { periodoDesde: "desc" },
        }),
      );
    }),

    get: leerProc.input(programacionTurnoGetSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const prog = await tx.programacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: {
            asignaciones: {
              include: {
                plantillaTurno: true,
                user: { select: { id: true, fullName: true } },
                sustituto: { select: { id: true, fullName: true } },
              },
              orderBy: [{ fecha: "asc" }],
            },
          },
        });
        if (!prog) throw new TRPCError({ code: "NOT_FOUND", message: "Programación de turnos no encontrada." });
        return prog;
      });
    }),

    create: programarProc.input(programacionTurnoCreateSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        await assertScopeEstablecimiento(tx, tenant, input.establishmentId);
        try {
          return await tx.programacionTurno.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: input.establishmentId,
              periodoDesde: new Date(`${input.periodoDesde}T00:00:00Z`),
              periodoHasta: new Date(`${input.periodoHasta}T00:00:00Z`),
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Ya existe una programación de turnos para ese establecimiento y período.",
            });
          }
          throw err;
        }
      });
    }),

    /** US.AFIL.1.10.4 — bloquea con dotación descubierta salvo autorización explícita. */
    publicar: publicarProc.input(programacionTurnoPublicarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const prog = await tx.programacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!prog) throw new TRPCError({ code: "NOT_FOUND", message: "Programación de turnos no encontrada." });
        if (prog.estado !== "BORRADOR") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Solo se puede publicar una programación en BORRADOR.",
          });
        }
        await assertScopeEstablecimiento(tx, tenant, prog.establishmentId);

        const shortfalls = await computeDotacionShortfalls(tx, prog);
        const puedeAutorizarDescubierto = ctx.effectivePermissions?.get("turno.autorizar_descubierto") === "ALLOW";
        if (shortfalls.length > 0 && (!input.autorizaDescubiertoMotivo || !puedeAutorizarDescubierto)) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Dotación descubierta en ${shortfalls.length} turno(s)/día del período. Requiere motivo y permiso turno:autorizar_descubierto.`,
            // `causas` (no `shortfalls`) a propósito — reutiliza el reenvío
            // genérico de `error.cause.causas` -> `data.causas` que ya hace
            // el errorFormatter de trpc.ts (RN-HIS-BOT-001 R11), así la UI
            // puede listar el detalle sin tocar trpc.ts.
            cause: { causas: shortfalls },
          });
        }

        return tx.programacionTurno.update({
          where: { id: input.id },
          data: {
            estado: "PUBLICADA",
            publicadaBy: user.id,
            publicadaAt: new Date(),
            updatedBy: user.id,
            ...(shortfalls.length > 0
              ? { autorizaDescubiertoBy: user.id, autorizaDescubiertoMotivo: input.autorizaDescubiertoMotivo }
              : {}),
          },
        });
      });
    }),

    cerrar: publicarProc.input(programacionTurnoCerrarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const prog = await tx.programacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!prog) throw new TRPCError({ code: "NOT_FOUND", message: "Programación de turnos no encontrada." });
        if (prog.estado !== "PUBLICADA") {
          throw new TRPCError({ code: "CONFLICT", message: "Solo se puede cerrar una programación PUBLICADA." });
        }
        await assertScopeEstablecimiento(tx, tenant, prog.establishmentId);
        return tx.programacionTurno.update({
          where: { id: input.id },
          data: { estado: "CERRADA", updatedBy: user.id },
        });
      });
    }),
  }),

  asignacion: router({
    list: leerProc.input(asignacionTurnoListSchema).query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, (tx) =>
        tx.asignacionTurno.findMany({
          where: { organizationId: tenant.organizationId, programacionId: input.programacionId },
          include: {
            plantillaTurno: true,
            user: { select: { id: true, fullName: true } },
            sustituto: { select: { id: true, fullName: true } },
          },
          orderBy: [{ fecha: "asc" }],
        }),
      );
    }),

    /** US.AFIL.1.10.1/2/3 — solo en BORRADOR; antitraslape (DB) + advertencia >24h continuas. */
    asignar: programarProc.input(asignacionTurnoAsignarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const prog = await tx.programacionTurno.findFirst({
          where: { id: input.programacionId, organizationId: tenant.organizationId },
        });
        if (!prog) throw new TRPCError({ code: "NOT_FOUND", message: "Programación de turnos no encontrada." });
        if (prog.estado !== "BORRADOR") {
          throw new TRPCError({ code: "CONFLICT", message: "Solo se puede asignar en una programación BORRADOR." });
        }
        await assertScopeEstablecimiento(tx, tenant, prog.establishmentId);

        const plantilla = await tx.plantillaTurno.findFirst({
          where: { id: input.plantillaTurnoId, establishmentId: prog.establishmentId, active: true },
        });
        if (!plantilla) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Plantilla de turno no encontrada o inactiva en este establecimiento.",
          });
        }

        const { inicioProgramado, finProgramado } = calcularRangoTurno(input.fecha, plantilla);

        await assertSinExceso24h(tx, {
          userId: input.userId,
          inicioProgramado,
          finProgramado,
          justificacion24h: input.justificacion24h,
        });

        try {
          return await tx.asignacionTurno.create({
            data: {
              organizationId: tenant.organizationId,
              establishmentId: prog.establishmentId,
              programacionId: prog.id,
              plantillaTurnoId: plantilla.id,
              userId: input.userId,
              fecha: new Date(`${input.fecha}T00:00:00Z`),
              inicioProgramado,
              finProgramado,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
        } catch (err) {
          rethrowAsignacionConflict(err);
        }
      });
    }),

    quitar: programarProc.input(asignacionTurnoQuitarSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const asignacion = await tx.asignacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: { programacion: { select: { estado: true, establishmentId: true } } },
        });
        if (!asignacion) throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
        if (asignacion.programacion.estado !== "BORRADOR") {
          throw new TRPCError({ code: "CONFLICT", message: "Solo se puede quitar una asignación en BORRADOR." });
        }
        await assertScopeEstablecimiento(tx, tenant, asignacion.programacion.establishmentId);
        await tx.asignacionTurno.delete({ where: { id: input.id } });
        return { id: input.id };
      });
    }),

    /**
     * US.AFIL.1.10.5 — sustitución sobre programación PUBLICADA. Notifica al
     * sustituto (best-effort, no bloquea la sustitución — mismo contrato de
     * fallo que `care-task-consumer.ts` para `task.action_required`).
     */
    sustituir: sustituirProc.input(asignacionTurnoSustituirSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const asignacion = await tx.asignacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
          include: {
            programacion: { select: { estado: true, establishmentId: true } },
            plantillaTurno: { select: { nombre: true, tipo: true } },
          },
        });
        if (!asignacion) throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
        if (asignacion.programacion.estado !== "PUBLICADA") {
          throw new TRPCError({ code: "CONFLICT", message: "Solo se puede sustituir un turno de una programación PUBLICADA." });
        }
        if (!VIGENTES.includes(asignacion.estado)) {
          throw new TRPCError({ code: "CONFLICT", message: `No se puede sustituir un turno en estado ${asignacion.estado}.` });
        }
        await assertScopeEstablecimiento(tx, tenant, asignacion.programacion.establishmentId);

        const updated = await tx.asignacionTurno.update({
          where: { id: input.id },
          data: {
            estado: "SUSTITUIDO",
            sustitutoUserId: input.sustitutoUserId,
            motivoCambio: input.motivo,
            updatedBy: user.id,
          },
        });

        try {
          const assignedRoleCode =
            asignacion.plantillaTurno.tipo === "ENFERMERIA" ? "NURSE" : "PHYSICIAN";
          await emitDomainEvent(tx, {
            organizationId: tenant.organizationId,
            eventType: "task.action_required",
            aggregateType: "AsignacionTurno",
            aggregateId: updated.id,
            emittedById: user.id,
            payload: {
              taskType: "TURNO_SUSTITUCION",
              sourceType: "ASIGNACION_TURNO",
              sourceId: updated.id,
              assignedRoleCode,
              establishmentId: asignacion.programacion.establishmentId,
              serviceUnitId: null,
              dueAt: updated.inicioProgramado.toISOString(),
              url: "/turnos",
              resumen: `Sustitución de turno "${asignacion.plantillaTurno.nombre}" — ${input.motivo}`,
            },
          });
        } catch (err) {
          console.error(
            `[turno.router] emitDomainEvent(task.action_required) falló para AsignacionTurno ${updated.id} — la sustitución se registró igual.`,
            err,
          );
        }

        return updated;
      });
    }),

    /** US.AFIL.1.10.7 — marca ingreso real; propio usuario (titular o sustituto) o `turno.programar`. */
    marcarInicio: tenantProcedure.input(asignacionTurnoMarcarInicioSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const asignacion = await tx.asignacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!asignacion) throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
        const esTitular = asignacion.userId === user.id || asignacion.sustitutoUserId === user.id;
        if (!esTitular && !tenant.roleCodes.some((r) => ["JEFE_MEDICO_SEDE", "ADMIN", "DIR"].includes(r))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo el titular del turno o el jefe médico pueden marcar el ingreso." });
        }
        if (asignacion.inicioReal) return asignacion; // idempotente
        return tx.asignacionTurno.update({
          where: { id: input.id },
          data: { inicioReal: new Date(), estado: "EN_CURSO", updatedBy: user.id },
        });
      });
    }),

    marcarFin: tenantProcedure.input(asignacionTurnoMarcarFinSchema).mutation(async ({ ctx, input }) => {
      const { tenant, prisma, user } = ctx;
      return withTenantContext(prisma, tenant, async (tx) => {
        const asignacion = await tx.asignacionTurno.findFirst({
          where: { id: input.id, organizationId: tenant.organizationId },
        });
        if (!asignacion) throw new TRPCError({ code: "NOT_FOUND", message: "Asignación no encontrada." });
        const esTitular = asignacion.userId === user.id || asignacion.sustitutoUserId === user.id;
        if (!esTitular && !tenant.roleCodes.some((r) => ["JEFE_MEDICO_SEDE", "ADMIN", "DIR"].includes(r))) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Solo el titular del turno o el jefe médico pueden marcar el cierre." });
        }
        if (asignacion.finReal) return asignacion; // idempotente
        return tx.asignacionTurno.update({
          where: { id: input.id },
          data: { finReal: new Date(), estado: "CUMPLIDO", updatedBy: user.id },
        });
      });
    }),
  }),

  /**
   * US.AFIL.1.11 — resuelve el médico/enfermero de turno vigente en una
   * sede. `fn_medico_de_turno` es SECURITY DEFINER (corre con el rol
   * propietario, BYPASSRLS) — no requiere `withTenantContext`, igual que su
   * uso desde `care-task-consumer.ts` bajo contexto ECE. NFR-1: p95 < 150ms
   * (índice parcial `idx_asignacion_turno_vigente`, sql/243).
   */
  medicoDeTurno: leerProc.input(medicoDeTurnoSchema).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    // `fn_medico_de_turno` es SECURITY DEFINER y filtra solo por
    // establishmentId (bypassa RLS por diseño — lo necesitan callers sin
    // contexto de tenant, ver care-task-consumer.ts). Sin este chequeo,
    // cualquier usuario con turno.leer en SU organización podría pasar el
    // establishmentId de OTRA organización y leer quién está de guardia ahí
    // (hallazgo de revisión pre-PR). withTenantContext aplica RLS real sobre
    // Establishment (defensa primaria); el `where` explícito es defensa en
    // profundidad, no el único candado.
    const establishment = await withTenantContext(prisma, tenant, (tx) =>
      tx.establishment.findFirst({
        where: { id: input.establishmentId, organizationId: tenant.organizationId },
        select: { id: true },
      }),
    );
    if (!establishment) {
      throw new TRPCError({ code: "FORBIDDEN", message: "Establecimiento fuera de tu organización." });
    }

    const at = input.at ? new Date(input.at) : new Date();
    const rows = await prisma.$queryRaw<
      Array<{ userId: string; fullName: string; plantillaTurnoId: string; tipo: string }>
    >`SELECT * FROM public.fn_medico_de_turno(${input.establishmentId}::uuid, ${at}::timestamptz)`;
    return rows;
  }),
});
