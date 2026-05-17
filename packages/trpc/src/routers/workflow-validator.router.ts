/**
 * Router de validación de integridad de workflows ECE.
 *
 * Expone `validate(tipDocumentoId)` que carga el estado del workflow desde BD
 * y delega a la función pura `validateWorkflow`.
 *
 * Requiere rol DIR o WORKFLOW_DESIGNER.
 */
import { z } from "zod";
import { router, requireRole } from "../trpc";
import {
  validateWorkflow,
  type EstadoInput,
  type TransicionInput,
  type DocumentoRolInput,
} from "../lib/workflow-validator";

const workflowProc = requireRole(["DIR", "WORKFLOW_DESIGNER"]);

export const workflowValidatorRouter = router({
  /**
   * Valida la coherencia estructural de un workflow completo.
   *
   * Carga estados, transiciones y roles desde BD y ejecuta las 9 reglas.
   * Retorna `{ valid, errors }` donde `errors` incluye tanto errores como warnings.
   */
  validate: workflowProc
    .input(z.object({ tipDocumentoId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const { tipDocumentoId } = input;

      const [estados, transiciones, roles] = await Promise.all([
        ctx.prisma.$queryRaw<EstadoInput[]>`
          SELECT id::text, nombre, es_inicial, es_final
            FROM ece.flujo_estado
           WHERE tipo_documento_id = ${tipDocumentoId}::uuid
        `,
        ctx.prisma.$queryRaw<TransicionInput[]>`
          SELECT id::text, estado_origen_id::text, estado_destino_id::text, accion
            FROM ece.flujo_transicion
           WHERE tipo_documento_id = ${tipDocumentoId}::uuid
        `,
        ctx.prisma.$queryRaw<DocumentoRolInput[]>`
          SELECT id::text
            FROM ece.documento_rol
           WHERE tipo_documento_id = ${tipDocumentoId}::uuid
        `,
      ]);

      return validateWorkflow({ estados, transiciones, roles });
    }),
});
