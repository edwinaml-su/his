/**
 * Consumer — 'ece.indicaciones.firmadas' → `LabOrder`/`ImagingRequest`+`ImagingOrder`
 * (CC-0026 D2, corrección de Edwin 2026-08-26 tras UAT).
 *
 * Los ítems de indicación tipo=ESTUDIO con `detalle.categoriaUI` LABORATORIO o
 * GABINETE NO generan una tarea de enfermería (ver `care-task-consumer.ts`,
 * que excluye estos mismos ítems vía `categoriaUIDeItem`): en su lugar generan
 * la orden REAL en su módulo — `LabOrder` (LIS, CC-0013) o
 * `ImagingRequest`+`ImagingOrder` (RIS, CC-0016) — más una `CareTask` para el
 * área ejecutora (LAB_TECHNICIAN/RAD_TECHNICIAN), no para NURSE. "Los estudios
 * no se hacen para enfermería: pueden ayudar a sacar muestras pero no generan
 * los resultados" (REQ CC-0026, decisión D2).
 *
 * Debe llamarse DENTRO de la misma transacción `withEceContext` que `firmar()`,
 * DESPUÉS de `materializeCareTasksFromIndicacion`. Mismo contrato de fallo que
 * los demás consumers de `firmar()` (mar-consumer.ts, care-task-consumer.ts):
 * NO atrapa excepciones de infraestructura — si un INSERT falla de verdad
 * (constraint, conexión), la excepción propaga y `firmar()` hace ROLLBACK
 * completo. La única salida "silenciosa" es cuando la CADENA episodio→paciente
 * no es resoluble (ver abajo): eso NO es un error de infraestructura, es un
 * dato faltante — se reporta en `ordenesOmitidas` sin abortar la firma ni
 * inventar un paciente/cuenta.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTEXTO DUAL DE ESCRITURA
 * ─────────────────────────────────────────────────────────────────────────
 * `LabOrder`/`ImagingRequest`/`ImagingOrder` son tablas `public.*` con RLS de
 * tenant clásico (`organizationId = current_org_id()`). `firmar()` corre bajo
 * `withEceContext` (GUC `app.ece_*`, NUNCA `app.current_org_id`) — por eso el
 * router debe invocar `withEceContext(..., { tenantContext: { userId, orgId } })`
 * (ver `packages/trpc/src/ece/rls-context.ts`) para que esta misma transacción
 * también tenga `app.current_org_id`/`app.current_user_id` seteados ANTES del
 * demote a `authenticated`. Sin eso, todo INSERT/SELECT Prisma tipado de este
 * archivo (`tx.labOrder.create`, `tx.patientAccount.findFirst`, etc.) caería
 * en deny-all silencioso — la misma trampa documentada en la cabecera de
 * `packages/database/sql/209_cc0026_care_task.sql`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * RESOLUCIÓN organizationId / patientId / encounterId / patientAccountId
 * ─────────────────────────────────────────────────────────────────────────
 *   - organizationId: `public.current_org_id_or_ece_context()` (SECURITY
 *     DEFINER, sql/209) — igual que `care-task-consumer.ts`. Con el
 *     `tenantContext` de arriba ya seteado, `current_org_id()` (rama feliz de
 *     esa función) también resolvería, pero se mantiene la misma llamada que
 *     el resto del corpus para no depender de que el caller siempre pase
 *     `tenantContext` (defensa en profundidad, cero costo extra).
 *   - encounterId/patientId: mismo bridge de `care-task-consumer.ts`
 *     (`ece.episodio_atencion.public_encounter_id` / `ece.paciente.public_patient_id`,
 *     `LEFT JOIN` para que un paciente ECE sin ACL al MPI degrade a NULL en
 *     vez de tronar).
 *   - patientId es NOT NULL en `LabOrder`/`ImagingRequest` (a diferencia de
 *     `CareTask`, donde es nullable): si el bridge no resuelve `patientId`,
 *     NINGÚN ítem lab/gabinete de este episodio puede materializar su orden
 *     real — se listan todos en `ordenesOmitidas` y la firma sigue adelante
 *     (nunca se inventa un paciente).
 *   - patientAccountId es nullable en ambas tablas: se intenta resolver
 *     (por `encounterId`, luego fallback a la cuenta más reciente del
 *     paciente — mismo criterio que `lis.router.ts` `order.create`) pero si
 *     no hay ninguna cuenta, la orden se crea igual con `patientAccountId=null`
 *     (no es motivo de omisión — el contrato NOT NULL que bloquea es el de
 *     `patientId`, no el de la cuenta).
 */
import type { PrismaClient } from "@his/database";
import { MODALITY_EXECUTOR_CODE } from "../lib/modality-executor";

