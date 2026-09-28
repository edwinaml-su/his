/**
 * Router tRPC: clasificadores clínicos N:M de medicamentos.
 *
 * Guía GS1 El Salvador Nivel 1 (tbl_Mapeo_Clinico_Estandar): un medicamento
 * puede mapearse simultáneamente a múltiples vocabularios controlados
 * (ATC, SNOMED CT, UNSPSC, RxNorm, ...). Drug.atcCode (1:1) se conserva.
 *
 * Seguridad: lectura tenantProcedure; escritura requireRole(["ADMIN","PHARM"]).
 * DrugClassifier es catálogo de referencia clínica (acceso directo ctx.prisma).
 *
 * R02 (auditoria RLS externa, 2026-09-27) - decision (b), NO usa
 * withTenantContext. "DrugClassifier" es una tabla puente sin columna
 * organizationId (mapea Drug -> vocabularios externos ATC/SNOMED/UNSPSC/
 * RxNorm, catalogo de referencia clinica compartido). Verificado en prod
 * (read-only): su unica policy es drug_classifier_select (SELECT, qual=true)
 * - NO existe policy de INSERT/DELETE para `authenticated`, asi que `add`/
 * `remove` requieren el rol BYPASSRLS para funcionar.
 * NOTA (fuera de este alcance, no se corrige aqui): `add`/`remove` no
 * verifican que `drugId` pertenezca a un Drug de la organizacion del caller
 * (ni a un Drug global, organizationId IS NULL) - un ADMIN/PHARM de una org
 * podria clasificar un Drug de otra org si conoce su UUID. Es un gap de
 * autorizacion a nivel app (IDOR), no de RLS/tenant-context - ver
 * decisions_needed.
 */
import { z } from "zod";
import { router, tenantProcedure, requireRole } from "../trpc";

const standardEnum = z.enum(["ATC", "SNOMED", "UNSPSC", "RXNORM", "CIE10", "LOINC"]);

export const drugClassifierRouter = router({
  list: tenantProcedure
    .input(z.object({ drugId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.drugClassifier.findMany({
        where: { drugId: input.drugId },
        orderBy: [{ standard: "asc" }, { value: "asc" }],
      });
    }),

  add: requireRole(["ADMIN", "PHARM"])
    .input(
      z.object({
        drugId: z.string().uuid(),
        standard: standardEnum,
        value: z.string().trim().min(1).max(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.drugClassifier.create({
        data: { drugId: input.drugId, standard: input.standard, value: input.value },
      });
    }),

  remove: requireRole(["ADMIN", "PHARM"])
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.drugClassifier.delete({ where: { id: input.id } });
      return { ok: true as const };
    }),
});
