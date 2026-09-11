/**
 * docs/48 Ola 4 (C4-2) — Conciliación clínico-financiera (RN-HIS-BOT-001 R11).
 *
 * 6 reportes de brecha entre el acto clínico y su reflejo financiero (5
 * originales + `despachadoSinCierre`, SQL 232 — RN-HIS-BOT-001 devolución
 * post-despacho), más un `resumen` con los 6 conteos para el tablero. Todas
 * las queries usan
 * `$queryRawUnsafe` porque cruzan `Prescription`/`PharmacyReservation`/
 * `StockMovement`/`PatientAccountService` sin relaciones Prisma declaradas
 * entre sí (mismo patrón que `finance-reports.router.ts`).
 *
 * Mapeo de conceptos del plan a modelos reales del repo (docs/48 §C4-2):
 *   - "indicación MEDICAMENTO firmada (con drug_id)" → `Prescription` firmada
 *     (signedAt IS NOT NULL) + su `PrescriptionItem.drugId`. El HIS legacy
 *     usa `Prescription` como el driver real de dispensación (la Prescription
 *     firmada ACTÚA como orden de farmacia, SQL 214) — `ece.indicacion_item`
 *     (bitácora NTEC) no tiene `drug_id` propio.
 *   - "PharmacyReservation COMPLETED" → el enum real es
 *     RESERVED/CONFIRMED/DISPATCHED/CANCELLED/EXPIRED (sin valor COMPLETED
 *     literal). El flujo cableado hoy (`dispensation.router.ts`) solo crea
 *     RESERVED y nunca transiciona a CONFIRMED/DISPATCHED — se interpreta
 *     "completado" como "reserva activa, no cancelada/expirada"
 *     (`status NOT IN ('CANCELLED','EXPIRED')`).
 *   - "StockMovement OUT de dispensación" → docs/48 Ola 4b (H-15): antes se
 *     identificaba por `reason ILIKE '%dispensaci%'` (frágil — cualquier
 *     cambio de texto en `dispensation.router.ts` lo rompía en silencio).
 *     Ahora se identifica por el vínculo ESTRUCTURAL: `type='OUT'` con un
 *     `StockMovement.referenceCode` que matchea el `id` de una
 *     `PharmacyReservation` (`reserveItem` graba `referenceCode =
 *     reservation.id`, SQL 214/dispensation.router.ts). El scan directo
 *     (`scanItem`, sin caller real hoy — ver H-14) graba `referenceCode =
 *     prescription.id`, que no es una PharmacyReservation — queda fuera de
 *     este reporte hasta que ese camino tenga un caller real; no se
 *     reintroduce el `ILIKE` para cubrirlo.
 *   - El vínculo `PatientAccountService.referenciaId` ↔ `StockMovement.
 *     referenceCode` se compara como texto: `referenceCode` es
 *     `varchar(80)` de uso libre (también guarda "nro factura"/ajustes no
 *     UUID) — castear a uuid rompería con esos valores.
 */
import { z } from "zod";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";

const dateRangeInput = z.object({
  fechaDesde: z.string().date("Formato YYYY-MM-DD"),
  fechaHasta: z.string().date("Formato YYYY-MM-DD"),
});

const readerProc = tenantProcedure;

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

interface IndicacionSinDispensaRow {
  prescriptionId: string;
  prescriptionItemId: string;
  patientId: string;
  prescribedAt: Date;
  genericName: string;
}

interface DispensadoSinCargoRow {
  stockMovementId: string;
  referenceCode: string | null;
  performedAt: Date;
  sku: string;
  quantity: string;
}

interface CargoSinMovimientoRow {
  cargoId: string;
  accountId: string;
  code: string | null;
  totalPrice: string | null;
  createdAt: Date;
  referenciaId: string | null;
}

interface CargoSinTarifaRow {
  cargoId: string;
  accountId: string;
  code: string | null;
  descripcion: string | null;
  quantity: string;
  createdAt: Date;
  antiguedadDias: number;
}