export interface OrderIndicacionItem {
  id: string;
  /** Valor crudo de `ece.indicacion_item.tipo` (CHECK `chk_ind_item_tipo`, sql/202). */
  tipo: string;
  descripcion: string;
  /** Payload estructurado del modal CPOE (ESP-MOCKUP-0026) — ver los `compose()` de
   * `modal-laboratorio.tsx`/`modal-gabinete.tsx` para las claves exactas por categoría. */
  detalle: Record<string, unknown> | null;
}

export interface MaterializeOrdenesParams {
  episodioId: string;
  /** Espacio `public."Establishment"` — `ImagingOrder.establishmentId`, ancla del `ServiceUnit` del área. */
  establishmentId: string;
  /** Médico que firma — `LabOrder.prescriberId`, `ImagingOrder.orderingProviderId`, `ImagingRequest.firmadoPor`. */
  userId: string;
  items: OrderIndicacionItem[];
}

export interface OrdenOmitida {
  descripcion: string;
  motivo: string;
}

export interface MaterializeOrdenesResult {
  labOrdersCreated: number;
  imagingRequestsCreated: number;
  ordenesOmitidas: OrdenOmitida[];
}

/**
 * Discriminador único lab/gabinete — compartido con `care-task-consumer.ts`
 * para que ambos consumers concuerden siempre en qué ítems corresponden a
 * "estudio real" (si drift entre los dos, un ítem podría quedar sin NINGUNA
 * tarea, o con dos). `tipo` debe ser ESTUDIO (CHECK sql/202/211) Y
 * `detalle.categoriaUI` debe ser el valor que arma el modal correspondiente.
 */
export function categoriaUIDeItem(
  tipo: string,
  detalle: Record<string, unknown> | null | undefined,
): "LABORATORIO" | "GABINETE" | null {
  if (tipo.toUpperCase() !== "ESTUDIO") {
    return null;
  }
  const categoria = detalle?.categoriaUI;
  return categoria === "LABORATORIO" || categoria === "GABINETE" ? categoria : null;
}

/** Espejo de `PRIORIDADES` en modal-laboratorio.tsx/modal-gabinete.tsx. */
const SLA_MINUTES_BY_MOCKUP: Record<string, number> = {
  STAT: 60,
  Urgente: 240,
  Rutina: 1440,
};

const CARE_TASK_PRIORITY_BY_MOCKUP: Record<string, "CRITICAL" | "HIGH" | "NORMAL"> = {
  STAT: "CRITICAL",
  Urgente: "HIGH",
  Rutina: "NORMAL",
};

/** LabPriority/ImagingPriority (Prisma) comparten el mismo vocabulario ROUTINE|URGENT|STAT. */
const ENGINE_PRIORITY_BY_MOCKUP: Record<string, "ROUTINE" | "URGENT" | "STAT"> = {
  STAT: "STAT",
  Urgente: "URGENT",
  Rutina: "ROUTINE",
};

const TITLE_MAX_LENGTH = 200;

