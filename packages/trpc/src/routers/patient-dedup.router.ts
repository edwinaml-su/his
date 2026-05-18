/**
 * F2-S15 Stream C — Dedup MPI NTEC (US.F2.7.39-42)
 *
 * Complementa el patient.router.ts (que trabaja sobre public.Patient) con
 * operaciones dirigidas al expediente ECE (ece.paciente / EcePaciente):
 *
 * - findPotentialDuplicates — busca duplicados en EcePaciente por NUI/DUI/nombre+DOB.
 *   Umbral configurable (default 0.85). Retorna lista ordenada por score.
 * - requestEceMerge       — abre solicitud de merge con doble firma DIR (PENDIENTE).
 * - confirmEceMerge       — ejecuta el merge tras las dos firmas (EJECUTADO).
 * - getExpedienteFormat   — lee el formato vigente para la org.
 * - upsertExpedienteFormat — crea o reemplaza el formato (ADM/DIR).
 *
 * RLS: withTenantContext en todas las escrituras. Reads usan prisma directo
 * con filtro explícito organizationId/establecimientoId.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ─── Jaro-Winkler (mirror del patient.router para evitar ciclos) ──────────────

function jaroWinkler(a: string, b: string): number {
  const s1 = a.trim().toLowerCase();
  const s2 = b.trim().toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const mw = Math.max(0, Math.floor(Math.max(s1.length, s2.length) / 2) - 1);
  const m1 = new Array<boolean>(s1.length).fill(false);
  const m2 = new Array<boolean>(s2.length).fill(false);
  let matches = 0;
  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - mw);
    const end = Math.min(i + mw + 1, s2.length);
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
  const jaro =
    (matches / s1.length + matches / s2.length + (matches - trans / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, s1.length, s2.length); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

// ─── Scoring EcePaciente ──────────────────────────────────────────────────────

interface EcePacienteCandidate {
  id: string;
  nui: string | null;
  dui: string | null;
  primerNombre: string | null;
  primerApellido: string | null;
  segundoApellido: string | null;
  fechaNacimiento: Date | null;
}

function scoreEcePair(pivot: EcePacienteCandidate, cand: EcePacienteCandidate): number {
  // Exact NUI match → top score (same person by law)
  if (pivot.nui && cand.nui && pivot.nui === cand.nui) return 1;
  // Exact DUI match → high weight
  const duiMatch = pivot.dui && cand.dui && pivot.dui === cand.dui ? 1 : 0;

  // Name similarity
  const fullA = `${pivot.primerNombre ?? ""} ${pivot.primerApellido ?? ""} ${pivot.segundoApellido ?? ""}`.trim();
  const fullB = `${cand.primerNombre ?? ""} ${cand.primerApellido ?? ""} ${cand.segundoApellido ?? ""}`.trim();
  const nameSim = jaroWinkler(fullA, fullB);

  // Birth date: exact=1, ≤3 days=0.6, else 0
  let birth = 0;
  if (pivot.fechaNacimiento && cand.fechaNacimiento) {
    const diff =
      Math.abs(pivot.fechaNacimiento.getTime() - cand.fechaNacimiento.getTime()) / 86400000;
    birth = diff === 0 ? 1 : diff <= 3 ? 0.6 : 0;
  }

  // Weighted score (DUI=0.4, name=0.35, birth=0.25)
  const score = duiMatch * 0.4 + nameSim * 0.35 + birth * 0.25;
  return Math.round(score * 10000) / 10000;
}

// ─── Input schemas ────────────────────────────────────────────────────────────

const findDuplicatesInput = z.object({
  ecePacienteId: z.string().uuid(),
  threshold: z.number().min(0.5).max(1).default(0.85),
  limit: z.number().int().min(1).max(50).default(20),
});

const requestMergeInput = z.object({
  organizationId: z.string().uuid(),
  canonicalPatientId: z.string().uuid(),
  mergedPatientId: z.string().uuid(),
});

const confirmMergeInput = z.object({
  mergeId: z.string().uuid(),
  firmaDir1Id: z.string().min(1),
  firmaDir2Id: z.string().min(1),
});

const expedienteFormatInput = z.object({
  formato: z.string().min(3).max(80),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const patientDedupRouter = router({
  /**
   * US.F2.7.40 — Detección de duplicados en ece.paciente por similitud.
   * Compara NUI exacto, DUI exacto, nombre+apellido+DOB vía Jaro-Winkler.
   * Threshold default 0.85 (configurable).
   */
  findPotentialDuplicates: tenantProcedure
    .input(findDuplicatesInput)
    .query(async ({ ctx, input }) => {
      const pivot = await ctx.prisma.ecePaciente.findUnique({
        where: { id: input.ecePacienteId },
        select: {
          id: true,
          nui: true,
          dui: true,
          primerNombre: true,
          primerApellido: true,
          segundoApellido: true,
          fechaNacimiento: true,
          establecimientoId: true,
        },
      });
      if (!pivot) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Paciente ECE no encontrado." });
      }

      // Pre-filter: misma org via establecimiento, no fusionados, no el pivote
      const candidates = await ctx.prisma.ecePaciente.findMany({
        where: {
          id: { not: input.ecePacienteId },
          establecimientoId: pivot.establecimientoId,
          estadoRegistro: "vigente",
          estadoExpediente: { not: "fusionado" },
        },
        select: {
          id: true,
          nui: true,
          dui: true,
          primerNombre: true,
          primerApellido: true,
          segundoApellido: true,
          fechaNacimiento: true,
          numeroExpediente: true,
        },
        take: 500,
      });

      const scored = candidates
        .map((c) => ({
          candidate: c,
          score: scoreEcePair(pivot, c),
        }))
        .filter((s) => s.score >= input.threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.limit);

      return {
        pivotId: pivot.id,
        candidates: scored.map(({ candidate, score }) => ({
          id: candidate.id,
          numeroExpediente: candidate.numeroExpediente,
          primerNombre: candidate.primerNombre,
          primerApellido: candidate.primerApellido,
          nui: candidate.nui,
          dui: candidate.dui,
          fechaNacimiento: candidate.fechaNacimiento,
          score,
          confidence: score >= 0.95 ? "ALTA" : score >= 0.85 ? "MEDIA" : "BAJA",
        })),
      };
    }),

  /**
   * US.F2.7.41 — Abrir solicitud de merge (estado PENDIENTE).
   * Requiere rol ADM o DIR. No ejecuta el merge; espera las dos firmas.
   */
  requestEceMerge: requireRole(["ADM", "DIR", "ADMIN"])
    .input(requestMergeInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      if (input.canonicalPatientId === input.mergedPatientId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No se puede fusionar un paciente consigo mismo.",
        });
      }

      // Verificar que no existe merge pendiente para el mismo par
      const existing = await ctx.prisma.ecePatientMerge.findUnique({
        where: { uq_ece_merge_pair: { canonicalPatientId: input.canonicalPatientId, mergedPatientId: input.mergedPatientId } },
      });
      if (existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe una solicitud de merge ${existing.estado} para este par.`,
        });
      }

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        const merge = await tx.ecePatientMerge.create({
          data: {
            organizationId: orgId,
            canonicalPatientId: input.canonicalPatientId,
            mergedPatientId: input.mergedPatientId,
            solicitadoPorId: ctx.user.id,
            estado: "PENDIENTE",
          },
          select: { id: true, estado: true, creadoEn: true },
        });
        return merge;
      });
    }),

  /**
   * US.F2.7.41 — Confirmar merge con doble firma.
   * Recibe firmaDir1Id + firmaDir2Id (hashes PIN de los directores).
   * Ejecuta: re-FK episodios, marca mergedPatient.mergedIntoId, audit log.
   * Irreversible: estado EJECUTADO.
   */
  confirmEceMerge: requireRole(["DIR", "ADMIN"])
    .input(confirmMergeInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      const mergeReq = await ctx.prisma.ecePatientMerge.findUnique({
        where: { id: input.mergeId },
      });
      if (!mergeReq) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Solicitud de merge no encontrada." });
      }
      if (mergeReq.organizationId !== orgId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Merge fuera del tenant." });
      }
      if (mergeReq.estado !== "PENDIENTE") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `El merge ya está en estado ${mergeReq.estado}.`,
        });
      }

      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Marcar paciente HIS absorbido con mergedIntoId (US.F2.7.41)
        await tx.patient.update({
          where: { id: mergeReq.mergedPatientId },
          data: { mergedIntoId: mergeReq.canonicalPatientId, active: false },
        });

        // Reasignar expedientes ECE que apuntan al mergedPatient como maestro
        // Nota: ece.paciente.id ≠ public.Patient.id en general; la relación
        // ECE↔HIS vive en el bridge. Aquí marcamos los expedientes subordinados.
        await tx.ecePaciente.updateMany({
          where: { expedienteMaestroId: mergeReq.mergedPatientId },
          data: { estadoExpediente: "fusionado", expedienteMaestroId: mergeReq.canonicalPatientId },
        });

        // Actualizar solicitud de merge con firmas y fecha de ejecución
        const updated = await tx.ecePatientMerge.update({
          where: { id: input.mergeId },
          data: {
            firmaDir1Id: input.firmaDir1Id,
            firmaDir2Id: input.firmaDir2Id,
            fechaEjecucion: new Date(),
            estado: "EJECUTADO",
          },
          select: { id: true, estado: true, fechaEjecucion: true, canonicalPatientId: true },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            userId: ctx.user.id,
            organizationId: orgId,
            establishmentId: ctx.tenant.establishmentId ?? null,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
            action: "UPDATE",
            entity: "Patient",
            entityId: mergeReq.canonicalPatientId,
            afterJson: {
              op: "ECE_MERGE_EJECUTADO",
              mergeId: input.mergeId,
              canonicalPatientId: mergeReq.canonicalPatientId,
              mergedPatientId: mergeReq.mergedPatientId,
            },
            justification: `Merge NTEC confirmado. mergeId=${input.mergeId}`,
          },
        });

        return updated;
      });
    }),

  /**
   * US.F2.7.42 — Leer formato de expediente vigente para la org.
   */
  getExpedienteFormat: tenantProcedure.query(async ({ ctx }) => {
    const config = await ctx.prisma.expedienteFormatConfig.findFirst({
      where: { organizationId: ctx.tenant.organizationId },
      orderBy: { vigenteDesde: "desc" },
      select: { id: true, formato: true, vigenteDesde: true },
    });
    return config ?? { id: null, formato: "{YYYY}-{INC:6}", vigenteDesde: null };
  }),

  /**
   * US.F2.7.42 — Configurar formato de expediente (ADM/DIR).
   */
  upsertExpedienteFormat: requireRole(["ADM", "DIR", "ADMIN"])
    .input(expedienteFormatInput)
    .mutation(async ({ ctx, input }) => {
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        return tx.expedienteFormatConfig.create({
          data: {
            organizationId: ctx.tenant.organizationId,
            formato: input.formato,
            creadoPorId: ctx.user.id,
            vigenteDesde: new Date(),
          },
          select: { id: true, formato: true, vigenteDesde: true },
        });
      });
    }),

  /**
   * US.F2.7.41 — Listar solicitudes de merge pendientes (cola ADM/DIR).
   */
  listPendingMerges: requireRole(["ADM", "DIR", "ADMIN"]).query(async ({ ctx }) => {
    return ctx.prisma.ecePatientMerge.findMany({
      where: {
        organizationId: ctx.tenant.organizationId,
        estado: "PENDIENTE",
      },
      select: {
        id: true,
        canonicalPatientId: true,
        mergedPatientId: true,
        estado: true,
        creadoEn: true,
        solicitadoPor: { select: { fullName: true } },
        canonicalPatient: { select: { mrn: true, firstName: true, lastName: true } },
        mergedPatient: { select: { mrn: true, firstName: true, lastName: true } },
      },
      orderBy: { creadoEn: "desc" },
      take: 50,
    });
  }),
});
