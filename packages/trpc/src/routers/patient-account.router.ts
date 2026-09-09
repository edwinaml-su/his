/**
 * CC-0002 §7 — Cuentas y Servicios de Paciente.
 *
 * PatientAccount: correlativo CTA00001 por expediente (por patientId).
 * PatientAccountService: tipo HOSPITALARIO | NO_HOSPITALARIO.
 * encounterId es opcional en ambos — un paciente ambulatorio puede generar
 * una cuenta sin admisión asociada.
 *
 * CC-0015: `crear` ahora requiere `tipoCuentaId` (pivote de lista de precios
 * de los cargos de la cuenta) y acepta un `servicio` opcional para crear
 * cuenta + primer servicio en un solo paso.
 *
 * docs/48 Ola 1 (C1-5) — `crear` fija `status` (ABIERTA salvo
 * `emergenciaSinPagador: true`, RN-HIS-BOT-001 R1 → PENDIENTE_REGULARIZAR).
 *
 * docs/48 Ola 4 (C4-1) — `cerrar` bloquea con PRECONDITION_FAILED listando
 * TODAS las causas presentes: cargos PENDIENTE_TARIFA, cuenta
 * PENDIENTE_REGULARIZAR, devoluciones de farmacia sin reversión. `regularizar`
 * resuelve la segunda causa (asigna tipoCuentaId y pasa a ABIERTA) — no hay
 * procedure de reapertura post-cierre: es una decisión administrativa futura,
 * fuera de alcance de este plan.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { nextCuenta } from "../lib/cuenta-numbering";

const tipoServicioEnum = z.enum(["HOSPITALARIO", "NO_HOSPITALARIO"]);

/** Fila del worklist de cobro: 1 por expediente con saldo agregado + área actual. */
interface WorklistRow {
  patientId: string;
  expediente: string | null;
  mrn: string | null;
  nombreCompleto: string;
  documentNumber: string | null;
  sexo: string | null;
  edad: number | null;
  saldo: number;
  facturasPendientes: number;
  areaUnidad: string | null;
  areaCama: string | null;
}

