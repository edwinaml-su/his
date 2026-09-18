/**
 * CC-0016 — Módulo de Radiología e Imágenes (mockup) sobre el RIS legacy §18.
 * Fuente: docs/CC/0016/mockup_modulo_imagenes.html.
 *
 * Router NUEVO (no extiende imaging.router.ts): el dominio es distinto —
 * imaging.router.ts es el flujo manual RIS/PACS (orden única con UUIDs,
 * DICOM, reportería/firma del radiólogo); este router es la "solicitud"
 * del mockup (cabecera ImagingRequest + N ImagingOrder hijas, catálogo de
 * 292 prestaciones, parametrización de campos/reglas). Mantenerlos
 * separados evita tocar los 452 tests existentes de imaging.router.test.ts.
 * `imaging.router.ts` sigue siendo la fuente de verdad para updateStatus/
 * report/cancel — las órdenes creadas aquí se gestionan con esos procedures.
 *
 * SQL: packages/database/sql/192_cc0016_modulo_imagenes.sql.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  imagingRequestCrearInput,
  imagingRequestListarPorCuentaInput,
  imagingRequestListarPorPacienteInput,
  imagingRequestDetalleInput,
  imagingFormFieldConfigSetInput,
  imagingModuleRuleSetInput,
  imagingCatalogoUpsertInput,
  imagingSupervisionInput,
  imagingSlaConfigUpsertInput,
  derivarEstadoSolicitud,
  imagingModalityTypeEnum,
  IMAGING_FIELD_KEYS,
  IMAGING_RULE_KEYS,
  type ImagingFieldKey,
  type ImagingFieldEstado,
  type ImagingRuleKey,
  type ImagingOrderStatusType,
  type ImagingCatalogoItem,
  type LabSlaEstado,
} from "@his/contracts";
import { emitDomainEvent } from "@his/database";

type ImagingModalityTypeValue = z.infer<typeof imagingModalityTypeEnum>;
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { withEceContext } from "../ece/rls-context";
import { MODALITY_EXECUTOR_CODE } from "../lib/modality-executor";
import { checkPin } from "./firma-electronica.router";
import { capturarCargo } from "../lib/charge-capture";
import {
  resolveImagingSlaMap,
  DEFAULT_LAB_SLA,
  CARE_TASK_PRIORITY_BY_LAB_PRIORITY,
  type LabPriorityKey,
} from "../lib/lab-sla";

/** CC-0016 — parametrización del módulo: solo administración. */
const catalogAdminProc = requireRole(["ADMIN", "DIR"]);

// -----------------------------------------------------------------------------
// Defaults (mockup FIELDS/RULES) — usados cuando la org aún no corrió el seed
// de SQL 192 o no ha personalizado un campo/regla puntual.
// -----------------------------------------------------------------------------

const DEFAULT_FIELD_CONFIG: Record<ImagingFieldKey, ImagingFieldEstado> = {
  dx: "obligatorio",
  just: "obligatorio",
  prio: "obligatorio",
  fecha: "opcional",
  // CC-0041 RF-06 — obligatorio SIEMPRE (sql/253 actualizó el seed; el
  // server además lo exige incondicional en `crear` y bloquea bajarlo).
  embarazo: "obligatorio",
  alergias: "opcional",
  creat: "opcional",
  obs: "oculto",
};

const FIELD_LABELS: Record<ImagingFieldKey, string> = {
  dx: "Diagnóstico presuntivo",
  just: "Justificación clínica",
  prio: "Prioridad de la solicitud",
  fecha: "Fecha deseada del estudio",
  embarazo: "Posibilidad de embarazo",
  alergias: "Alergias conocidas",
  creat: "Creatinina sérica",
  obs: "Observaciones para el técnico",
};

const DEFAULT_RULES: Record<ImagingRuleKey, { enabled: boolean; valorNum: number | null }> = {
  multi: { enabled: true, valorNum: null },
  global: { enabled: true, valorNum: null },
  codigo: { enabled: false, valorNum: null },
  flags: { enabled: true, valorNum: null },
  dupWarn: { enabled: true, valorNum: null },
  firma: { enabled: false, valorNum: null },
  maxN: { enabled: false, valorNum: 10 },
};

/** Categoría (nombre de panel) por modalidad lógica — inverso 1:1 de la derivación del seed. */
const CATEGORIA_POR_MODALITY_TYPE: Partial<Record<string, string>> = {
  XA: "Estudios Especiales",
  CR: "Radiografías",
  MR: "Resonancia Magnética",
  CT: "Tomografías",
  US: "Ultrasonografías",
};

/** Modalidad lógica por code de panel — mismo mapeo que packages/database/scripts/seed-imagenes-catalogo.mjs. */
const CAT_MODALITY_BY_PANEL_CODE: Record<string, ImagingModalityTypeValue> = {
  "IMG-ESP": "XA",
  "IMG-RX": "CR",
  "IMG-RM": "MR",
  "IMG-TAC": "CT",
  "IMG-USG": "US",
};

function fieldIsEmpty(key: ImagingFieldKey, input: { dx?: string; justificacion?: string; prioridad?: string; fechaDeseada?: Date; embarazo?: string; alergias?: string; creatinina?: string; observaciones?: string }): boolean {
  switch (key) {
    case "dx":
      return !input.dx?.trim();
    case "just":
      return !input.justificacion?.trim();
    case "prio":
      return !input.prioridad;
    case "fecha":
      return !input.fechaDeseada;
    case "embarazo":
      return !input.embarazo?.trim();
    case "alergias":
      return !input.alergias?.trim();
    case "creat":
      return !input.creatinina?.trim();
    case "obs":
      return !input.observaciones?.trim();
    default: {
      const _exhaustive: never = key;
      return _exhaustive;
    }
  }
}

