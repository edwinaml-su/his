/**
 * identity-resolver.ts — resolver canónico User (HIS) ↔ ece.personal_salud (ECE).
 *
 * R03 (assessment externo, riesgo Alto) — "Identidad HIS↔ECE no unificada":
 * al momento de escribir esto había 107 subqueries `his_user_id = ...`
 * repetidas en 48 archivos, cada una reimplementando el mismo lookup (y, la
 * mayoría de las veces, un mensaje de error ligeramente distinto). Este
 * módulo es el punto de resolución único — código nuevo que necesite mapear
 * un usuario HIS a su fila `ece.personal_salud` pasa por acá, no reimplementa
 * la query.
 *
 * ── Los DOS espacios de identificadores en juego ─────────────────────────
 *   `ctx.user.id`             → `public."User".id`. Es la sesión HIS — lo que
 *                                trae `TRPCContext.user.id` en TODOS los
 *                                routers (ver `packages/trpc/src/context.ts`).
 *   `ece.personal_salud.id`   → fila ECE. Es el id que exigen las FK clínicas
 *                                (firmante, autoriza, valida...), p.ej.
 *                                `ece.devolucion_inventario.autorizado_por`,
 *                                `ece.certificado_defuncion.*`,
 *                                `ece.firma_electronica.personal_id`.
 *   `ece.personal_salud.his_user_id` → FK a `public."User"(id)`, UNIQUE,
 *                                nullable. Es el puente entre los dos de
 *                                arriba — lo que este módulo resuelve.
 *
 * NUNCA son el mismo id, y no hay ninguna relación aritmética o convención
 * entre ambos espacios de UUID — son generados por procesos totalmente
 * distintos. Pasar `ctx.user.id` directo a una columna con FK a
 * `ece.personal_salud(id)` es, exactamente, el bug que este módulo existe
 * para eliminar: `gs1-proceso-f.router.ts` (`autorizarDevolucion`) lo tenía
 * hasta este cambio — el UPDATE fallaba con violación de FK salvo que
 * `ctx.user.id` coincidiera por casualidad con un `personal_salud.id`, algo
 * que además es estructuralmente imposible ahora mismo (ver próximo punto).
 *
 * ── Dato crítico (verificado 2026-08-22, psql read-only vía DIRECT_URL
 *    contra prod) — `ece.personal_salud` tiene 0 FILAS EN PRODUCCIÓN ───────
 * Ningún usuario del HIS tiene hoy su contraparte clínica ECE. Todo flujo
 * que dependa de esa fila (firma electrónica, autorización con FK clínica,
 * certificación NTEC) es HOY INALCANZABLE para cualquier usuario, en
 * cualquier establecimiento. Esto no es una condición de borde rara — es el
 * estado universal actual. Por eso:
 *
 *   - `resolvePersonalSalud` devuelve `null` explícito cuando no hay fila.
 *     Nunca inventa ni aproxima un resultado.
 *   - `requirePersonalSalud` lanza un `TRPCError` que dice QUÉ falta
 *     (no un "no autorizado" genérico) y dónde resolverlo.
 *   - Ninguna de las dos cae a `hisUserId` como si fuera un id ECE válido
 *     "por las dudas". Esa suposición es exactamente la que produjo el bug
 *     de devoluciones.
 *
 * ── Hallazgo relacionado — el camino de alta actual NO puede cerrar el gap
 * `personal-salud.router.ts` es hoy el único camino de producción para
 * crear filas en `ece.personal_salud` (UI en `/profesionales-salud` y
 * `/medicos`). Tiene un SEGUNDO defecto de identidad, independiente de este
 * módulo: su `create` nunca setea `his_user_id` (la columna que este
 * resolver y las ~100 subqueries dispersas leen), y sus mutations de
 * vínculo (`linkAuthUser` / `createAndLinkUser`) solo setean `auth_user_id`
 * (FK a `auth.users`, un TERCER espacio de ids, usado únicamente por las
 * vistas B2B2C de reportes de médico). Es decir: aunque un ADMIN dé de alta
 * y "vincule" un profesional hoy mismo con la UI existente, la fila
 * resultante sigue sin `his_user_id`, y `requirePersonalSalud` seguirá
 * lanzando para ese usuario. Cerrar R03 de raíz requiere tocar también esas
 * dos mutations — deliberadamente fuera del alcance de este cambio (ver
 * "qué falta" en el informe del PR que introduce este archivo).
 *
 * ── Contrato de uso ───────────────────────────────────────────────────────
 * Debe llamarse DENTRO de una transacción con el contexto RLS ECE ya
 * aplicado — `withEceContext` (`packages/trpc/src/ece/rls-context.ts`) o
 * `withWorkflowContext` (`packages/trpc/src/workflow/context.ts`; son dos
 * helpers paralelos para el mismo par de GUC, ver la nota en ese archivo).
 * La policy `personal_by_estab` de `ece.personal_salud` exige
 * `establecimiento_id = ece.current_establecimiento_id_safe()`; sin el GUC
 * seteado en la transacción activa, la fila puede existir y aun así este
 * resolver reporta "no encontrado" — un falso negativo indistinguible del
 * caso real. Si `requirePersonalSalud` falla para un usuario que sí tiene
 * fila, lo primero a revisar es si la `tx` recibida tiene el contexto ECE
 * aplicado (y con el `establecimientoId` correcto).
 *
 * La receta completa para migrar el resto de los call sites pendientes está
 * al final de este archivo.
 */
