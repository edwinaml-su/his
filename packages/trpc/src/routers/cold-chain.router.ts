/**
 * Router tRPC — Cold Chain Monitoring (placeholder F2-S15).
 *
 * Procedures:
 *   coldChain.registrarLectura      — inserta lectura manual o webhook IoT;
 *                                     si fuera de rango → INSERT alerta + emit outbox
 *   coldChain.listAlertas           — alertas pendientes del equipo
 *   coldChain.configurarRangoEquipo — upsert config de rangos
 *   coldChain.listLecturasHistorial — últimas 24 h de lecturas del equipo
 *
 * Nota: usa raw SQL porque las tablas viven en schema `ece` y no están
 * mapeadas en schema.prisma (placeholder pattern del codebase).
 *
 * RLS Cat-E aplicado en BD; el router filtra por organizationId en JS
 * como defensa adicional (patrón establecido para tablas ece.*).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../trpc";
import { emitDomainEvent } from "@his/database";

// ---------------------------------------------------------------------------
// Schemas locales
// ---------------------------------------------------------------------------

const registrarLecturaInput = z.object({
  equipmentId: z.string().uuid(),
  temperaturaC: z.number(),
  humedadPct: z.number().optional(),
  fuente: z.enum(["manual", "iot_sensor"]).default("manual"),
});

const configurarRangoInput = z.object({
  equipmentId: z.string().uuid(),
  tempMinC: z.number(),
  tempMaxC: z.number(),
  humedadMinPct: z.number().optional(),
  humedadMaxPct: z.number().optional(),
});

const listEquipInput = z.object({
  equipmentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Determina si la lectura está fuera de rango dado el config. */
function calcularDentroRango(
  config: { temp_min_c: number; temp_max_c: number; humedad_min_pct: number | null; humedad_max_pct: number | null } | null,
  temperaturaC: number,
  humedadPct: number | undefined
): { dentroRango: boolean; severidad: "WARNING" | "CRITICAL" | null; mensaje: string } {
  if (!config) {
    // Sin config → lectura válida por defecto; no se puede evaluar rango
    return { dentroRango: true, severidad: null, mensaje: "" };
  }

  const tempFuera = temperaturaC < config.temp_min_c || temperaturaC > config.temp_max_c;
  const humFuera =
    humedadPct !== undefined &&
    config.humedad_min_pct !== null &&
    config.humedad_max_pct !== null &&
    (humedadPct < config.humedad_min_pct || humedadPct > config.humedad_max_pct);

  if (!tempFuera && !humFuera) {
    return { dentroRango: true, severidad: null, mensaje: "" };
  }

  // Distancia al rango más cercano (no al extremo más lejano)
  const delta = tempFuera
    ? Math.min(
        Math.abs(temperaturaC - config.temp_min_c),
        Math.abs(temperaturaC - config.temp_max_c)
      )
    : 0;

  // >2°C fuera del límite más cercano → CRITICAL; resto WARNING
  const severidad: "WARNING" | "CRITICAL" = delta > 2 ? "CRITICAL" : "WARNING";

  const partes: string[] = [];
  if (tempFuera) {
    partes.push(`Temperatura ${temperaturaC}°C fuera de rango [${config.temp_min_c}-${config.temp_max_c}°C]`);
  }
  if (humFuera && humedadPct !== undefined) {
    partes.push(`Humedad ${humedadPct}% fuera de rango [${config.humedad_min_pct}-${config.humedad_max_pct}%]`);
  }

  return { dentroRango: false, severidad, mensaje: partes.join(". ") };
}

// ---------------------------------------------------------------------------
// Base procedure — cualquier rol clínico puede registrar y ver
// ---------------------------------------------------------------------------