/** Shape de fila del listado (`listarPorCuenta`/`listarPorPaciente`). */
function buildSolicitudRow(r: {
  id: string;
  folio: string;
  createdAt: Date;
  prioridad: string;
  orders: { status: string; modalityType: string }[];
}) {
  const categorias = [
    ...new Set(r.orders.map((o) => CATEGORIA_POR_MODALITY_TYPE[o.modalityType] ?? o.modalityType)),
  ];
  return {
    id: r.id,
    folio: r.folio,
    fecha: r.createdAt,
    categorias: categorias.join(", "),
    nPrestaciones: r.orders.length,
    prioridad: r.prioridad,
    estado: derivarEstadoSolicitud(r.orders.map((o) => o.status as ImagingOrderStatusType)),
  };
}

export const imagingRequestRouter = router({
  /**
   * Crea la solicitud (cabecera ImagingRequest) + una ImagingOrder por
   * prestación seleccionada. Valida campos obligatorios/regla maxN/
   * contraste⇒creatinina/firma PIN server-side según la parametrización de
   * la organización; dupWarn no bloquea — se devuelve como advertencia.
   */
  crear: tenantProcedure.input(imagingRequestCrearInput).mutation(async ({ ctx, input }) => {
    if (!ctx.tenant.establishmentId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selecciona un establecimiento antes de continuar.",
      });
    }
    const establishmentId = ctx.tenant.establishmentId;

    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const organizationId = ctx.tenant.organizationId;

      const account = await tx.patientAccount.findFirst({
        where: { id: input.cuentaId, organizationId },
        select: { id: true, patientId: true, encounterId: true },
      });
      if (!account) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de paciente no encontrada." });
      }

      // --- CC-0041 RF-06/RF-07 — sexo biológico + alergias desde la HC ---
      const [patientRow, alergiasRows] = await Promise.all([
        tx.patient.findUnique({
          where: { id: account.patientId },
          select: { biologicalSex: { select: { code: true } } },
        }),
        tx.patientAllergy.findMany({
          where: { patientId: account.patientId, active: true },
          select: { substanceText: true, reaction: true },
        }),
      ]);
      const sexoCode = patientRow?.biologicalSex?.code ?? null;

      // RF-07 / RN-6 — snapshot server-side (el input del cliente se ignora:
      // el campo es solo lectura desde la Historia Clínica).
      const alergiasSnapshot = (
        alergiasRows.length > 0
          ? alergiasRows
              .map((a) => `${a.substanceText}${a.reaction ? ` (${a.reaction})` : ""}`)
              .join(" · ")
          : "Sin alergias registradas en Historia Clínica"
      ).slice(0, 300);

      // RF-06 / RN-5 — embarazo obligatorio SIEMPRE; sexo masculino ⇒
      // "No aplica" automático (aunque el cliente mande otra cosa).
      const embarazo = sexoCode === "M" ? "No aplica" : (input.embarazo ?? null);
      if (!embarazo) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Complete «¿Posibilidad de embarazo?» — campo obligatorio.",
        });
      }

      // RF-05 / RN-4 — la fecha de programación solo existe con prioridad Rutina.
      const prioridad = input.prioridad ?? "ROUTINE";
      if (input.fechaDeseada && prioridad !== "ROUTINE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "La fecha de programación solo aplica a solicitudes de prioridad Rutina — Urgente y STAT se atienden de inmediato.",
        });
      }
      if (input.fechaDeseada) {
        const hoy = new Date();
        hoy.setHours(0, 0, 0, 0);
        if (input.fechaDeseada.getTime() < hoy.getTime()) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "La fecha de programación debe ser hoy o una fecha futura.",
          });
        }
      }

      // --- Parametrización: campos + reglas (fallback a defaults del mockup) ---
      const fieldRows = await tx.imagingFormFieldConfig.findMany({ where: { organizationId } });
      const fieldConfig: Record<ImagingFieldKey, ImagingFieldEstado> = { ...DEFAULT_FIELD_CONFIG };
      for (const r of fieldRows) fieldConfig[r.fieldKey as ImagingFieldKey] = r.estado as ImagingFieldEstado;

      const ruleRows = await tx.imagingModuleRule.findMany({ where: { organizationId } });
      const rules: Record<ImagingRuleKey, { enabled: boolean; valorNum: number | null }> = {
        ...DEFAULT_RULES,
      };
      for (const r of ruleRows) rules[r.ruleKey as ImagingRuleKey] = { enabled: r.enabled, valorNum: r.valorNum };

      // --- Validación de campos obligatorios ---
      // `efectivos` incorpora los valores resueltos server-side (embarazo
      // auto por sexo, alergias snapshot). `fecha` se excluye cuando la
      // prioridad no es Rutina (RF-05: el campo no existe en ese caso).
      const efectivos = { ...input, embarazo, alergias: alergiasSnapshot };
      const faltantes = IMAGING_FIELD_KEYS.filter(
        (k) =>
          fieldConfig[k] === "obligatorio" &&
          !(k === "fecha" && prioridad !== "ROUTINE") &&
          fieldIsEmpty(k, efectivos),
      );
      if (faltantes.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Complete los campos obligatorios: ${faltantes.map((k) => FIELD_LABELS[k]).join(", ")}.`,
        });
      }

      // --- Regla maxN ---
      if (rules.maxN.enabled) {
        const max = rules.maxN.valorNum ?? 10;
        if (input.prestaciones.length > max) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Máximo ${max} prestaciones por solicitud.`,
          });
        }
      }

      // --- Firma electrónica: valida presencia del PIN temprano (no requiere BD) ---
      if (rules.firma.enabled && !input.pin) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere PIN de firma electrónica para guardar la solicitud.",
        });
      }

      // --- Catálogo: cargar LabTest + attrs de las prestaciones seleccionadas ---
      const labTestIds = input.prestaciones.map((p) => p.labTestId);
      const tests = await tx.labTest.findMany({
        where: { id: { in: labTestIds }, OR: [{ organizationId: null }, { organizationId }] },
        include: { imagingAttrs: true },
      });
      const testById = new Map(tests.map((t) => [t.id, t]));
      for (const p of input.prestaciones) {
        if (!testById.has(p.labTestId)) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Una o más prestaciones no existen en el catálogo.",
          });
        }
      }

      // --- CC-0041 RF-08 — contraste ⇒ creatinina SIEMPRE (aunque el campo
      // esté configurado Opcional; si está Oculto, el error señala la
      // parametrización — advertencia bloqueante del RF-10.3).
      const hayContraste = input.prestaciones.some((p) => {
        const attrs = testById.get(p.labTestId)?.imagingAttrs;
        return p.conContraste ?? attrs?.requiereContraste ?? false;
      });
      if (hayContraste && !input.creatinina?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            fieldConfig.creat === "oculto"
              ? "Hay estudios con contraste pero el campo creatinina está oculto en la parametrización — corrija la parametrización o retire el estudio."
              : "Estudios con contraste requieren creatinina sérica reciente.",
        });
      }

      // --- Firma electrónica: verifica el PIN contra ece.firma_electronica ---
      let firmadoPor: string | null = null;
      let firmadoEn: Date | null = null;
      if (rules.firma.enabled) {
        // Presencia ya validada arriba (guard temprano); non-null seguro aquí.
        await checkPin(tx, {
          userId: ctx.user.id,
          pin: input.pin!,
          accion: "confirm",
          contexto: "imaging-request.crear",
        });
        firmadoPor = ctx.user.id;
        firmadoEn = new Date();
      }

      // --- dupWarn (no bloquea — se devuelve como advertencia) ---
      const advertencias: string[] = [];
      if (rules.dupWarn.enabled) {
        const nombres = input.prestaciones.map((p) => testById.get(p.labTestId)!.name);
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const previas = await tx.imagingOrder.findMany({
          where: {
            patientId: account.patientId,
            organizationId,
            deletedAt: null,
            orderedAt: { gte: cutoff },
            studyDescription: { in: nombres },
          },
          select: { studyDescription: true },
        });
        const repetidas = [...new Set(previas.map((o) => o.studyDescription))];
        if (repetidas.length > 0) {
          advertencias.push(
            `Prestación(es) ya solicitada(s) en los últimos 30 días: ${repetidas.join(", ")}.`,
          );
        }
      }

      // --- folio SOL-{YYYY}-{NNNN} ---
      const anio = new Date().getFullYear();
      const seqRows = await tx.$queryRaw<{ n: number }[]>`
        SELECT public.fn_next_solicitud_imagen(${organizationId}::uuid, ${anio}::int) AS n
      `;
      const folio = `SOL-${anio}-${String(seqRows[0]!.n).padStart(4, "0")}`;

      const request = await tx.imagingRequest.create({
        data: {
          organizationId,
          folio,
          patientId: account.patientId,
          patientAccountId: account.id,
          encounterId: account.encounterId ?? null,
          prioridad,
          dx: input.dx ?? null,
          // CC-0041 RF-03 — trazabilidad del dx copiado del expediente.
          dxSistema: input.dxSistema ?? null,
          dxFuente: input.dxFuente ?? null,
          dxOrigenId: input.dxOrigenId ?? null,
          justificacion: input.justificacion ?? null,
          fechaDeseada: input.fechaDeseada ?? null,
          embarazo,
          alergias: alergiasSnapshot,
          creatinina: input.creatinina ?? null,
          observaciones: input.observaciones ?? null,
          firmadoPor,
          firmadoEn,
          createdBy: ctx.user.id,
        },
      });

      const ordenesCreadas: { id: string; nombre: string }[] = [];
      for (const p of input.prestaciones) {
        const test = testById.get(p.labTestId)!;
        const attrs = test.imagingAttrs;
        const modalityType = attrs?.modalityType ?? "OTHER";
        const conContraste = p.conContraste ?? attrs?.requiereContraste ?? false;

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
            encounterId: account.encounterId ?? null,
            patientId: account.patientId,
            patientAccountId: account.id,
            requestId: request.id,
            modalityId: attrs?.modalityId ?? null,
            modalityType,
            orderingProviderId: ctx.user.id,
            studyDescription: test.name,
            clinicalIndication: input.justificacion || input.dx || test.name,
            priority: prioridad,
            conContraste,
            notaEstudio: p.nota ?? null,
            ejecutorCostCenterId,
            createdBy: ctx.user.id,
          },
        });

        // docs/48 Ola 3 (C3-1) — un cargo por prestación de imagen, en la
        // MISMA tx que la orden (RN-HIS-BOT-001 R5). `accountId` es la cuenta
        // ya resuelta arriba (`input.cuentaId`) — este flujo SIEMPRE la
        // conoce (a diferencia de lab, que también acepta el camino legado
        // por encounterId), así que no hay fallback de resolución.
        await capturarCargo(tx, {
          organizationId,
          patientId: account.patientId,
          encounterId: account.encounterId,
          accountId: account.id,
          code: test.code,
          descripcion: test.name,
          quantity: 1,
          origen: "IMAGENES",
          referenciaId: order.id,
          actorId: ctx.user.id,
        });
        ordenesCreadas.push({ id: order.id, nombre: test.name });
      }

      // --- CC-0041 — una CareTask por prestación para el equipo de
      // radiología (mismo patrón que order-consumer.ts, camino de indicación:
      // taskType IMAGING_TO_PERFORM, rol RAD_TECHNICIAN, SLA parametrizado
      // en ImagingSlaConfig con fallback a los defaults de ImagingPriority).
      const slaMap = await resolveImagingSlaMap(tx, organizationId);
      const sla = slaMap[prioridad as LabPriorityKey] ?? slaMap.ROUTINE;
      const dueAt = new Date(Date.now() + sla.slaMinutes * 60_000);
      const serviceUnit = await tx.serviceUnit.findFirst({
        where: { establishmentId, areaType: "IMAGENES", active: true },
        select: { id: true },
      });

      let primeraTareaId: string | null = null;
      for (const orden of ordenesCreadas) {
        const tarea = await tx.careTask.create({
          data: {
            organizationId,
            establishmentId,
            serviceUnitId: serviceUnit?.id ?? null,
            assignedRoleCode: "RAD_TECHNICIAN",
            patientId: account.patientId,
            encounterId: account.encounterId ?? null,
            patientAccountId: account.id,
            sourceType: "IMAGING_ORDER",
            sourceId: orden.id,
            taskType: "IMAGING_TO_PERFORM",
            title: orden.nombre.slice(0, 200),
            priority: CARE_TASK_PRIORITY_BY_LAB_PRIORITY[prioridad as LabPriorityKey] ?? "NORMAL",
            slaMinutes: sla.slaMinutes,
            dueAt,
            status: "PENDIENTE",
            createdBy: ctx.user.id,
          },
        });
        primeraTareaId ??= tarea.id;
      }

      // CC-0031 — UNA notificación por solicitud (no por prestación).
      // Try/catch deliberado: el outbox no revierte la solicitud ya creada.
      if (primeraTareaId) {
        try {
          await emitDomainEvent(tx, {
            organizationId,
            eventType: "task.action_required",
            aggregateType: "CareTask",
            aggregateId: primeraTareaId,
            emittedById: ctx.user.id,
            payload: {
              taskType: "IMAGING_TO_PERFORM",
              sourceType: "IMAGING_ORDER",
              sourceId: request.id,
              assignedRoleCode: "RAD_TECHNICIAN",
              establishmentId,
              serviceUnitId: serviceUnit?.id ?? null,
              dueAt: dueAt.toISOString(),
              url: "/imaging?vista=supervision",
              resumen: `Solicitud ${folio}: ${ordenesCreadas.length} estudio(s) de imagenología`,
            },
          });
        } catch (err) {
          console.error(
            `[CC-0041 imagingRequest.crear] emitDomainEvent(task.action_required) falló para ${folio} — ` +
              "las tareas se crearon igual, solo no se emitió la notificación.",
            err,
          );
        }
      }

      // --- CC-0041 RF-04 — hook `solicitud.stat.creada` (solo el evento;
      // la notificación inmediata a Imagenología es fase posterior).
      if (prioridad === "STAT") {
        try {
          await emitDomainEvent(tx, {
            organizationId,
            eventType: "imaging.solicitudStat",
            aggregateType: "ImagingRequest",
            aggregateId: request.id,
            emittedById: ctx.user.id,
            payload: {
              requestId: request.id,
              folio,
              patientId: account.patientId,
              patientAccountId: account.id,
              nPrestaciones: ordenesCreadas.length,
              estudios: ordenesCreadas.map((o) => o.nombre),
            },
          });
        } catch (err) {
          console.error(
            `[CC-0041 imagingRequest.crear] emitDomainEvent(imaging.solicitudStat) falló para ${folio}.`,
            err,
          );
        }
      }

      return { id: request.id, folio, advertencias };
    });
  }),

  listarPorCuenta: tenantProcedure.input(imagingRequestListarPorCuentaInput).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const requests = await tx.imagingRequest.findMany({
        where: { patientAccountId: input.cuentaId, organizationId: ctx.tenant.organizationId },
        include: { orders: { select: { status: true, modalityType: true } } },
        orderBy: { createdAt: "desc" },
      });
      return requests.map(buildSolicitudRow);
    });
  }),

  listarPorPaciente: tenantProcedure.input(imagingRequestListarPorPacienteInput).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const requests = await tx.imagingRequest.findMany({
        where: { patientId: input.patientId, organizationId: ctx.tenant.organizationId },
        include: { orders: { select: { status: true, modalityType: true } } },
        orderBy: { createdAt: "desc" },
      });
      return requests.map(buildSolicitudRow);
    });
  }),

  detalle: tenantProcedure.input(imagingRequestDetalleInput).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const r = await tx.imagingRequest.findFirst({
        where: { id: input.id, organizationId: ctx.tenant.organizationId },
        include: {
          orders: {
            include: { report: true, modality: { select: { id: true, name: true, code: true } } },
            orderBy: { createdAt: "asc" },
          },
          patient: { select: { firstName: true, lastName: true, mrn: true, expediente: true } },
          patientAccount: { select: { numeroCuenta: true } },
        },
      });
      if (!r) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...r,
        estado: derivarEstadoSolicitud(r.orders.map((o) => o.status as ImagingOrderStatusType)),
      };
    });
  }),

  /**
   * CC-0016 — deep-link del workflow-inbox: los 3 tipos de tarea
   * (IMAGING_TO_REPORT/IMAGING_TO_VALIDATE/STUDY_TO_SCHEDULE) enlazan a
   * `/imaging?id={imagingOrderId}` (ver workflow-inbox.router.ts). Resuelve
   * el requestId padre si la orden se creó vía este módulo; null si es una
   * orden legada sin solicitud (creada por el extinto `imaging.order.create`,
   * eliminado en docs/48 Ola 3 por crear órdenes sin cargo — H-01).
   */
  resolverDeepLink: tenantProcedure
    .input(z.object({ orderId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const order = await tx.imagingOrder.findFirst({
          where: { id: input.orderId, organizationId: ctx.tenant.organizationId },
          select: { id: true, requestId: true },
        });
        if (!order) throw new TRPCError({ code: "NOT_FOUND" });
        return { requestId: order.requestId };
      });
    }),

  /**
   * CC-0041 RF-03/RF-06/RF-07 — contexto del expediente para el formulario:
   * sexo biológico (embarazo automático), alergias formateadas (solo lectura)
   * y diagnósticos con código agrupados por fuente:
   *   · Historia Clínica (ece.historia_clinica.diagnosticos JSONB, CIE-11)
   *   · Encuentros (EncounterDiagnosis + ClinicalConcept, CIE-10 legado)
   *   · Evolución Clínica (problemas de la nota SOAP — SIN código: la
   *     evolución no persiste códigos, se exponen como texto; ver hallazgo
   *     exploración CC-0041). Indicaciones médicas no guardan dx — se omiten.
   */
  contextoExpediente: tenantProcedure
    .input(z.object({ cuentaId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      type Dx = {
        codigo: string | null;
        descripcion: string;
        sistema: "CIE10" | "CIE11" | null;
        fuente: string;
        origenId: string | null;
      };

      const base = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const account = await tx.patientAccount.findFirst({
          where: { id: input.cuentaId, organizationId: ctx.tenant.organizationId },
          select: { id: true, patientId: true },
        });
        if (!account) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Cuenta de paciente no encontrada." });
        }

        const [patient, alergiasRows, encDx] = await Promise.all([
          tx.patient.findUnique({
            where: { id: account.patientId },
            select: { biologicalSex: { select: { code: true } } },
          }),
          tx.patientAllergy.findMany({
            where: { patientId: account.patientId, active: true },
            select: { substanceText: true, reaction: true },
          }),
          tx.encounterDiagnosis.findMany({
            where: {
              encounter: { patientId: account.patientId, organizationId: ctx.tenant.organizationId },
              resolvedAt: null,
            },
            orderBy: { diagnosedAt: "desc" },
            take: 20,
            select: { id: true, conceptId: true, diagnosedAt: true },
          }),
        ]);

        const conceptIds = [...new Set(encDx.map((d) => d.conceptId))];
        const concepts = conceptIds.length
          ? await tx.clinicalConcept.findMany({
              where: { id: { in: conceptIds } },
              select: { id: true, code: true, display: true },
            })
          : [];
        const conceptById = new Map(concepts.map((c) => [c.id, c]));

        const diagnosticos: Dx[] = [];
        for (const d of encDx) {
          const c = conceptById.get(d.conceptId);
          if (!c) continue;
          diagnosticos.push({
            codigo: c.code,
            descripcion: c.display,
            sistema: "CIE10",
            fuente: "Historia Clínica — Encuentros",
            origenId: d.id,
          });
        }

        return {
          patientId: account.patientId,
          sexo: patient?.biologicalSex?.code ?? null,
          alergias:
            alergiasRows.length > 0
              ? alergiasRows
                  .map((a) => `${a.substanceText}${a.reaction ? ` (${a.reaction})` : ""}`)
                  .join(" · ")
              : null,
          diagnosticos,
        };
      });

      // ECE (HC Avante CIE-11 + Evolución) — mejor esfuerzo: sin
      // establecimiento o sin filas ECE, el selector queda con lo de arriba.
      if (ctx.tenant.establishmentId) {
        try {
          const eceDx = await withEceContext(
            ctx.prisma,
            ctx.user.id,
            ctx.tenant.establishmentId,
            async (tx) => {
              type HcRow = { id: string; diagnosticos: unknown; registrado_en: Date };
              const hcRows = await tx.$queryRaw<HcRow[]>`
                SELECT hc.id::text AS id, hc.diagnosticos, hc.registrado_en
                FROM ece.historia_clinica hc
                JOIN ece.paciente ep ON ep.id = hc.paciente_id
                WHERE ep.public_patient_id = ${base.patientId}::uuid
                  AND hc.estado_registro = 'vigente'
                  AND hc.diagnosticos IS NOT NULL
                ORDER BY hc.registrado_en DESC
                LIMIT 5
              `;

              type EvoRow = { id: string; data: unknown; fecha_hora: Date };
              const evoRows = await tx.$queryRaw<EvoRow[]>`
                SELECT em.id::text AS id, em.data, em.fecha_hora
                FROM ece.evolucion_medica em
                JOIN ece.paciente ep ON ep.id = em.paciente_id
                WHERE ep.public_patient_id = ${base.patientId}::uuid
                  AND em.estado_registro = 'vigente'
                  AND em.fecha_hora >= now() - interval '90 days'
                ORDER BY em.fecha_hora DESC
                LIMIT 5
              `;
              return { hcRows, evoRows };
            },
          );

          const fmt = new Intl.DateTimeFormat("es-SV", { day: "2-digit", month: "2-digit", year: "numeric" });
          const vistos = new Set(base.diagnosticos.map((d) => `${d.codigo}|${d.descripcion}`));
          for (const hc of eceDx.hcRows) {
            if (!Array.isArray(hc.diagnosticos)) continue;
            for (const raw of hc.diagnosticos as unknown[]) {
              const d = raw as { codigo?: unknown; descripcion?: unknown };
              if (typeof d?.codigo !== "string" || typeof d?.descripcion !== "string") continue;
              const key = `${d.codigo}|${d.descripcion}`;
              if (vistos.has(key)) continue;
              vistos.add(key);
              base.diagnosticos.unshift({
                codigo: d.codigo,
                descripcion: d.descripcion,
                sistema: "CIE11",
                fuente: `Historia Clínica — ${fmt.format(hc.registrado_en)}`,
                origenId: hc.id,
              });
            }
          }
          for (const evo of eceDx.evoRows) {
            const data = evo.data as { problemas?: unknown } | null;
            if (!data || !Array.isArray(data.problemas)) continue;
            for (const raw of data.problemas as unknown[]) {
              const p = raw as { texto?: unknown };
              if (typeof p?.texto !== "string" || !p.texto.trim()) continue;
              const key = `|${p.texto}`;
              if (vistos.has(key)) continue;
              vistos.add(key);
              base.diagnosticos.push({
                codigo: null,
                descripcion: p.texto,
                sistema: null,
                fuente: `Evolución Clínica — ${fmt.format(evo.fecha_hora)}`,
                origenId: evo.id,
              });
            }
          }
        } catch (err) {
          console.error("[CC-0041 contextoExpediente] lectura ECE falló (degrada a public.*):", err);
        }
      }

      return { sexo: base.sexo, alergias: base.alergias, diagnosticos: base.diagnosticos };
    }),

  /**
   * CC-0041 — Tablero de supervisión de imagenología (espejo del de
   * laboratorio, extensión CC-0040): un row por estudio (ImagingOrder) con
   * hitos de trazabilidad (solicitado / programado / realizado / informado /
   * validado) y semáforo contra el SLA parametrizado (ImagingSlaConfig +
   * CareTask.dueAt). KPIs sobre la página retornada — tablero operativo.
   */
  supervision: tenantProcedure.input(imagingSupervisionInput).query(async ({ ctx, input }) => {
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      const orders = await tx.imagingOrder.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          deletedAt: null,
          status: input.incluirCompletados
            ? { not: "CANCELLED" }
            : { in: ["ORDERED", "SCHEDULED", "IN_PROGRESS"] },
        },
        include: {
          report: { select: { reportedAt: true, validatedAt: true } },
          request: { select: { folio: true } },
          patient: { select: { firstName: true, lastName: true, expediente: true, mrn: true } },
          patientAccount: { select: { numeroCuenta: true } },
        },
        orderBy: [{ orderedAt: "desc" }, { id: "desc" }],
        take: input.limit,
      });

      const tareas = await tx.careTask.findMany({
        where: { sourceType: "IMAGING_ORDER", sourceId: { in: orders.map((o) => o.id) } },
        select: { sourceId: true, status: true, dueAt: true, slaMinutes: true, completedAt: true },
      });
      const tareaByOrder = new Map(tareas.map((t) => [t.sourceId, t]));
      const slaMap = await resolveImagingSlaMap(tx, ctx.tenant.organizationId);
      const now = Date.now();

      let rows = orders.map((o) => {
        const tarea = tareaByOrder.get(o.id) ?? null;
        const prioridad = (o.priority as LabPriorityKey) ?? "ROUTINE";
        const sla = slaMap[prioridad] ?? slaMap.ROUTINE;

        const etapa =
          o.status === "VALIDATED"
            ? ("VALIDADO" as const)
            : o.status === "REPORTED"
              ? ("INFORMADO" as const)
              : o.status === "COMPLETED"
                ? ("REALIZADO" as const)
                : o.status === "IN_PROGRESS"
                  ? ("EN_PROCESO" as const)
                  : o.status === "SCHEDULED"
                    ? ("PROGRAMADO" as const)
                    : ("SOLICITADO" as const);

        const terminado =
          o.status === "COMPLETED" || o.status === "REPORTED" || o.status === "VALIDATED";
        // Fin real para cumplimiento: realización del estudio (completedAt) o
        // cierre de la tarea. Data legada sin ambos ⇒ default optimista
        // (mismo criterio documentado del tablero de laboratorio).
        const finAt = o.completedAt ?? tarea?.completedAt ?? null;
        const dueAt = tarea?.dueAt ?? new Date(o.orderedAt.getTime() + sla.slaMinutes * 60_000);

        let slaEstado: LabSlaEstado;
        if (terminado || tarea?.status === "CUMPLIDA") {
          slaEstado =
            finAt && finAt.getTime() > dueAt.getTime() ? "CUMPLIDO_TARDE" : "CUMPLIDO_A_TIEMPO";
        } else if (now > dueAt.getTime()) {
          slaEstado = "VENCIDO";
        } else if (now > dueAt.getTime() - sla.warningMinutes * 60_000) {
          slaEstado = "POR_VENCER";
        } else {
          slaEstado = "EN_TIEMPO";
        }

        return {
          orderId: o.id,
          folio: o.request?.folio ?? null,
          estudio: o.studyDescription,
          categoria: CATEGORIA_POR_MODALITY_TYPE[o.modalityType] ?? o.modalityType,
          paciente: {
            nombre: `${o.patient.firstName} ${o.patient.lastName}`.trim(),
            expediente: o.patient.expediente ?? o.patient.mrn,
          },
          cuenta: o.patientAccount?.numeroCuenta ?? null,
          atencion: o.encounterId ? ("HOSPITALARIO" as const) : ("AMBULATORIO" as const),
          prioridad,
          etapa,
          hitos: {
            solicitadoAt: o.orderedAt,
            programadoAt: o.scheduledAt ?? null,
            realizadoAt: o.completedAt ?? null,
            informadoAt: o.report?.reportedAt ?? null,
            validadoAt: o.report?.validatedAt ?? null,
          },
          slaEstado,
          dueAt,
          tareaStatus: tarea?.status ?? null,
        };
      });

      const search = input.search?.trim().toLowerCase();
      if (search) {
        rows = rows.filter(
          (r) =>
            r.paciente.nombre.toLowerCase().includes(search) ||
            (r.paciente.expediente ?? "").toLowerCase().includes(search) ||
            (r.folio ?? "").toLowerCase().includes(search) ||
            (r.cuenta ?? "").toLowerCase().includes(search) ||
            r.estudio.toLowerCase().includes(search),
        );
      }
      if (input.slaEstado) rows = rows.filter((r) => r.slaEstado === input.slaEstado);

      const kpis = {
        total: rows.length,
        enTiempo: rows.filter((r) => r.slaEstado === "EN_TIEMPO").length,
        porVencer: rows.filter((r) => r.slaEstado === "POR_VENCER").length,
        vencidos: rows.filter((r) => r.slaEstado === "VENCIDO").length,
        cumplidosATiempo: rows.filter((r) => r.slaEstado === "CUMPLIDO_A_TIEMPO").length,
        cumplidosTarde: rows.filter((r) => r.slaEstado === "CUMPLIDO_TARDE").length,
      };

      return { kpis, rows };
    });
  }),

  /**
   * CC-0041 — parametrización del SLA de imagenología por prioridad (espejo
   * exacto de lis.sla, extensión CC-0040). `list` retorna el valor efectivo;
   * `upsert` crea/actualiza la fila del tenant. Solo administración.
   */
  sla: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const rows = await tx.imagingSlaConfig.findMany({
          where: { organizationId: ctx.tenant.organizationId },
          select: { priority: true, slaMinutes: true, warningMinutes: true },
        });
        const byPriority = new Map(rows.map((r) => [r.priority, r]));
        return (["STAT", "URGENT", "ROUTINE"] as const).map((priority) => {
          const custom = byPriority.get(priority);
          const efectivo = custom ?? DEFAULT_LAB_SLA[priority];
          return {
            priority,
            slaMinutes: efectivo.slaMinutes,
            warningMinutes: efectivo.warningMinutes,
            esDefault: !custom,
          };
        });
      });
    }),

    upsert: catalogAdminProc.input(imagingSlaConfigUpsertInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.imagingSlaConfig.upsert({
          where: {
            organizationId_priority: {
              organizationId: ctx.tenant.organizationId,
              priority: input.priority,
            },
          },
          create: {
            organizationId: ctx.tenant.organizationId,
            priority: input.priority,
            slaMinutes: input.slaMinutes,
            warningMinutes: input.warningMinutes,
          },
          update: { slaMinutes: input.slaMinutes, warningMinutes: input.warningMinutes },
        });
      });
    }),
  }),

  catalogoImagen: router({
    /** Catálogo de las 292 prestaciones (LabTest + ImagingTestAttrs) agrupado por panel RADIOLOGIA. */
    list: tenantProcedure.query(async ({ ctx }): Promise<ImagingCatalogoItem[]> => {
      const panels = await ctx.prisma.labPanel.findMany({
        where: {
          area: "RADIOLOGIA",
          OR: [{ organizationId: null }, { organizationId: ctx.tenant.organizationId }],
        },
        orderBy: { displayOrder: "asc" },
        include: {
          tests: { include: { imagingAttrs: true }, orderBy: { displayOrder: "asc" } },
        },
      });

      const items: ImagingCatalogoItem[] = [];
      for (const p of panels) {
        for (const t of p.tests) {
          items.push({
            labTestId: t.id,
            code: t.code,
            name: t.name,
            panelId: p.id,
            panelNombre: p.name,
            panelDisplayOrder: p.displayOrder,
            panelActive: p.active,
            displayOrder: t.displayOrder,
            active: t.active,
            requiereContraste: t.imagingAttrs?.requiereContraste ?? false,
            requiereAyuno: t.imagingAttrs?.requiereAyuno ?? false,
            requiereAutorizacion: t.imagingAttrs?.requiereAutorizacion ?? false,
            duracionMin: t.imagingAttrs?.duracionMin ?? 20,
            modalityId: t.imagingAttrs?.modalityId ?? null,
            preparacionPaciente: t.imagingAttrs?.preparacionPaciente ?? null,
            // CC-0041 — precio estándar (LabTest.standardPrice, CC-0013).
            standardPrice: t.standardPrice ? Number(t.standardPrice) : null,
          });
        }
      }
      return items;
    }),

    /** CRUD combinado: crea/actualiza LabTest + su ImagingTestAttrs en un solo viaje. */
    upsert: catalogAdminProc.input(imagingCatalogoUpsertInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const organizationId = ctx.tenant.organizationId;

        const panel = await tx.labPanel.findFirst({
          where: {
            id: input.panelId,
            area: "RADIOLOGIA",
            OR: [{ organizationId: null }, { organizationId }],
          },
          select: { id: true, code: true },
        });
        if (!panel) throw new TRPCError({ code: "NOT_FOUND", message: "Categoría no encontrada." });
        const modalityType = CAT_MODALITY_BY_PANEL_CODE[panel.code] ?? "OTHER";

        let labTestId = input.labTestId;
        if (labTestId) {
          const existing = await tx.labTest.findFirst({
            where: { id: labTestId, organizationId },
            select: { id: true },
          });
          if (!existing) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Prestación no encontrada en el tenant." });
          }
          await tx.labTest.update({
            where: { id: labTestId },
            data: {
              name: input.name,
              panelId: input.panelId,
              displayOrder: input.displayOrder,
              active: input.active,
              // CC-0041 — precio estándar de la prestación (undefined = no tocar).
              ...(input.standardPrice !== undefined && { standardPrice: input.standardPrice }),
            },
          });
        } else {
          const dup = await tx.labTest.findFirst({
            where: { organizationId, code: input.code! },
            select: { id: true },
          });
          if (dup) {
            throw new TRPCError({ code: "CONFLICT", message: "Ya existe una prestación con ese código." });
          }
          const created = await tx.labTest.create({
            data: {
              organizationId,
              panelId: input.panelId,
              code: input.code!,
              name: input.name,
              specimen: "OTHER",
              displayOrder: input.displayOrder,
              active: input.active,
              standardPrice: input.standardPrice ?? null,
            },
            select: { id: true },
          });
          labTestId = created.id;
        }

        await tx.imagingTestAttrs.upsert({
          where: { labTestId },
          create: {
            labTestId,
            requiereContraste: input.requiereContraste,
            requiereAyuno: input.requiereAyuno,
            requiereAutorizacion: input.requiereAutorizacion,
            duracionMin: input.duracionMin,
            modalityType,
            modalityId: input.modalityId ?? null,
            preparacionPaciente: input.preparacionPaciente ?? null,
          },
          update: {
            requiereContraste: input.requiereContraste,
            requiereAyuno: input.requiereAyuno,
            requiereAutorizacion: input.requiereAutorizacion,
            duracionMin: input.duracionMin,
            modalityId: input.modalityId ?? null,
            preparacionPaciente: input.preparacionPaciente ?? null,
          },
        });

        return { labTestId };
      });
    }),
  }),

  fieldConfig: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.prisma.imagingFormFieldConfig.findMany({
        where: { organizationId: ctx.tenant.organizationId },
      });
      const byKey = new Map(rows.map((r) => [r.fieldKey as ImagingFieldKey, r]));
      return IMAGING_FIELD_KEYS.map((key, i) => {
        const row = byKey.get(key);
        return {
          fieldKey: key,
          estado: (row?.estado as ImagingFieldEstado | undefined) ?? DEFAULT_FIELD_CONFIG[key],
          displayOrder: row?.displayOrder ?? i,
        };
      });
    }),

    set: catalogAdminProc.input(imagingFormFieldConfigSetInput).mutation(async ({ ctx, input }) => {
      // CC-0041 CA-12 — "¿Posibilidad de embarazo?" no puede configurarse por
      // debajo de Obligatorio (RF-06); la prioridad no es ocultable (Apéndice B).
      if (input.fieldKey === "embarazo" && input.estado !== "obligatorio") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "«¿Posibilidad de embarazo?» es obligatoria por norma (RF-06) — no puede configurarse como opcional u oculta.",
        });
      }
      if (input.fieldKey === "prio" && input.estado === "oculto") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "«Prioridad de la solicitud» no puede ocultarse.",
        });
      }
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.imagingFormFieldConfig.upsert({
          where: {
            organizationId_fieldKey: {
              organizationId: ctx.tenant.organizationId,
              fieldKey: input.fieldKey,
            },
          },
          create: {
            organizationId: ctx.tenant.organizationId,
            fieldKey: input.fieldKey,
            estado: input.estado,
            displayOrder: IMAGING_FIELD_KEYS.indexOf(input.fieldKey),
          },
          update: { estado: input.estado },
        });
        return { ok: true as const };
      });
    }),
  }),

  rules: router({
    list: tenantProcedure.query(async ({ ctx }) => {
      const rows = await ctx.prisma.imagingModuleRule.findMany({
        where: { organizationId: ctx.tenant.organizationId },
      });
      const byKey = new Map(rows.map((r) => [r.ruleKey as ImagingRuleKey, r]));
      return IMAGING_RULE_KEYS.map((key) => {
        const row = byKey.get(key);
        const def = DEFAULT_RULES[key];
        return {
          ruleKey: key,
          enabled: row?.enabled ?? def.enabled,
          valorNum: row?.valorNum ?? def.valorNum,
        };
      });
    }),

    set: catalogAdminProc.input(imagingModuleRuleSetInput).mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        await tx.imagingModuleRule.upsert({
          where: {
            organizationId_ruleKey: { organizationId: ctx.tenant.organizationId, ruleKey: input.ruleKey },
          },
          create: {
            organizationId: ctx.tenant.organizationId,
            ruleKey: input.ruleKey,
            enabled: input.enabled,
            valorNum: input.valorNum ?? null,
          },
          update: {
            enabled: input.enabled,
            ...(input.valorNum !== undefined && { valorNum: input.valorNum }),
          },
        });
        return { ok: true as const };
      });
    }),
  }),
});
