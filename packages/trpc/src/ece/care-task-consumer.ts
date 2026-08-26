/**
 * Consumer — 'ece.indicaciones.firmadas' → `public."CareTask"` (CC-0026 D2).
 *
 * Al firmar una indicación médica, cada ítem genera UNA tarea de seguimiento
 * asignada a enfermería en la unidad del episodio (REQ CC-0026, decisión D2)
 * — CON UNA EXCEPCIÓN corregida por Edwin 2026-08-26 tras UAT: los ítems
 * ESTUDIO cuyo `detalle.categoriaUI` sea LABORATORIO o GABINETE NO generan
 * tarea de enfermería. Esos ítems generan en su lugar la orden real
 * (LabOrder/ImagingRequest+ImagingOrder) y una `CareTask` para el área
 * ejecutora — ver `order-consumer.ts` y su `categoriaUIDeItem` (mismo
 * discriminador, importado aquí para que los dos consumers nunca diverjan
 * sobre qué ítems son "estudio real"). "Los estudios no se hacen para
 * enfermería: pueden ayudar a sacar muestras pero no generan los resultados"
 * (REQ CC-0026, decisión D2).
 *
 * Patrón gemelo de `mar-consumer.ts` (misma transacción `withEceContext` que
 * `firmar()`, mismo contrato de fallo: NO atrapa excepciones — si el INSERT
 * de `CareTask` falla, la excepción propaga y la transacción completa de
 * `firmar()` hace ROLLBACK (la firma, el evento de dominio y la
 * materialización a farmacia se revierten junto con las tareas). Se prefirió
 * esto sobre "firmar bien y perder las tareas silenciosamente" por la misma
 * razón que mar-consumer: nunca debe existir un estado "firmado pero el
 * área de seguimiento no se enteró".
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RESOLUCIÓN DE organizationId (columna NOT NULL, SÍ chequeada por las
 * policies RLS de sql/209 — ver la cabecera de ese archivo, "la trampa de
 * los dos espacios de GUC"):
 *
 * `firmar()` corre bajo `withEceContext` — el GUC `app.current_org_id` NUNCA
 * se setea ahí (es exclusivo de `withTenantContext`). Se resuelve llamando a
 * `public.current_org_id_or_ece_context()` (SECURITY DEFINER, sql/209) en
 * vez de confiar en un valor de aplicación (`ctx.tenant.organizationId`):
 * así el valor insertado es, por construcción, EXACTAMENTE el que la policy
 * `care_task_tenant_insert` va a exigir en su `WITH CHECK` — cero riesgo de
 * que un INSERT válido choque con una violación de RLS por un desalineamiento
 * entre "lo que cree la app" y "lo que la policy puede probar".
 *
 * `establishmentId` (también NOT NULL) SÍ se recibe del caller
 * (`ctx.tenant.establishmentId`, espacio `public."Establishment"`) en vez de
 * resolverse aquí: a diferencia de `organizationId`, ninguna policy de
 * `CareTask` lo compara contra nada (sql/209 §4 solo chequea
 * `organizationId`), así que no hay riesgo de mismatch con un `WITH CHECK` —
 * y resolverlo desde `ece.establecimiento` requeriría el mismo salto a
 * `public."Establishment"` que el header de sql/209 documenta como
 * RLS-bloqueado para un `SELECT` plano bajo este contexto.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * MAPEO episodio → patient/encounter/serviceUnit (LÍMITE DOCUMENTADO):
 *
 *   - encounterId: columna directa `ece.episodio_atencion.public_encounter_id`
 *     (FK nullable a `public."Encounter"`, Opción B — sql/59). Esa tabla NO
 *     tiene RLS habilitado (sin `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
 *     en el corpus, verificado 2026-08-26), así que el `SELECT` no tropieza
 *     con ningún GUC ausente.
 *   - patientId: vía `ece.paciente.public_patient_id` (FK nullable a
 *     `public."Patient"`, sql/58 — "ACL hacia el MPI"), unido con
 *     `LEFT JOIN` desde `episodio_atencion.paciente_id`. `ece.paciente` SÍ
 *     tiene RLS (`ece_paciente_select`, sql/62) pero exige el mismo GUC ECE
 *     que esta transacción ya trae (`app.ece_establecimiento_id` +
 *     `app.ece_personal_id` de un `personal_salud` activo) — se resuelve
 *     igual de bien que cualquier otra lectura del router. El `LEFT JOIN`
 *     (no `INNER`) hace que si esa policy no matcheara por cualquier motivo,
 *     `patientId` degrade a NULL en vez de tronar la consulta completa.
 *   - serviceUnitId: SIEMPRE NULL en esta ola. `public.ServiceUnit` solo es
 *     alcanzable hoy vía `Encounter.serviceUnitId`, y `public."Encounter"`
 *     SÍ tiene RLS con la policy genérica `tenant_isolation_select`
 *     (`"organizationId" = current_org_id()`, sql/01) — bloqueada bajo este
 *     contexto por la misma trampa de GUC que motivó el resolver de sql/209,
 *     y no existe ningún bridge `ece.servicio → public."ServiceUnit"` en el
 *     corpus (verificado 2026-08-26, 0 columnas `service_unit_id` en DDL de
 *     `ece`). Cerrarlo exigiría o bien un resolver SECURITY DEFINER nuevo
 *     (fuera de alcance de esta ola — no autorizado a tocar sql/209) o el
 *     bridge estructural. La columna es nullable por diseño exactamente para
 *     este caso. `/tableros/[unidad]` (Ola 3) tendrá que filtrar estas tareas
 *     por `assignedRoleCode` (transversal) hasta que el bridge exista.
 *   - patientAccountId: SIEMPRE NULL — no forma parte del contrato D2 y
 *     depende de la misma cadena bloqueada que serviceUnitId (vía Encounter).
 */
