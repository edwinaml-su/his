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
import { emitDomainEvent, type PrismaClient } from "@his/database";
import { categoriaUIDeItem } from "./order-consumer";

/** CC-0036 — alias de "médico general" para efectos de US.AFIL.1.11.2 (mismo criterio que `PHYSICIAN_CODES` de `middleware/ece-permission.ts`, acotado a los 2 códigos relevantes acá). */
const PHYSICIAN_ROLE_CODES = new Set(["PHYSICIAN", "MC"]);

/**
 * CC-0036 US.AFIL.1.11.2/3 (REQ-HIS-AFIL-001 Bloque C) — si `assignedRoleCode`
 * es de médico general y la tarea no trae `assigneeId` explícito, resuelve el
 * médico de turno vigente en la sede vía `fn_medico_de_turno` (sql/243) y
 * devuelve su `userId`. Sin cobertura: no asigna a nadie y emite
 * `task.escalated` a JEFE_MEDICO_SEDE con resumen `SIN_COBERTURA` — NUNCA
 * bloquea el flujo clínico (try/catch, mismo contrato de fallo que el puente
 * de notificación `task.action_required` de más abajo).
 *
 * Forward-wired: en este consumer `assignedRoleCode` siempre es `NURSE`
 * (`TASK_TYPE_BY_TIPO` solo produce tareas de enfermería) — la rama de
 * médico general está lista para cuando algún tipo de indicación futuro (o
 * cualquier otro creador de `CareTask`, ver `order-consumer.ts`) apunte a
 * `PHYSICIAN`/`MC`. Con `assignedRoleCode="NURSE"` retorna sin tocar la BD.
 */
export async function resolveMedicoGeneralAssignee(
  tx: PrismaClient,
  params: {
    organizationId: string;
    establishmentId: string;
    assignedRoleCode: string;
    taskId: string;
    taskType: string;
    title: string;
    emittedById: string;
  },
): Promise<string | null> {
  if (!PHYSICIAN_ROLE_CODES.has(params.assignedRoleCode)) return null;
  try {
    const rows = await tx.$queryRaw<Array<{ userId: string; tipo: string }>>`
      SELECT "userId", tipo FROM public.fn_medico_de_turno(${params.establishmentId}::uuid)
    `;
    const medico = rows.find((r) => r.tipo === "MEDICO_GENERAL");
    if (medico) return medico.userId;

    await emitDomainEvent(tx, {
      organizationId: params.organizationId,
      eventType: "task.escalated",
      aggregateType: "CareTask",
      aggregateId: params.taskId,
      emittedById: params.emittedById,
      payload: {
        taskType: params.taskType,
        sourceType: "CARE_TASK",
        sourceId: params.taskId,
        assignedRoleCode: "JEFE_MEDICO_SEDE",
        establishmentId: params.establishmentId,
        serviceUnitId: null,
        dueAt: null,
        url: "/turnos",
        resumen: `SIN_COBERTURA — no hay médico general de turno para asignar: ${params.title}`,
      },
    });
  } catch (err) {
    console.error(
      `[CC-0036 care-task-consumer] resolución de médico de turno falló para CareTask ${params.taskId} — ` +
        "la tarea queda sin asignatario, sin bloquear el flujo.",
      err,
    );
  }
  return null;
}

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

/**
 * CC-0031 Fase 3(a) — SLA en minutos por `taskType` IND_*. No existe entrada
 * en `TASK_SLA_MINUTES` (workflow-inbox.ts, contracts) para estos códigos —
 * ese catálogo cubre los 69 tipos de la bandeja BPM, no el vocabulario propio
 * de CareTask (`IND_MED_CUMPLIR`/`IND_DIETA`/...). Mapeo documentado aquí
 * (criterio clínico aproximado, no normativo): medicación/procedimiento son
 * los más urgentes; dieta/reposo toleran más margen. `IND_ESTUDIO` no debería
 * ocurrir (excluido arriba, ver `categoriaUIDeItem`) pero se deja un default
 * por si el discriminador cambia.
 */
