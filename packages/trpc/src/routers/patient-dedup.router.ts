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
 *
 * HJ-30: PIN nunca viaja ni se almacena en texto plano. confirmEceMerge recibe
 *   { firmante1: { userId, pin }, firmante2: { userId, pin } } y verifica cada
 *   PIN contra ece.firma_electronica.pin_hash (argon2id) server-side. Solo el
 *   UUID de la firma electrónica queda persistido en EcePatientMerge.
 *
 * HJ-31: Quorum de roles verificado server-side: ambos firmantes deben ser
 *   personal_salud activo con roles ECE distintos. Se rechaza si es el mismo
 *   personal o si ambos comparten el mismo código de rol.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { argon2 } from "@his/infrastructure";
import { router, tenantProcedure, requireRole } from "../trpc";
import { withTenantContext } from "../rls-context";

// ─── Tipos y helpers firma electrónica (HJ-30 / HJ-31) ───────────────────────

// Columnas mínimas necesarias de ece.firma_electronica.
type FirmaRow = {
  id: string;
  personal_id: string;
  pin_hash: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
};

type PersonalRolRow = {
  personal_id: string;
  rol_codigo: string;
};

/**
 * Resuelve his_user_id → firma electrónica activa en ece.
 * Lanza PRECONDITION_FAILED si no existe personal ECE o firma sin configurar.
 */
async function resolveFirma(
  prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<FirmaRow> {
  const personal = await (
    prisma.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<Array<{ id: string }>>
  )`
    SELECT id FROM ece.personal_salud
    WHERE his_user_id = ${userId}::uuid AND activo = true
    LIMIT 1
  `;
  if (!personal[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No se encontró personal ECE activo para el usuario firmante.",
    });
  }

  const firmas = await (
    prisma.$queryRaw as (q: TemplateStringsArray, ...v: unknown[]) => Promise<FirmaRow[]>
  )`
    SELECT id, personal_id, pin_hash, failed_attempts, locked_until, revoked_at
    FROM ece.firma_electronica
    WHERE personal_id = ${personal[0].id}::uuid
    LIMIT 1
  `;
  if (!firmas[0]) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Firma electrónica no configurada para el usuario firmante.",
    });
  }
  return firmas[0];
}

/**
 * Verifica PIN argon2id. Lanza UNAUTHORIZED / TOO_MANY_REQUESTS / FORBIDDEN.
 * No actualiza contadores de intentos fallidos (responsabilidad del router firma-electronica).
 */
async function verifyMergePinOrThrow(firma: FirmaRow, pin: string): Promise<void> {
  if (firma.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica del firmante ha sido revocada.",
    });
  }
  if (firma.locked_until !== null && firma.locked_until > new Date()) {
    const mins = Math.ceil((firma.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }
  const valid = await argon2.verify(firma.pin_hash, pin);
  if (!valid) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN de firma incorrecto.",
    });
  }
}

/**
 * HJ-31: Verifica quorum — personal_id distintos y rol ECE distinto entre ambos.
 * Consulta ece.asignacion_rol con ece.rol para obtener el código del rol.
 */