import type { PrismaClient } from "@his/database";
import { categoriaUIDeItem } from "./order-consumer";

export interface CareTaskIndicacionItem {
  id: string;
  /** Valor crudo de `ece.indicacion_item.tipo` (CHECK `chk_ind_item_tipo`, sql/202). */
  tipo: string;
  descripcion: string;
  /**
   * CC-0026 — corrección de Edwin 2026-08-26: necesario para excluir de
   * enfermería los ítems ESTUDIO que `order-consumer.ts` materializa como
   * LabOrder/ImagingRequest real (ver `categoriaUIDeItem` más abajo).
   */
  detalle?: Record<string, unknown> | null;
}

export interface MaterializeCareTasksParams {
  /**
   * PK de `ece.indicaciones_medicas` — no se persiste en `CareTask` (la
   * trazabilidad hacia el ítem exacto va por `sourceId`, ver abajo). Se
   * mantiene en la firma por simetría con `MaterializeIndicacionFirmadaParams`
   * de `mar-consumer.ts` y como punto de extensión si una ola futura necesita
   * agrupar tareas por indicación en vez de por ítem.
   */
  indicacionId: string;
  episodioId: string;
  /** Espacio `ece.establecimiento` (el mismo pasado a `ece.set_ece_context`). */
  eceEstablecimientoId: string;
  /** Espacio `public."Establishment"` (`ctx.tenant.establishmentId`) — ver nota de diseño arriba. */
  establishmentId: string;
  /** Médico que firma — puebla `CareTask.createdBy`. */
  userId: string;
  items: CareTaskIndicacionItem[];
}

export interface MaterializeCareTasksResult {
  tasksCreated: number;
}

/** Espejo de chk_ind_item_tipo (sql/202) — incluye REPOSO aunque el enum Zod del router todavía no lo expone. */
const TASK_TYPE_BY_TIPO: Record<string, string> = {
  MEDICAMENTO: "IND_MED_CUMPLIR",
  DIETA: "IND_DIETA",
  CUIDADO_GENERAL: "IND_CUIDADOS",
  PROCEDIMIENTO: "IND_PROCEDIMIENTO",
  ESTUDIO: "IND_ESTUDIO",
  REPOSO: "IND_REPOSO",
};