export const patientAccountRouter = router({
  /**
   * Crea una nueva cuenta para un paciente.
   * Genera el correlativo CTA{NNNNN} de forma atómica vía fn_next_cuenta.
   *
   * CC-0015: `tipoCuentaId` es requerido (pivote de lista de precios de los
   * cargos de la cuenta) — se valida que exista, esté activo y pertenezca al
   * tenant. `servicio` opcional crea el primer PatientAccountService en el
   * mismo paso (usado por el selector-cuenta inline).
   */
  crear: tenantProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
        tipoCuentaId: z.string().uuid(),
        /** docs/48 (RN-HIS-BOT-001 R1) — emergencia sin pagador definido: abre PENDIENTE_REGULARIZAR. */
        emergenciaSinPagador: z.boolean().optional(),
        servicio: z
          .object({
            tipo: tipoServicioEnum,
            descripcion: z.string().max(300).optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const tipoCuenta = await tx.tipoCuenta.findFirst({
          where: {
            id: input.tipoCuentaId,
            organizationId: ctx.tenant.organizationId,
            active: true,
          },
        });
        if (!tipoCuenta) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tipo de cuenta no encontrado o inactivo.",
          });
        }

        const numeroCuenta = await nextCuenta(tx, input.patientId);
        const account = await tx.patientAccount.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            patientId: input.patientId,
            encounterId: input.encounterId ?? null,
            tipoCuentaId: input.tipoCuentaId,
            status: input.emergenciaSinPagador ? "PENDIENTE_REGULARIZAR" : "ABIERTA",
            numeroCuenta,
            createdBy: ctx.user.id,
          },
        });

        if (input.servicio) {
          await tx.patientAccountService.create({
            data: {
              accountId: account.id,
              tipo: input.servicio.tipo,
              descripcion: input.servicio.descripcion ?? null,
              encounterId: input.encounterId ?? null,
              createdBy: ctx.user.id,
            },
          });
        }

        return account;
      });
    }),

  /**
   * Agrega un servicio a una cuenta existente.
   */
  agregarServicio: tenantProcedure
    .input(
      z.object({
        accountId: z.string().uuid(),
        tipo: tipoServicioEnum,
        descripcion: z.string().max(300).optional(),
        encounterId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.patientAccountService.create({
          data: {
            accountId: input.accountId,
            tipo: input.tipo,
            descripcion: input.descripcion ?? null,
            encounterId: input.encounterId ?? null,
            createdBy: ctx.user.id,
          },
        });
      });
    }),

  /**
   * Lista cuentas de un paciente con sus servicios y tipo de cuenta incluidos.
   */
  listarPorPaciente: tenantProcedure
    .input(z.object({ patientId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.patientAccount.findMany({
          where: {
            patientId: input.patientId,
            organizationId: ctx.tenant.organizationId,
          },
          include: {
            servicios: true,
            tipoCuenta: { select: { id: true, code: true, nombre: true } },
          },
          orderBy: { numeroCuenta: "asc" },
        });
      });
    }),

  /**
   * Worklist de cobro (CC-0008 §grid /patients).
   * Una fila por expediente con saldo agregado de facturas + área actual.
   *
   * - vista "pendientes": expedientes con saldo > 0 (factura ISSUED/PARTIALLY_PAID).
   * - vista "cerradas": expedientes con todas las facturas pagadas (saldo <= 0).
   * - Área actual: encuentro abierto (dischargedAt NULL) → unidad + cama activa;
   *   sin encuentro abierto → null (la UI muestra "Egresado").
   *
   * El saldo se deriva solo de Invoice porque PatientAccount no tiene estado.
   */
  listarWorklist: tenantProcedure
    .input(
      z.object({
        vista: z.enum(["pendientes", "cerradas"]).default("pendientes"),
        nombre: z.string().trim().min(1).optional(),
        documento: z.string().trim().min(1).optional(),
        expediente: z.string().trim().min(1).optional(),
        biologicalSexId: z.string().uuid().optional(),
        edadMin: z.number().int().min(0).max(150).optional(),
        edadMax: z.number().int().min(0).max(150).optional(),
        limit: z.number().int().min(1).max(100).default(25),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const orgId = tenant.organizationId;

      return withTenantContext(prisma, tenant, async (tx) => {
        const conditions: string[] = [
          // $1::uuid — con $queryRawUnsafe los strings JS bindan como text y
          // Postgres no tiene operador uuid = text (42883).
          `i."organizationId" = $1::uuid`,
          `i.status NOT IN ('VOIDED', 'DRAFT')`,
        ];
        const params: unknown[] = [orgId];
        let idx = 2;

        if (input.nombre) {
          conditions.push(
            `(p."firstName" || ' ' || COALESCE(p."middleName",'') || ' ' || p."lastName" || ' ' || COALESCE(p."secondLastName",'')) ILIKE '%' || $${idx++} || '%'`,
          );
          params.push(input.nombre);
        }
        if (input.documento) {
          conditions.push(`p."documentNumber" ILIKE '%' || $${idx++} || '%'`);
          params.push(input.documento);
        }
        if (input.expediente) {
          conditions.push(`p.expediente ILIKE '%' || $${idx++} || '%'`);
          params.push(input.expediente);
        }
        if (input.biologicalSexId) {
          conditions.push(`p."biologicalSexId" = $${idx++}::uuid`);
          params.push(input.biologicalSexId);
        }
        if (input.edadMin !== undefined) {
          conditions.push(`date_part('year', age(p."birthDate")) >= $${idx++}`);
          params.push(input.edadMin);
        }
        if (input.edadMax !== undefined) {
          conditions.push(`date_part('year', age(p."birthDate")) <= $${idx++}`);
          params.push(input.edadMax);
        }

        const having =
          input.vista === "pendientes"
            ? `SUM(i."totalAmount" - i."paidAmount") > 0`
            : `SUM(i."totalAmount" - i."paidAmount") <= 0`;

        params.push(input.limit, input.offset);

        const rows = await tx.$queryRawUnsafe<WorklistRow[]>(
          `SELECT
              p.id              AS "patientId",
              p.expediente      AS "expediente",
              p.mrn             AS "mrn",
              btrim(
                p."firstName" || ' ' || COALESCE(p."middleName",'') || ' ' ||
                p."lastName"  || ' ' || COALESCE(p."secondLastName",'')
              )                 AS "nombreCompleto",
              p."documentNumber" AS "documentNumber",
              bs.name           AS "sexo",
              CASE WHEN p."birthDate" IS NULL THEN NULL
                   ELSE date_part('year', age(p."birthDate"))::int END AS "edad",
              SUM(i."totalAmount" - i."paidAmount")::float8 AS "saldo",
              COUNT(*) FILTER (WHERE i.status IN ('ISSUED','PARTIALLY_PAID'))::int AS "facturasPendientes",
              area.unidad       AS "areaUnidad",
              area.cama         AS "areaCama"
           FROM "Invoice" i
           JOIN "Patient" p ON p.id = i."patientId" AND p."organizationId" = $1::uuid
           LEFT JOIN "BiologicalSex" bs ON bs.id = p."biologicalSexId"
           LEFT JOIN LATERAL (
             SELECT su.name AS unidad, bdsel.cama AS cama
             FROM "Encounter" e
             LEFT JOIN "ServiceUnit" su ON su.id = e."serviceUnitId"
             LEFT JOIN LATERAL (
               SELECT bd.code AS cama
               FROM "BedAssignment" ba
               JOIN "Bed" bd ON bd.id = ba."bedId"
               WHERE ba."encounterId" = e.id AND ba."releasedAt" IS NULL
               ORDER BY ba."assignedAt" DESC
               LIMIT 1
             ) bdsel ON true
             WHERE e."patientId" = p.id AND e."dischargedAt" IS NULL
             ORDER BY e."admittedAt" DESC
             LIMIT 1
           ) area ON true
          WHERE ${conditions.join(" AND ")}
          GROUP BY p.id, bs.name, area.unidad, area.cama
          HAVING ${having}
          ORDER BY "saldo" DESC, p."lastName" ASC
          LIMIT $${idx++} OFFSET $${idx++}`,
          ...params,
        );

        return rows.map((r) => ({
          ...r,
          egresado: r.areaUnidad === null,
        }));
      });
    }),

  /**
   * docs/48 Ola 4 (C4-1) — Cierre de cuenta bloqueante (RN-HIS-BOT-001 R11,
   * paso 23). Bloquea con PRECONDITION_FAILED listando TODAS las causas
   * presentes (no solo la primera encontrada):
   *   1. Cargos `status='PENDIENTE_TARIFA'` — conteo + primeros codes.
   *   2. Cuenta `status='PENDIENTE_REGULARIZAR'` — pagador sin definir (R1).
   *      Se resuelve con `regularizar`, no reintentando `cerrar`.
   *   3. Reservas de farmacia CANCELLED con cargo VIGENTE sin línea REVERSION
   *      (devolución sin reversión) — en el flujo normal `cancelReservation`
   *      ya revierte el cargo en la misma tx (docs/48 C2-4); esto atrapa
   *      anomalías (datos pre-Ola-2, intervención manual).
   * Sin causas → CERRADA + closedAt/closedBy. No hay reapertura: decisión
   * administrativa futura, fuera de alcance de este plan.
   */
  cerrar: tenantProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const account = await tx.patientAccount.findFirst({
          where: { id: input.accountId, organizationId: ctx.tenant.organizationId },
        });
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
        }
        if (account.status === "CERRADA") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "La cuenta ya está cerrada.",
          });
        }

        const causas: Array<Record<string, unknown>> = [];

        // 1. Cargos PENDIENTE_TARIFA.
        const pendientesTarifa = await tx.patientAccountService.findMany({
          where: { accountId: account.id, status: "PENDIENTE_TARIFA" },
          select: { code: true },
          orderBy: { createdAt: "asc" },
        });
        if (pendientesTarifa.length > 0) {
          causas.push({
            tipo: "CARGOS_PENDIENTE_TARIFA",
            mensaje: `${pendientesTarifa.length} cargo(s) sin tarifa resuelta.`,
            count: pendientesTarifa.length,
            codes: pendientesTarifa.slice(0, 10).map((c) => c.code),
          });
        }

        // 2. Cuenta PENDIENTE_REGULARIZAR (pagador sin definir — R1).
        if (account.status === "PENDIENTE_REGULARIZAR") {
          causas.push({
            tipo: "CUENTA_PENDIENTE_REGULARIZAR",
            mensaje: "La cuenta está PENDIENTE_REGULARIZAR (pagador sin definir). Use `regularizar` antes de cerrar.",
          });
        }

        // 3. Devoluciones de farmacia sin reversión: cargo VIGENTE cuya
        // referenciaId apunta a una PharmacyReservation CANCELLED. Sin
        // relación Prisma declarada entre ambas tablas (referenciaId es una
        // referencia lógica, no una FK) — dos pasos en vez de un join.
        const cargosDispensacionVigentes = await tx.patientAccountService.findMany({
          where: {
            accountId: account.id,
            status: "VIGENTE",
            origen: "DISPENSACION_FARMACIA",
            referenciaId: { not: null },
          },
          select: { id: true, referenciaId: true },
        });
        const referenciaIds = cargosDispensacionVigentes
          .map((c) => c.referenciaId)
          .filter((id): id is string => id !== null);
        let devolucionesSinReversion: typeof cargosDispensacionVigentes = [];
        if (referenciaIds.length > 0) {
          const reservasCanceladas = await tx.pharmacyReservation.findMany({
            where: { id: { in: referenciaIds }, status: "CANCELLED" },
            select: { id: true },
          });
          const canceladasSet = new Set(reservasCanceladas.map((r) => r.id));
          devolucionesSinReversion = cargosDispensacionVigentes.filter(
            (c) => c.referenciaId !== null && canceladasSet.has(c.referenciaId),
          );
        }
        if (devolucionesSinReversion.length > 0) {
          causas.push({
            tipo: "DEVOLUCION_SIN_REVERSION",
            mensaje: `${devolucionesSinReversion.length} cargo(s) VIGENTE con reserva de farmacia CANCELLED sin línea de reversión.`,
            count: devolucionesSinReversion.length,
            cargoIds: devolucionesSinReversion.map((c) => c.id),
          });
        }

        if (causas.length > 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `No se puede cerrar la cuenta: ${causas.length} causa(s) de bloqueo pendientes.`,
            cause: { causas } as unknown as Error,
          });
        }

        return tx.patientAccount.update({
          where: { id: account.id },
          data: { status: "CERRADA", closedAt: new Date(), closedBy: ctx.user.id },
        });
      });
    }),

  /**
   * docs/48 Ola 4 (C4-1) — Regulariza una cuenta PENDIENTE_REGULARIZAR:
   * asigna/cambia `tipoCuentaId` (resuelve "pagador sin definir", R1) y la
   * pasa a ABIERTA. Rol administrativo (mismo par ADMIN/ACCOUNTANT que
   * `tipoCuenta.router.ts`).
   */
  regularizar: requireRole(["ADMIN", "ACCOUNTANT"])
    .input(z.object({ accountId: z.string().uuid(), tipoCuentaId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const account = await tx.patientAccount.findFirst({
          where: { id: input.accountId, organizationId: ctx.tenant.organizationId },
        });
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
        }
        if (account.status !== "PENDIENTE_REGULARIZAR") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Solo cuentas PENDIENTE_REGULARIZAR pueden regularizarse (estado actual: ${account.status}).`,
          });
        }

        const tipoCuenta = await tx.tipoCuenta.findFirst({
          where: { id: input.tipoCuentaId, organizationId: ctx.tenant.organizationId, active: true },
        });
        if (!tipoCuenta) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Tipo de cuenta no encontrado o inactivo.",
          });
        }

        return tx.patientAccount.update({
          where: { id: account.id },
          data: { tipoCuentaId: input.tipoCuentaId, status: "ABIERTA" },
        });
      });
    }),
});