interface DevolucionSinReversionRow {
  cargoId: string;
  accountId: string;
  reservationId: string;
  cancelMotivo: string | null;
  totalPrice: string | null;
  createdAt: Date;
}

interface DespachadoSinCierreRow {
  reservationId: string;
  patientId: string;
  status: string;
  gtin: string;
  lote: string;
  createdAt: Date;
  horasTranscurridas: number;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const conciliacionCargosRouter = router({
  /**
   * 1. Indicaciones MEDICAMENTO firmadas sin PharmacyReservation asociada
   * (ver mapeo de conceptos en el encabezado).
   */
  indicacionesSinDispensa: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<IndicacionSinDispensaRow[]>(
          `SELECT
             p.id            AS "prescriptionId",
             pi.id           AS "prescriptionItemId",
             p."patientId"   AS "patientId",
             p."prescribedAt" AS "prescribedAt",
             d."genericName" AS "genericName"
           FROM "PrescriptionItem" pi
           JOIN "Prescription" p ON p.id = pi."prescriptionId"
           JOIN "Drug" d ON d.id = pi."drugId"
           WHERE p."organizationId" = $1
             AND p."signedAt" IS NOT NULL
             AND p."signedAt" BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM "PharmacyReservation" pr
               WHERE pr."pharmacyOrderId" = p.id
                 AND pr.status NOT IN ('CANCELLED', 'EXPIRED')
             )
           ORDER BY p."prescribedAt" DESC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * 2. StockMovement OUT de dispensación sin PatientAccountService con
   * referenciaId correspondiente.
   */
  dispensadoSinCargo: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<DispensadoSinCargoRow[]>(
          `SELECT
             sm.id              AS "stockMovementId",
             sm."referenceCode" AS "referenceCode",
             sm."performedAt"   AS "performedAt",
             si.sku             AS "sku",
             sm.quantity::text  AS "quantity"
           FROM "StockMovement" sm
           JOIN "StockItem" si ON si.id = sm."itemId"
           JOIN "PharmacyReservation" pr
             ON pr.id::text = sm."referenceCode"
            AND pr."organizationId" = sm."organizationId"
           WHERE sm."organizationId" = $1
             AND sm.type = 'OUT'
             AND sm."performedAt" BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM "PatientAccountService" pas
               JOIN "PatientAccount" pa ON pa.id = pas."accountId"
               WHERE pa."organizationId" = $1
                 AND pas."referenciaId"::text = sm."referenceCode"
             )
           ORDER BY sm."performedAt" DESC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * 3. Cargos origen DISPENSACION_FARMACIA cuya referencia no tiene
   * movimiento de stock (espejo de la query 2).
   */
  cargosSinMovimiento: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<CargoSinMovimientoRow[]>(
          `SELECT
             pas.id            AS "cargoId",
             pas."accountId"   AS "accountId",
             pas.code          AS "code",
             pas."totalPrice"::text AS "totalPrice",
             pas."createdAt"   AS "createdAt",
             pas."referenciaId" AS "referenciaId"
           FROM "PatientAccountService" pas
           JOIN "PatientAccount" pa ON pa.id = pas."accountId"
           WHERE pa."organizationId" = $1
             AND pas.origen = 'DISPENSACION_FARMACIA'
             AND pas.status = 'VIGENTE'
             AND pas."createdAt" BETWEEN $2 AND $3
             AND NOT EXISTS (
               SELECT 1 FROM "StockMovement" sm
               WHERE sm."organizationId" = $1
                 AND sm.type = 'OUT'
                 AND sm."referenceCode" = pas."referenciaId"::text
             )
           ORDER BY pas."createdAt" DESC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * 4. Cargos PENDIENTE_TARIFA (+total y antigüedad).
   */
  cargosSinTarifa: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<CargoSinTarifaRow[]>(
          `SELECT
             pas.id          AS "cargoId",
             pas."accountId" AS "accountId",
             pas.code        AS "code",
             pas.descripcion AS "descripcion",
             pas.quantity::text AS "quantity",
             pas."createdAt" AS "createdAt",
             EXTRACT(DAY FROM now() - pas."createdAt")::int AS "antiguedadDias"
           FROM "PatientAccountService" pas
           JOIN "PatientAccount" pa ON pa.id = pas."accountId"
           WHERE pa."organizationId" = $1
             AND pas.status = 'PENDIENTE_TARIFA'
             AND pas."createdAt" BETWEEN $2 AND $3
           ORDER BY pas."createdAt" ASC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * 5. Devoluciones sin reversión — misma condición que el bloqueo 3 de
   * `patientAccount.cerrar`, pero global (todas las cuentas del tenant).
   */
  devolucionesSinReversion: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<DevolucionSinReversionRow[]>(
          `SELECT
             pas.id            AS "cargoId",
             pas."accountId"   AS "accountId",
             pr.id             AS "reservationId",
             pr."cancelMotivo" AS "cancelMotivo",
             pas."totalPrice"::text AS "totalPrice",
             pas."createdAt"   AS "createdAt"
           FROM "PatientAccountService" pas
           JOIN "PatientAccount" pa ON pa.id = pas."accountId"
           JOIN "PharmacyReservation" pr ON pr.id = pas."referenciaId"
           WHERE pa."organizationId" = $1
             AND pas.status = 'VIGENTE'
             AND pr.status = 'CANCELLED'
             AND pas."createdAt" BETWEEN $2 AND $3
           ORDER BY pas."createdAt" DESC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * 6. SQL 232 — reservas despachadas sin cierre: `PharmacyReservation` en
   * estado RESERVED/DISPATCHED (ver hallazgo en dispensation.router.ts
   * `RETURN_ITEM_OPEN_STATUSES` — el flujo real solo produce RESERVED, nunca
   * transiciona a CONFIRMED/DISPATCHED) que nunca se cerraron a ADMINISTERED
   * (bedside.router administration.record) ni RETURNED (dispensation.router
   * returnItem). Espejo de la 6ª causa de bloqueo en `patientAccount.cerrar`
   * (DISPENSACION_SIN_CIERRE), pero global.
   */
  despachadoSinCierre: readerProc
    .input(dateRangeInput)
    .query(async ({ ctx, input }) => {
      const { tenant, prisma } = ctx;
      const desde = `${input.fechaDesde}T00:00:00`;
      const hasta = `${input.fechaHasta}T23:59:59`;

      return withTenantContext(prisma, tenant, async (tx) =>
        tx.$queryRawUnsafe<DespachadoSinCierreRow[]>(
          `SELECT
             pr.id            AS "reservationId",
             pr."patientId"   AS "patientId",
             pr.status::text  AS "status",
             pr.gtin          AS "gtin",
             pr.lote          AS "lote",
             pr."createdAt"   AS "createdAt",
             EXTRACT(EPOCH FROM (now() - pr."createdAt")) / 3600 AS "horasTranscurridas"
           FROM "PharmacyReservation" pr
           WHERE pr."organizationId" = $1
             AND pr.status IN ('RESERVED', 'DISPATCHED')
             AND pr."createdAt" BETWEEN $2 AND $3
           ORDER BY pr."createdAt" ASC`,
          tenant.organizationId,
          desde,
          hasta,
        ),
      );
    }),

  /**
   * Resumen — los 6 conteos de una vez, para el tablero.
   */
  resumen: readerProc.input(dateRangeInput).query(async ({ ctx, input }) => {
    const { tenant, prisma } = ctx;
    const desde = `${input.fechaDesde}T00:00:00`;
    const hasta = `${input.fechaHasta}T23:59:59`;

    return withTenantContext(prisma, tenant, async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        Array<{
          indicaciones_sin_dispensa: string;
          dispensado_sin_cargo: string;
          cargos_sin_movimiento: string;
          cargos_sin_tarifa: string;
          devoluciones_sin_reversion: string;
          despachado_sin_cierre: string;
        }>
      >(
        `SELECT
           (SELECT count(*) FROM "PrescriptionItem" pi
              JOIN "Prescription" p ON p.id = pi."prescriptionId"
             WHERE p."organizationId" = $1
               AND p."signedAt" IS NOT NULL
               AND p."signedAt" BETWEEN $2 AND $3
               AND NOT EXISTS (
                 SELECT 1 FROM "PharmacyReservation" pr
                 WHERE pr."pharmacyOrderId" = p.id
                   AND pr.status NOT IN ('CANCELLED', 'EXPIRED')
               )
           )::text AS indicaciones_sin_dispensa,
           (SELECT count(*) FROM "StockMovement" sm
              JOIN "StockItem" si ON si.id = sm."itemId"
              JOIN "PharmacyReservation" pr
                ON pr.id::text = sm."referenceCode"
               AND pr."organizationId" = sm."organizationId"
             WHERE sm."organizationId" = $1
               AND sm.type = 'OUT'
               AND sm."performedAt" BETWEEN $2 AND $3
               AND NOT EXISTS (
                 SELECT 1 FROM "PatientAccountService" pas
                 JOIN "PatientAccount" pa ON pa.id = pas."accountId"
                 WHERE pa."organizationId" = $1
                   AND pas."referenciaId"::text = sm."referenceCode"
               )
           )::text AS dispensado_sin_cargo,
           (SELECT count(*) FROM "PatientAccountService" pas
              JOIN "PatientAccount" pa ON pa.id = pas."accountId"
             WHERE pa."organizationId" = $1
               AND pas.origen = 'DISPENSACION_FARMACIA'
               AND pas.status = 'VIGENTE'
               AND pas."createdAt" BETWEEN $2 AND $3
               AND NOT EXISTS (
                 SELECT 1 FROM "StockMovement" sm
                 WHERE sm."organizationId" = $1
                   AND sm.type = 'OUT'
                   AND sm."referenceCode" = pas."referenciaId"::text
               )
           )::text AS cargos_sin_movimiento,
           (SELECT count(*) FROM "PatientAccountService" pas
              JOIN "PatientAccount" pa ON pa.id = pas."accountId"
             WHERE pa."organizationId" = $1
               AND pas.status = 'PENDIENTE_TARIFA'
               AND pas."createdAt" BETWEEN $2 AND $3
           )::text AS cargos_sin_tarifa,
           (SELECT count(*) FROM "PatientAccountService" pas
              JOIN "PatientAccount" pa ON pa.id = pas."accountId"
              JOIN "PharmacyReservation" pr ON pr.id = pas."referenciaId"
             WHERE pa."organizationId" = $1
               AND pas.status = 'VIGENTE'
               AND pr.status = 'CANCELLED'
               AND pas."createdAt" BETWEEN $2 AND $3
           )::text AS devoluciones_sin_reversion,
           (SELECT count(*) FROM "PharmacyReservation" pr
             WHERE pr."organizationId" = $1
               AND pr.status IN ('RESERVED', 'DISPATCHED')
               AND pr."createdAt" BETWEEN $2 AND $3
           )::text AS despachado_sin_cierre`,
        tenant.organizationId,
        desde,
        hasta,
      );

      const r = rows[0]!;
      return {
        indicacionesSinDispensa: Number(r.indicaciones_sin_dispensa),
        dispensadoSinCargo: Number(r.dispensado_sin_cargo),
        cargosSinMovimiento: Number(r.cargos_sin_movimiento),
        cargosSinTarifa: Number(r.cargos_sin_tarifa),
        devolucionesSinReversion: Number(r.devoluciones_sin_reversion),
        despachadoSinCierre: Number(r.despachado_sin_cierre),
      };
    });
  }),
});