import { TRPCError } from "@trpc/server";

/**
 * Subconjunto mínimo de PrismaClient/tx que necesita este módulo. Cualquier
 * `tx` real (PrismaClient, el `tx` de `$transaction`, o el de
 * `withEceContext` / `withWorkflowContext` / `withTenantContext`) lo
 * satisface estructuralmente — no hace falta castear en el call site.
 */
export type PersonalSaludTx = {
  $queryRaw: (query: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
};

export interface PersonalSalud {
  /** `ece.personal_salud.id` — el id que exigen las FK clínicas. */
  id: string;
  nombreCompleto: string;
}

interface PersonalSaludRow {
  id: string;
  nombre_completo: string;
}

/**
 * Resuelve la fila `ece.personal_salud` activa vinculada a `hisUserId`
 * (= `public."User".id`, típicamente `ctx.user.id`).
 *
 * Devuelve `null` si no existe fila, si existe pero `activo = false`, o si
 * RLS la esconde por contexto de establecimiento ausente/incorrecto — los
 * tres casos son indistinguibles desde acá a propósito (ver contrato de uso
 * arriba); el caller decide cómo reaccionar. Para el caso común ("necesito
 * la fila o debo fallar con un mensaje claro") usar `requirePersonalSalud`.
 */
export async function resolvePersonalSalud(
  tx: PersonalSaludTx,
  hisUserId: string,
): Promise<PersonalSalud | null> {
  const rows = await (
    tx.$queryRaw as (
      query: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<PersonalSaludRow[]>
  )`
    SELECT id::text, nombre_completo
    FROM ece.personal_salud
    WHERE his_user_id = ${hisUserId}::uuid
      AND activo = true
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, nombreCompleto: row.nombre_completo };
}

export interface RequirePersonalSaludOptions {
  /**
   * Qué se estaba intentando hacer, en español, para insertar en el mensaje
   * de error (ej. "autorizar la devolución de inventario"). Opcional: sin
   * esto el mensaje sigue siendo específico (dice QUÉ falta), solo menos
   * contextual sobre la acción que lo disparó.
   */
  action?: string;
}

/**
 * Como `resolvePersonalSalud`, pero lanza `TRPCError` (`PRECONDITION_FAILED`)
 * si no hay contraparte clínica activa. Usar SIEMPRE que el resultado vaya a
 * parar a un campo con FK a `ece.personal_salud(id)` (autoriza, firma,
 * valida, certifica) — nunca sustituir por `hisUserId` ni por `ctx.user.id`.
 *
 * El `cause` estructurado permite a callers programáticos (tests, UI)
 * distinguir esta causa de otros `PRECONDITION_FAILED` sin parsear el
 * mensaje.
 */
export async function requirePersonalSalud(
  tx: PersonalSaludTx,
  hisUserId: string,
  options: RequirePersonalSaludOptions = {},
): Promise<PersonalSalud> {
  const personal = await resolvePersonalSalud(tx, hisUserId);
  if (personal) return personal;

  const suffix = options.action ? ` para ${options.action}` : "";
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      `Su usuario no tiene un registro de personal de salud (ece.personal_salud) ` +
      `activo y vinculado${suffix}. Pida a un ADMIN/DIR que lo dé de alta y lo ` +
      `vincule (his_user_id) en /profesionales-salud antes de continuar.`,
    cause: {
      code: "ECE_PERSONAL_SALUD_NOT_FOUND",
      hisUserId,
    },
  });
}

// ============================================================================
// Receta de migración — para el resto de los call sites pendientes
// ============================================================================
//
// Quedan ~62 subqueries de patrón equivalente sin migrar (de las ~107
// originales, este cambio migró 8 en 6 archivos — ver el PR que introduce
// este módulo para la lista exacta). Migrar uno:
//
// 1. Ubicar el bloque. Firma típica encontrada en el barrido:
//
//      const rows = await tx.$queryRaw<{ id: string }[]>`
//        SELECT id FROM ece.personal_salud
//        WHERE his_user_id = ${hisUserId}::uuid AND activo = true
//        LIMIT 1
//      `;
//      if (!rows[0]) {
//        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "..." });
//      }
//      const personalId = rows[0].id;
//
//    Reemplazar por:
//
//      import { requirePersonalSalud } from "../../lib/identity-resolver"; // ajustar profundidad
//      ...
//      const personal = await requirePersonalSalud(tx, hisUserId, {
//        action: "<qué se está intentando hacer, en español>",
//      });
//      const personalId = personal.id;
//
//    Si el caller necesita distinguir "no existe" de otro flujo (sin
//    lanzar), usar `resolvePersonalSalud` y manejar el `null` explícito.
//
// 2. CUIDADO con los casos que YA hacen JOIN con otra tabla en la misma
//    query (ej. `ece.firma_electronica` en la misma sentencia — ver
//    `certificado-defuncion.router.ts:261` o `critical-result.router.ts`,
//    este último NO migrado porque otro equipo lo está tocando). Esos NO son
//    drop-in: hay que separar en dos queries (identidad + lo demás) o dejar
//    el JOIN y solo documentar por qué no aplica el helper. No fusiones
//    lookup-de-identidad con lookup-de-negocio en queries nuevas — separarlos
//    es lo que permite reusar este módulo.
//
// 3. Correr los tests del archivo tocado. Los tests existentes mockean
//    `prisma.$queryRaw` con `mockResolvedValueOnce([{ id: PERSONAL_ID }])`
//    en la posición secuencial del lookup de personal — migrar a
//    `requirePersonalSalud` preserva el conteo y el orden de llamadas a
//    `$queryRaw` (sigue siendo UNA sola query), así que los mocks existentes
//    no deberían requerir cambios. Si un test rompe por esto, es señal de
//    que el call site fusionaba lookups (ver punto 2).
//
// 4. NO tocar `personal-salud.router.ts` como parte de una migración de
//    lectura — ese archivo es el lado de ESCRITURA (alta/vínculo) y tiene su
//    propio defecto documentado arriba ("Hallazgo relacionado"). Migrarlo
//    es un cambio de producto (qué inputs pide el form, quién puede setear
//    his_user_id), no una migración mecánica de lectura.
