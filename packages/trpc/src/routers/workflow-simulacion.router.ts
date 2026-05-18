/**
 * workflow.simulacion — Simulación paso a paso de un workflow (US.F2.2.08).
 *
 * La simulación es PURAMENTE en memoria: no crea ni modifica registros en BD.
 *
 * simulate — dado un tipDocumentoId + estadoActualId + (opcional) accionElegida,
 *   devuelve:
 *     - estadoActual: datos del estado actual
 *     - transicionesDisponibles: lista de transiciones salientes desde estadoActual
 *     - estadoSiguiente: (solo cuando se elige una accion) el estado destino
 *     - esFinal: si el estado actual es estado final
 *
 * path — dado un tipDocumentoId + secuencia de acciones, recorre el flujo
 *   y devuelve el estado en cada paso (para visualización de simulación completa).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../trpc";

// ── Schemas ───────────────────────────────────────────────────────────────────

const simulateInput = z.object({
  tipDocumentoId: z.string().uuid(),
  /** ID del estado actual en la simulación. Si omitido, usa el estado inicial. */
  estadoActualId: z.string().uuid().optional(),
  /** Acción a ejecutar desde estadoActual. Si omitida, solo lista transiciones disponibles. */
  accionElegida: z.string().max(64).optional(),
  /** Payload de prueba libre (JSONB) que puede usarse para filtrar transiciones condicionales. */
  testPayload: z.record(z.unknown()).optional(),
});

const pathInput = z.object({
  tipDocumentoId: z.string().uuid(),
  /** Secuencia de acciones a simular desde el estado inicial. */
  acciones: z.array(z.string().max(64)).max(50),
});

// ── Row types ─────────────────────────────────────────────────────────────────

export interface EstadoSimRow {
  id: string;
  codigo: string;
  nombre: string;
  es_inicial: boolean;
  es_final: boolean;
  orden: number;
  descripcion_markdown: string | null;
}

export interface TransicionSimRow {
  id: string;
  estado_origen_id: string;
  estado_destino_id: string;
  accion: string;
  rol_codigo: string;
  rol_nombre: string;
  requiere_firma: boolean;
}

export interface PathStep {
  estado: EstadoSimRow;
  transicionEjecutada: TransicionSimRow | null;
  accionUsada: string | null;
}

// ── Router ────────────────────────────────────────────────────────────────────

