/**
 * workflow.tipoDoc — CRUD de ece.tipo_documento (motor de workflow ECE).
 *
 * Tabla manejada: ece.tipo_documento (schema ece, fuera de Prisma).
 * Ver docs/backlog/fase2/_insumos/05_motor_workflow.sql para DDL completo.
 *
 * Roles permitidos: DIR (Dirección, ece.rol seed) o WORKFLOW_DESIGNER
 * (rol HIS en TenantContext.roleCodes).
 *
 * Todas las mutaciones registran en ece.bitacora_acceso (Art. 55-56 NTEC)
 * con tipo_acceso = 'escritura' y componente = 'workflow.tipoDoc'.
 *
 * NOTA: withWorkflowContext proviene de Stream 11 (ece/workflow-context.ts).
 * El import es un forward-dependency; el consolidador lo resuelve al integrar
 * los streams. Hasta entonces el runtime fallará si ese módulo no existe.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@his/database";
import { router, requireRole } from "../trpc";
import { withWorkflowContext } from "../ece/workflow-context";

// ---------------------------------------------------------------------------
// Schemas Zod
// ---------------------------------------------------------------------------

const TIPO_REGISTRO = ["maestro", "transaccional", "historico"] as const;
const MODALIDAD = ["ambulatorio", "hospitalario", "ambos"] as const;

/**
 * Zod enum para tipo_registro, alineado con CHECK constraint de la tabla.
 */
const tipoRegistroEnum = z.enum(TIPO_REGISTRO);

/**
 * Zod enum para modalidad, alineado con CHECK constraint de la tabla.
 */
const modalidadEnum = z.enum(MODALIDAD);

const createInput = z.object({
  /** Código único del tipo de documento (PK semántica). */
  codigo: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z][a-z0-9_]*$/, "Solo minúsculas, dígitos y guión bajo; debe iniciar con letra."),
  nombre: z.string().min(2).max(255),
  /** Nombre de la tabla física ece.<tabla_datos> que guarda el formulario. */
  tablaDatos: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z][a-z0-9_]*$/, "Solo minúsculas, dígitos y guión bajo."),
  tipoRegistro: tipoRegistroEnum,
  modalidad: modalidadEnum,
  /** Códigos de tipos de documento prerequisito (grafo dependencias). */
  dependeDe: z.array(z.string().min(2).max(64)).optional(),
  /** Si true, el documento no admite UPDATE después de su creación. */
  inmutable: z.boolean().optional(),
});

const updateInput = z.object({
  id: z.string().uuid(),
  nombre: z.string().min(2).max(255).optional(),
  tablaDatos: z
    .string()
    .min(2)
    .max(128)
    .regex(/^[a-z][a-z0-9_]*$/)
    .optional(),
  tipoRegistro: tipoRegistroEnum.optional(),
  modalidad: modalidadEnum.optional(),
  dependeDe: z.array(z.string().min(2).max(64)).optional(),
  inmutable: z.boolean().optional(),
});

const idInput = z.object({ id: z.string().uuid() });

const listInput = z.object({
  /** Filtra solo activos cuando es true (default). */
  soloActivos: z.boolean().optional(),
  modalidad: modalidadEnum.optional(),
  tipoRegistro: tipoRegistroEnum.optional(),
});

// ---------------------------------------------------------------------------
// Tipos de fila retornados por las queries raw
// ---------------------------------------------------------------------------

export interface TipoDocRow {
  id: string;
  codigo: string;
  nombre: string;
  tabla_datos: string;
  tipo_registro: string;
  modalidad: string;
  depende_de: string[] | null;
  inmutable: boolean;
  activo: boolean;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

/** Lanza NOT_FOUND si la fila no existe. */
function assertFound<T>(row: T | undefined | null, label: string): T {
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: `${label} no encontrado.` });
  }
  return row;
}

/**
 * Valida que todos los códigos en dependeDe existan en ece.tipo_documento.
 * Lanza BAD_REQUEST con el primer código inválido que encuentre.
 *
 * Usa el tx corriente para que la validación viva dentro de la transacción
 * del withWorkflowContext (consistencia de lectura).
 */
async function assertDependenciasExisten(
  tx: Prisma.TransactionClient,
  codigos: string[],
  selfCodigo?: string,
): Promise<void> {
  if (codigos.length === 0) return;

  for (const codigo of codigos) {
    if (selfCodigo && codigo === selfCodigo) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Un tipo de documento no puede depender de sí mismo (código: ${codigo}).`,
      });
    }

    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM ece.tipo_documento WHERE codigo = ${codigo} AND activo = true LIMIT 1`,
    );

    if (rows.length === 0) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `La dependencia '${codigo}' no existe o está inactiva en ece.tipo_documento.`,
      });
    }
  }
}

