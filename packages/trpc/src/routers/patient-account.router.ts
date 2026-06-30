/**
 * CC-0002 §7 — Cuentas y Servicios de Paciente.
 *
 * PatientAccount: correlativo CTA00001 por expediente (por patientId).
 * PatientAccountService: tipo HOSPITALARIO | NO_HOSPITALARIO.
 * encounterId es opcional en ambos — un paciente ambulatorio puede generar
 * una cuenta sin admisión asociada.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
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
   */
  crear: tenantProcedure
    .input(
      z.object({
        patientId: z.string().uuid(),
        encounterId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const numeroCuenta = await nextCuenta(tx, input.patientId);
        return tx.patientAccount.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            patientId: input.patientId,
            encounterId: input.encounterId ?? null,
            numeroCuenta,
            createdBy: ctx.user.id,
          },
        });
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
   * Lista cuentas de un paciente con sus servicios incluidos.
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
          include: { servicios: true },
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
});