const proc = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowSimulacionRouter = router({
  /**
   * Paso individual de simulación.
   *
   * Si estadoActualId está vacío, parte del estado inicial.
   * Si accionElegida está presente, avanza al estado destino de esa transición.
   * No persiste nada en BD.
   */
  simulate: proc.input(simulateInput).query(async ({ ctx, input }) => {
    // Cargar todos los estados del workflow
    const estados = await ctx.prisma.$queryRaw<EstadoSimRow[]>(Prisma.sql`
      SELECT
        id::text,
        codigo,
        nombre,
        es_inicial,
        es_final,
        orden,
        descripcion_markdown
      FROM ece.flujo_estado
      WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
      ORDER BY orden ASC, codigo ASC
    `);

    if (estados.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "El workflow no tiene estados configurados.",
      });
    }

    // Estado inicial — punto de partida si no se especifica estadoActualId
    const estadoInicial = estados.find((e) => e.es_inicial);
    if (!estadoInicial) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "El workflow no tiene estado inicial definido.",
      });
    }

    const estadoActualId = input.estadoActualId ?? estadoInicial.id;
    const estadoActual = estados.find((e) => e.id === estadoActualId);

    if (!estadoActual) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `Estado con id '${estadoActualId}' no pertenece a este workflow.`,
      });
    }

    // Cargar transiciones salientes desde estado actual
    const transicionesDisponibles = await ctx.prisma.$queryRaw<TransicionSimRow[]>(Prisma.sql`
      SELECT
        ft.id::text,
        ft.estado_origen_id::text,
        ft.estado_destino_id::text,
        ft.accion,
        r.codigo AS rol_codigo,
        r.nombre AS rol_nombre,
        ft.requiere_firma
      FROM ece.flujo_transicion ft
      JOIN ece.rol r ON r.id = ft.rol_autoriza_id
      WHERE ft.tipo_documento_id = ${input.tipDocumentoId}::uuid
        AND ft.estado_origen_id = ${estadoActualId}::uuid
      ORDER BY ft.accion ASC
    `);

    // Avanzar si se eligió una acción
    let estadoSiguiente: EstadoSimRow | null = null;
    let transicionEjecutada: TransicionSimRow | null = null;

    if (input.accionElegida) {
      const transicion = transicionesDisponibles.find(
        (t) => t.accion === input.accionElegida,
      );
      if (!transicion) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `La acción '${input.accionElegida}' no está disponible desde el estado actual.`,
        });
      }
      transicionEjecutada = transicion;
      estadoSiguiente = estados.find((e) => e.id === transicion.estado_destino_id) ?? null;
    }

    return {
      estadoActual,
      transicionesDisponibles,
      estadoSiguiente,
      transicionEjecutada,
      esFinal: estadoActual.es_final,
      totalEstados: estados.length,
    };
  }),

  /**
   * Recorre el workflow completo siguiendo la secuencia de acciones dada.
   * Retorna el historial de pasos para visualización del path de simulación.
   * Puramente en memoria — no escribe en BD.
   */
  path: proc.input(pathInput).query(async ({ ctx, input }) => {
    // Cargar todos los estados
    const estados = await ctx.prisma.$queryRaw<EstadoSimRow[]>(Prisma.sql`
      SELECT
        id::text,
        codigo,
        nombre,
        es_inicial,
        es_final,
        orden,
        descripcion_markdown
      FROM ece.flujo_estado
      WHERE tipo_documento_id = ${input.tipDocumentoId}::uuid
      ORDER BY orden ASC
    `);

    // Cargar todas las transiciones del workflow
    const transiciones = await ctx.prisma.$queryRaw<TransicionSimRow[]>(Prisma.sql`
      SELECT
        ft.id::text,
        ft.estado_origen_id::text,
        ft.estado_destino_id::text,
        ft.accion,
        r.codigo AS rol_codigo,
        r.nombre AS rol_nombre,
        ft.requiere_firma
      FROM ece.flujo_transicion ft
      JOIN ece.rol r ON r.id = ft.rol_autoriza_id
      WHERE ft.tipo_documento_id = ${input.tipDocumentoId}::uuid
    `);

    const estadoMap = new Map(estados.map((e) => [e.id, e]));
    const transMap = new Map<string, TransicionSimRow[]>();
    for (const t of transiciones) {
      const arr = transMap.get(t.estado_origen_id) ?? [];
      arr.push(t);
      transMap.set(t.estado_origen_id, arr);
    }

    const estadoInicial = estados.find((e) => e.es_inicial);
    if (!estadoInicial) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "El workflow no tiene estado inicial.",
      });
    }

    // Trazar el path
    const steps: PathStep[] = [
      { estado: estadoInicial, transicionEjecutada: null, accionUsada: null },
    ];

    let estadoActual = estadoInicial;

    for (const accion of input.acciones) {
      if (estadoActual.es_final) {
        // No avanzar más allá de un estado final
        break;
      }
      const transicionesSalientes = transMap.get(estadoActual.id) ?? [];
      const t = transicionesSalientes.find((tr) => tr.accion === accion);
      if (!t) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Acción '${accion}' no disponible desde el estado '${estadoActual.nombre}'.`,
        });
      }
      const siguiente = estadoMap.get(t.estado_destino_id);
      if (!siguiente) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Estado destino de la transición '${accion}' no encontrado.`,
        });
      }
      steps.push({
        estado: siguiente,
        transicionEjecutada: t,
        accionUsada: accion,
      });
      estadoActual = siguiente;
    }

    return {
      steps,
      completado: estadoActual.es_final,
      estadoFinal: estadoActual,
    };
  }),
});
