/**
 * US-2.9 — Consentimiento informado de tratamiento de datos.
 *
 * MVP:
 *  - Plantillas hardcoded por país (ISO alpha-3) y propósito (`CONSENT_TEMPLATES`).
 *  - CRUD: list (paginado, filtros patient/purpose/status/fecha), get, create, revoke.
 *  - byPatient: agregado por paciente (vigentes vs revocados) + listado expandible.
 *
 * No-objetivos del Sprint 1:
 *  - Firma digital DTE (Sprint 5).
 *  - Tabla `ConsentTemplate` (Sprint 2 — hoy hardcoded en este archivo).
 *  - Notificaciones de expiración (Sprint 3+).
 *
 * Patrón: imitando catalog.router.ts (TRPCError homogéneo) + audit.router.ts (paginación).
 */
import { TRPCError } from "@trpc/server";
import { Prisma, PrismaClient } from "@his/database";
import {
  consentListInput,
  consentGetInput,
  consentByPatientInput,
  consentCreateInput,
  consentRevokeInput,
  consentTemplateListInput,
  type ConsentPurpose,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";

// ----- Plantillas hardcoded por país y propósito (TDR §6.4) -----
// TODO(Sprint 2): mover a tabla `ConsentTemplate` con versionado en BD.

interface ConsentTemplate {
  version: number;
  title: string;
  text: string;
  /** Lapso de validez por defecto en días; null = indefinido hasta revocación. */
  validForDays: number | null;
}

type CountryTemplates = Partial<Record<ConsentPurpose, ConsentTemplate>>;

export const CONSENT_TEMPLATES: Record<string, CountryTemplates> = {
  // El Salvador — Ley de Protección de Datos Personales (LEPDP).
  SLV: {
    "data-processing": {
      version: 1,
      title: "Consentimiento de tratamiento de datos personales (SV)",
      text:
        "Autorizo a la institución prestadora de salud a recopilar, almacenar y " +
        "tratar mis datos personales y de salud con fines asistenciales, de " +
        "facturación y de cumplimiento normativo, conforme a la Ley de Protección " +
        "de Datos Personales de El Salvador. Reconozco que puedo ejercer mis " +
        "derechos ARCO en cualquier momento.",
      validForDays: null,
    },
    "mpi-cross-org": {
      version: 1,
      title: "Compartir datos entre establecimientos (SV)",
      text:
        "Autorizo el intercambio de mi información clínica entre los establecimientos " +
        "del grupo asistencial únicamente para garantizar la continuidad de mi atención.",
      validForDays: 365,
    },
    transfusion: {
      version: 1,
      title: "Consentimiento informado para transfusión sanguínea (SV)",
      text:
        "He sido informado(a) de los riesgos y beneficios de la transfusión de " +
        "componentes sanguíneos y otorgo mi consentimiento para proceder.",
      validForDays: 30,
    },
  },
  // Guatemala
  GTM: {
    "data-processing": {
      version: 1,
      title: "Consentimiento de tratamiento de datos personales (GT)",
      text:
        "Autorizo el tratamiento de mis datos personales y sensibles de salud por " +
        "el prestador, conforme a la normativa vigente en la República de Guatemala.",
      validForDays: null,
    },
  },
  // Honduras
  HND: {
    "data-processing": {
      version: 1,
      title: "Consentimiento de tratamiento de datos personales (HN)",
      text:
        "Autorizo el tratamiento de mis datos personales y de salud por el " +
        "prestador, conforme a la normativa vigente en Honduras.",
      validForDays: null,
    },
  },
};

// ----- Helpers -----

/** Resuelve el ISO alpha-3 del país del tenant. */
async function resolveCountryIso(prisma: PrismaClient, countryId: string): Promise<string> {
  const country = await prisma.country.findUnique({
    where: { id: countryId },
    select: { isoAlpha3: true },
  });
  if (!country) {
    throw new TRPCError({ code: "NOT_FOUND", message: "País del tenant no encontrado." });
  }
  return country.isoAlpha3;
}

function getTemplate(iso: string, purpose: ConsentPurpose): ConsentTemplate {
  const tpl = CONSENT_TEMPLATES[iso]?.[purpose];
  if (!tpl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `No hay plantilla de consentimiento para ${purpose} en el país ${iso}.`,
    });
  }
  return tpl;
}

/** Status derivado en runtime (no persistido). */
function statusOf(row: { revokedAt: Date | null; validTo: Date | null }): "active" | "revoked" | "expired" {
  if (row.revokedAt) return "revoked";
  if (row.validTo && row.validTo.getTime() < Date.now()) return "expired";
  return "active";
}

// ----- Router -----