const CARE_TASK_SLA_MINUTES_BY_TASK_TYPE: Record<string, number> = {
  IND_MED_CUMPLIR: 60,
  IND_PROCEDIMIENTO: 120,
  IND_CUIDADOS: 120,
  IND_DIETA: 240,
  IND_REPOSO: 240,
  IND_ESTUDIO: 240,
  IND_GENERAL: 240,
};

/**
 * Pedido Edwin 2026-09-18 — la orden "Tomar signos vitales" (sección `sv` del
 * modal de cuidados, cuidados-catalogo.ts) genera ADEMÁS una CareTask propia
 * `SIGNOS_VITALES` en el tablero de enfermería: embebida en la tarea genérica
 * IND_CUIDADOS quedaba invisible como pendiente de toma. El SLA es la propia
 * frecuencia ordenada (cada N horas ⇒ la primera toma vence en N horas); el
 * watchdog sql/238b la vigila como a cualquier CareTask.
 */
const SV_SECCION_NOMBRE = "Tomar signos vitales";

/**
 * "Hora" → 60 · "N Horas" → N×60 · "Día" → 1440 · desconocido → 60.
 * Clamp a 7 días: `detalle` viene del input del router (z.unknown()), una
 * frecuencia artesanal gigante no debe overflow-ear el int4 de slaMinutes
 * (revienta el INSERT y revierte la firma completa).
 */
const SV_SLA_MAX_MINUTES = 7 * 1440;
function frecuenciaToMinutes(frecuencia: string): number {
  const f = frecuencia.trim().toLowerCase();
  if (f === "hora") return 60;
  if (f === "día" || f === "dia") return 1440;
  const m = /^(\d+)\s*horas?$/.exec(f);
  if (m) return Math.min(Number.parseInt(m[1]!, 10) * 60, SV_SLA_MAX_MINUTES);
  return 60;
}

