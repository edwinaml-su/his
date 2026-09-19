/**
 * Router tRPC — ECE Certificación Director (Art. 21 NTEC).
 *
 * Norma: MINSAL Acuerdo n.° 1616 (2024), Art. 21 — Certificación oficial de
 *   documentos clínicos por el Director Médico del establecimiento.
 * Código de operación: ECE-CERT (transversal — aplica a varios tipos_documento).
 *
 * Este router implementa el paso final del workflow de certificación para
 * documentos que requieren sello del director. Solo opera sobre documentos
 * en estado 'validado'. Los tipos elegibles son:
 *   - FICHA_ID    (Ficha de Identificación del Paciente)
 *   - EPICRISIS   (Epicrisis de Egreso)
 *   - CERT_DEF    (Certificado de Defunción)
 *
 * ---------------------------------------------------------------------------
 * WORKFLOW  (paso terminal — solo el step certificar)
 * ---------------------------------------------------------------------------
 *   validado → certificado  (DIR: firma con PIN argon2id + emite outbox)
 *   Precondición estricta: estado = 'validado' en ece.documento_instancia.
 *   El router rechaza con FORBIDDEN si el tipo_documento no está en la lista
 *   elegible, usando requireEcePermission("ece.documento.certificar").
 *
 *   El PIN se verifica contra ece.firma_electronica.pin_hash (argon2id).
 *   Lockout automático tras 3 intentos fallidos (locked_until timestamptz).
 *   Se registra transición en ece.documento_instancia_historial con SHA-256.
 *
 * ---------------------------------------------------------------------------
 * OUTBOX (emitDomainEvent dentro del callback de withWorkflowContext)
 * ---------------------------------------------------------------------------
 *   'ece.documento.certificado'  — emitido por certificar(). Beta.15 notifications.
 *     Payload: { instanciaId, tipoDocumento, dirUserId, payloadHash, orgId }
 *     payloadHash = SHA-256(instanciaId + tipoDocumento + directorId + timestamp)
 *
 * ---------------------------------------------------------------------------
 * TABLAS BD (raw SQL — ece.* no está en schema.prisma)
 * ---------------------------------------------------------------------------
 *   ece.documento_instancia           — estado actual; filtrado por 'validado'
 *   ece.documento_instancia_historial — append-only log de transiciones
 *   ece.firma_electronica             — credencial PIN del DIR (argon2id hash)
 *   ece.personal_salud                — mapeo his_user_id → personal ECE id
 *
 * ---------------------------------------------------------------------------
 * ROLES tRPC
 * ---------------------------------------------------------------------------
 *   listCola        → requireRole(["DIR"])  — cola de documentos pendientes de certificar
 *   certificar      → requireRole(["DIR"])  + requireEcePermission("ece.documento.certificar")
 *   certificarBulk  → requireRole(["DIR"])  — verifica PIN una vez, certifica todos en serie
 *
 * ---------------------------------------------------------------------------
 * R1.1 (plan de remediación 2026-09) — `listCola` re-migrado a RLS real
 * ---------------------------------------------------------------------------
 *   Hasta PR #693, `listCola` leía con `ctx.prisma.$queryRawUnsafe` SIN
 *   contexto ECE (rol BYPASSRLS) — excepción documentada porque
 *   `ece.personal_salud` tenía 0 filas en prod y `ece.current_personal_id()`
 *   nunca resolvía para ningún DIR. `sql/257_r1_sync_personal_salud.sql`
 *   materializa automáticamente `ece.personal_salud` + `ece.asignacion_rol`
 *   para todo usuario clínico con rol asignado (trigger AFTER INSERT/UPDATE
 *   sobre `User`/`UserOrganizationRole` + backfill), así que ya se puede
 *   resolver `personal.id` y correr bajo `withWorkflowContext` — la policy
 *   RESTRICTIVE `"documento_instancia: confidencial_read"` (ADR 0020) evalúa
 *   correctamente: no-confidenciales siempre visibles; confidenciales solo si
 *   `creado_por = ece.current_personal_id()` o el personal tiene
 *   `ece.asignacion_rol` activa con `ece.rol.codigo = 'DIR'` (lo que el sync
 *   ahora puebla). Si `resolvePersonalSalud` no encuentra fila (sync aún no
 *   corrió, o el DIR perdió el rol clínico), lanza PRECONDITION_FAILED en vez
 *   de degradar a lectura privilegiada.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, requireRole } from "../../trpc";
import { requireEcePermission } from "../../middleware/ece-permission";
import { withWorkflowContext } from "../../workflow/context";
import { emitDomainEvent } from "@his/database";
import { resolvePersonalSalud } from "../../lib/identity-resolver";

// PIN de firma: 6-8 dígitos numéricos
const pinSchema = z
  .string()
  .trim()
  .regex(/^\d{6,8}$/, { message: "El PIN debe tener entre 6 y 8 dígitos." });

const listColaCertificacionInput = z.object({
  incluirCertificados: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(25),
  cursor: z.string().uuid().optional(),
});

const certificarInput = z.object({
  instanciaId: z.string().uuid(),
  pin: pinSchema,
});

const certificarBulkInput = z.object({
  instanciaIds: z.array(z.string().uuid()).min(1).max(100),
  pin: pinSchema,
});

// ---------------------------------------------------------------------------
// Tipos de fila raw
// ---------------------------------------------------------------------------

// R1.1 (corregido tras revisión — P1-1) — `di.paciente_id` es FK a
// `ece.paciente(id)`, NO a `public."Patient".id` (verificado por
// introspección de `pg_constraint`: `documento_instancia_paciente_id_fkey`
// referencia `ece.paciente`). El puente real hacia el registro público es
// `ece.paciente.public_patient_id` (127/127 filas bridged en prod, columna
// nullable por si algún día hay pacientes ECE sin contraparte pública).
// Análogamente, `dih.ejecutado_por` es FK a `ece.personal_salud(id)`, NO a
// `public."User".id` (`documento_instancia_historial_ejecutado_por_fkey`) —
// por eso `validado_por_nombre` se resuelve DENTRO de la misma tx ECE (join a
// `ece.personal_salud`, mismo espacio de ids), no aparte. Solo el nombre del
// PACIENTE cruza a `public."Patient"` (que sí tiene RLS tenant ajena al GUC
// ECE) y por eso ese único lookup queda para después de cerrar la tx — ver
// el bloque de enriquecimiento en `listCola`.
interface InstanciaColaRawRow {
  id: string;
  tipo_documento_codigo: string;
  tipo_documento_nombre: string;
  paciente_id: string;
  public_patient_id: string | null;
  estado_codigo: string;
  estado_nombre: string;
  version: number;
  validado_por: string | null;
  validado_por_nombre: string | null;
  creado_en: Date;
  ultimo_cambio_en: Date;
}

interface FirmaRow {
  id: string;
  failed_attempts: number;
  locked_until: Date | null;
  revoked_at: Date | null;
}

interface PersonalRow {
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers raw SQL
// ---------------------------------------------------------------------------

// R03: delega al resolver canónico (packages/trpc/src/lib/identity-resolver.ts)
// en vez de reimplementar el lookup his_user_id → ece.personal_salud.
async function findPersonal(
  prisma: { $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<PersonalRow | null> {
  return resolvePersonalSalud(prisma, userId);
}

/** Verifica PIN argon2id contra la firma del DIR. Lanza TRPCError si falla. */
async function checkPinDir(firmaRow: FirmaRow & { pin_hash: string }, pin: string): Promise<void> {
  if (firmaRow.revoked_at !== null) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "La firma electrónica del DIR ha sido revocada.",
    });
  }
  if (firmaRow.locked_until !== null && firmaRow.locked_until > new Date()) {
    const mins = Math.ceil((firmaRow.locked_until.getTime() - Date.now()) / 60_000);
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Firma bloqueada. Inténtelo en ${mins} min.`,
    });
  }
  const { argon2 } = await import("@his/infrastructure");
  const valid = await argon2.verify(firmaRow.pin_hash, pin);
  if (!valid) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "PIN de firma incorrecto.",
    });
  }
}

// ---------------------------------------------------------------------------
// Core — certifica un documento dentro de una transacción ya abierta.
// Reutilizado por `certificar` (individual) y `certificarBulk` (loop).
// La verificación de PIN NO está aquí — el caller es responsable de
// verificarla antes de invocar esta función.
// ---------------------------------------------------------------------------

type TxLike = {
  $queryRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;
  $executeRaw: (q: TemplateStringsArray, ...v: unknown[]) => Promise<number>;
};

interface CertificarOneParams {
  tx: TxLike;
  instanciaId: string;
  firmaId: string;
  userId: string;
  organizationId: string;
}

async function certificarOneInTx({
  tx,
  instanciaId,
  firmaId,
  userId,
  organizationId,
}: CertificarOneParams): Promise<{ instanciaId: string; payloadHash: string }> {
  const TIPOS_CERTIFICABLES = new Set(["FICHA_ID", "EPICRISIS", "CERT_DEF"]);

  // 1. Leer instancia con lock optimista.
  const instancias = await (tx.$queryRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<Array<{
    id: string;
    estado_actual_id: string;
    estado_codigo: string;
    tipo_documento_codigo: string;
    paciente_id: string;
    version: number;
  }>>)`
    SELECT
      di.id,
      di.estado_actual_id,
      fe.codigo AS estado_codigo,
      td.codigo AS tipo_documento_codigo,
      di.paciente_id,
      di.version
    FROM ece.documento_instancia di
    JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
    JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
    WHERE di.id = ${instanciaId}::uuid
      AND di.estado_registro = 'vigente'
    FOR UPDATE
  `;

  const instancia = instancias[0];
  if (!instancia) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `Documento ${instanciaId} no encontrado o inactivo.`,
    });
  }

  if (instancia.estado_codigo !== "validado") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `Documento ${instanciaId}: solo se pueden certificar documentos en estado 'validado'. Estado actual: ${instancia.estado_codigo}.`,
    });
  }

  if (!TIPOS_CERTIFICABLES.has(instancia.tipo_documento_codigo)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `El tipo '${instancia.tipo_documento_codigo}' no es certificable por DIR (Art. 21 NTEC).`,
    });
  }

  // 2. Resolver estado 'certificado' para este tipo de documento.
  const estadosCertificado = await (tx.$queryRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<Array<{ id: string }>>)`
    SELECT fe.id
    FROM ece.flujo_estado fe
    JOIN ece.tipo_documento td ON td.id = fe.tipo_documento_id
    WHERE td.codigo = ${instancia.tipo_documento_codigo}
      AND fe.codigo = 'certificado'
    LIMIT 1
  `;

  const estadoCertificado = estadosCertificado[0];
  if (!estadoCertificado) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Estado 'certificado' no configurado en el workflow.",
    });
  }

  // 3. Hash de integridad del payload clínico.
  const payloadHash = createHash("sha256")
    .update(JSON.stringify({
      instanciaId: instancia.id,
      tipoCodigo: instancia.tipo_documento_codigo,
      version: instancia.version,
      dirUserId: userId,
      firmaId,
    }))
    .digest("hex");

  // 4. Actualizar estado (optimistic locking por version).
  const updated = await (tx.$executeRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<number>)`
    UPDATE ece.documento_instancia
    SET
      estado_actual_id = ${estadoCertificado.id}::uuid,
      version          = version + 1
    WHERE id      = ${instancia.id}::uuid
      AND version = ${instancia.version}
  `;

  if (updated === 0) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Documento ${instanciaId} fue modificado concurrentemente. Recargue e intente de nuevo.`,
    });
  }

  // 5. Historial inmutable.
  const observacion = `Certificación DIR Art. 21 NTEC — hash: ${payloadHash.slice(0, 16)}…`;
  await (tx.$executeRaw as (
    q: TemplateStringsArray, ...v: unknown[]
  ) => Promise<number>)`
    INSERT INTO ece.documento_instancia_historial
      (instancia_id, estado_anterior_id, estado_nuevo_id,
       accion, ejecutado_por, firma_id, observacion, ejecutado_en)
    VALUES (
      ${instancia.id}::uuid,
      ${instancia.estado_actual_id}::uuid,
      ${estadoCertificado.id}::uuid,
      'certificar',
      ${userId}::uuid,
      ${firmaId}::uuid,
      ${observacion},
      now()
    )
  `;

  // 6. Evento outbox transaccional.
  await emitDomainEvent(tx as Parameters<typeof emitDomainEvent>[0], {
    organizationId,
    eventType: "ece.documento.certificado",
    aggregateType: "DocumentoInstancia",
    aggregateId: instancia.id,
    emittedById: userId,
    payload: {
      instanciaId: instancia.id,
      tipoDocumentoCodigo: instancia.tipo_documento_codigo,
      fromEstadoCodigo: "validado",
      firmaId,
      payloadHash,
      dirUserId: userId,
      pacienteId: instancia.paciente_id,
    },
  });

  return { instanciaId: instancia.id, payloadHash };
}