export const consentRouter = router({
  /**
   * Lista plantillas disponibles para el país del tenant (o el indicado).
   * Útil para selectores en UI antes de registrar un consentimiento.
   */
  templates: tenantProcedure.input(consentTemplateListInput).query(async ({ ctx, input }) => {
    const iso = input.countryIso ?? (await resolveCountryIso(ctx.prisma, ctx.tenant.countryId));
    const country = CONSENT_TEMPLATES[iso] ?? {};
    return {
      countryIso: iso,
      templates: Object.entries(country).map(([purpose, tpl]) => ({
        purpose: purpose as ConsentPurpose,
        version: tpl!.version,
        title: tpl!.title,
        text: tpl!.text,
        validForDays: tpl!.validForDays,
      })),
    };
  }),

  /**
   * Listado paginado con filtros: paciente, propósito, estado, rango de fechas.
   * Filtra por organización del tenant a través de Patient.organizationId.
   */
  list: tenantProcedure.input(consentListInput).query(async ({ ctx, input }) => {
    const baseWhere: Record<string, unknown> = {
      patient: { organizationId: ctx.tenant.organizationId },
    };
    if (input.patientId) baseWhere.patientId = input.patientId;
    if (input.purpose) baseWhere.purpose = input.purpose;
    if (input.from || input.to) {
      baseWhere.signedAt = {
        ...(input.from ? { gte: input.from } : {}),
        ...(input.to ? { lte: input.to } : {}),
      };
    }

    // Status derivado se aplica como filtro adicional en where.
    const now = new Date();
    if (input.status === "revoked") {
      baseWhere.revokedAt = { not: null };
    } else if (input.status === "active") {
      baseWhere.revokedAt = null;
      baseWhere.OR = [{ validTo: null }, { validTo: { gt: now } }];
    } else if (input.status === "expired") {
      baseWhere.revokedAt = null;
      baseWhere.validTo = { lte: now };
    }

    const [rows, total] = await Promise.all([
      ctx.prisma.patientConsent.findMany({
        where: baseWhere,
        include: {
          patient: { select: { id: true, mrn: true, firstName: true, lastName: true } },
          signedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { signedAt: "desc" },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      ctx.prisma.patientConsent.count({ where: baseWhere }),
    ]);

    return {
      items: rows.map((r) => ({ ...r, status: statusOf(r) })),
      total,
      page: input.page,
      pageSize: input.pageSize,
    };
  }),

  /** Obtiene un consentimiento por id (con paciente y firmante). */
  get: tenantProcedure.input(consentGetInput).query(async ({ ctx, input }) => {
    const row = await ctx.prisma.patientConsent.findUnique({
      where: { id: input.id },
      include: {
        patient: { select: { id: true, organizationId: true, mrn: true, firstName: true, lastName: true } },
        signedBy: { select: { id: true, fullName: true } },
      },
    });
    if (!row || row.patient.organizationId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return { ...row, status: statusOf(row) };
  }),

  /**
   * Resumen + detalle por paciente: usado en la vista 360°.
   * Devuelve conteos vigentes/revocados/expirados + lista expandible.
   */
  byPatient: tenantProcedure.input(consentByPatientInput).query(async ({ ctx, input }) => {
    const patient = await ctx.prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true, organizationId: true },
    });
    if (!patient || patient.organizationId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
    }
    const rows = await ctx.prisma.patientConsent.findMany({
      where: { patientId: input.patientId },
      include: { signedBy: { select: { id: true, fullName: true } } },
      orderBy: { signedAt: "desc" },
    });
    const items = rows.map((r) => ({ ...r, status: statusOf(r) }));
    return {
      items,
      summary: {
        active: items.filter((i) => i.status === "active").length,
        revoked: items.filter((i) => i.status === "revoked").length,
        expired: items.filter((i) => i.status === "expired").length,
        total: items.length,
      },
    };
  }),

  /**
   * Registra un consentimiento firmado.
   * - Valida que el paciente pertenezca al tenant.
   * - Valida que la versión coincida con la plantilla vigente del país.
   * - `validTo` se calcula desde `validForDays` salvo override.
   *
   * Nota: `ipAddress` se acepta como input pero NO se persiste en `PatientConsent`
   * (no hay columna). Queda registrada vía audit log (TDR §6.3) cuando se habilite
   * el middleware de auditoría para este modelo. TODO(Sprint 5).
   */
  create: tenantProcedure.input(consentCreateInput).mutation(async ({ ctx, input }) => {
    // 1. Verificar paciente del tenant
    const patient = await ctx.prisma.patient.findUnique({
      where: { id: input.patientId },
      select: { id: true, organizationId: true },
    });
    if (!patient || patient.organizationId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
    }

    // 2. Validar plantilla / versión
    const iso = await resolveCountryIso(ctx.prisma, ctx.tenant.countryId);
    const tpl = getTemplate(iso, input.purpose);
    if (tpl.version !== input.version) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La versión vigente es ${tpl.version}; recibida ${input.version}.`,
      });
    }

    // 3. Calcular validez
    const validFrom = input.validFrom ?? new Date();
    const validTo =
      input.validTo ??
      (tpl.validForDays
        ? new Date(validFrom.getTime() + tpl.validForDays * 86_400_000)
        : null);

    // 4. signedBy: el operador que registra (el usuario en sesión por defecto).
    const signedById = input.signedByUserId ?? ctx.tenant.userId;

    try {
      return await ctx.prisma.patientConsent.create({
        data: {
          patientId: input.patientId,
          purpose: input.purpose,
          granted: input.granted,
          scope: (input.scope ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          signedById,
          validFrom,
          validTo,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Referencia inválida (paciente o usuario firmante).",
        });
      }
      throw err;
    }
  }),

  /**
   * Revoca un consentimiento (setea `revokedAt = now()`). Inmutable post-revocación.
   * Devuelve el registro actualizado.
   */
  revoke: tenantProcedure.input(consentRevokeInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.prisma.patientConsent.findUnique({
      where: { id: input.id },
      include: { patient: { select: { organizationId: true } } },
    });
    if (!existing || existing.patient.organizationId !== ctx.tenant.organizationId) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    if (existing.revokedAt) {
      throw new TRPCError({
        code: "CONFLICT",
        message: "El consentimiento ya fue revocado previamente.",
      });
    }
    // Nota: `reason` no se persiste en columna (no existe en schema). Queda en audit log.
    // TODO(Sprint 2): añadir columna `revocationReason` cuando se amplíe schema.
    return ctx.prisma.patientConsent.update({
      where: { id: input.id },
      data: { revokedAt: new Date() },
    });
  }),
});
