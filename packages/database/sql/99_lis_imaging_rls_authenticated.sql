-- =============================================================================
-- HH-08 (audit Stream H PR #193) — RLS de LIS + Imaging deben restringir a
-- rol `authenticated`, no `public`.
--
-- En PostgreSQL, el rol `public` representa a todos los usuarios, incluyendo
-- conexiones no autenticadas. Las 9 policies listadas tenían `TO public`, lo
-- que anula el aislamiento multi-tenant: cualquier conexión con el GUC
-- seteado podía leer/modificar datos LIS/Imaging sin token de sesión válido.
--
-- ALTER POLICY ... TO <role> preserva USING/WITH_CHECK conditions intactas.
-- =============================================================================

ALTER POLICY lab_order_tenant_modify           ON public."LabOrder"        TO authenticated;
ALTER POLICY lab_order_tenant_select           ON public."LabOrder"        TO authenticated;
ALTER POLICY lab_order_item_inherit            ON public."LabOrderItem"    TO authenticated;
ALTER POLICY lab_result_inherit                ON public."LabResult"       TO authenticated;
ALTER POLICY lab_specimen_inherit              ON public."LabSpecimen"     TO authenticated;
ALTER POLICY imaging_order_tenant_modify       ON public."ImagingOrder"    TO authenticated;
ALTER POLICY imaging_order_tenant_select       ON public."ImagingOrder"    TO authenticated;
ALTER POLICY imaging_report_inherit_order      ON public."ImagingReport"   TO authenticated;
ALTER POLICY imaging_modality_inherit_establishment ON public."ImagingModality" TO authenticated;
