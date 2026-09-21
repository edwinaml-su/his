/**
 * Router tRPC — ECE Período Expulsivo + Alumbramiento (NTEC Doc 14).
 *
 * Opera sobre `ece.sala_expulsion.eventos` (JSONB array en fila existente).
 * No crea tablas nuevas — usa la columna añadida en SQL 72b.
 *
 * Procedures:
 *   list            — registros sala_expulsion del establecimiento
 *   get             — registro por id
 *   listEventos     — array eventos de una sala por salaId
 *   registrarEvento — appends evento al array JSONB + validación HPP
 *
 * Validación crítica:
 *   Si tipo === 'alumbramiento' y existe evento 'nacimiento' en el array,
 *   la diferencia debe ser < 30 min; caso contrario emite
 *   `ece.expulsion.hemorragia_post_parto_alerta` en el outbox.
 *
 * RLS: withWorkflowContext establece app.ece_establecimiento_id (vía
 *      ece.set_ece_context) y demota a rol `authenticated` — la policy
 *      `sala_exp_by_estab` (ALL) filtra por establecimiento contra
 *      ece.episodio_hospitalario/episodio_atencion.
 *
 * R1.2 (2026-09) — este router tenía una función local también llamada
 * `withEceContext` que NO seteaba ningún GUC ni demotaba rol: solo devolvía
 * un objeto plano. Las 5 procedures corrían en `ctx.prisma` directo (rol
 * BYPASSRLS) creyendo (por el nombre) que ya estaban protegidas — el filtro
 * de establecimiento en `list` vivía solo en el WHERE de JS, y `get`/
 * `listEventos` no filtraban por establecimiento en absoluto (cualquier
 * establecimiento podía leer la sala de expulsión de otro por id). Se
 * renombra a `buildEceCtx` (mismo patrón que triaje-ece.router.ts) y se
 * envuelve cada operación en `withWorkflowContext` real.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { router, requireRole } from "../../trpc";
import { emitDomainEvent } from "@his/database";
import { withWorkflowContext, type EceContext } from "../../workflow/context";

// ─── Constantes ──────────────────────────────────────────────────────────────

/** Umbral NTEC Doc 14 §3.3: alumbramiento normal ≤ 30 min post-nacimiento. */
const HPP_THRESHOLD_MS = 30 * 60 * 1000;

// ─── Schemas Zod ──────────────────────────────────────────────────────────────

const tipoEventoEnum = z.enum([
  "inicio_pujos",
  "posicion_madre_cambio",
  "amniotomia",
  "episiotomia",
  "desgarro",
  "nacimiento",
  "alumbramiento",
  "sangrado_anormal",
]);

const registrarEventoInput = z.object({
  salaId: z.string().uuid(),
  tipo: tipoEventoEnum,
  timestamp: z.coerce.date().default(() => new Date()),
  nota: z.string().max(500).optional(),
  datos: z.record(z.unknown()).optional(),
});

const getInput = z.object({ id: z.string().uuid() });
const listInput = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(50).default(20),
});
const listEventosInput = z.object({ salaId: z.string().uuid() });

// ─── Tipos raw SQL ────────────────────────────────────────────────────────────

export interface SalaExpulsionRow {
  id: string;
  episodio_hospitalario_id: string;
  tipo_parto: string;
  inicio_expulsivo_ts: Date | null;
  nacimiento_ts: Date;
  alumbramiento_ts: Date | null;
  sangrado_estimado_ml: number | null;
  episiotomia: boolean;
  desgarro_perineal_grado: number | null;
  estado_registro: string;
  registrado_en: Date;
  eventos: ExpulsionEvento[];
}

export interface ExpulsionEvento {
  id: string;
  tipo: string;
  timestamp: string;
  nota?: string;
  datos?: Record<string, unknown>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildEceCtx(ctx: {
  user: { id: string };
  tenant: { organizationId: string; establishmentId?: string; roleCodes: string[] };
}): EceContext & { organizationId: string } {
  if (!ctx.tenant.establishmentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Se requiere un establecimiento activo para operar el período expulsivo.",
    });
  }
  return {
    personalId: ctx.user.id,
    organizationId: ctx.tenant.organizationId,
    establecimientoId: ctx.tenant.establishmentId,
    roles: ctx.tenant.roleCodes,
  };
}

/**
 * Extrae el timestamp ISO del primer evento que coincide con `tipo`.
 * Retorna null si no existe.
 */
export function findEventoTimestamp(
  eventos: ExpulsionEvento[],
  tipo: string,
): Date | null {
  const ev = eventos.find((e) => e.tipo === tipo);
  return ev ? new Date(ev.timestamp) : null;
}

/**
 * Calcula si el intervalo alumbramiento-nacimiento supera el umbral HPP.
 * Ambos timestamps deben existir; si no, retorna false (no alerta).
 */
export function debeEmitirAlertaHPP(
  eventos: ExpulsionEvento[],
  alumbramientoTs: Date,
): boolean {
  const nacimientoTs = findEventoTimestamp(eventos, "nacimiento");
  if (!nacimientoTs) return false;
  return alumbramientoTs.getTime() - nacimientoTs.getTime() > HPP_THRESHOLD_MS;
}

// ─── Base procedure ───────────────────────────────────────────────────────────

const eceBase = requireRole(["MC", "PHYSICIAN", "NURSE", "ESP", "DIR"]);
const eceMutate = requireRole(["MC", "PHYSICIAN", "NURSE"]);