// ---------------------------------------------------------------------------
// Base procedures
// ---------------------------------------------------------------------------

const dirProcedure = requireRole(["DIR"]);
const certificarProcedure = requireEcePermission("ece.documento.certificar");

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const eceCertificacionRouter = router({
  /**
   * Lista documentos en estado 'validado' pendientes de certificación DIR.
   * Ordenados por antigüedad (los más viejos primero — FIFO de cola).
   * Con `incluirCertificados: true` devuelve también los ya certificados
   * (histórico, orden DESC por último cambio).
   */
  listCola: dirProcedure
    .input(listColaCertificacionInput)
    .query(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere un establecimiento activo.",
        });
      }

      // R1.1 — resuelve el personal_salud del DIR que llama (BYPASSRLS, fuera
      // de tx, igual que el resto de este archivo) para setear el GUC
      // correcto (`app.ece_personal_id`) dentro de `withWorkflowContext` más
      // abajo. Antes de sql/257 esta fila no existía para ningún usuario.
      const personal = await resolvePersonalSalud(ctx.prisma, ctx.user.id);
      if (!personal) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Su usuario no tiene un registro de personal de salud (ece.personal_salud) activo. " +
            "El sync automático lo materializa si tiene un rol clínico asignado (sql/257); " +
            "si el problema persiste, contacte a un ADMIN.",
        });
      }

      const eceCtx = {
        personalId: personal.id,
        establecimientoId: ctx.tenant.establishmentId,
        roles: ctx.tenant.roleCodes,
      };

      const estadoFiltro = input.incluirCertificados
        ? ["validado", "certificado"]
        : ["validado"];

      // R1.1 (corregido — P1-1) — `p.public_patient_id` (bridge hacia
      // public."Patient", resuelto aparte más abajo) y `ps.nombre_completo`
      // (join directo a ece.personal_salud, MISMO espacio de ids que
      // `dih.ejecutado_por` — se resuelve aquí mismo, dentro de la tx ECE).
      // Ninguno de los dos existía en la query original: `di.paciente_id`
      // apunta a `ece.paciente`, no a `public."Patient"`, y `ejecutado_por`
      // apunta a `ece.personal_salud`, no a `public."User"`.
      const baseQuery = `
        SELECT
          di.id,
          td.codigo          AS tipo_documento_codigo,
          td.nombre          AS tipo_documento_nombre,
          di.paciente_id,
          p.public_patient_id,
          fe.codigo          AS estado_codigo,
          fe.nombre          AS estado_nombre,
          di.version,
          dih.ejecutado_por  AS validado_por,
          ps.nombre_completo AS validado_por_nombre,
          di.creado_en,
          di.actualizado_en  AS ultimo_cambio_en
        FROM ece.documento_instancia di
        JOIN ece.tipo_documento td ON td.id = di.tipo_documento_id
        JOIN ece.flujo_estado   fe ON fe.id = di.estado_actual_id
        JOIN ece.paciente       p  ON p.id = di.paciente_id
        LEFT JOIN LATERAL (
          SELECT ejecutado_por
          FROM ece.documento_instancia_historial
          WHERE instancia_id = di.id
            AND accion = 'validar'
          ORDER BY ejecutado_en DESC
          LIMIT 1
        ) dih ON true
        LEFT JOIN ece.personal_salud ps ON ps.id = dih.ejecutado_por
        WHERE fe.codigo = ANY($1::text[])
          AND di.estado_registro = 'vigente'
          ${input.cursor ? "AND di.id > $2::uuid" : ""}
        ORDER BY
          ${input.incluirCertificados
            ? "di.actualizado_en DESC"
            : "di.creado_en ASC"}
        LIMIT ${input.cursor ? "$3" : "$2"}
      `;

      const limit = input.limit + 1; // +1 para detectar hasMore
      const params = input.cursor
        ? [estadoFiltro, input.cursor, limit]
        : [estadoFiltro, limit];

      // R1.1 — corre bajo contexto ECE real (antes: ctx.prisma.$queryRawUnsafe
      // sin ningún contexto, excepción de PR #693). `withWorkflowContext`
      // setea `app.ece_personal_id`/`app.ece_establecimiento_id` y demota a
      // `authenticated`: la policy RESTRICTIVE de confidencial_read aplica.
      const { rows, hasMore } = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const rawRows = await (
          tx as unknown as { $queryRawUnsafe: typeof ctx.prisma.$queryRawUnsafe }
        ).$queryRawUnsafe<InstanciaColaRawRow[]>(baseQuery, ...params);
        return { rows: rawRows, hasMore: rawRows.length > input.limit };
      });

      const items = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : undefined;

      // Nombre de paciente: `public."Patient"` tiene RLS tenant
      // (`organizationId = current_org_id()`), un GUC que `withWorkflowContext`
      // no setea (espacio ECE, no tenant). Se resuelve aparte, vía `ctx.prisma`
      // (BYPASSRLS) — mismo patrón que el resto de este archivo (`findPersonal`,
      // `findFirma`) — filtrando por el `organizationId` del tenant como
      // defensa adicional. Se cruza por `public_patient_id` (el bridge real),
      // NUNCA por `paciente_id` (ese es el id de `ece.paciente`, otro espacio).
      // `validado_por_nombre` YA viene resuelto de la query anterior (join a
      // ece.personal_salud dentro de la misma tx ECE — mismo espacio de ids
      // que `ejecutado_por`), no requiere un segundo lookup.
      const publicPatientIds = [
        ...new Set(items.map((r) => r.public_patient_id).filter((v): v is string => v !== null)),
      ];
      const orgId = ctx.tenant.organizationId;

      const pacientes =
        publicPatientIds.length > 0
          ? await ctx.prisma.$queryRaw<Array<{ id: string; nombre: string }>>`
              SELECT id::text, ("firstName" || ' ' || "lastName") AS nombre
              FROM public."Patient"
              WHERE id = ANY(${publicPatientIds}::uuid[])
                AND "organizationId" = ${orgId}::uuid
            `
          : [];
      const pacienteNombreMap = new Map(pacientes.map((p) => [p.id, p.nombre]));

      return {
        items: items.map((r) => ({
          id: r.id,
          tipoDocumentoCodigo: r.tipo_documento_codigo,
          tipoDocumentoNombre: r.tipo_documento_nombre,
          pacienteId: r.paciente_id,
          pacienteNombre:
            (r.public_patient_id ? pacienteNombreMap.get(r.public_patient_id) : undefined) ??
            r.paciente_id,
          estadoCodigo: r.estado_codigo,
          estadoNombre: r.estado_nombre,
          version: r.version,
          validadoPor: r.validado_por,
          validadoPorNombre: r.validado_por_nombre,
          creadoEn: r.creado_en instanceof Date
            ? r.creado_en.toISOString()
            : String(r.creado_en),
          ultimoCambioEn: r.ultimo_cambio_en instanceof Date
            ? r.ultimo_cambio_en.toISOString()
            : String(r.ultimo_cambio_en),
        })),
        nextCursor,
      };
    }),

  /**
   * Certifica un documento individual: avanza estado 'validado' → 'certificado',
   * valida PIN del DIR, registra historial e inserta evento outbox.
   */
  certificar: certificarProcedure
    .input(certificarInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere un establecimiento activo.",
        });
      }

      const eceCtx = {
        personalId: ctx.user.id,
        establecimientoId: ctx.tenant.establishmentId,
        roles: ctx.tenant.roleCodes,
      };

      return withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        // Verificar firma del DIR.
        const personal = await findPersonal(tx, ctx.user.id);
        if (!personal) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró personal ECE asociado a su cuenta.",
          });
        }

        const firmas = await (tx.$queryRaw as (
          q: TemplateStringsArray, ...v: unknown[]
        ) => Promise<Array<FirmaRow & { pin_hash: string }>>)`
          SELECT id, pin_hash, failed_attempts, locked_until, revoked_at
          FROM ece.firma_electronica
          WHERE personal_id = ${personal.id}::uuid
          LIMIT 1
        `;

        const firma = firmas[0];
        if (!firma) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Firma electrónica no configurada. Use firma.setup.",
          });
        }

        await checkPinDir(firma, input.pin);

        const resultado = await certificarOneInTx({
          tx,
          instanciaId: input.instanciaId,
          firmaId: firma.id,
          userId: ctx.user.id,
          organizationId: ctx.tenant.organizationId,
        });
        return { ok: true as const, ...resultado };
      });
    }),

  /**
   * Certifica múltiples documentos en una sola operación bulk.
   *
   * El PIN se verifica UNA SOLA VEZ al inicio. Luego cada documento se
   * certifica en serie dentro de su propia transacción independiente
   * (no se hace rollback global si un documento falla — los exitosos
   * quedan certificados y se reportan como tales).
   *
   * Retorna { exitosos, fallidos } para feedback granular en UI.
   *
   * Límite: 100 documentos por llamada (protección contra abusos de timeout).
   */
  certificarBulk: dirProcedure
    .input(certificarBulkInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.tenant.establishmentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Se requiere un establecimiento activo.",
        });
      }

      const eceCtx = {
        personalId: ctx.user.id,
        establecimientoId: ctx.tenant.establishmentId,
        roles: ctx.tenant.roleCodes,
      };

      // Fase 1: verificar PIN una sola vez (fuera del loop de documentos).
      const firmaVerificada = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
        const personal = await findPersonal(tx, ctx.user.id);
        if (!personal) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No se encontró personal ECE asociado a su cuenta.",
          });
        }

        const firmas = await (tx.$queryRaw as (
          q: TemplateStringsArray, ...v: unknown[]
        ) => Promise<Array<FirmaRow & { pin_hash: string }>>)`
          SELECT id, pin_hash, failed_attempts, locked_until, revoked_at
          FROM ece.firma_electronica
          WHERE personal_id = ${personal.id}::uuid
          LIMIT 1
        `;

        const firma = firmas[0];
        if (!firma) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Firma electrónica no configurada. Use firma.setup.",
          });
        }

        // Lanza UNAUTHORIZED si el PIN es incorrecto — aborta antes de procesar cualquier doc.
        await checkPinDir(firma, input.pin);

        return { firmaId: firma.id };
      });

      // Fase 2: certificar cada documento en serie, transacción independiente por doc.
      const exitosos: Array<{ instanciaId: string; payloadHash: string }> = [];
      const fallidos: Array<{ instanciaId: string; error: string }> = [];

      for (const instanciaId of input.instanciaIds) {
        try {
          const resultado = await withWorkflowContext(ctx.prisma, eceCtx, async (tx) => {
            return certificarOneInTx({
              tx,
              instanciaId,
              firmaId: firmaVerificada.firmaId,
              userId: ctx.user.id,
              organizationId: ctx.tenant.organizationId,
            });
          });
          exitosos.push(resultado);
        } catch (err) {
          // Capturar error del documento individual sin abortar el bulk.
          const message =
            err instanceof TRPCError
              ? err.message
              : err instanceof Error
                ? err.message
                : "Error desconocido";
          fallidos.push({ instanciaId, error: message });
        }
      }

      return { exitosos, fallidos };
    }),
});