function readString(detalle: Record<string, unknown>, key: string): string | undefined {
  const v = detalle[key];
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

function readBoolean(detalle: Record<string, unknown>, key: string): boolean | undefined {
  const v = detalle[key];
  return typeof v === "boolean" ? v : undefined;
}

function priorityMockupOf(detalle: Record<string, unknown>): string {
  return readString(detalle, "prioridad") ?? "Rutina";
}

/** Mismo criterio que `lis.router.ts` `order.create`: por encounterId, fallback a la cuenta más reciente. */
async function resolvePatientAccountId(
  tx: PrismaClient,
  organizationId: string,
  patientId: string,
  encounterId: string | null,
): Promise<string | null> {
  if (encounterId) {
    const byEncounter = await tx.patientAccount.findFirst({
      where: { patientId, organizationId, encounterId },
      select: { id: true },
    });
    if (byEncounter) {
      return byEncounter.id;
    }
  }
  const latest = await tx.patientAccount.findFirst({
    where: { patientId, organizationId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return latest?.id ?? null;
}

/**
 * Crea `LabOrder`/`ImagingRequest`+`ImagingOrder` reales + `CareTask` de área
 * por cada ítem ESTUDIO de la indicación cuyo `detalle.categoriaUI` sea
 * LABORATORIO o GABINETE. Debe llamarse DENTRO de la misma transacción
 * `withEceContext(..., { tenantContext })` que `firmar()`, DESPUÉS de
 * `materializeCareTasksFromIndicacion`.
 *
 * NO atrapa excepciones de infraestructura — ver contrato de fallo en el
 * header del archivo. Las condiciones de "cadena episodio→paciente
 * irresoluble" o "catálogo no encontrado" NO son excepciones: se acumulan en
 * `ordenesOmitidas` y la función retorna normalmente.
 */
export async function materializeOrdenesFromIndicacion(
  tx: PrismaClient,
  params: MaterializeOrdenesParams,
): Promise<MaterializeOrdenesResult> {
  const { episodioId, establishmentId, userId, items } = params;

  const result: MaterializeOrdenesResult = {
    labOrdersCreated: 0,
    imagingRequestsCreated: 0,
    ordenesOmitidas: [],
  };

  const labItems = items.filter((i) => categoriaUIDeItem(i.tipo, i.detalle) === "LABORATORIO");
  const gabItems = items.filter((i) => categoriaUIDeItem(i.tipo, i.detalle) === "GABINETE");

  if (labItems.length === 0 && gabItems.length === 0) {
    return result;
  }

  const orgRows = await tx.$queryRaw<{ org_id: string | null }[]>`
    SELECT public.current_org_id_or_ece_context()::text AS org_id
  `;
  const organizationId = orgRows[0]?.org_id ?? null;
  if (!organizationId) {
    throw new Error(
      "materializeOrdenesFromIndicacion: public.current_org_id_or_ece_context() " +
        "devolvió NULL — no se puede resolver organizationId para LabOrder/ImagingRequest.",
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

  if (!patientId) {
    const motivo =
      "No se pudo resolver el paciente del episodio (bridge ece.paciente → public.Patient sin ACL) — " +
      "LabOrder/ImagingRequest exigen patientId; genere la orden manualmente desde el módulo LIS/RIS.";
    for (const item of [...labItems, ...gabItems]) {
      result.ordenesOmitidas.push({ descripcion: item.descripcion, motivo });
    }
    return result;
  }

  const patientAccountId = await resolvePatientAccountId(tx, organizationId, patientId, encounterId);

  // ─── Laboratorio ────────────────────────────────────────────────────────
  for (const item of labItems) {
    const detalle = item.detalle ?? {};
    const labTestId = readString(detalle, "labTestId");
    if (!labTestId) {
      result.ordenesOmitidas.push({
        descripcion: item.descripcion,
        motivo: "Ítem de laboratorio sin labTestId en detalle (drift UI↔consumer).",
      });
      continue;
    }

    const test = await tx.labTest.findFirst({
      where: { id: labTestId, OR: [{ organizationId: null }, { organizationId }] },
      select: { id: true },
    });
    if (!test) {
      result.ordenesOmitidas.push({
        descripcion: item.descripcion,
        motivo: "Examen no encontrado en el catálogo de laboratorio del tenant.",
      });
      continue;
    }

    const prioridadMockup = priorityMockupOf(detalle);
    const engineePriority = ENGINE_PRIORITY_BY_MOCKUP[prioridadMockup] ?? "ROUTINE";
    const tipoMuestra = readString(detalle, "tipoMuestra");
    const observaciones = readString(detalle, "observaciones");

    const labCli = await tx.costCenter.findFirst({
      where: { organizationId, code: "2-LAB-CLI" },
      select: { id: true },
    });

    const order = await tx.labOrder.create({
      data: {
        organizationId,
        encounterId,
        patientId,
        patientAccountId,
        prescriberId: userId,
        priority: engineePriority,
        status: "ORDERED",
        clinicalIndication: observaciones ?? item.descripcion,
        ejecutorCostCenterId: labCli?.id ?? null,
        items: {
          create: [
            {
              testId: labTestId,
              notes: tipoMuestra ? `Muestra: ${tipoMuestra}` : null,
            },
          ],
        },
      },
    });
    result.labOrdersCreated += 1;

    const serviceUnit = await tx.serviceUnit.findFirst({
      where: { establishmentId, areaType: "LABORATORIO", active: true },
      select: { id: true },
    });
    if (!serviceUnit) {
      console.warn(
        `[CC-0026 order-consumer] Sin ServiceUnit areaType=LABORATORIO en establishmentId=${establishmentId}. ` +
          `CareTask LAB_TECHNICIAN queda con serviceUnitId=null.`,
      );
    }

    const slaMinutes = SLA_MINUTES_BY_MOCKUP[prioridadMockup] ?? SLA_MINUTES_BY_MOCKUP.Rutina!;
    await tx.careTask.create({
      data: {
        organizationId,
        establishmentId,
        serviceUnitId: serviceUnit?.id ?? null,
        assignedRoleCode: "LAB_TECHNICIAN",
        patientId,
        encounterId,
        patientAccountId,
        sourceType: "LAB_ORDER",
        sourceId: order.id,
        taskType: "LAB_TO_PROCESS",
        title: item.descripcion.slice(0, TITLE_MAX_LENGTH),
        priority: CARE_TASK_PRIORITY_BY_MOCKUP[prioridadMockup] ?? "NORMAL",
        slaMinutes,
        dueAt: new Date(Date.now() + slaMinutes * 60_000),
        status: "PENDIENTE",
        createdBy: userId,
      },
    });
  }

  // ─── Gabinete (imágenes) ────────────────────────────────────────────────
  for (const item of gabItems) {
    const detalle = item.detalle ?? {};
    const labTestId = readString(detalle, "labTestId");
    if (!labTestId) {
      result.ordenesOmitidas.push({
        descripcion: item.descripcion,
        motivo: "Ítem de gabinete sin labTestId en detalle (drift UI↔consumer).",
      });
      continue;
    }

    const test = await tx.labTest.findFirst({
      where: { id: labTestId, OR: [{ organizationId: null }, { organizationId }] },
      include: { imagingAttrs: true },
    });
    if (!test) {
      result.ordenesOmitidas.push({
        descripcion: item.descripcion,
        motivo: "Estudio no encontrado en el catálogo de imágenes del tenant.",
      });
      continue;
    }

    const prioridadMockup = priorityMockupOf(detalle);
    const engineePriority = ENGINE_PRIORITY_BY_MOCKUP[prioridadMockup] ?? "ROUTINE";
    const observaciones = readString(detalle, "observaciones");
    const modalityType = test.imagingAttrs?.modalityType ?? "OTHER";

    const anio = new Date().getFullYear();
    const seqRows = await tx.$queryRaw<{ n: number }[]>`
      SELECT public.fn_next_solicitud_imagen(${organizationId}::uuid, ${anio}::int) AS n
    `;
    const folio = `SOL-${anio}-${String(seqRows[0]!.n).padStart(4, "0")}`;
    const firmadoEn = new Date();

    const request = await tx.imagingRequest.create({
      data: {
        organizationId,
        folio,
        patientId,
        patientAccountId,
        encounterId,
        prioridad: engineePriority,
        justificacion: observaciones ?? null,
        observaciones: observaciones ?? null,
        firmadoPor: userId,
        firmadoEn,
        createdBy: userId,
      },
    });
    result.imagingRequestsCreated += 1;

    let ejecutorCostCenterId: string | null = null;
    const executorCode = MODALITY_EXECUTOR_CODE[modalityType];
    if (executorCode) {
      const cc = await tx.costCenter.findFirst({
        where: { organizationId, code: executorCode, active: true },
        select: { id: true },
      });
      ejecutorCostCenterId = cc?.id ?? null;
    }

    const order = await tx.imagingOrder.create({
      data: {
        organizationId,
        establishmentId,
        encounterId,
        patientId,
        patientAccountId,
        requestId: request.id,
        modalityId: test.imagingAttrs?.modalityId ?? null,
        modalityType,
        orderingProviderId: userId,
        studyDescription: readString(detalle, "nombre") ?? item.descripcion,
        bodySite: readString(detalle, "regionAnatomica") ?? null,
        clinicalIndication: observaciones ?? item.descripcion,
        priority: engineePriority,
        conContraste: readBoolean(detalle, "requiereContraste") ?? test.imagingAttrs?.requiereContraste ?? false,
        ejecutorCostCenterId,
        createdBy: userId,
      },
    });

    const serviceUnit = await tx.serviceUnit.findFirst({
      where: { establishmentId, areaType: "IMAGENES", active: true },
      select: { id: true },
    });
    if (!serviceUnit) {
      console.warn(
        `[CC-0026 order-consumer] Sin ServiceUnit areaType=IMAGENES en establishmentId=${establishmentId}. ` +
          `CareTask RAD_TECHNICIAN queda con serviceUnitId=null.`,
      );
    }

    const slaMinutes = SLA_MINUTES_BY_MOCKUP[prioridadMockup] ?? SLA_MINUTES_BY_MOCKUP.Rutina!;
    await tx.careTask.create({
      data: {
        organizationId,
        establishmentId,
        serviceUnitId: serviceUnit?.id ?? null,
        assignedRoleCode: "RAD_TECHNICIAN",
        patientId,
        encounterId,
        patientAccountId,
        sourceType: "IMAGING_ORDER",
        sourceId: order.id,
        taskType: "IMAGING_TO_PERFORM",
        title: item.descripcion.slice(0, TITLE_MAX_LENGTH),
        priority: CARE_TASK_PRIORITY_BY_MOCKUP[prioridadMockup] ?? "NORMAL",
        slaMinutes,
        dueAt: new Date(Date.now() + slaMinutes * 60_000),
        status: "PENDIENTE",
        createdBy: userId,
      },
    });
  }

  return result;
}
