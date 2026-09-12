-- Bootstrap E2E — función dual-GUC extraída de sql/209 (CC-0026).
--
-- La BD efímera de CI nace de `prisma db push` (sin funciones) y el workflow
-- aplica solo un subconjunto de sql/. Las RLS/paths que resuelven organización
-- desde cualquiera de los dos espacios de GUC (withTenantContext o
-- withEceContext) llaman a public.current_org_id_or_ece_context() — sin ella,
-- reserveItem (dispensación) muere con 42883 en el stack E2E.
--
-- Copia LITERAL de sql/209_cc0026_care_task.sql:163-192 (si cambia allá,
-- cambiar acá). Depende de public.current_org_id() (04_rls_session_helpers)
-- y ece.current_establecimiento_id_safe() (62b_ece_context_helpers), ambas
-- aplicadas antes en el workflow.
-- Dependencia: helper del GUC ece (copia literal de sql/65:34-40 — la BD
-- efímera no aplica el 65 completo y las funciones LANGUAGE sql validan su
-- cuerpo al crearse).
CREATE OR REPLACE FUNCTION ece.current_establecimiento_id_safe()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.ece_establecimiento_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION public.current_org_id_or_ece_context()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, ece, pg_catalog
AS $$
  SELECT coalesce(
    public.current_org_id(),
    (
      SELECT e."organizationId"
      FROM ece.establecimiento est
      JOIN public."Establishment" e ON e.id = est.establishment_id
      WHERE est.id = ece.current_establecimiento_id_safe()
    )
  );
$$;

REVOKE ALL ON FUNCTION public.current_org_id_or_ece_context() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_org_id_or_ece_context() TO authenticated;