// ─── Router ───────────────────────────────────────────────────────────────────

export const periodoExpulsivoRouter = router({
  /**
   * Lista registros sala_expulsion del establecimiento activo.
   */
  list: eceBase.input(listInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);
    const offset = (input.page - 1) * input.pageSize;

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // El WHERE explícito queda como defensa en profundidad; el filtro real
      // ahora lo aplica la policy `sala_exp_by_estab` bajo rol `authenticated`.
      const rows = await tx.$queryRaw<SalaExpulsionRow[]>`
        SELECT se.*
          FROM ece.sala_expulsion se
          JOIN ece.episodio_hospitalario eh
            ON eh.episodio_id = se.episodio_hospitalario_id
          JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_id
         WHERE ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
         ORDER BY se.registrado_en DESC
         LIMIT ${input.pageSize} OFFSET ${offset}
      `;

      const [{ total }] = await tx.$queryRaw<[{ total: bigint }]>`
        SELECT COUNT(*) AS total
          FROM ece.sala_expulsion se
          JOIN ece.episodio_hospitalario eh
            ON eh.episodio_id = se.episodio_hospitalario_id
          JOIN ece.episodio_atencion ea
            ON ea.id = eh.episodio_id
         WHERE ea.establecimiento_id = ${eceCtx.establecimientoId}::uuid
      `;

      return { items: rows, total: Number(total), page: input.page, pageSize: input.pageSize };
    });
  }),

  /**
   * Registro individual por id.
   *
   * R1.2 — antes NO filtraba por establecimiento (ctx.prisma directo, sin
   * WHERE de tenant): cualquier establecimiento podía leer la sala de
   * expulsión de otro conociendo el uuid. La policy `sala_exp_by_estab`
   * ahora hace ese filtro real bajo rol `authenticated`.
   */
  get: eceBase.input(getInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<SalaExpulsionRow[]>`
        SELECT * FROM ece.sala_expulsion WHERE id = ${input.id}::uuid LIMIT 1
      `;
      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Registro de sala de expulsión no encontrado." });
      }
      return rows[0]!;
    });
  }),

  /**
   * Devuelve solo el array de eventos de una sala específica.
   * Útil para el timeline de la UI sin cargar todos los campos.
   *
   * R1.2 — mismo hallazgo que `get`: sin filtro de establecimiento.
   */
  listEventos: eceBase.input(listEventosInput).query(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      const rows = await tx.$queryRaw<[{ eventos: ExpulsionEvento[] }?]>`
        SELECT eventos FROM ece.sala_expulsion WHERE id = ${input.salaId}::uuid LIMIT 1
      `;
      if (!rows[0]) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sala de expulsión no encontrada." });
      }
      return rows[0].eventos;
    });
  }),

  /**
   * Registra un evento en el cronograma de la sala de expulsión.
   *
   * Append-only sobre el JSONB array `eventos`.
   * Si tipo === 'alumbramiento' y el intervalo post-nacimiento supera 30 min,
   * emite `ece.expulsion.hemorragia_post_parto_alerta` en el outbox de dominio.
   */
  registrarEvento: eceMutate.input(registrarEventoInput).mutation(async ({ ctx, input }) => {
    const eceCtx = buildEceCtx(ctx);

    return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
      // Cargar la sala y sus eventos actuales dentro de la transacción.
      const rows = await tx.$queryRaw<SalaExpulsionRow[]>`
        SELECT id, eventos, nacimiento_ts
          FROM ece.sala_expulsion
         WHERE id = ${input.salaId}::uuid
         LIMIT 1
      `;
      const sala = rows[0];
      if (!sala) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Sala de expulsión no encontrada." });
      }

      const nuevoEvento: ExpulsionEvento = {
        id: randomUUID(),
        tipo: input.tipo,
        timestamp: input.timestamp.toISOString(),
        ...(input.nota ? { nota: input.nota } : {}),
        ...(input.datos ? { datos: input.datos } : {}),
      };

      // Append atómico: || es el operador de concatenación de JSONB arrays en Postgres.
      await tx.$executeRaw`
        UPDATE ece.sala_expulsion
           SET eventos = eventos || ${JSON.stringify([nuevoEvento])}::jsonb
         WHERE id = ${input.salaId}::uuid
      `;

      // Validación HPP: solo aplica si el evento registrado es alumbramiento.
      let alertaHPP = false;
      if (input.tipo === "alumbramiento") {
        const eventosActualizados: ExpulsionEvento[] = [
          ...sala.eventos,
          nuevoEvento,
        ];
        alertaHPP = debeEmitirAlertaHPP(eventosActualizados, input.timestamp);

        if (alertaHPP) {
          await emitDomainEvent(tx, {
            organizationId: eceCtx.organizationId,
            eventType: "ece.expulsion.hemorragia_post_parto_alerta",
            aggregateType: "SalaExpulsion",
            aggregateId: input.salaId,
            emittedById: ctx.user.id,
            payload: {
              salaId: input.salaId,
              alumbramientoTs: input.timestamp.toISOString(),
              nacimientoTs: sala.nacimiento_ts,
              organizationId: eceCtx.organizationId,
              establecimientoId: eceCtx.establecimientoId,
            },
          });
        }
      }

      return { ok: true as const, eventoId: nuevoEvento.id, alertaHPP };
    });
  }),
});