/** Extrae la orden de toma de SV del detalle de un ítem CUIDADO_GENERAL (null si no la trae). */
function ordenSignosVitalesDe(
  item: CareTaskIndicacionItem,
): { frecuencia: string; monitorizados: boolean } | null {
  if (item.tipo.toUpperCase() !== "CUIDADO_GENERAL") return null;
  const secciones = item.detalle?.secciones;
  if (!Array.isArray(secciones)) return null;
  for (const raw of secciones) {
    const s = raw as { seccion?: unknown; frecuencia?: unknown; monitorizados?: unknown };
    if (s?.seccion === SV_SECCION_NOMBRE) {
      return {
        frecuencia: typeof s.frecuencia === "string" ? s.frecuencia : "Hora",
        monitorizados: s.monitorizados === true,
      };
    }
  }
  return null;
}

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

    const taskType = resolveTaskType(item.tipo);
    const title = item.descripcion.slice(0, TITLE_MAX_LENGTH);
    const slaMinutes = CARE_TASK_SLA_MINUTES_BY_TASK_TYPE[taskType] ?? CARE_TASK_SLA_MINUTES_BY_TASK_TYPE.IND_GENERAL!;
    const dueAt = new Date(Date.now() + slaMinutes * 60_000);

    const task = await tx.careTask.create({
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
        taskType,
        title,
        priority: resolvePriority(item.descripcion),
        slaMinutes,
        dueAt,
        status: "PENDIENTE",
        createdBy: userId,
      },
    });
    tasksCreated += 1;

    // CC-0036 US.AFIL.1.11.2/3 — resolución de médico de turno (no-op para
    // assignedRoleCode="NURSE", ver doc de la función).
    const medicoDeTurnoId = await resolveMedicoGeneralAssignee(tx, {
      organizationId,
      establishmentId,
      assignedRoleCode: "NURSE",
      taskId: task.id,
      taskType,
      title,
      emittedById: userId,
    });
    if (medicoDeTurnoId) {
      await tx.careTask.update({ where: { id: task.id }, data: { assigneeId: medicoDeTurnoId } });
    }

    // CC-0031 Fase 1(b) — puente tarea→notificación. Try/catch DELIBERADO:
    // a diferencia del INSERT de CareTask arriba (que SÍ debe revertir la tx
    // completa si falla, ver contrato de fallo en el header), un fallo acá
    // NO debe tumbar `firmar()` — es la misma lección de CC-0026 (D2) que ya
    // pagamos una vez con `DomainEvent` bajo `withEceContext` (sql/213: la
    // policy exige `current_org_id()`, que nunca está seteado en este
    // contexto — `current_org_id_or_ece_context()` ya lo resuelve, pero se
    // mantiene el try/catch como defensa en profundidad porque emitir un
    // evento es una mejora de UX, no un requisito de integridad de la firma).
    try {
      await emitDomainEvent(tx, {
        organizationId,
        eventType: "task.action_required",
        aggregateType: "CareTask",
        aggregateId: task.id,
        emittedById: userId,
        payload: {
          taskType,
          sourceType: "INDICACION_ITEM",
          sourceId: item.id,
          assignedRoleCode: "NURSE",
          establishmentId,
          serviceUnitId: null,
          dueAt: dueAt.toISOString(),
          url: "/tareas",
          resumen: title,
        },
      });
    } catch (err) {
      console.error(
        `[CC-0031 care-task-consumer] emitDomainEvent(task.action_required) falló para CareTask ${task.id} — ` +
          "la tarea se creó igual, solo no se emitió la notificación.",
        err,
      );
    }

    // ── Orden de toma de signos vitales ⇒ tarea PROPIA en el tablero de
    // enfermería (pedido Edwin 2026-09-18). Es ADICIONAL a la IND_CUIDADOS
    // del ítem: la genérica cubre el conjunto de cuidados; esta rastrea la
    // toma pendiente con SLA = frecuencia ordenada. Misma tx (falla ⇒
    // rollback de la firma, contrato del header); emit best-effort.
    const svOrden = ordenSignosVitalesDe(item);
    if (svOrden) {
      const svTitle = `Tomar signos vitales${svOrden.monitorizados ? " monitorizados" : ""} y anotar cada ${svOrden.frecuencia}`.slice(
        0,
        TITLE_MAX_LENGTH,
      );
      const svSla = frecuenciaToMinutes(svOrden.frecuencia);
      const svDueAt = new Date(Date.now() + svSla * 60_000);
      const svTask = await tx.careTask.create({
        data: {
          organizationId,
          establishmentId,
          serviceUnitId: null,
          assignedRoleCode: "NURSE",
          patientId,
          encounterId,
          patientAccountId: null,
          sourceType: "INDICACION_ITEM",
          sourceId: item.id,
          taskType: "SIGNOS_VITALES",
          title: svTitle,
          priority: resolvePriority(item.descripcion),
          slaMinutes: svSla,
          dueAt: svDueAt,
          status: "PENDIENTE",
          createdBy: userId,
        },
      });
      tasksCreated += 1;

      try {
        await emitDomainEvent(tx, {
          organizationId,
          eventType: "task.action_required",
          aggregateType: "CareTask",
          aggregateId: svTask.id,
          emittedById: userId,
          payload: {
            taskType: "SIGNOS_VITALES",
            sourceType: "INDICACION_ITEM",
            sourceId: item.id,
            assignedRoleCode: "NURSE",
            establishmentId,
            serviceUnitId: null,
            dueAt: svDueAt.toISOString(),
            url: "/tareas",
            resumen: svTitle,
          },
        });
      } catch (err) {
        console.error(
          `[care-task-consumer] emitDomainEvent(task.action_required) falló para CareTask SV ${svTask.id} — ` +
            "la tarea se creó igual, solo no se emitió la notificación.",
          err,
        );
      }
    }
  }

  return { tasksCreated };
}
