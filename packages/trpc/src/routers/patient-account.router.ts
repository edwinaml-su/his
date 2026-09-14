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
import type { PrismaClient } from "@prisma/client";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { nextCuenta } from "../lib/cuenta-numbering";

const tipoServicioEnum = z.enum(["HOSPITALARIO", "NO_HOSPITALARIO"]);
const writerProc = requireRole(["ADMIN", "ACCOUNTANT"]);

/** CC-0027 — documento de aceptación de deuda que formaliza la ruta CXC. */
const documentoCxcInput = z.object({
  documentoTipo: z.enum(["PAGARE", "CONVENIO_PAGO", "RECONOCIMIENTO_DEUDA"]),
  folioDocumento: z.string().trim().min(1).max(80),
  firmanteTipo: z.enum(["PACIENTE", "FIADOR"]),
  firmanteNombre: z.string().trim().min(1).max(200),
  firmanteDocumento: z.string().trim().min(1).max(40),
  plazoDias: z.number().int().positive().max(3650).optional(),
  notas: z.string().max(500).optional(),
});

const altaAdministrativaInput = z.discriminatedUnion("ruta", [
  z.object({ accountId: z.string().uuid(), ruta: z.literal("CANCELACION_TOTAL") }),
  z.object({ accountId: z.string().uuid(), ruta: z.literal("CXC"), documento: documentoCxcInput }),
]);

/** Saldo se considera liquidado por debajo de este umbral (redondeo de centavos). */
const SALDO_EPSILON = 0.005;

/**
 * docs/48 Ola 4 (C4-1) / CC-0027 — las mismas 6 causas de bloqueo de
 * `cerrar`, extraídas para que `altaAdministrativa` (CC-0027 Fase 2) las
 * reutilice sin duplicar la lógica. Ver comentario original en `cerrar` para
 * el detalle de cada causa.
 */
