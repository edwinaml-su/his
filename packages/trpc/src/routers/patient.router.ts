import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  patientCreateSchema,
  patientUpdateSchema,
  patientIdentifierSchema,
  patientAllergySchema,
  patientAddressSchema,
  patientSearchSchema,
  findDuplicatesInput,
  mergePatientsInput,
  unmergeInput,
  mergeFieldKeys,
  type PatientMergeFieldKey,
} from "@his/contracts";
import { router, tenantProcedure } from "../trpc";
import { withTenantContext } from "../rls-context";
import { hookEcePacienteAfterCreate } from "../lib/ece-hooks";
import { nextExpediente } from "../lib/expediente-numbering";

// =============================================================================
// US-4.3 — Algoritmos de scoring (mirror compacto de apps/web/src/lib/mpi/dedupe.ts).
// Se duplica intencionalmente porque el paquete trpc no puede importar de apps/web
// sin ciclo. Tests viven en lib/mpi/dedupe.ts (fuente de verdad para la UI).
// =============================================================================

const W_IDENTIFIER = 0.4;
const W_NAME = 0.25;
const W_BIRTH = 0.2;
const W_PHONE = 0.1;
const W_ADDRESS = 0.05;

function jaroWinkler(a: string, b: string): number {
  const s1 = a.trim().toLowerCase();
  const s2 = b.trim().toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const matchWindow = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, s2.length);
    for (let j = start; j < end; j++) {
      if (m2[j] || s1[i] !== s2[j]) continue;
      m1[i] = true;
      m2[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let trans = 0;
  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }
  const jaro = (matches / s1.length + matches / s2.length + (matches - trans / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

interface ScoreCandidate {
  id: string;
  firstName: string;
  lastName: string;
  secondLastName: string | null;
  birthDate: Date | null;
  identifiers: Array<{ kind: string; value: string }>;
  phones: Array<{ phone: string }>;
  addresses: Array<{ line1: string; geoDivisionId: string | null }>;
}

function scorePair(a: ScoreCandidate, b: ScoreCandidate): number {
  // Identifier
  const normId = (v: string) => v.replace(/[\s-]/g, "").toUpperCase();
  const aIds = new Set(a.identifiers.map((i) => `${i.kind}|${normId(i.value)}`));
  let identifier = 0;
  for (const i of b.identifiers) {
    if (aIds.has(`${i.kind}|${normId(i.value)}`)) {
      identifier = 1;
      break;
    }
  }

  // Name (con swap firstName↔lastName)
  const direct = jaroWinkler(
    `${a.firstName} ${a.lastName} ${a.secondLastName ?? ""}`.trim(),
    `${b.firstName} ${b.lastName} ${b.secondLastName ?? ""}`.trim(),
  );
  const swapped = jaroWinkler(
    `${a.firstName} ${a.lastName}`,
    `${b.lastName} ${b.firstName}`,
  );
  const name = Math.max(direct, swapped);

  // Birth
  let birth = 0;
  if (a.birthDate && b.birthDate) {
    const diff = Math.abs(a.birthDate.getTime() - b.birthDate.getTime()) / 86400000;
    birth = diff === 0 ? 1 : diff <= 7 ? 0.5 : 0;
  }

  // Phone
  const digits = (s: string) => s.replace(/\D/g, "").slice(-8);
  const aPhones = new Set(a.phones.map((p) => digits(p.phone)).filter((d) => d.length >= 7));
  let phone = 0;
  for (const p of b.phones) {
    const d = digits(p.phone);
    if (d.length >= 7 && aPhones.has(d)) {
      phone = 1;
      break;
    }
  }

  // Address
  let address = 0;
  for (const x of a.addresses) {
    for (const y of b.addresses) {
      const sim = jaroWinkler(x.line1, y.line1);
      const sameGeo = x.geoDivisionId && y.geoDivisionId && x.geoDivisionId === y.geoDivisionId;
      const s = sameGeo ? Math.min(1, sim * 0.7 + 0.3) : sim * 0.7;
      if (s > address) address = s;
    }
  }

  const score =
    identifier * W_IDENTIFIER +
    name * W_NAME +
    birth * W_BIRTH +
    phone * W_PHONE +
    address * W_ADDRESS;

  return Math.round(score * 10000) / 10000;
}

// =============================================================================
// Tablas con FK a Patient que se reasignan en merge (TDR §8.1).
// Comprehensiva: cualquier registro clínico/admin del paciente "from" debe migrar
// al "to" para preservar continuidad asistencial. Cascade-delete tables (perfiles
// 1:N como ethnicities/religions/languages) NO se migran porque tienen PK
// compuesta y podrían colisionar; en MVP se descartan junto con el soft-delete
// del paciente from. TODO(Sprint 3): de-dup y merge de esos perfiles.
// =============================================================================
const FK_REASSIGN_TABLES = [
  "patientIdentifier",
  "patientAddress",
  "patientPhone",
  "patientEmail",
  "patientEmergencyContact",
  "patientAllergy",
  "patientConsent",
  "encounter",
  "triageEvaluation",
] as const;


export const patientRouter = router({
  search: tenantProcedure.input(patientSearchSchema).query(async ({ ctx, input }) => {
    const q = input.query.trim();
    // H1-06 — envuelto en withTenantContext: el rol Supabase original tiene
    // BYPASSRLS, así que sin demote a `authenticated` el filtro por
    // organizationId vive solo en JS y puede bypaseado por una query con SQL
    // injection o un bug en el `where`.
    return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
      return tx.patient.findMany({
        where: {
          organizationId: ctx.tenant.organizationId,
          deletedAt: null,
          OR: [
            { mrn: { contains: q, mode: "insensitive" } },
            { firstName: { contains: q, mode: "insensitive" } },
            { lastName: { contains: q, mode: "insensitive" } },
            { secondLastName: { contains: q, mode: "insensitive" } },
            { identifiers: { some: { value: { contains: q.replace(/\D/g, "") || q } } } },
          ],
        },
        take: input.limit,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        include: { identifiers: { take: 1, where: { isPrimary: true } } },
      });
    });
  }),

  get: tenantProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // H1-06 — RLS demote para evitar leer pacientes de otra org si el
      // `where` por organizationId fallara por cualquier motivo.
      //
      // Estrategia de resiliencia: el findFirst principal solo carga el
      // Patient base (sin includes). Después cada relación se carga en
      // paralelo con `catch` individual. Si UNA relación falla (schema drift,
      // 42703, etc.) las demás siguen mostrándose en lugar de tumbar la
      // página entera con "Unexpected end of JSON input".
      const patient = await withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.patient.findFirst({
          where: {
            id: input.id,
            organizationId: ctx.tenant.organizationId,
            deletedAt: null,
          },
        });
      });
      if (!patient) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }

      // Helper: ejecuta una promesa de Prisma y devuelve fallback si falla,
      // loggeando el error real para diagnóstico server-side.
      const safe = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
        try {
          return await p;
        } catch (err) {
          console.error(`[patient.get] include "${label}" failed:`, err);
          return fallback;
        }
      };

      // Tipo explícito para identifiers con su include de identifierType.
      // Sin esto, el fallback `[]` pierde el shape del include y rompe el
      // consumer (page.tsx accede a `i.identifierType.code`).
      type IdentifierWithType = Awaited<
        ReturnType<
          typeof ctx.prisma.patientIdentifier.findMany<{
            where: { patientId: string };
            include: { identifierType: true };
          }>
        >
      >;

      const [
        identifiers,
        addresses,
        phones,
        emails,
        emergencyContacts,
        allergies,
        biologicalSex,
        gender,
        maritalStatus,
      ] = await Promise.all([
        safe<IdentifierWithType>(
          "identifiers",
          ctx.prisma.patientIdentifier.findMany({
            where: { patientId: patient.id },
            include: { identifierType: true },
          }) as Promise<IdentifierWithType>,
          [] as IdentifierWithType,
        ),
        safe(
          "addresses",
          ctx.prisma.patientAddress.findMany({ where: { patientId: patient.id } }),
          [] as Awaited<ReturnType<typeof ctx.prisma.patientAddress.findMany>>,
        ),
        safe(
          "phones",
          ctx.prisma.patientPhone.findMany({ where: { patientId: patient.id } }),
          [] as Awaited<ReturnType<typeof ctx.prisma.patientPhone.findMany>>,
        ),
        safe(
          "emails",
          ctx.prisma.patientEmail.findMany({ where: { patientId: patient.id } }),
          [] as Awaited<ReturnType<typeof ctx.prisma.patientEmail.findMany>>,
        ),
        safe(
          "emergencyContacts",
          ctx.prisma.patientEmergencyContact.findMany({ where: { patientId: patient.id } }),
          [] as Awaited<ReturnType<typeof ctx.prisma.patientEmergencyContact.findMany>>,
        ),
        safe(
          "allergies",
          ctx.prisma.patientAllergy.findMany({
            where: { patientId: patient.id, active: true },
          }),
          [] as Awaited<ReturnType<typeof ctx.prisma.patientAllergy.findMany>>,
        ),
        safe(
          "biologicalSex",
          ctx.prisma.biologicalSex.findUnique({ where: { id: patient.biologicalSexId } }),
          null as Awaited<ReturnType<typeof ctx.prisma.biologicalSex.findUnique>>,
        ),
        patient.genderId
          ? safe(
              "gender",
              ctx.prisma.gender.findUnique({ where: { id: patient.genderId } }),
              null as Awaited<ReturnType<typeof ctx.prisma.gender.findUnique>>,
            )
          : Promise.resolve(null as Awaited<ReturnType<typeof ctx.prisma.gender.findUnique>>),
        patient.maritalStatusId
          ? safe(
              "maritalStatus",
              ctx.prisma.maritalStatus.findUnique({ where: { id: patient.maritalStatusId } }),
              null as Awaited<ReturnType<typeof ctx.prisma.maritalStatus.findUnique>>,
            )
          : Promise.resolve(
              null as Awaited<ReturnType<typeof ctx.prisma.maritalStatus.findUnique>>,
            ),
      ]);

      return {
        ...patient,
        identifiers,
        addresses,
        phones,
        emails,
        emergencyContacts,
        allergies,
        biologicalSex,
        gender,
        maritalStatus,
      };
    }),

  create: tenantProcedure.input(patientCreateSchema).mutation(async ({ ctx, input }) => {
    if (!ctx.tenant.establishmentId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Selecciona un establecimiento antes de registrar pacientes.",
      });
    }

    const establishmentId = ctx.tenant.establishmentId;

    return ctx.prisma.$transaction(async (tx) => {
      // CC-0002 §6: el expediente requiere birthDate y que el país tenga isoAlpha2.
      if (!input.birthDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "La fecha de nacimiento es requerida para generar el expediente del paciente (CC-0002).",
        });
      }

      const org = await tx.organization.findUnique({
        where: { id: ctx.tenant.organizationId },
        select: { country: { select: { isoAlpha2: true } } },
      });

      const alpha2 = org?.country?.isoAlpha2;
      if (!alpha2) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "El país de la organización no tiene código ISO alfa-2 configurado (CC-0002). Contacta al administrador.",
        });
      }

      // CC-0002 §5: dedup por documento propio antes de crear.
      if (
        input.documentType &&
        ["DUI", "DNI", "PASAPORTE"].includes(input.documentType) &&
        input.documentNumber
      ) {
        const existing = await tx.patient.findFirst({
          where: {
            organizationId: ctx.tenant.organizationId,
            documentType: input.documentType,
            documentNumber: input.documentNumber,
            deletedAt: null,
          },
        });
        if (existing) return existing; // recuperar expediente existente, NO crear uno nuevo.
      }

      const expediente = await nextExpediente(tx, alpha2, input.birthDate);

      // responsable no es columna de Patient — excluirlo del data.
      const { responsable, ...patientData } = input;

      const patient = await tx.patient.create({
        data: {
          ...patientData,
          organizationId: ctx.tenant.organizationId,
          createdBy: ctx.user.id,
          expediente,
        },
      });

      // Hook automático: crear ece.paciente para habilitar documentos clínicos ECE.
      // Pasa el expediente nuevo (CC-0002) como numero_expediente en ECE.
      // Non-fatal: si falla, el Patient ya se creó y se puede backfillear luego.
      const pacienteEceId = await hookEcePacienteAfterCreate(
        tx,
        patient.id,
        establishmentId,
        patient.expediente ?? patient.mrn,
      ).catch((err: unknown) => {
        console.error(
          `[patient.create] hook ECE falló para patient=${patient.id}:`,
          err,
        );
        return null;
      });

      // CC-0002: persistir responsable del menor (best-effort, espejo ECE).
      if (input.documentType === "DUI_RESP" && responsable && pacienteEceId) {
        await tx.$executeRaw`
          INSERT INTO ece.responsable_paciente (id, paciente_id, nombre, parentesco, documento, vigente)
          VALUES (gen_random_uuid(), ${pacienteEceId}::uuid, ${responsable.nombre}, ${responsable.parentesco}, ${responsable.dui}, true)
        `.catch((err: unknown) => {
          console.error(`[patient.create] responsable ECE falló:`, err);
        });
      }

      return patient;
    });
  }),

  update: tenantProcedure.input(patientUpdateSchema).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input;
    return ctx.prisma.patient.update({
      where: { id },
      data: { ...rest, updatedBy: ctx.user.id },
    });
  }),

  addIdentifier: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientIdentifierSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientIdentifier.create({
        data: { patientId: input.patientId, ...input.data },
      });
    }),

  addAllergy: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientAllergySchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientAllergy.create({
        data: {
          patientId: input.patientId,
          ...input.data,
          createdBy: ctx.user.id,
        },
      });
    }),

  addAddress: tenantProcedure
    .input(z.object({ patientId: z.string().uuid(), data: patientAddressSchema }))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.patientAddress.create({
        data: { patientId: input.patientId, ...input.data },
      });
    }),

  // ===========================================================================
  // US-4.3 — Buscar duplicados probables.
  // ===========================================================================
  findDuplicates: tenantProcedure
    .input(findDuplicatesInput)
    .query(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // 1) Pivote: el paciente sobre el cual se buscan candidatos.
      const pivot = await ctx.prisma.patient.findFirst({
        where: { id: input.patientId, organizationId: orgId, deletedAt: null },
        include: {
          identifiers: { select: { kind: true, value: true } },
          phones: { select: { phone: true } },
          addresses: { select: { line1: true, geoDivisionId: true } },
        },
      });
      if (!pivot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente no encontrado." });
      }

      // 2) IDs de pacientes ya merge-eados con el pivote (en cualquier dirección)
      // para excluirlos de la lista de candidatos.
      const previousMerges = await ctx.prisma.patientMerge.findMany({
        where: {
          OR: [{ fromPatientId: pivot.id }, { toPatientId: pivot.id }],
        },
        select: { fromPatientId: true, toPatientId: true },
      });
      const excludedIds = new Set<string>([pivot.id]);
      for (const m of previousMerges) {
        excludedIds.add(m.fromPatientId);
        excludedIds.add(m.toPatientId);
      }

      // 3) Bloque candidatos: misma org, no soft-deleted, no excluidos.
      // Pre-filtro grueso por inicial de apellido o coincidencia de identificador
      // para no traer toda la org. Heurística simple: comparten 1ra letra del lastName.
      const initial = pivot.lastName?.[0]?.toLowerCase() ?? "";
      const idValues = pivot.identifiers.map((i) => i.value);
      const candidates = await ctx.prisma.patient.findMany({
        where: {
          organizationId: orgId,
          deletedAt: null,
          id: { notIn: Array.from(excludedIds) },
          OR: [
            initial ? { lastName: { startsWith: initial, mode: "insensitive" } } : undefined,
            idValues.length > 0
              ? { identifiers: { some: { value: { in: idValues } } } }
              : undefined,
            pivot.birthDate ? { birthDate: pivot.birthDate } : undefined,
          ].filter(Boolean) as Array<Record<string, unknown>>,
        },
        take: 500, // hard cap para evitar O(n) explosivo en orgs grandes.
        include: {
          identifiers: { select: { kind: true, value: true } },
          phones: { select: { phone: true } },
          addresses: { select: { line1: true, geoDivisionId: true } },
        },
      });

      // 4) Score y filtrado por threshold.
      const pivotPayload: ScoreCandidate = {
        id: pivot.id,
        firstName: pivot.firstName,
        lastName: pivot.lastName,
        secondLastName: pivot.secondLastName,
        birthDate: pivot.birthDate,
        identifiers: pivot.identifiers,
        phones: pivot.phones,
        addresses: pivot.addresses,
      };

      const scored = candidates
        .map((c) => {
          const payload: ScoreCandidate = {
            id: c.id,
            firstName: c.firstName,
            lastName: c.lastName,
            secondLastName: c.secondLastName,
            birthDate: c.birthDate,
            identifiers: c.identifiers,
            phones: c.phones,
            addresses: c.addresses,
          };
          const score = scorePair(pivotPayload, payload);
          const klass: "DUPLICATE_PROBABLE" | "CANDIDATE" | "DIFFERENT" =
            score > 0.85 ? "DUPLICATE_PROBABLE" : score >= 0.65 ? "CANDIDATE" : "DIFFERENT";
          return {
            patient: {
              id: c.id,
              mrn: c.mrn,
              firstName: c.firstName,
              lastName: c.lastName,
              secondLastName: c.secondLastName,
              birthDate: c.birthDate,
            },
            score,
            class: klass,
          };
        })
        .filter((s) => s.score >= input.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);

      return { pivotId: pivot.id, candidates: scored };
    }),

  // ===========================================================================
  // US-4.4 — Merge con auditoría (transaccional).
  // ===========================================================================
  mergePatients: tenantProcedure
    .input(mergePatientsInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // 1) Cargar ambos pacientes (mismo tenant) y validar.
      const [from, to] = await Promise.all([
        ctx.prisma.patient.findFirst({
          where: { id: input.fromPatientId, organizationId: orgId, deletedAt: null },
        }),
        ctx.prisma.patient.findFirst({
          where: { id: input.toPatientId, organizationId: orgId, deletedAt: null },
        }),
      ]);
      if (!from || !to) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Uno o ambos pacientes no existen o están eliminados.",
        });
      }
      if (from.id === to.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede fusionar un paciente consigo mismo.",
        });
      }

      // 2) Construir el patch para `toPatient` según fieldsToTake.
      const patch: Record<string, unknown> = { updatedBy: ctx.user.id };
      for (const key of mergeFieldKeys) {
        const choice = input.fieldsToTake[key as PatientMergeFieldKey];
        if (choice === "from") {
          patch[key] = (from as Record<string, unknown>)[key];
        }
      }

      // 3) Snapshot before/after para auditoría.
      const beforeSnapshot = {
        from: { id: from.id, mrn: from.mrn, firstName: from.firstName, lastName: from.lastName },
        to: { id: to.id, mrn: to.mrn, firstName: to.firstName, lastName: to.lastName },
      };

      // 4) Transaction.
      const result = await ctx.prisma.$transaction(async (tx) => {
        // 4a) PatientMerge audit row (campo se llama `reason` en schema).
        const merge = await tx.patientMerge.create({
          data: {
            fromPatientId: from.id,
            toPatientId: to.id,
            reason: input.justification,
            mergedBy: ctx.user.id,
          },
        });

        // 4b) Reasignar FKs. Se hace una update por tabla; Prisma optimiza a UPDATE
        // ... WHERE patientId = $from. Si una tabla no existe en el cliente Prisma
        // (drift), saltamos silenciosamente para no romper el merge.
        for (const table of FK_REASSIGN_TABLES) {
          const delegate = (tx as unknown as Record<string, { updateMany?: Function }>)[table];
          if (!delegate?.updateMany) continue;
          await delegate.updateMany({
            where: { patientId: from.id },
            data: { patientId: to.id },
          });
        }

        // 4c) Aplicar fields seleccionados al `to`.
        if (Object.keys(patch).length > 1) {
          await tx.patient.update({
            where: { id: to.id },
            data: patch,
          });
        }

        // 4d) Soft-delete del `from`.
        await tx.patient.update({
          where: { id: from.id },
          data: {
            deletedAt: new Date(),
            deletedBy: ctx.user.id,
            active: false,
          },
        });

        // 4e) Audit log entry (usa UPDATE porque MERGE_PATIENTS no está en enum).
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: orgId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "UPDATE",
            entity: "Patient",
            entityId: to.id,
            beforeJson: beforeSnapshot,
            afterJson: {
              op: "MERGE_PATIENTS",
              mergeId: merge.id,
              fromPatientId: from.id,
              toPatientId: to.id,
              fieldsToTake: input.fieldsToTake,
              tablesReassigned: FK_REASSIGN_TABLES,
            },
            justification: input.justification,
          },
        });

        return merge;
      });

      return { mergeId: result.id, toPatientId: to.id };
    }),

  // ===========================================================================
  // US-4.4 — Unmerge (reversible dentro de ventana de 7 días).
  // ===========================================================================
  // H1-08 (audit Stream A — P1 ALTA): unmerge deshabilitado hasta Sprint X.
  // El restore actual solo recupera `deletedAt` del paciente "from" pero NO
  // restaura los encuentros, alergias y demás FKs reasignadas durante el merge.
  // Dejar esa operación a medias deja al paciente restaurado sin historial clínico,
  // lo cual es peor que no tener unmerge. Se requiere snapshot completo en
  // PatientMerge.snapshotJson antes de habilitar de nuevo.
  // Referencia: H1-08 audit 2026-05-19, re-audit 2026-05-24 — ABIERTO.
  unmerge: tenantProcedure
    .input(unmergeInput)
    .mutation(async () => {
      throw new TRPCError({
        code: "METHOD_NOT_SUPPORTED",
        message:
          "Unmerge de pacientes no está disponible en esta versión. " +
          "Requiere implementación de snapshot completo de relaciones (Sprint X). " +
          "Contacte soporte técnico para reversiones manuales.",
      });
    }),
});