/** tipo fuera del vocabulario conocido (drift BD↔código futuro) → categoría genérica en vez de crashear la firma. */
const FALLBACK_TASK_TYPE = "IND_GENERAL";

/** JCI/mockup: STAT o "urgente" (cualquier capitalización) en la descripción sube la prioridad. */
const HIGH_PRIORITY_PATTERN = /\bSTAT\b|urgente/i;

const TITLE_MAX_LENGTH = 200;

function resolveTaskType(tipo: string): string {
  return TASK_TYPE_BY_TIPO[tipo.toUpperCase()] ?? FALLBACK_TASK_TYPE;
}

function resolvePriority(descripcion: string): "NORMAL" | "HIGH" {
  return HIGH_PRIORITY_PATTERN.test(descripcion) ? "HIGH" : "NORMAL";
}

/**
 * Crea una `CareTask` NURSE por cada ítem de la indicación. Debe llamarse
 * DENTRO de la misma transacción `withEceContext` que `firmar()` (mismo
 * `tx`), DESPUÉS de `materializeIndicacionFirmadaToFarmacia`.
 *
 * NO atrapa excepciones — ver contrato de fallo en el header del archivo.
 */
export async function materializeCareTasksFromIndicacion(
  tx: PrismaClient,
  params: MaterializeCareTasksParams,
): Promise<MaterializeCareTasksResult> {
  const { episodioId, eceEstablecimientoId, establishmentId, userId, items } = params;

  if (items.length === 0) {
    return { tasksCreated: 0 };
  }

  const orgRows = await tx.$queryRaw<{ org_id: string | null }[]>`
    SELECT public.current_org_id_or_ece_context()::text AS org_id
  `;
  const organizationId = orgRows[0]?.org_id ?? null;
  if (!organizationId) {
    throw new Error(
      "materializeCareTasksFromIndicacion: public.current_org_id_or_ece_context() " +
        `devolvió NULL para el establecimiento ECE ${eceEstablecimientoId}. ` +
        "No se puede resolver organizationId para CareTask — revisar " +
        "ece.establecimiento.establishment_id (posible NULL) antes de reintentar.",
    );
  }

  const bridgeRows = await tx.$queryRaw<
    { encounter_id: string | null; patient_id: string | null }[]
  >`
    SELECT
      ea.public_encounter_id::text AS encounter_id,
      p.public_patient_id::text AS patient_id
    FROM ece.episodio_atencion ea
    LEFT JOIN ece.paciente p ON p.id = ea.paciente_id
    WHERE ea.id = ${episodioId}::uuid
  `;
  const encounterId = bridgeRows[0]?.encounter_id ?? null;
  const patientId = bridgeRows[0]?.patient_id ?? null;

  let tasksCreated = 0;
  for (const item of items) {
    // CC-0026 — ítems lab/gabinete no generan tarea de enfermería; los
    // materializa `order-consumer.ts` con su propia CareTask de área.
    if (categoriaUIDeItem(item.tipo, item.detalle) !== null) {
      continue;
    }

    await tx.careTask.create({
      data: {
        organizationId,
        establishmentId,
        // serviceUnitId/patientAccountId: NULL — ver "LÍMITE DOCUMENTADO" en el header.
        serviceUnitId: null,
        assignedRoleCode: "NURSE",
        patientId,
        encounterId,
        patientAccountId: null,
        sourceType: "INDICACION_ITEM",
        sourceId: item.id,
        taskType: resolveTaskType(item.tipo),
        title: item.descripcion.slice(0, TITLE_MAX_LENGTH),
        priority: resolvePriority(item.descripcion),
        status: "PENDIENTE",
        createdBy: userId,
      },
    });
    tasksCreated += 1;
  }

  return { tasksCreated };
}