const base = requireRole(["PHYSICIAN", "NURSE", "ADM", "DIR", "BIOMEDICAL", "ARCH"]);

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const coldChainRouter = router({
  /**
   * Registra una lectura de temperatura/humedad.
   * Si fuera de rango → INSERT alerta + emit cold_chain.excursion.
   */
  registrarLectura: base
    .input(registrarLecturaInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Verificar que el equipo pertenece al tenant
      const equipo = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM public."BiomedicalEquipment"
        WHERE id = ${input.equipmentId}::uuid
          AND "organizationId" = ${orgId}::uuid
        LIMIT 1
      `;
      if (equipo.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });
      }

      // Leer config de rangos
      const configRows = await ctx.prisma.$queryRaw<{
        temp_min_c: number;
        temp_max_c: number;
        humedad_min_pct: number | null;
        humedad_max_pct: number | null;
      }[]>`
        SELECT temp_min_c, temp_max_c, humedad_min_pct, humedad_max_pct
        FROM ece.cold_chain_config_equipo
        WHERE equipment_id = ${input.equipmentId}::uuid
        LIMIT 1
      `;
      const config = configRows[0] ?? null;

      const { dentroRango, severidad, mensaje } = calcularDentroRango(
        config,
        input.temperaturaC,
        input.humedadPct
      );

      return ctx.prisma.$transaction(async (tx) => {
        // INSERT lectura
        const lecturaRows = await tx.$queryRaw<{ id: string }[]>`
          INSERT INTO ece.cold_chain_lectura
            (equipment_id, temperatura_c, humedad_pct, dentro_rango, fuente, registrado_por)
          VALUES (
            ${input.equipmentId}::uuid,
            ${input.temperaturaC},
            ${input.humedadPct ?? null},
            ${dentroRango},
            ${input.fuente},
            ${userId}::uuid
          )
          RETURNING id
        `;
        const lecturaId = lecturaRows[0]!.id;

        if (!dentroRango && severidad) {
          // INSERT alerta
          await tx.$queryRaw`
            INSERT INTO ece.cold_chain_alerta
              (lectura_id, equipment_id, severidad, mensaje)
            VALUES (
              ${lecturaId}::uuid,
              ${input.equipmentId}::uuid,
              ${severidad},
              ${mensaje}
            )
          `;

          // Emit outbox (atómico dentro de la transacción)
          await emitDomainEvent(tx, {
            organizationId: orgId,
            eventType: "cold_chain.excursion",
            aggregateType: "ColdChainLectura",
            aggregateId: lecturaId,
            emittedById: userId,
            payload: {
              lecturaId,
              equipmentId: input.equipmentId,
              organizationId: orgId,
              temperaturaC: input.temperaturaC,
              ...(input.humedadPct !== undefined && { humedadPct: input.humedadPct }),
              severidad,
              mensaje,
            },
          });
        }

        return { lecturaId, dentroRango, severidad };
      });
    }),

  /** Alertas pendientes (no atendidas) de un equipo. */
  listAlertas: base
    .input(listEquipInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // Verificar tenant
      const equipo = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM public."BiomedicalEquipment"
        WHERE id = ${input.equipmentId}::uuid AND "organizationId" = ${orgId}::uuid
        LIMIT 1
      `;
      if (equipo.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });
      }

      return ctx.prisma.$queryRaw<{
        id: string;
        lectura_id: string;
        severidad: string;
        mensaje: string;
        creada_en: Date;
      }[]>`
        SELECT id, lectura_id, severidad, mensaje, creada_en
        FROM ece.cold_chain_alerta
        WHERE equipment_id = ${input.equipmentId}::uuid
          AND atendida_en IS NULL
        ORDER BY creada_en DESC
        LIMIT 50
      `;
    }),

  /** Upsert de configuración de rangos para el equipo. */
  configurarRangoEquipo: base
    .input(configurarRangoInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;
      const userId = ctx.user.id;

      // Verificar tenant
      const equipo = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM public."BiomedicalEquipment"
        WHERE id = ${input.equipmentId}::uuid AND "organizationId" = ${orgId}::uuid
        LIMIT 1
      `;
      if (equipo.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });
      }

      await ctx.prisma.$queryRaw`
        INSERT INTO ece.cold_chain_config_equipo
          (equipment_id, temp_min_c, temp_max_c, humedad_min_pct, humedad_max_pct, actualizado_en, actualizado_por)
        VALUES (
          ${input.equipmentId}::uuid,
          ${input.tempMinC},
          ${input.tempMaxC},
          ${input.humedadMinPct ?? null},
          ${input.humedadMaxPct ?? null},
          now(),
          ${userId}::uuid
        )
        ON CONFLICT (equipment_id) DO UPDATE SET
          temp_min_c      = EXCLUDED.temp_min_c,
          temp_max_c      = EXCLUDED.temp_max_c,
          humedad_min_pct = EXCLUDED.humedad_min_pct,
          humedad_max_pct = EXCLUDED.humedad_max_pct,
          actualizado_en  = now(),
          actualizado_por = EXCLUDED.actualizado_por
      `;

      return { ok: true };
    }),

  /** Últimas 24 h de lecturas de un equipo. */
  listLecturasHistorial: base
    .input(listEquipInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      const equipo = await ctx.prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM public."BiomedicalEquipment"
        WHERE id = ${input.equipmentId}::uuid AND "organizationId" = ${orgId}::uuid
        LIMIT 1
      `;
      if (equipo.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Equipo no encontrado." });
      }

      return ctx.prisma.$queryRaw<{
        id: string;
        temperatura_c: number;
        humedad_pct: number | null;
        registrado_en: Date;
        dentro_rango: boolean;
        fuente: string;
      }[]>`
        SELECT id, temperatura_c, humedad_pct, registrado_en, dentro_rango, fuente
        FROM ece.cold_chain_lectura
        WHERE equipment_id = ${input.equipmentId}::uuid
          AND registrado_en >= now() - INTERVAL '24 hours'
        ORDER BY registrado_en ASC
        LIMIT 1440
      `;
    }),
});