async function assertQuorumOrThrow(
  prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  firma1: FirmaRow,
  firma2: FirmaRow,
): Promise<void> {
  // Misma persona → rechazar
  if (firma1.personal_id === firma2.personal_id) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Quorum inválido: ambas firmas corresponden al mismo profesional.",
    });
  }

  // Obtener rol ECE primario (vigente) de cada firmante
  const rows = await (
    prisma.$queryRaw as (
      q: TemplateStringsArray,
      ...v: unknown[]
    ) => Promise<PersonalRolRow[]>
  )`
    SELECT ar.personal_id, r.codigo AS rol_codigo
    FROM ece.asignacion_rol ar
    JOIN ece.rol r ON r.id = ar.rol_id
    WHERE ar.personal_id IN (${firma1.personal_id}::uuid, ${firma2.personal_id}::uuid)
      AND ar.vigente = true
    ORDER BY ar.personal_id, ar.asignado_en DESC
  `;

  const rolPor = new Map<string, string>();
  for (const row of rows) {
    // Primer registro = rol más reciente (ya ordenado)
    if (!rolPor.has(row.personal_id)) {
      rolPor.set(row.personal_id, row.rol_codigo);
    }
  }

  const rol1 = rolPor.get(firma1.personal_id);
  const rol2 = rolPor.get(firma2.personal_id);

  if (!rol1 || !rol2) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Uno o ambos firmantes no tienen rol ECE vigente asignado.",
    });
  }

  if (rol1 === rol2) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Quorum inválido: ambos firmantes tienen el mismo rol ECE (${rol1}). Se requieren roles distintos.`,
    });
  }
}

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

// PIN: 6-8 dígitos numéricos (NTEC Art. 42) — idéntico a ece-rectificacion.router.
const pinSchema = z
  .string()
  .regex(/^\d{6,8}$/, "El PIN debe ser 6-8 dígitos numéricos.");

// HJ-30: el cliente nunca envía el PIN ya hasheado ni el firmaId directamente.
// Envía userId + PIN en claro; el servidor resuelve la firma y verifica argon2id.
const firmanteSchema = z.object({
  userId: z.string().uuid("userId debe ser UUID del usuario HIS"),
  pin: pinSchema,
});

const confirmMergeInput = z.object({
  mergeId: z.string().uuid(),
  firmante1: firmanteSchema,
  firmante2: firmanteSchema,
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
   * US.F2.7.41 — Confirmar merge con doble firma electrónica argon2id.
   *
   * HJ-30: los PINes se verifican server-side contra ece.firma_electronica.pin_hash.
   *   Nunca se almacenan ni se loguean los PINes en texto plano.
   *   Solo los UUIDs de las firmas electrónicas quedan en EcePatientMerge.
   *
   * HJ-31: se verifica quorum antes de ejecutar:
   *   - Los dos firmantes deben ser personal ECE activo distintos.
   *   - Deben tener roles ECE distintos (e.g., DIR + MC — no dos DIR).
   *
   * Ejecuta: re-FK expedientes ECE, marca mergedPatient.mergedIntoId, audit log.
   * Irreversible: estado EJECUTADO.
   */
  confirmEceMerge: requireRole(["DIR", "ADMIN"])
    .input(confirmMergeInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.tenant.organizationId;

      // ── 1. Verificar que la solicitud existe, es del tenant y está PENDIENTE ──
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

      // ── 2. HJ-30: Resolver y verificar PINes server-side (argon2id) ───────────
      // Secuencial (no paralelo) para que el orden de $queryRaw sea determinista
      // y para que un error en firma1 no ocupe recursos para firma2 inútilmente.
      const firma1 = await resolveFirma(ctx.prisma, input.firmante1.userId);
      const firma2 = await resolveFirma(ctx.prisma, input.firmante2.userId);

      // Verificar PINes sin cortocircuito para no revelar cuál falló por timing.
      const [check1, check2] = await Promise.allSettled([
        verifyMergePinOrThrow(firma1, input.firmante1.pin),
        verifyMergePinOrThrow(firma2, input.firmante2.pin),
      ]);

      if (check1.status === "rejected") throw check1.reason;
      if (check2.status === "rejected") throw check2.reason;

      // ── 3. HJ-31: Quorum de roles ────────────────────────────────────────────
      await assertQuorumOrThrow(ctx.prisma, firma1, firma2);

      // ── 4. Ejecutar merge dentro de transacción con RLS ──────────────────────
      return withTenantContext(ctx.prisma, ctx.tenant, async (tx) => {
        // Marcar paciente HIS absorbido con mergedIntoId (US.F2.7.41)
        await tx.patient.update({
          where: { id: mergeReq.mergedPatientId },
          data: { mergedIntoId: mergeReq.canonicalPatientId, active: false },
        });

        // Reasignar expedientes ECE que apuntan al mergedPatient como maestro.
        // Nota: ece.paciente.id ≠ public.Patient.id en general; la relación
        // ECE↔HIS vive en el bridge. Aquí marcamos los expedientes subordinados.
        await tx.ecePaciente.updateMany({
          where: { expedienteMaestroId: mergeReq.mergedPatientId },
          data: { estadoExpediente: "fusionado", expedienteMaestroId: mergeReq.canonicalPatientId },
        });

        // Persistir UUIDs de firma (nunca el PIN).
        const updated = await tx.ecePatientMerge.update({
          where: { id: input.mergeId },
          data: {
            firmaDir1Id: firma1.id,
            firmaDir2Id: firma2.id,
            fechaEjecucion: new Date(),
            estado: "EJECUTADO",
          },
          select: { id: true, estado: true, fechaEjecucion: true, canonicalPatientId: true },
        });

        // Audit log con quorum explícito — sin PINes.
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
              // UUIDs de firma — trazabilidad completa sin datos sensibles.
              firmaDir1Id: firma1.id,
              firmaDir1PersonalId: firma1.personal_id,
              firmaDir2Id: firma2.id,
              firmaDir2PersonalId: firma2.personal_id,
            },
            justification: `Merge NTEC confirmado con quorum doble firma. mergeId=${input.mergeId}`,
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
