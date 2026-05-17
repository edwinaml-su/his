/**
 * @his/trpc — Motor de transiciones del workflow ECE (Fase 2 / GS1).
 *
 * Las reglas de flujo viven en `ece.flujo_transicion` (data-driven); no hay
 * lógica hardcodeada de estados aquí. Cambiar un flujo = modificar filas, no
 * tocar este archivo.
 *
 * Tablas referenciadas (schema ECE, sin modelo Prisma — sólo SQL raw):
 *   ece.flujo_transicion         — qué acción lleva de qué estado a cuál + rol autorizador
 *   ece.documento_instancia      — estado_actual_id, episodio, tipo
 *   ece.documento_instancia_historial — bitácora inmutable (solo INSERT)
 */
import { TRPCError } from "@trpc/server";
import type { PrismaClient } from "@prisma/client";
import { withWorkflowContext, type EceContext } from "./context";

// ─────────────────────────────────────────────────────────────────────────────
// Tipos internos (resultados de las queries raw)
// ─────────────────────────────────────────────────────────────────────────────

interface TransicionRow {
  id: string;
  estado_destino_id: string;
  rol_autoriza_id: string;
  rol_codigo: string;
  requiere_firma: boolean;
}

interface InstanciaRow {
  id: string;
  estado_actual_id: string;
  tipo_documento_id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// canTransition
// ─────────────────────────────────────────────────────────────────────────────

export interface CanTransitionResult {
  /** Si la transición está permitida para el usuario dado. */
  allowed: boolean;
  /** Si la transición exige firma electrónica (requiere_firma = true). */
  requiresSignature: boolean;
  /** UUID del estado destino; undefined cuando allowed = false. */
  targetStateId: string | undefined;
}

/**
 * Verifica si una transición de workflow es válida para el usuario.
 *
 * No muta nada; hace dos lecturas:
 *   1. Lee el estado actual de la instancia.
 *   2. Busca la transición candidata y compara los roles del usuario.
 *
 * @param prisma   Cliente Prisma (sin transacción necesaria — solo lecturas).
 * @param instanceId  UUID de `ece.documento_instancia`.
 * @param action      Código de acción (e.g. 'firmar', 'enviar_revision').
 * @param userRoles   Códigos de rol ECE del usuario (e.g. ['MC', 'ESP']).
 */
export async function canTransition(
  prisma: PrismaClient,
  instanceId: string,
  action: string,
  userRoles: string[],
): Promise<CanTransitionResult> {
  // 1. Leer instancia — verifica existencia y obtiene estado actual
  const instancias = await prisma.$queryRaw<InstanciaRow[]>`
    SELECT id, estado_actual_id, tipo_documento_id
    FROM ece.documento_instancia
    WHERE id = ${instanceId}::uuid
    LIMIT 1
  `;

  if (instancias.length === 0) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Instancia de documento no encontrada: ${instanceId}`,
    });
  }

  const instancia = instancias[0]!;

  // 2. Buscar transición candidata: (tipo, estado_actual, accion) es UNIQUE
  const transiciones = await prisma.$queryRaw<TransicionRow[]>`
    SELECT
      ft.id,
      ft.estado_destino_id,
      ft.rol_autoriza_id,
      ft.requiere_firma,
      r.codigo AS rol_codigo
    FROM ece.flujo_transicion ft
    JOIN ece.rol r ON r.id = ft.rol_autoriza_id
    WHERE ft.tipo_documento_id = ${instancia.tipo_documento_id}::uuid
      AND ft.estado_origen_id  = ${instancia.estado_actual_id}::uuid
      AND ft.accion            = ${action}
    LIMIT 1
  `;

  // Si no hay transición definida para (tipo, estado_actual, accion) → no permitido
  if (transiciones.length === 0) {
    return { allowed: false, requiresSignature: false, targetStateId: undefined };
  }

  const transicion = transiciones[0]!;

  // 3. Verificar que el usuario tenga el rol autorizador
  const allowed = userRoles.includes(transicion.rol_codigo);

  return {
    allowed,
    requiresSignature: transicion.requiere_firma,
    targetStateId: allowed ? transicion.estado_destino_id : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// executeTransition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ejecuta la transición de workflow dentro de una transacción atómica:
 *   1. Revalida `canTransition` (evita TOCTOU entre check y execute).
 *   2. Actualiza `ece.documento_instancia.estado_actual_id`.
 *   3. Inserta en `ece.documento_instancia_historial` (inmutable).
 *
 * Lanza `TRPCError` si:
 *   - La instancia no existe (`NOT_FOUND`).
 *   - La transición no está definida o el rol no la autoriza (`FORBIDDEN`).
 *   - La transición requiere firma pero no se pasó `firmaId` (`BAD_REQUEST`).
 *
 * @param prisma      Cliente Prisma raíz (la función abre la transacción).
 * @param instanceId  UUID de `ece.documento_instancia`.
 * @param action      Código de acción (e.g. 'firmar', 'enviar_revision').
 * @param eceCtx      Contexto ECE del ejecutor (personal + establecimiento + roles).
 * @param userId      UUID de `ece.personal_salud` del ejecutor (para historial).
 * @param firmaId     UUID de `ece.firma_electronica`; obligatorio si `requiresSignature`.
 * @param observacion Texto libre opcional para el historial.
 */
export async function executeTransition(
  prisma: PrismaClient,
  instanceId: string,
  action: string,
  eceCtx: EceContext,
  userId: string,
  firmaId?: string,
  observacion?: string,
): Promise<void> {
  await withWorkflowContext(prisma, eceCtx, async (tx) => {
    // 1. Revalidar dentro de la transacción (evita race condition TOCTOU)
    const check = await canTransition(
      tx,
      instanceId,
      action,
      eceCtx.roles ?? [],
    );

    if (!check.allowed) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Acción '${action}' no permitida para los roles del usuario en el estado actual.`,
      });
    }

    if (check.requiresSignature && !firmaId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La acción '${action}' requiere firma electrónica.`,
      });
    }

    // 2. Obtener rol_autoriza_id para insertar en historial
    const rolRows = await tx.$queryRaw<Array<{ rol_autoriza_id: string; estado_origen_id: string }>>`
      SELECT ft.rol_autoriza_id, ft.estado_origen_id
      FROM ece.flujo_transicion ft
      JOIN ece.documento_instancia di
        ON di.tipo_documento_id = ft.tipo_documento_id
       AND di.estado_actual_id  = ft.estado_origen_id
      JOIN ece.rol r ON r.id = ft.rol_autoriza_id
      WHERE di.id     = ${instanceId}::uuid
        AND ft.accion = ${action}
      LIMIT 1
    `;

    // rolRows no puede estar vacío aquí — canTransition ya lo garantizó
    const { rol_autoriza_id: rolAutorizaId, estado_origen_id: estadoOrigenId } = rolRows[0]!;

    // 3. Actualizar estado actual de la instancia
    await tx.$executeRaw`
      UPDATE ece.documento_instancia
      SET estado_actual_id = ${check.targetStateId!}::uuid
      WHERE id = ${instanceId}::uuid
    `;

    // 4. Insertar en historial (inmutable — sin UPDATE/DELETE por contrato)
    await tx.$executeRaw`
      INSERT INTO ece.documento_instancia_historial
        (instancia_id, estado_anterior_id, estado_nuevo_id, accion,
         ejecutado_por, rol_ejecutor_id, firma_id, observacion)
      VALUES (
        ${instanceId}::uuid,
        ${estadoOrigenId}::uuid,
        ${check.targetStateId!}::uuid,
        ${action},
        ${userId}::uuid,
        ${rolAutorizaId}::uuid,
        ${firmaId ?? null}::uuid,
        ${observacion ?? null}
      )
    `;
  });
}