async function computeCausasBloqueoCierre(
  tx: PrismaClient,
  organizationId: string,
  account: { id: string; status: string; patientId: string },
): Promise<Array<Record<string, unknown>>> {
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

  // 4. docs/48 Ola 4b (H-16) — cargos DISPENSACION_FARMACIA VIGENTE sin
  // StockMovement OUT asociado (espejo de
  // conciliacion-cargos.cargosSinMovimiento). Reutiliza
  // `cargosDispensacionVigentes`/`referenciaIds` del punto 3 — no
  // vuelve a consultar los cargos de la cuenta.
  let cargosSinMovimiento: typeof cargosDispensacionVigentes = [];
  if (referenciaIds.length > 0) {
    const movimientosConfirmados = await tx.stockMovement.findMany({
      where: {
        organizationId,
        type: "OUT",
        referenceCode: { in: referenciaIds },
      },
      select: { referenceCode: true },
    });
    const referenciasConMovimiento = new Set(
      movimientosConfirmados
        .map((m) => m.referenceCode)
        .filter((c): c is string => c !== null),
    );
    cargosSinMovimiento = cargosDispensacionVigentes.filter(
      (c) => c.referenciaId !== null && !referenciasConMovimiento.has(c.referenciaId),
    );
  }
  if (cargosSinMovimiento.length > 0) {
    causas.push({
      tipo: "CARGOS_SIN_MOVIMIENTO",
      mensaje: `${cargosSinMovimiento.length} cargo(s) de dispensación sin movimiento de inventario asociado.`,
      count: cargosSinMovimiento.length,
      cargoIds: cargosSinMovimiento.map((c) => c.id),
    });
  }

  // 5. docs/48 Ola 4b (H-16) — dispensado sin cargo, acotado a esta
  // cuenta (espejo de conciliacion-cargos.dispensadoSinCargo): reservas
  // de farmacia de ESTE paciente con StockMovement OUT confirmado
  // (vínculo estructural StockMovement↔PharmacyReservation de H-15)
  // pero sin ningún cargo de esta cuenta cuya referenciaId apunte a
  // esa reserva.
  const reservasPaciente = await tx.pharmacyReservation.findMany({
    where: {
      organizationId,
      patientId: account.patientId,
      status: { notIn: ["CANCELLED", "EXPIRED"] },
    },
    select: { id: true },
  });
  let dispensadoSinCargo: string[] = [];
  if (reservasPaciente.length > 0) {
    const reservaIds = reservasPaciente.map((r) => r.id);
    const movimientosDeReservas = await tx.stockMovement.findMany({
      where: {
        organizationId,
        type: "OUT",
        referenceCode: { in: reservaIds },
      },
      select: { referenceCode: true },
    });
    const reservaIdsConMovimiento = [
      ...new Set(
        movimientosDeReservas
          .map((m) => m.referenceCode)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (reservaIdsConMovimiento.length > 0) {
      const cargosDeEstaCuenta = await tx.patientAccountService.findMany({
        where: { accountId: account.id, referenciaId: { in: reservaIdsConMovimiento } },
        select: { referenciaId: true },
      });
      const reservaIdsConCargo = new Set(
        cargosDeEstaCuenta.map((c) => c.referenciaId).filter((id): id is string => id !== null),
      );
      dispensadoSinCargo = reservaIdsConMovimiento.filter(
        (id) => !reservaIdsConCargo.has(id),
      );
    }
  }
  if (dispensadoSinCargo.length > 0) {
    causas.push({
      tipo: "DISPENSADO_SIN_CARGO",
      mensaje: `${dispensadoSinCargo.length} dispensación(es) con movimiento de inventario confirmado sin cargo en esta cuenta.`,
      count: dispensadoSinCargo.length,
      reservationIds: dispensadoSinCargo,
    });
  }

  // 6. SQL 232 — dispensación sin cierre: reservas de farmacia de ESTE
  // paciente en estado RESERVED/DISPATCHED (ver hallazgo en
  // dispensation.router.ts RETURN_ITEM_OPEN_STATUSES — el flujo real
  // solo produce RESERVED) que nunca se cerraron a ADMINISTERED ni
  // RETURNED. Espejo acotado de conciliacion-cargos.despachadoSinCierre.
  const reservasSinCierre = await tx.pharmacyReservation.findMany({
    where: {
      organizationId,
      patientId: account.patientId,
      status: { in: ["RESERVED", "DISPATCHED"] },
    },
    select: { id: true },
  });
  if (reservasSinCierre.length > 0) {
    causas.push({
      tipo: "DISPENSACION_SIN_CIERRE",
      mensaje: `${reservasSinCierre.length} dispensación(es) despachada(s) sin registrar administración ni devolución.`,
      count: reservasSinCierre.length,
      reservationIds: reservasSinCierre.map((r) => r.id),
    });
  }

  return causas;
}

interface Liquidacion {
  totalCargos: number;
  totalPagos: number;
  coberturaAprobada: number;
  saldo: number;
}

/**
 * CC-0027 — total cargos VIGENTE (PatientAccountService) − pagos
 * (InvoicePayment de las facturas ancladas a la cuenta) − cobertura
 * aprobada (CoverageLetter) = saldo. No compone con
 * `conciliacionCargos.resumen`: ese reporte cuenta BRECHAS clínico-
 * financieras en un rango de fechas (indicaciones sin dispensar, cargos
 * sin movimiento, etc.), no un saldo corriente de una cuenta puntual —
 * son complementarios, no sustituibles entre sí.
 */
async function computeLiquidacion(tx: PrismaClient, accountId: string): Promise<Liquidacion> {
  const [cargosAgg, invoices, coberturaAgg] = await Promise.all([
    tx.patientAccountService.aggregate({
      where: { accountId, status: "VIGENTE" },
      _sum: { totalPrice: true },
    }),
    tx.invoice.findMany({
      where: { patientAccountId: accountId },
      select: { id: true },
    }),
    tx.coverageLetter.aggregate({
      where: { accountId },
      _sum: { montoAprobado: true },
    }),
  ]);

  const invoiceIds = invoices.map((i) => i.id);
  const pagosAgg =
    invoiceIds.length > 0
      ? await tx.invoicePayment.aggregate({
          where: { invoiceId: { in: invoiceIds } },
          _sum: { amount: true },
        })
      : null;

  const totalCargos = Number(cargosAgg._sum.totalPrice ?? 0);
  const totalPagos = Number(pagosAgg?._sum.amount ?? 0);
  const coberturaAprobada = Number(coberturaAgg._sum.montoAprobado ?? 0);

  return {
    totalCargos,
    totalPagos,
    coberturaAprobada,
    saldo: totalCargos - totalPagos - coberturaAprobada,
  };
}

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
            // CC-0027 — egresoAutorizadoAt indica si la Fase 2 ya liberó el
            // egreso físico del encuentro (puede quedar pendiente si otra
            // PatientAccount del mismo encuentro sigue activa).
            encounter: { select: { id: true, egresoAutorizadoAt: true } },
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
   * docs/48 Ola 4b (H-18) — comentario corregido: `PatientAccount.status` SÍ
   * existe desde Ola 1 (C1-5, ABIERTA/PENDIENTE_REGULARIZAR/CERRADA), pero es
   * administrativo y no refleja saldo pendiente de pago — eso lo determina
   * `Invoice.status`/`paidAmount`. El saldo se deriva de `Invoice` (no de
   * `PatientAccount`, que ni siquiera se joinea aquí) por eso, no porque a
   * `PatientAccount` le falte estado.
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
   *   4. docs/48 Ola 4b (H-16) — Cargos DISPENSACION_FARMACIA VIGENTE sin
   *      StockMovement OUT asociado (espejo de
   *      `conciliacion-cargos.cargosSinMovimiento`, acotado a esta cuenta).
   *   5. docs/48 Ola 4b (H-16) — Reservas de farmacia de este paciente con
   *      StockMovement OUT confirmado pero sin cargo en esta cuenta (espejo
   *      de `conciliacion-cargos.dispensadoSinCargo`, vínculo estructural
   *      StockMovement↔PharmacyReservation de H-15).
   *   6. SQL 232 — Reservas de farmacia de este paciente despachadas
   *      (RESERVED/DISPATCHED) sin cerrar a ADMINISTERED/RETURNED (espejo de
   *      `conciliacion-cargos.despachadoSinCierre`).
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

        const causas = await computeCausasBloqueoCierre(tx, ctx.tenant.organizationId, account);

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

  /**
   * CC-0027 — desglose de liquidación de la cuenta: total cargos VIGENTE −
   * pagos − cobertura aprobada = saldo. Base para las dos rutas de alta
   * administrativa (ver `computeLiquidacion`).
   */
  liquidacion: tenantProcedure
    .input(z.object({ accountId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const account = await tx.patientAccount.findFirst({
          where: { id: input.accountId, organizationId: ctx.tenant.organizationId },
          select: { id: true },
        });
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta no encontrada." });
        }
        return computeLiquidacion(tx, account.id);
      });
    }),

  /**
   * CC-0027 — Alta administrativa (Fase 2 del alta hospitalaria en dos
   * fases). Precondiciones:
   *   1. Si la cuenta tiene un encuentro vinculado, ese encuentro debe tener
   *      alta médica registrada (Fase 1, `Encounter.dischargedAt`).
   *   2. Las mismas 6 causas de bloqueo de `cerrar` deben estar limpias.
   * Rutas (mutuamente excluyentes, `input.ruta`):
   *   - CANCELACION_TOTAL: exige saldo ≤ 0 (epsilon de centavos) — pagos y/o
   *     cobertura aprobada cubren el 100% de los cargos.
   *   - CXC: exige saldo > 0 — crea `AccountReceivable` con el documento de
   *     aceptación de deuda (pagaré/convenio/reconocimiento) firmado por el
   *     paciente o un fiador solidario.
   * En ambos casos: PatientAccount → CERRADA + altaAdministrativaAt/By/
   * altaRuta (reutiliza la transición de `cerrar`, sin duplicarla). Si hay
   * encuentro vinculado Y ninguna otra PatientAccount de ese encuentro sigue
   * activa, se libera la cama diferida desde Fase 1 (ver
   * `encounter-discharge.router.ts` / `lib/egreso-fisico-gate.ts`) y se
   * marca `Encounter.egresoAutorizadoAt/By` — la autorización de egreso
   * físico que exige el gate de `bed.release`.
   */
  altaAdministrativa: writerProc.input(altaAdministrativaInput).mutation(async ({ ctx, input }) => {
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

      // 1. Alta médica (Fase 1) del encuentro vinculado, si existe.
      if (account.encounterId) {
        const encounter = await tx.encounter.findFirst({
          where: { id: account.encounterId, organizationId: ctx.tenant.organizationId },
          select: { dischargedAt: true },
        });
        if (!encounter?.dischargedAt) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "El encuentro asociado no tiene alta médica registrada (Fase 1 pendiente).",
          });
        }
      }

      // 2. Mismas 6 causas de bloqueo de `cerrar`.
      const causas = await computeCausasBloqueoCierre(tx, ctx.tenant.organizationId, account);
      if (causas.length > 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `No se puede concluir el alta administrativa: ${causas.length} causa(s) de bloqueo pendientes.`,
          cause: { causas } as unknown as Error,
        });
      }

      const liquidacion = await computeLiquidacion(tx, account.id);

      if (input.ruta === "CANCELACION_TOTAL") {
        if (liquidacion.saldo > SALDO_EPSILON) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Saldo pendiente de $${liquidacion.saldo.toFixed(2)} — no puede cerrarse por cancelación total. Registre el pago/cobertura faltante o use la ruta CXC.`,
            cause: { saldo: liquidacion.saldo } as unknown as Error,
          });
        }
      } else if (liquidacion.saldo <= SALDO_EPSILON) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "La cuenta no tiene saldo pendiente — use la ruta CANCELACION_TOTAL.",
          cause: { saldo: liquidacion.saldo } as unknown as Error,
        });
      }

      const now = new Date();
      const updatedAccount = await tx.patientAccount.update({
        where: { id: account.id },
        data: {
          status: "CERRADA",
          closedAt: now,
          closedBy: ctx.user.id,
          altaAdministrativaAt: now,
          altaAdministrativaBy: ctx.user.id,
          altaRuta: input.ruta,
        },
      });

      let cxc = null;
      if (input.ruta === "CXC") {
        cxc = await tx.accountReceivable.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            accountId: account.id,
            saldoInicial: liquidacion.saldo,
            saldoActual: liquidacion.saldo,
            documentoTipo: input.documento.documentoTipo,
            folioDocumento: input.documento.folioDocumento,
            firmanteTipo: input.documento.firmanteTipo,
            firmanteNombre: input.documento.firmanteNombre,
            firmanteDocumento: input.documento.firmanteDocumento,
            plazoDias: input.documento.plazoDias ?? null,
            notas: input.documento.notas ?? null,
            createdBy: ctx.user.id,
          },
        });
      }

      // 3. Egreso físico: solo si NINGUNA otra cuenta de este encuentro
      // sigue activa (un encuentro puede tener varias PatientAccount —
      // servicios distintos — y todas deben concluir su Fase 2).
      if (account.encounterId) {
        const otraCuentaActiva = await tx.patientAccount.findFirst({
          where: {
            encounterId: account.encounterId,
            id: { not: account.id },
            status: { not: "CERRADA" },
          },
          select: { id: true },
        });
        if (!otraCuentaActiva) {
          await tx.encounter.update({
            where: { id: account.encounterId },
            data: { egresoAutorizadoAt: now, egresoAutorizadoBy: ctx.user.id },
          });

          const activeAssignment = await tx.bedAssignment.findFirst({
            where: { encounterId: account.encounterId, releasedAt: null },
          });
          if (activeAssignment) {
            await tx.bedAssignment.update({
              where: { id: activeAssignment.id },
              data: { releasedAt: now, reason: "Alta administrativa concluida (CC-0027)" },
            });
            await tx.bed.update({
              where: { id: activeAssignment.bedId },
              data: { status: "DIRTY" },
            });
          }
        }
      }

      return { account: updatedAccount, cxc, liquidacion };
    });
  }),

  /**
   * CC-0027 — registra una carta de cobertura (aprobación parcial) o
   * finiquito (aprobación del 100% de la cuenta) de una aseguradora. Insumo
   * de la ruta CANCELACION_TOTAL cuando la cobertura, sola o junto con los
   * pagos ya registrados, cubre el saldo completo.
   */
  registrarCartaCobertura: writerProc
    .input(
      z.object({
        accountId: z.string().uuid(),
        insurerId: z.string().uuid().optional(),
        tipo: z.enum(["CARTA_COBERTURA", "FINIQUITO"]),
        montoAprobado: z.number().positive(),
        folio: z.string().trim().min(1).max(80),
        notas: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const account = await tx.patientAccount.findFirst({
          where: { id: input.accountId, organizationId: ctx.tenant.organizationId },
          select: { id: true, status: true },
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

        return tx.coverageLetter.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            accountId: account.id,
            insurerId: input.insurerId ?? null,
            tipo: input.tipo,
            montoAprobado: input.montoAprobado,
            folio: input.folio,
            notas: input.notas ?? null,
            createdBy: ctx.user.id,
          },
        });
      });
    }),
});
