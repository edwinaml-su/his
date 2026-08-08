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
  derivarEstadoSolicitud,
  imagingModalityTypeEnum,
  IMAGING_FIELD_KEYS,
  IMAGING_RULE_KEYS,
  type ImagingFieldKey,
  type ImagingFieldEstado,
  type ImagingRuleKey,
  type ImagingOrderStatusType,
  type ImagingCatalogoItem,
} from "@his/contracts";

type ImagingModalityTypeValue = z.infer<typeof imagingModalityTypeEnum>;
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";
import { MODALITY_EXECUTOR_CODE } from "../lib/modality-executor";
import { checkPin } from "./firma-electronica.router";

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
  embarazo: "opcional",
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
      const faltantes = IMAGING_FIELD_KEYS.filter(
        (k) => fieldConfig[k] === "obligatorio" && fieldIsEmpty(k, input),
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

      // --- contraste ⇒ creatinina (si el campo no está oculto) ---
      const hayContraste = input.prestaciones.some((p) => {
        const attrs = testById.get(p.labTestId)?.imagingAttrs;
        return p.conContraste ?? attrs?.requiereContraste ?? false;
      });
      if (hayContraste && fieldConfig.creat !== "oculto" && !input.creatinina?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Estudios con contraste requieren creatinina sérica reciente.",
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

      const prioridad = input.prioridad ?? "ROUTINE";

      const request = await tx.imagingRequest.create({
        data: {
          organizationId,
          folio,
          patientId: account.patientId,
          patientAccountId: account.id,
          encounterId: account.encounterId ?? null,
          prioridad,
          dx: input.dx ?? null,
          justificacion: input.justificacion ?? null,
          fechaDeseada: input.fechaDeseada ?? null,
          embarazo: input.embarazo ?? null,
          alergias: input.alergias ?? null,
          creatinina: input.creatinina ?? null,
          observaciones: input.observaciones ?? null,
          firmadoPor,
          firmadoEn,
          createdBy: ctx.user.id,
        },
      });

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

        await tx.imagingOrder.create({
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
   * orden legada creada por `imaging.router.ts#order.create` (sin solicitud).
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