/**
 * Registra en ece.bitacora_acceso (fire-and-forget).
 * Los fallos de bitácora no deben bloquear la respuesta al cliente (Art. 53 NTEC
 * prohíbe alterar la bitácora, pero un INSERT fallido por timeout no debe tirar
 * la operación clínica). Por eso se ejecuta con void fuera de la transacción
 * principal cuando sea posible, o dentro cuando la tx ya está abierta.
 *
 * authUserId y establecimientoId provienen del ctx; personalId es opcional hasta
 * que Stream 12 conecte ece.personal_salud con el usuario HIS.
 */
async function logBitacora(
  tx: Prisma.TransactionClient,
  opts: {
    authUserId: string;
    establecimientoId: string | undefined;
    tipoAcceso: string;
    recursoId?: string;
    ipOrigen?: string;
  },
): Promise<void> {
  try {
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO ece.bitacora_acceso
          (auth_user_id, componente, tipo_acceso, autorizado, recurso_id, ip_origen)
        VALUES
          (
            ${opts.authUserId}::uuid,
            'workflow.tipoDoc',
            ${opts.tipoAcceso},
            true,
            ${opts.recursoId ? opts.recursoId + "::uuid" : null}::uuid,
            ${opts.ipOrigen ?? null}::inet
          )
      `,
    );
  } catch {
    // Silenciar: un fallo de bitácora no debe bloquear la operación clínica.
    // El SRE debe alertar sobre gaps de bitácora por otra vía.
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const workflowBase = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowTipoDocRouter = router({
  /**
   * Lista todos los tipos de documento.
   * Filtros opcionales: soloActivos, modalidad, tipoRegistro.
   */
  list: workflowBase.input(listInput).query(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      const soloActivos = input.soloActivos ?? true;

      const rows = await tx.$queryRaw<TipoDocRow[]>(Prisma.sql`
        SELECT
          id::text,
          codigo,
          nombre,
          tabla_datos,
          tipo_registro,
          modalidad,
          depende_de,
          inmutable,
          activo
        FROM ece.tipo_documento
        WHERE
          (${soloActivos} = false OR activo = true)
          AND (${input.modalidad ?? null}::text IS NULL OR modalidad = ${input.modalidad ?? null})
          AND (${input.tipoRegistro ?? null}::text IS NULL OR tipo_registro = ${input.tipoRegistro ?? null})
        ORDER BY nombre ASC
      `);

      return rows;
    });
  }),

  /** Obtiene un tipo de documento por id. */
  get: workflowBase.input(idInput).query(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      const rows = await tx.$queryRaw<TipoDocRow[]>(Prisma.sql`
        SELECT
          id::text,
          codigo,
          nombre,
          tabla_datos,
          tipo_registro,
          modalidad,
          depende_de,
          inmutable,
          activo
        FROM ece.tipo_documento
        WHERE id = ${input.id}::uuid
        LIMIT 1
      `);

      return assertFound(rows[0], "TipoDocumento");
    });
  }),

  /** Crea un nuevo tipo de documento. Valida unicidad de código y dependencias. */
  create: workflowBase.input(createInput).mutation(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      // Validar unicidad de código (el UNIQUE constraint lo haría fallar igual,
      // pero devolvemos un mensaje legible antes de llegar a la BD).
      const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM ece.tipo_documento WHERE codigo = ${input.codigo} LIMIT 1
      `);
      if (existing.length > 0) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Ya existe un tipo de documento con código '${input.codigo}'.`,
        });
      }

      // Validar dependencias
      if (input.dependeDe && input.dependeDe.length > 0) {
        await assertDependenciasExisten(tx, input.dependeDe, input.codigo);
      }

      const rows = await tx.$queryRaw<TipoDocRow[]>(Prisma.sql`
        INSERT INTO ece.tipo_documento
          (codigo, nombre, tabla_datos, tipo_registro, modalidad, depende_de, inmutable)
        VALUES
          (
            ${input.codigo},
            ${input.nombre},
            ${input.tablaDatos},
            ${input.tipoRegistro},
            ${input.modalidad},
            ${input.dependeDe ?? null},
            ${input.inmutable ?? false}
          )
        RETURNING
          id::text,
          codigo,
          nombre,
          tabla_datos,
          tipo_registro,
          modalidad,
          depende_de,
          inmutable,
          activo
      `);

      const created = assertFound(rows[0], "TipoDocumento recién creado");

      await logBitacora(tx, {
        authUserId: ctx.tenant.userId,
        establecimientoId: ctx.tenant.establishmentId,
        tipoAcceso: "escritura",
        recursoId: created.id,
        ipOrigen: ctx.ip,
      });

      return created;
    });
  }),

  /** Actualiza campos del tipo de documento. No modifica el código (PK semántica). */
  update: workflowBase.input(updateInput).mutation(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      // Verificar que existe
      const existRows = await tx.$queryRaw<{ codigo: string }[]>(Prisma.sql`
        SELECT codigo FROM ece.tipo_documento WHERE id = ${input.id}::uuid LIMIT 1
      `);
      const existing = assertFound(existRows[0], "TipoDocumento");

      // Validar dependencias si se actualizan
      if (input.dependeDe && input.dependeDe.length > 0) {
        await assertDependenciasExisten(tx, input.dependeDe, existing.codigo);
      }

      // Construir SET dinámico con Prisma.sql fragments (parametrizados).
      // Prisma.join une fragmentos Prisma.sql con separador, lo que genera
      // un único Sql object con todos los placeholders bien numerados.
      const updates: ReturnType<typeof Prisma.sql>[] = [];
      if (input.nombre !== undefined)
        updates.push(Prisma.sql`nombre = ${input.nombre}`);
      if (input.tablaDatos !== undefined)
        updates.push(Prisma.sql`tabla_datos = ${input.tablaDatos}`);
      if (input.tipoRegistro !== undefined)
        updates.push(Prisma.sql`tipo_registro = ${input.tipoRegistro}`);
      if (input.modalidad !== undefined)
        updates.push(Prisma.sql`modalidad = ${input.modalidad}`);
      if (input.dependeDe !== undefined)
        updates.push(Prisma.sql`depende_de = ${input.dependeDe}`);
      if (input.inmutable !== undefined)
        updates.push(Prisma.sql`inmutable = ${input.inmutable}`);

      if (updates.length === 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "No se proveyó ningún campo para actualizar." });
      }

      const setFragment = Prisma.join(updates, ", ");

      const rows = await tx.$queryRaw<TipoDocRow[]>(
        Prisma.sql`
          UPDATE ece.tipo_documento
          SET ${setFragment}
          WHERE id = ${input.id}::uuid
          RETURNING
            id::text,
            codigo,
            nombre,
            tabla_datos,
            tipo_registro,
            modalidad,
            depende_de,
            inmutable,
            activo
        `,
      );

      const updated = assertFound(rows[0], "TipoDocumento");

      await logBitacora(tx, {
        authUserId: ctx.tenant.userId,
        establecimientoId: ctx.tenant.establishmentId,
        tipoAcceso: "escritura",
        recursoId: updated.id,
        ipOrigen: ctx.ip,
      });

      return updated;
    });
  }),

  /**
   * Desactiva un tipo de documento (soft-delete: activo = false).
   * No elimina físicamente para preservar referencias desde flujo_estado,
   * flujo_transicion y documento_instancia.
   */
  deactivate: workflowBase.input(idInput).mutation(async ({ ctx, input }) => {
    return withWorkflowContext(ctx.prisma, ctx.tenant.establishmentId, async (tx) => {
      const existRows = await tx.$queryRaw<{ activo: boolean }[]>(Prisma.sql`
        SELECT activo FROM ece.tipo_documento WHERE id = ${input.id}::uuid LIMIT 1
      `);
      const existing = assertFound(existRows[0], "TipoDocumento");

      if (!existing.activo) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "El tipo de documento ya está inactivo.",
        });
      }

      const rows = await tx.$queryRaw<TipoDocRow[]>(Prisma.sql`
        UPDATE ece.tipo_documento
        SET activo = false
        WHERE id = ${input.id}::uuid
        RETURNING
          id::text,
          codigo,
          nombre,
          tabla_datos,
          tipo_registro,
          modalidad,
          depende_de,
          inmutable,
          activo
      `);

      const deactivated = assertFound(rows[0], "TipoDocumento");

      await logBitacora(tx, {
        authUserId: ctx.tenant.userId,
        establecimientoId: ctx.tenant.establishmentId,
        tipoAcceso: "escritura",
        recursoId: deactivated.id,
        ipOrigen: ctx.ip,
      });

      return deactivated;
    });
  }),
});
