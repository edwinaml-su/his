/**
 * workflow-validator-visual — US.F2.2.05
 *
 * Endpoint tRPC que valida el grafo en memoria desde el cliente.
 * Carga los roles válidos del catálogo y ejecuta validateGraphVisual.
 *
 * Se invoca con debounce 300ms desde el hook useWorkflowValidator del editor.
 * El resultado incluye el mapa de nodos/aristas afectados para renderizado.
 */
import { z } from "zod";
import { Prisma } from "@his/database";
import { router, tenantProcedure } from "../trpc";
import { validateGraphVisual } from "../lib/workflow-visual-validator";

const GraphNodeSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  es_inicial: z.boolean(),
  es_final: z.boolean(),
});

const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  accion: z.string(),
  rolCodigo: z.string().optional(),
});

export const workflowValidatorVisualRouter = router({
  /**
   * Valida el grafo actual en memoria.
   *
   * El cliente pasa el estado del grafo + los códigos de rol referenciados.
   * El servidor resuelve qué roles existen en catálogo y ejecuta la validación.
   *
   * Retorna: issues, nodeIssueMap (serializado), edgeIssueMap (serializado).
   */
  validateGraph: tenantProcedure
    .input(
      z.object({
        nodes: z.array(GraphNodeSchema),
        edges: z.array(GraphEdgeSchema),
        /** Si true, valida roles contra catálogo BD (llama DB). Si false, omite esa check. */
        checkRoles: z.boolean().default(true),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { nodes, edges, checkRoles } = input;

      let validRoleCodes: Set<string> | null = null;

      if (checkRoles) {
        const referencedRoles = [
          ...new Set(
            edges.map((e) => e.rolCodigo).filter((r): r is string => !!r),
          ),
        ];

        if (referencedRoles.length > 0) {
          const existentes = await ctx.prisma.$queryRaw<Array<{ codigo: string }>>(
            Prisma.sql`SELECT codigo FROM public."Role" WHERE codigo = ANY(${referencedRoles})`,
          );
          validRoleCodes = new Set(existentes.map((r) => r.codigo));
        } else {
          validRoleCodes = new Set();
        }
      }

      const result = validateGraphVisual({ nodes, edges, validRoleCodes });

      // Map no es serializable por superjson directamente — convertir a array
      return {
        valid: result.valid,
        issues: result.issues,
        nodeIssueMap: [...result.nodeIssueMap.entries()],
        edgeIssueMap: [...result.edgeIssueMap.entries()],
      };
    }),
});
