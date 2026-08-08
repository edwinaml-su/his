-- ============================================================================
-- 194_cc0017_rbac_parametrizable.sql
-- CC-0017 Fase 1 — Motor de autorización RBAC PARAMETRIZABLE y RETROCOMPATIBLE.
--
-- Hallazgo de auditoría: `requireRole([...])` (packages/trpc/src/trpc.ts) compara
-- `ctx.tenant.roleCodes` contra arrays LITERALES en código (376 call sites / 99
-- routers / 45 códigos de rol). La tabla `RolePermission` (pantalla /roles, CRUD
-- real vía rbac.router.ts) NUNCA se lee en enforcement — cambiar permisos en
-- /roles no altera nada. Los códigos del seed (PHYSICIAN/NURSE/PHARMACIST) NO
-- coinciden con muchos literales (MEDICO/ENF/FARM/MC/MT/RAD/QX...).
--
-- Diseño FAIL-SAFE (ver packages/trpc/src/rbac/effective-roles.ts):
--   - Herencia de roles 1:1 (`Role.inheritsFromRoleId`) — un rol nuevo puede
--     heredar los accesos efectivos de un rol existente sin tocar los 376
--     call sites de `requireRole`.
--   - `RoleCodeAlias` — mapea variantes de código (MEDICO→PHYSICIAN, etc.) al
--     código canónico usado por los literales `requireRole`.
--   - `RolePermission` se siembra como ESPEJO del estado actual (derivado de
--     los literales `requireRole` reales, no inventado) — preparación para
--     `requirePermission()`, NO cambia el enforcement de `requireRole` por sí
--     mismo.
--
-- Esta migración SOLO escribe schema + datos de preparación. El motor en
-- trpc.ts hace fallback silencioso a `roleCodes` sin cambios si estas tablas
-- están vacías o no existen las filas esperadas — por diseño, un ambiente que
-- NO aplique este SQL sigue funcionando exactamente igual que hoy.
--
-- Idempotente: seguro de re-ejecutar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Herencia de roles — Role.inheritsFromRoleId (1:1)
--
-- Decisión: 1:1 en vez de N:M (tabla RoleInheritance). Justificación: el caso
-- de uso es "rol nuevo = clon de un rol existente + extras" (un admin crea
-- p.ej. "MEDICO_RESIDENTE_JR" heredando de "PHYSICIAN"). Herencia múltiple
-- (N:M) introduciría ambigüedad de resolución de conflictos DENY/ALLOW entre
-- padres sin caso de uso real que lo justifique hoy. Si F2 requiere N:M, se
-- puede migrar sin romper: `inheritsFromRoleId` pasaría a ser la primera fila
-- de una tabla puente nueva.
-- ---------------------------------------------------------------------------

ALTER TABLE public."Role"
  ADD COLUMN IF NOT EXISTS "inheritsFromRoleId" UUID NULL
    REFERENCES public."Role"(id) ON DELETE SET NULL;

-- Guard DB-level anti auto-herencia (defensa en profundidad; el router valida
-- también en aplicación — ver rbac.router.ts `setRoleInheritance`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'role_no_self_inherit' AND table_name = 'Role'
  ) THEN
    ALTER TABLE public."Role"
      ADD CONSTRAINT role_no_self_inherit
      CHECK ("inheritsFromRoleId" IS DISTINCT FROM id);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_role_inherits_from
  ON public."Role"("inheritsFromRoleId");

-- ---------------------------------------------------------------------------
-- 2. RoleCodeAlias — mapea códigos de rol equivalentes al código canónico.
--
-- organizationId NULL = alias global (aplica a cualquier tenant). Los 6 alias
-- sembrados abajo son GLOBALES porque son drift de nomenclatura del código
-- (Spanish shorthand vs English) confirmado por evidencia directa en el
-- código fuente (ver docs/CC/0017/REQ-SEC-RBAC-001-rbac-parametrizable.md
-- §Mapeo de aliases).
--
-- NULL no es único en un UNIQUE compuesto estándar de Postgres (dos filas con
-- organizationId=NULL y mismo sourceCode NO chocan bajo `UNIQUE(a,b)`) — se
-- usan dos índices únicos parciales en vez de un `@@unique` compuesto.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."RoleCodeAlias" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" UUID NULL, -- NULL = alias global. Sin FK dura a Organization,
                               -- igual que Role.organizationId (mismo patrón
                               -- pre-existente en este schema).
  "sourceCode"    VARCHAR(60) NOT NULL,
  "canonicalCode" VARCHAR(60) NOT NULL,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT role_code_alias_no_self CHECK ("sourceCode" <> "canonicalCode")
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_code_alias_org_source
  ON public."RoleCodeAlias" ("organizationId", "sourceCode")
  WHERE "organizationId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_role_code_alias_global_source
  ON public."RoleCodeAlias" ("sourceCode")
  WHERE "organizationId" IS NULL;

CREATE INDEX IF NOT EXISTS idx_role_code_alias_org
  ON public."RoleCodeAlias"("organizationId");

ALTER TABLE public."RoleCodeAlias" ENABLE ROW LEVEL SECURITY;

-- Lectura: filas de la org activa + globales. Igual patrón que Role (global +
-- org-scoped visible). El motor de autorización en trpc.ts consulta esta
-- tabla con el rol `authenticated` sólo cuando el caller pasa por
-- `withTenantContext`; el resto de RBAC (rbac.router.ts) usa `ctx.prisma`
-- directo hoy (patrón preexistente, no introducido por esta migración — ver
-- doc de hallazgos).
DROP POLICY IF EXISTS "RoleCodeAlias: read" ON public."RoleCodeAlias";
CREATE POLICY "RoleCodeAlias: read" ON public."RoleCodeAlias"
  FOR SELECT TO authenticated
  USING (
    "organizationId" = (current_setting('app.current_org_id', true))::uuid
    OR "organizationId" IS NULL
  );

-- Escritura: sólo filas de la org activa. Alias GLOBALES (organizationId
-- NULL) sólo administrables por super_admin — ese check vive en aplicación
-- (rbac.router.ts), igual que Role global (createRole/updateRole ya siguen
-- ese patrón). RLS aquí cubre el caso org-scoped.
DROP POLICY IF EXISTS "RoleCodeAlias: write_org" ON public."RoleCodeAlias";
CREATE POLICY "RoleCodeAlias: write_org" ON public."RoleCodeAlias"
  FOR ALL TO authenticated
  USING ("organizationId" = (current_setting('app.current_org_id', true))::uuid)
  WITH CHECK ("organizationId" = (current_setting('app.current_org_id', true))::uuid);

-- ---------------------------------------------------------------------------
-- 3. Seed de aliases RESUELTOS (evidencia directa en código — ver doc REQ-SEC
--    §Mapeo de aliases para la cita exacta de cada uno). Ambiguos (MT, PHARM,
--    ADM, ADMIN_CLINICO, ADMIN_ORG, DIR_MEDICO) quedan SIN alias — pendientes,
--    documentados, NO inventados.
-- ---------------------------------------------------------------------------

INSERT INTO public."RoleCodeAlias" ("organizationId", "sourceCode", "canonicalCode")
VALUES
  (NULL, 'MEDICO', 'PHYSICIAN'),
  (NULL, 'MC', 'PHYSICIAN'),
  (NULL, 'ENF', 'NURSE'),
  (NULL, 'FARM', 'PHARMACIST'),
  (NULL, 'ANES', 'ANEST'),
  (NULL, 'SUPER_ADMIN', 'super_admin')
ON CONFLICT ("sourceCode") WHERE "organizationId" IS NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. Catálogo COMPLETO de Permission.
--
-- Criterio: `resource` = dominio del router (nombre de archivo sin
-- `.router.ts`; prefijo `ece.` para packages/trpc/src/routers/ece/*).
-- `action` = clasificado por proximidad de `.query(`/`.mutation(` tras cada
-- `requireRole([...])` (read/write), o `access` cuando no se pudo clasificar
-- con certeza (helper de procedure reusado por varios endpoints mixtos). NO
-- es 1 permiso por procedure — se agrupa por recurso.acción lógica (182
-- permisos cubriendo 95 dominios de router + los 26 originales del seed MVP
-- + 2 finos para las pruebas de concepto de `requirePermission`:
-- accounting.post, rbac.manage).
--
-- Derivado programáticamente de un barrido de los 375 call sites reales de
-- `requireRole([...])` (excluyendo tests) — ver metodología en el doc REQ-SEC.
-- ---------------------------------------------------------------------------

INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('accounting.access', 'accounting', 'access'),
  ('accounting.post', 'accounting', 'post'),
  ('accounting.read', 'accounting', 'read'),
  ('accounting.write', 'accounting', 'write'),
  ('allocation-rule.read', 'allocation-rule', 'read'),
  ('audit-outlier.read', 'audit-outlier', 'read'),
  ('audit-outlier.write', 'audit-outlier', 'write'),
  ('audit.read', 'audit', 'read'),
  ('bed.read', 'bed', 'read'),
  ('bed.update', 'bed', 'update'),
  ('bedside-stat.read', 'bedside-stat', 'read'),
  ('bedside-stat.write', 'bedside-stat', 'write'),
  ('calculadoras.access', 'calculadoras', 'access'),
  ('cart.access', 'cart', 'access'),
  ('cart.write', 'cart', 'write'),
  ('catalog.read', 'catalog', 'read'),
  ('catalog.write', 'catalog', 'write'),
  ('chat-analytics.access', 'chat-analytics', 'access'),
  ('chat-analytics.read', 'chat-analytics', 'read'),
  ('cold-chain.access', 'cold-chain', 'access'),
  ('country.access', 'country', 'access'),
  ('death-certificate.write', 'death-certificate', 'write'),
  ('drug-classifier.access', 'drug-classifier', 'access'),
  ('drug-classifier.write', 'drug-classifier', 'write'),
  ('ece-bridge-patient.access', 'ece-bridge-patient', 'access'),
  ('ece-rectificacion.read', 'ece-rectificacion', 'read'),
  ('ece-rectificacion.write', 'ece-rectificacion', 'write'),
  ('ece.acto-quirurgico.access', 'ece.acto-quirurgico', 'access'),
  ('ece.atencion-emergencia.read', 'ece.atencion-emergencia', 'read'),
  ('ece.atencion-emergencia.write', 'ece.atencion-emergencia', 'write'),
  ('ece.atencion-rn.access', 'ece.atencion-rn', 'access'),
  ('ece.atencion-rn.read', 'ece.atencion-rn', 'read'),
  ('ece.bitacora.access', 'ece.bitacora', 'access'),
  ('ece.bitacora.read', 'ece.bitacora', 'read'),
  ('ece.bridge-admision.access', 'ece.bridge-admision', 'access'),
  ('ece.bridge-admision.write', 'ece.bridge-admision', 'write'),
  ('ece.bridge-cirugia.access', 'ece.bridge-cirugia', 'access'),
  ('ece.bridge-cirugia.write', 'ece.bridge-cirugia', 'write'),
  ('ece.bridge-encounter.access', 'ece.bridge-encounter', 'access'),
  ('ece.bridge-encounter.write', 'ece.bridge-encounter', 'write'),
  ('ece.bridge-triage.access', 'ece.bridge-triage', 'access'),
  ('ece.bridge-triage.write', 'ece.bridge-triage', 'write'),
  ('ece.cama.read', 'ece.cama', 'read'),
  ('ece.certificacion.access', 'ece.certificacion', 'access'),
  ('ece.certificado-defuncion.access', 'ece.certificado-defuncion', 'access'),
  ('ece.certificado-incapacidad.read', 'ece.certificado-incapacidad', 'read'),
  ('ece.comite-ece.access', 'ece.comite-ece', 'access'),
  ('ece.comite-ece.read', 'ece.comite-ece', 'read'),
  ('ece.comite-ece.write', 'ece.comite-ece', 'write'),
  ('ece.consentimiento.access', 'ece.consentimiento', 'access'),
  ('ece.contingencia.access', 'ece.contingencia', 'access'),
  ('ece.contingencia.read', 'ece.contingencia', 'read'),
  ('ece.contingencia.write', 'ece.contingencia', 'write'),
  ('ece.critical-result.access', 'ece.critical-result', 'access'),
  ('ece.documento-asociado.access', 'ece.documento-asociado', 'access'),
  ('ece.documento-asociado.read', 'ece.documento-asociado', 'read'),
  ('ece.documento-asociado.write', 'ece.documento-asociado', 'write'),
  ('ece.epicrisis.access', 'ece.epicrisis', 'access'),
  ('ece.epicrisis.read', 'ece.epicrisis', 'read'),
  ('ece.epicrisis.write', 'ece.epicrisis', 'write'),
  ('ece.episodio-hospitalario.access', 'ece.episodio-hospitalario', 'access'),
  ('ece.episodio-hospitalario.read', 'ece.episodio-hospitalario', 'read'),
  ('ece.episodio.access', 'ece.episodio', 'access'),
  ('ece.episodio.read', 'ece.episodio', 'read'),
  ('ece.fall-event.access', 'ece.fall-event', 'access'),
  ('ece.fall-event.write', 'ece.fall-event', 'write'),
  ('ece.historia-clinica.access', 'ece.historia-clinica', 'access'),
  ('ece.hoja-ingreso.access', 'ece.hoja-ingreso', 'access'),
  ('ece.hoja-ingreso.read', 'ece.hoja-ingreso', 'read'),
  ('ece.icd10.access', 'ece.icd10', 'access'),
  ('ece.icd10.read', 'ece.icd10', 'read'),
  ('ece.icd10.write', 'ece.icd10', 'write'),
  ('ece.indicaciones-medicas.access', 'ece.indicaciones-medicas', 'access'),
  ('ece.indicaciones-medicas.read', 'ece.indicaciones-medicas', 'read'),
  ('ece.obstetricia.access', 'ece.obstetricia', 'access'),
  ('ece.orden-ingreso.access', 'ece.orden-ingreso', 'access'),
  ('ece.orden-ingreso.read', 'ece.orden-ingreso', 'read'),
  ('ece.partograma.access', 'ece.partograma', 'access'),
  ('ece.partograma.read', 'ece.partograma', 'read'),
  ('ece.partograma.write', 'ece.partograma', 'write'),
  ('ece.periodo-expulsivo.read', 'ece.periodo-expulsivo', 'read'),
  ('ece.preop-checklist.access', 'ece.preop-checklist', 'access'),
  ('ece.reanimacion-neonatal.access', 'ece.reanimacion-neonatal', 'access'),
  ('ece.reanimacion-neonatal.read', 'ece.reanimacion-neonatal', 'read'),
  ('ece.registro-anestesico.read', 'ece.registro-anestesico', 'read'),
  ('ece.registro-enfermeria.read', 'ece.registro-enfermeria', 'read'),
  ('ece.resultado-estudio.access', 'ece.resultado-estudio', 'access'),
  ('ece.resultado-estudio.read', 'ece.resultado-estudio', 'read'),
  ('ece.retencion.access', 'ece.retencion', 'access'),
  ('ece.retencion.read', 'ece.retencion', 'read'),
  ('ece.retencion.write', 'ece.retencion', 'write'),
  ('ece.rri.access', 'ece.rri', 'access'),
  ('ece.rri.read', 'ece.rri', 'read'),
  ('ece.sala-expulsion.read', 'ece.sala-expulsion', 'read'),
  ('ece.signos-vitales.access', 'ece.signos-vitales', 'access'),
  ('ece.solicitud-estudio.access', 'ece.solicitud-estudio', 'access'),
  ('ece.solicitud-estudio.read', 'ece.solicitud-estudio', 'read'),
  ('ece.solicitud-estudio.write', 'ece.solicitud-estudio', 'write'),
  ('ece.triaje-ece.access', 'ece.triaje-ece', 'access'),
  ('ece.triaje-ece.read', 'ece.triaje-ece', 'read'),
  ('ece.urpa-recovery.access', 'ece.urpa-recovery', 'access'),
  ('ece.valoracion-inicial-enfermeria.access', 'ece.valoracion-inicial-enfermeria', 'access'),
  ('ece.valoracion-inicial-enfermeria.read', 'ece.valoracion-inicial-enfermeria', 'read'),
  ('ece.verbal-order.access', 'ece.verbal-order', 'access'),
  ('ece.who-checklist.read', 'ece.who-checklist', 'read'),
  ('ece.who-checklist.write', 'ece.who-checklist', 'write'),
  ('ehr.diagnosis.author', 'ehr', 'diagnosis.author'),
  ('ehr.note.author', 'ehr', 'note.author'),
  ('encounter.admit', 'encounter', 'admit'),
  ('encounter.discharge', 'encounter', 'discharge'),
  ('encounter.read', 'encounter', 'read'),
  ('encounter.transfer', 'encounter', 'transfer'),
  ('epcis-query.access', 'epcis-query', 'access'),
  ('epcis-query.read', 'epcis-query', 'read'),
  ('evolucion-medica.access', 'evolucion-medica', 'access'),
  ('evolucion-medica.read', 'evolucion-medica', 'read'),
  ('farmacovigilancia.read', 'farmacovigilancia', 'read'),
  ('farmacovigilancia.write', 'farmacovigilancia', 'write'),
  ('gs1-catalogos.access', 'gs1-catalogos', 'access'),
  ('gs1-catalogos.write', 'gs1-catalogos', 'write'),
  ('gs1-gln-hierarchy.access', 'gs1-gln-hierarchy', 'access'),
  ('gs1-gln-hierarchy.write', 'gs1-gln-hierarchy', 'write'),
  ('gs1-lote-trace.access', 'gs1-lote-trace', 'access'),
  ('gs1-lote-trace.read', 'gs1-lote-trace', 'read'),
  ('gs1-lote-trace.write', 'gs1-lote-trace', 'write'),
  ('gs1-medication.access', 'gs1-medication', 'access'),
  ('gs1-medication.write', 'gs1-medication', 'write'),
  ('gs1-proceso-b.write', 'gs1-proceso-b', 'write'),
  ('gs1-proceso-c.write', 'gs1-proceso-c', 'write'),
  ('gs1-proceso-f.write', 'gs1-proceso-f', 'write'),
  ('inventory.write', 'inventory', 'write'),
  ('invoice.read', 'invoice', 'read'),
  ('lis.access', 'lis', 'access'),
  ('lis.order.create', 'lis', 'order.create'),
  ('lis.result.enter', 'lis', 'result.enter'),
  ('lis.result.validate', 'lis', 'result.validate'),
  ('lis.specimen.collect', 'lis', 'specimen.collect'),
  ('operating-cost.access', 'operating-cost', 'access'),
  ('org.manage', 'organization', 'manage'),
  ('pathology.write', 'pathology', 'write'),
  ('patient-dedup.read', 'patient-dedup', 'read'),
  ('patient-dedup.write', 'patient-dedup', 'write'),
  ('patient-identification.read', 'patient-identification', 'read'),
  ('patient-identification.write', 'patient-identification', 'write'),
  ('patient.create', 'patient', 'create'),
  ('patient.delete', 'patient', 'delete'),
  ('patient.read', 'patient', 'read'),
  ('patient.update', 'patient', 'update'),
  ('patient.write', 'patient', 'write'),
  ('personal-salud.access', 'personal-salud', 'access'),
  ('personal-salud.write', 'personal-salud', 'write'),
  ('pharmacy-dispensation.write', 'pharmacy-dispensation', 'write'),
  ('pharmacy.dispense', 'pharmacy', 'dispense'),
  ('pharmacy.drug.manage', 'pharmacy', 'drug.manage'),
  ('pharmacy.prescribe', 'pharmacy', 'prescribe'),
  ('portal-arco.read', 'portal-arco', 'read'),
  ('portal-arco.write', 'portal-arco', 'write'),
  ('rbac.manage', 'rbac', 'manage'),
  ('rbac.read', 'rbac', 'read'),
  ('rbac.write', 'rbac', 'write'),
  ('service-price-list.access', 'service-price-list', 'access'),
  ('srs-registro.access', 'srs-registro', 'access'),
  ('staff-gsrn.access', 'staff-gsrn', 'access'),
  ('staff-gsrn.read', 'staff-gsrn', 'read'),
  ('staff-gsrn.write', 'staff-gsrn', 'write'),
  ('substitution.read', 'substitution', 'read'),
  ('substitution.write', 'substitution', 'write'),
  ('tipo-cuenta.read', 'tipo-cuenta', 'read'),
  ('triage.create', 'triage', 'create'),
  ('triage.read', 'triage', 'read'),
  ('user-admin.write', 'user-admin', 'write'),
  ('user.manage', 'user', 'manage'),
  ('workflow-estado.read', 'workflow-estado', 'read'),
  ('workflow-instance.access', 'workflow-instance', 'access'),
  ('workflow-plantilla.read', 'workflow-plantilla', 'read'),
  ('workflow-publicacion.access', 'workflow-publicacion', 'access'),
  ('workflow-rol.read', 'workflow-rol', 'read'),
  ('workflow-simulacion.read', 'workflow-simulacion', 'read'),
  ('workflow-tipoDoc-override.read', 'workflow-tipoDoc-override', 'read'),
  ('workflow-tipoDoc.read', 'workflow-tipoDoc', 'read'),
  ('workflow-transicion.read', 'workflow-transicion', 'read'),
  ('workflow-validator.read', 'workflow-validator', 'read')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. RolePermission — ESPEJO del estado actual (derivado de requireRole).
--
-- CRÍTICO: esta INSERT NO cambia el enforcement de `requireRole` (que sigue
-- comparando arrays literales). Es preparación de datos para
-- `requirePermission()` — sólo los 3 procedures de prueba de concepto migrados
-- en esta fase (accounting.journalEntry.post, rbac.purgeInactiveUsers,
-- userAdmin.resetPassword) leen esta tabla en runtime.
--
-- Aplica vía JOIN por código (no UUIDs hardcoded) — cubre TODAS las orgs cuyo
-- `Role.code` matchea, más los roles globales. Idempotente vía
-- ON CONFLICT (roleId, permissionId) DO UPDATE — re-ejecutar esta migración
-- nunca duplica ni deja el effect desactualizado.
-- ---------------------------------------------------------------------------

INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ACCOUNTANT', 'accounting.access'),
  ('ACCOUNTANT', 'accounting.read'),
  ('ACCOUNTANT', 'accounting.write'),
  ('ACCOUNTANT', 'allocation-rule.read'),
  ('ACCOUNTANT', 'invoice.read'),
  ('ACCOUNTANT', 'operating-cost.access'),
  ('ACCOUNTANT', 'service-price-list.access'),
  ('ACCOUNTANT', 'tipo-cuenta.read'),
  ('ACCOUNTANT_SENIOR', 'accounting.access'),
  ('ACCOUNTANT_SENIOR', 'accounting.read'),
  ('ACCOUNTANT_SENIOR', 'accounting.write'),
  ('ADMIN', 'accounting.read'),
  ('ADMIN', 'accounting.write'),
  ('ADMIN', 'allocation-rule.read'),
  ('ADMIN', 'calculadoras.access'),
  ('ADMIN', 'cart.access'),
  ('ADMIN', 'cart.write'),
  ('ADMIN', 'chat-analytics.access'),
  ('ADMIN', 'chat-analytics.read'),
  ('ADMIN', 'death-certificate.write'),
  ('ADMIN', 'drug-classifier.access'),
  ('ADMIN', 'drug-classifier.write'),
  ('ADMIN', 'ece.atencion-emergencia.read'),
  ('ADMIN', 'ece.atencion-emergencia.write'),
  ('ADMIN', 'ece.cama.read'),
  ('ADMIN', 'ece.certificado-incapacidad.read'),
  ('ADMIN', 'ece.comite-ece.access'),
  ('ADMIN', 'ece.comite-ece.read'),
  ('ADMIN', 'ece.comite-ece.write'),
  ('ADMIN', 'ece.critical-result.access'),
  ('ADMIN', 'ece.documento-asociado.access'),
  ('ADMIN', 'ece.documento-asociado.write'),
  ('ADMIN', 'ece.epicrisis.read'),
  ('ADMIN', 'ece.icd10.access'),
  ('ADMIN', 'ece.icd10.read'),
  ('ADMIN', 'ece.icd10.write'),
  ('ADMIN', 'ece.orden-ingreso.access'),
  ('ADMIN', 'ece.reanimacion-neonatal.access'),
  ('ADMIN', 'epcis-query.access'),
  ('ADMIN', 'epcis-query.read'),
  ('ADMIN', 'farmacovigilancia.read'),
  ('ADMIN', 'farmacovigilancia.write'),
  ('ADMIN', 'gs1-catalogos.access'),
  ('ADMIN', 'gs1-catalogos.write'),
  ('ADMIN', 'gs1-gln-hierarchy.access'),
  ('ADMIN', 'gs1-gln-hierarchy.write'),
  ('ADMIN', 'gs1-lote-trace.access'),
  ('ADMIN', 'gs1-lote-trace.read'),
  ('ADMIN', 'gs1-lote-trace.write'),
  ('ADMIN', 'gs1-medication.access'),
  ('ADMIN', 'gs1-medication.write'),
  ('ADMIN', 'gs1-proceso-f.write'),
  ('ADMIN', 'inventory.write'),
  ('ADMIN', 'invoice.read'),
  ('ADMIN', 'lis.access'),
  ('ADMIN', 'operating-cost.access'),
  ('ADMIN', 'patient-dedup.read'),
  ('ADMIN', 'patient-dedup.write'),
  ('ADMIN', 'patient-identification.read'),
  ('ADMIN', 'patient-identification.write'),
  ('ADMIN', 'personal-salud.access'),
  ('ADMIN', 'personal-salud.write'),
  ('ADMIN', 'pharmacy-dispensation.write'),
  ('ADMIN', 'portal-arco.read'),
  ('ADMIN', 'portal-arco.write'),
  ('ADMIN', 'service-price-list.access'),
  ('ADMIN', 'srs-registro.access'),
  ('ADMIN', 'staff-gsrn.access'),
  ('ADMIN', 'staff-gsrn.read'),
  ('ADMIN', 'staff-gsrn.write'),
  ('ADMIN', 'substitution.read'),
  ('ADMIN', 'substitution.write'),
  ('ADMIN', 'tipo-cuenta.read'),
  ('ADMIN', 'user-admin.write'),
  ('DIR', 'audit-outlier.read'),
  ('DIR', 'audit-outlier.write'),
  ('DIR', 'bedside-stat.read'),
  ('DIR', 'calculadoras.access'),
  ('DIR', 'chat-analytics.access'),
  ('DIR', 'chat-analytics.read'),
  ('DIR', 'cold-chain.access'),
  ('DIR', 'ece-bridge-patient.access'),
  ('DIR', 'ece-rectificacion.read'),
  ('DIR', 'ece.acto-quirurgico.access'),
  ('DIR', 'ece.atencion-emergencia.read'),
  ('DIR', 'ece.atencion-emergencia.write'),
  ('DIR', 'ece.atencion-rn.read'),
  ('DIR', 'ece.bitacora.access'),
  ('DIR', 'ece.bitacora.read'),
  ('DIR', 'ece.cama.read'),
  ('DIR', 'ece.certificacion.access'),
  ('DIR', 'ece.certificado-defuncion.access'),
  ('DIR', 'ece.certificado-incapacidad.read'),
  ('DIR', 'ece.comite-ece.access'),
  ('DIR', 'ece.comite-ece.read'),
  ('DIR', 'ece.comite-ece.write'),
  ('DIR', 'ece.consentimiento.access'),
  ('DIR', 'ece.contingencia.access'),
  ('DIR', 'ece.contingencia.read'),
  ('DIR', 'ece.contingencia.write'),
  ('DIR', 'ece.critical-result.access'),
  ('DIR', 'ece.documento-asociado.access'),
  ('DIR', 'ece.documento-asociado.write'),
  ('DIR', 'ece.epicrisis.access'),
  ('DIR', 'ece.epicrisis.read'),
  ('DIR', 'ece.epicrisis.write'),
  ('DIR', 'ece.fall-event.write'),
  ('DIR', 'ece.historia-clinica.access'),
  ('DIR', 'ece.hoja-ingreso.access'),
  ('DIR', 'ece.hoja-ingreso.read'),
  ('DIR', 'ece.icd10.access'),
  ('DIR', 'ece.icd10.read'),
  ('DIR', 'ece.icd10.write'),
  ('DIR', 'ece.orden-ingreso.access'),
  ('DIR', 'ece.orden-ingreso.read'),
  ('DIR', 'ece.periodo-expulsivo.read'),
  ('DIR', 'ece.preop-checklist.access'),
  ('DIR', 'ece.reanimacion-neonatal.access'),
  ('DIR', 'ece.resultado-estudio.access'),
  ('DIR', 'ece.resultado-estudio.read'),
  ('DIR', 'ece.retencion.access'),
  ('DIR', 'ece.retencion.read'),
  ('DIR', 'ece.retencion.write'),
  ('DIR', 'ece.rri.access'),
  ('DIR', 'ece.rri.read'),
  ('DIR', 'ece.solicitud-estudio.access'),
  ('DIR', 'ece.solicitud-estudio.read'),
  ('DIR', 'ece.solicitud-estudio.write'),
  ('DIR', 'ece.triaje-ece.access'),
  ('DIR', 'ece.triaje-ece.read'),
  ('DIR', 'ece.verbal-order.access'),
  ('DIR', 'ece.who-checklist.read'),
  ('DIR', 'epcis-query.access'),
  ('DIR', 'epcis-query.read'),
  ('DIR', 'lis.access'),
  ('DIR', 'patient-dedup.read'),
  ('DIR', 'patient-dedup.write'),
  ('DIR', 'patient.write'),
  ('DIR', 'personal-salud.access'),
  ('DIR', 'personal-salud.write'),
  ('DIR', 'portal-arco.read'),
  ('DIR', 'portal-arco.write'),
  ('DIR', 'rbac.read'),
  ('DIR', 'rbac.write'),
  ('DIR', 'workflow-instance.access'),
  ('DIR', 'workflow-plantilla.read'),
  ('DIR', 'workflow-publicacion.access'),
  ('DIR', 'workflow-rol.read'),
  ('DIR', 'workflow-simulacion.read'),
  ('DIR', 'workflow-tipoDoc-override.read'),
  ('DIR', 'workflow-tipoDoc.read'),
  ('DIR', 'workflow-transicion.read'),
  ('DIR', 'workflow-validator.read'),
  ('ARCH', 'audit-outlier.read'),
  ('ARCH', 'cold-chain.access'),
  ('ARCH', 'ece-bridge-patient.access'),
  ('ARCH', 'ece.acto-quirurgico.access'),
  ('ARCH', 'ece.atencion-rn.read'),
  ('ARCH', 'ece.bitacora.access'),
  ('ARCH', 'ece.bitacora.read'),
  ('ARCH', 'ece.comite-ece.access'),
  ('ARCH', 'ece.comite-ece.read'),
  ('ARCH', 'ece.consentimiento.access'),
  ('ARCH', 'ece.contingencia.access'),
  ('ARCH', 'ece.contingencia.write'),
  ('ARCH', 'ece.hoja-ingreso.access'),
  ('ARCH', 'ece.hoja-ingreso.read'),
  ('ARCH', 'ece.icd10.access'),
  ('ARCH', 'ece.icd10.read'),
  ('ARCH', 'ece.orden-ingreso.access'),
  ('ARCH', 'ece.preop-checklist.access'),
  ('ARCH', 'ece.resultado-estudio.access'),
  ('ARCH', 'ece.resultado-estudio.read'),
  ('ARCH', 'ece.rri.read'),
  ('ARCH', 'ece.solicitud-estudio.access'),
  ('ARCH', 'ece.solicitud-estudio.read'),
  ('ARCH', 'ece.triaje-ece.access'),
  ('ARCH', 'ece.triaje-ece.read'),
  ('ARCH', 'epcis-query.access'),
  ('ARCH', 'epcis-query.read'),
  ('ARCH', 'gs1-proceso-f.write'),
  ('ARCH', 'workflow-instance.access'),
  ('MEDICO', 'bedside-stat.read'),
  ('MEDICO', 'bedside-stat.write'),
  ('MEDICO', 'substitution.read'),
  ('MEDICO', 'substitution.write'),
  ('ENF_JEFE', 'bedside-stat.read'),
  ('ENF_JEFE', 'bedside-stat.write'),
  ('PHARM', 'calculadoras.access'),
  ('PHARM', 'cart.access'),
  ('PHARM', 'cart.write'),
  ('PHARM', 'drug-classifier.access'),
  ('PHARM', 'drug-classifier.write'),
  ('PHARM', 'farmacovigilancia.read'),
  ('PHARM', 'farmacovigilancia.write'),
  ('PHARM', 'gs1-catalogos.access'),
  ('PHARM', 'gs1-catalogos.write'),
  ('PHARM', 'gs1-lote-trace.read'),
  ('PHARM', 'gs1-medication.access'),
  ('PHARM', 'gs1-medication.write'),
  ('PHARM', 'pharmacy-dispensation.write'),
  ('PHARM', 'substitution.write'),
  ('PHYSICIAN', 'cold-chain.access'),
  ('PHYSICIAN', 'death-certificate.write'),
  ('PHYSICIAN', 'ece-rectificacion.read'),
  ('PHYSICIAN', 'ece-rectificacion.write'),
  ('PHYSICIAN', 'ece.atencion-emergencia.read'),
  ('PHYSICIAN', 'ece.bridge-cirugia.access'),
  ('PHYSICIAN', 'ece.bridge-cirugia.write'),
  ('PHYSICIAN', 'ece.bridge-encounter.access'),
  ('PHYSICIAN', 'ece.bridge-encounter.write'),
  ('PHYSICIAN', 'ece.bridge-triage.access'),
  ('PHYSICIAN', 'ece.bridge-triage.write'),
  ('PHYSICIAN', 'ece.cama.read'),
  ('PHYSICIAN', 'ece.certificado-defuncion.access'),
  ('PHYSICIAN', 'ece.certificado-incapacidad.read'),
  ('PHYSICIAN', 'ece.consentimiento.access'),
  ('PHYSICIAN', 'ece.contingencia.access'),
  ('PHYSICIAN', 'ece.contingencia.write'),
  ('PHYSICIAN', 'ece.critical-result.access'),
  ('PHYSICIAN', 'ece.documento-asociado.access'),
  ('PHYSICIAN', 'ece.documento-asociado.read'),
  ('PHYSICIAN', 'ece.epicrisis.access'),
  ('PHYSICIAN', 'ece.epicrisis.read'),
  ('PHYSICIAN', 'ece.epicrisis.write'),
  ('PHYSICIAN', 'ece.episodio-hospitalario.access'),
  ('PHYSICIAN', 'ece.episodio-hospitalario.read'),
  ('PHYSICIAN', 'ece.episodio.access'),
  ('PHYSICIAN', 'ece.episodio.read'),
  ('PHYSICIAN', 'ece.historia-clinica.access'),
  ('PHYSICIAN', 'ece.indicaciones-medicas.access'),
  ('PHYSICIAN', 'ece.indicaciones-medicas.read'),
  ('PHYSICIAN', 'ece.obstetricia.access'),
  ('PHYSICIAN', 'ece.partograma.access'),
  ('PHYSICIAN', 'ece.partograma.read'),
  ('PHYSICIAN', 'ece.partograma.write'),
  ('PHYSICIAN', 'ece.periodo-expulsivo.read'),
  ('PHYSICIAN', 'ece.reanimacion-neonatal.access'),
  ('PHYSICIAN', 'ece.reanimacion-neonatal.read'),
  ('PHYSICIAN', 'ece.registro-anestesico.read'),
  ('PHYSICIAN', 'ece.rri.access'),
  ('PHYSICIAN', 'ece.sala-expulsion.read'),
  ('PHYSICIAN', 'ece.signos-vitales.access'),
  ('PHYSICIAN', 'ece.urpa-recovery.access'),
  ('PHYSICIAN', 'ece.who-checklist.read'),
  ('PHYSICIAN', 'ece.who-checklist.write'),
  ('PHYSICIAN', 'evolucion-medica.access'),
  ('PHYSICIAN', 'evolucion-medica.read'),
  ('PHYSICIAN', 'farmacovigilancia.write'),
  ('PHYSICIAN', 'pathology.write'),
  ('PHYSICIAN', 'patient.write'),
  ('NURSE', 'cart.access'),
  ('NURSE', 'cart.write'),
  ('NURSE', 'cold-chain.access'),
  ('NURSE', 'ece-rectificacion.read'),
  ('NURSE', 'ece-rectificacion.write'),
  ('NURSE', 'ece.atencion-emergencia.read'),
  ('NURSE', 'ece.bridge-cirugia.access'),
  ('NURSE', 'ece.bridge-cirugia.write'),
  ('NURSE', 'ece.bridge-encounter.access'),
  ('NURSE', 'ece.bridge-encounter.write'),
  ('NURSE', 'ece.bridge-triage.access'),
  ('NURSE', 'ece.bridge-triage.write'),
  ('NURSE', 'ece.cama.read'),
  ('NURSE', 'ece.certificado-incapacidad.read'),
  ('NURSE', 'ece.consentimiento.access'),
  ('NURSE', 'ece.contingencia.access'),
  ('NURSE', 'ece.contingencia.write'),
  ('NURSE', 'ece.documento-asociado.access'),
  ('NURSE', 'ece.documento-asociado.read'),
  ('NURSE', 'ece.epicrisis.access'),
  ('NURSE', 'ece.episodio-hospitalario.access'),
  ('NURSE', 'ece.episodio.access'),
  ('NURSE', 'ece.episodio.read'),
  ('NURSE', 'ece.fall-event.access'),
  ('NURSE', 'ece.fall-event.write'),
  ('NURSE', 'ece.historia-clinica.access'),
  ('NURSE', 'ece.indicaciones-medicas.read'),
  ('NURSE', 'ece.obstetricia.access'),
  ('NURSE', 'ece.partograma.access'),
  ('NURSE', 'ece.partograma.read'),
  ('NURSE', 'ece.partograma.write'),
  ('NURSE', 'ece.periodo-expulsivo.read'),
  ('NURSE', 'ece.reanimacion-neonatal.access'),
  ('NURSE', 'ece.reanimacion-neonatal.read'),
  ('NURSE', 'ece.registro-anestesico.read'),
  ('NURSE', 'ece.registro-enfermeria.read'),
  ('NURSE', 'ece.rri.access'),
  ('NURSE', 'ece.sala-expulsion.read'),
  ('NURSE', 'ece.signos-vitales.access'),
  ('NURSE', 'ece.triaje-ece.access'),
  ('NURSE', 'ece.urpa-recovery.access'),
  ('NURSE', 'ece.valoracion-inicial-enfermeria.access'),
  ('NURSE', 'ece.valoracion-inicial-enfermeria.read'),
  ('NURSE', 'ece.verbal-order.access'),
  ('NURSE', 'ece.who-checklist.read'),
  ('NURSE', 'ece.who-checklist.write'),
  ('NURSE', 'farmacovigilancia.write'),
  ('NURSE', 'gs1-proceso-b.write'),
  ('NURSE', 'gs1-proceso-c.write'),
  ('NURSE', 'patient.write'),
  ('ADM', 'cold-chain.access'),
  ('ADM', 'ece-bridge-patient.access'),
  ('ADM', 'ece.bridge-admision.access'),
  ('ADM', 'ece.bridge-admision.write'),
  ('ADM', 'ece.bridge-cirugia.access'),
  ('ADM', 'ece.bridge-cirugia.write'),
  ('ADM', 'ece.bridge-encounter.access'),
  ('ADM', 'ece.bridge-encounter.write'),
  ('ADM', 'ece.cama.read'),
  ('ADM', 'ece.contingencia.access'),
  ('ADM', 'ece.contingencia.read'),
  ('ADM', 'ece.contingencia.write'),
  ('ADM', 'ece.episodio-hospitalario.access'),
  ('ADM', 'ece.episodio.access'),
  ('ADM', 'ece.episodio.read'),
  ('ADM', 'ece.hoja-ingreso.access'),
  ('ADM', 'ece.hoja-ingreso.read'),
  ('ADM', 'ece.orden-ingreso.access'),
  ('ADM', 'ece.retencion.access'),
  ('ADM', 'ece.retencion.read'),
  ('ADM', 'patient-dedup.read'),
  ('ADM', 'patient-dedup.write'),
  ('ADM', 'portal-arco.read'),
  ('ADM', 'portal-arco.write'),
  ('ADM', 'rbac.write'),
  ('BIOMEDICAL', 'cold-chain.access'),
  ('SUPER_ADMIN', 'country.access'),
  ('MC', 'ece.acto-quirurgico.access'),
  ('MC', 'ece.atencion-rn.access'),
  ('MC', 'ece.atencion-rn.read'),
  ('MC', 'ece.certificado-defuncion.access'),
  ('MC', 'ece.certificado-incapacidad.read'),
  ('MC', 'ece.consentimiento.access'),
  ('MC', 'ece.critical-result.access'),
  ('MC', 'ece.epicrisis.access'),
  ('MC', 'ece.epicrisis.read'),
  ('MC', 'ece.epicrisis.write'),
  ('MC', 'ece.fall-event.access'),
  ('MC', 'ece.fall-event.write'),
  ('MC', 'ece.historia-clinica.access'),
  ('MC', 'ece.hoja-ingreso.access'),
  ('MC', 'ece.hoja-ingreso.read'),
  ('MC', 'ece.indicaciones-medicas.access'),
  ('MC', 'ece.indicaciones-medicas.read'),
  ('MC', 'ece.obstetricia.access'),
  ('MC', 'ece.orden-ingreso.access'),
  ('MC', 'ece.orden-ingreso.read'),
  ('MC', 'ece.periodo-expulsivo.read'),
  ('MC', 'ece.preop-checklist.access'),
  ('MC', 'ece.resultado-estudio.access'),
  ('MC', 'ece.resultado-estudio.read'),
  ('MC', 'ece.rri.access'),
  ('MC', 'ece.rri.read'),
  ('MC', 'ece.sala-expulsion.read'),
  ('MC', 'ece.signos-vitales.access'),
  ('MC', 'ece.solicitud-estudio.access'),
  ('MC', 'ece.solicitud-estudio.read'),
  ('MC', 'ece.solicitud-estudio.write'),
  ('MC', 'ece.triaje-ece.access'),
  ('MC', 'ece.triaje-ece.read'),
  ('MC', 'ece.urpa-recovery.access'),
  ('MC', 'ece.verbal-order.access'),
  ('MC', 'patient.write'),
  ('MC', 'workflow-instance.access'),
  ('ESP', 'ece.acto-quirurgico.access'),
  ('ESP', 'ece.consentimiento.access'),
  ('ESP', 'ece.critical-result.access'),
  ('ESP', 'ece.epicrisis.access'),
  ('ESP', 'ece.epicrisis.read'),
  ('ESP', 'ece.epicrisis.write'),
  ('ESP', 'ece.fall-event.access'),
  ('ESP', 'ece.fall-event.write'),
  ('ESP', 'ece.hoja-ingreso.access'),
  ('ESP', 'ece.hoja-ingreso.read'),
  ('ESP', 'ece.orden-ingreso.access'),
  ('ESP', 'ece.orden-ingreso.read'),
  ('ESP', 'ece.periodo-expulsivo.read'),
  ('ESP', 'ece.preop-checklist.access'),
  ('ESP', 'ece.registro-anestesico.read'),
  ('ESP', 'ece.resultado-estudio.access'),
  ('ESP', 'ece.resultado-estudio.read'),
  ('ESP', 'ece.rri.access'),
  ('ESP', 'ece.rri.read'),
  ('ESP', 'ece.solicitud-estudio.access'),
  ('ESP', 'ece.solicitud-estudio.read'),
  ('ESP', 'ece.solicitud-estudio.write'),
  ('ESP', 'ece.triaje-ece.access'),
  ('ESP', 'ece.triaje-ece.read'),
  ('ESP', 'ece.urpa-recovery.access'),
  ('ESP', 'ece.verbal-order.access'),
  ('ESP', 'workflow-instance.access'),
  ('ENF', 'ece.acto-quirurgico.access'),
  ('ENF', 'ece.atencion-rn.read'),
  ('ENF', 'ece.consentimiento.access'),
  ('ENF', 'ece.fall-event.access'),
  ('ENF', 'ece.fall-event.write'),
  ('ENF', 'ece.hoja-ingreso.access'),
  ('ENF', 'ece.hoja-ingreso.read'),
  ('ENF', 'ece.indicaciones-medicas.read'),
  ('ENF', 'ece.orden-ingreso.access'),
  ('ENF', 'ece.preop-checklist.access'),
  ('ENF', 'ece.resultado-estudio.access'),
  ('ENF', 'ece.resultado-estudio.read'),
  ('ENF', 'ece.rri.read'),
  ('ENF', 'ece.solicitud-estudio.access'),
  ('ENF', 'ece.solicitud-estudio.read'),
  ('ENF', 'ece.triaje-ece.access'),
  ('ENF', 'ece.triaje-ece.read'),
  ('ENF', 'ece.verbal-order.access'),
  ('ENF', 'gs1-proceso-c.write'),
  ('ENF', 'workflow-instance.access'),
  ('QX', 'ece.acto-quirurgico.access'),
  ('MT', 'ece.atencion-emergencia.read'),
  ('MT', 'ece.documento-asociado.access'),
  ('MT', 'ece.documento-asociado.read'),
  ('MT', 'ece.historia-clinica.access'),
  ('MT', 'ece.partograma.access'),
  ('MT', 'ece.partograma.read'),
  ('MT', 'ece.partograma.write'),
  ('MT', 'ece.reanimacion-neonatal.access'),
  ('MT', 'ece.reanimacion-neonatal.read'),
  ('MT', 'ece.signos-vitales.access'),
  ('MT', 'ece.triaje-ece.access'),
  ('MT', 'ece.triaje-ece.read'),
  ('MT', 'patient.write'),
  ('MT', 'workflow-instance.access'),
  ('ADMIN_CLINICO', 'ece.cama.read'),
  ('ADMIN_CLINICO', 'staff-gsrn.access'),
  ('ADMIN_CLINICO', 'staff-gsrn.read'),
  ('ADMIN_CLINICO', 'staff-gsrn.write'),
  ('LAB', 'ece.critical-result.access'),
  ('RAD', 'ece.critical-result.access'),
  ('HEAD_NURSE', 'ece.obstetricia.access'),
  ('ANES', 'ece.preop-checklist.access'),
  ('OB', 'ece.reanimacion-neonatal.access'),
  ('OB', 'ece.reanimacion-neonatal.read'),
  ('NEONATOLOGIST', 'ece.reanimacion-neonatal.access'),
  ('NEONATOLOGIST', 'ece.reanimacion-neonatal.read'),
  ('TEC', 'ece.resultado-estudio.access'),
  ('TEC', 'ece.resultado-estudio.read'),
  ('TEC', 'ece.solicitud-estudio.access'),
  ('TEC', 'ece.solicitud-estudio.read'),
  ('PROF_DX', 'ece.resultado-estudio.access'),
  ('PROF_DX', 'ece.resultado-estudio.read'),
  ('DIR_MEDICO', 'ece.retencion.access'),
  ('DIR_MEDICO', 'ece.retencion.write'),
  ('IC', 'ece.rri.access'),
  ('IC', 'ece.rri.read'),
  ('ANEST', 'ece.who-checklist.read'),
  ('ANEST', 'ece.who-checklist.write'),
  ('DIRECTOR', 'farmacovigilancia.read'),
  ('DIRECTOR', 'gs1-lote-trace.access'),
  ('DIRECTOR', 'gs1-lote-trace.read'),
  ('DIRECTOR', 'gs1-lote-trace.write'),
  ('LOGISTIC', 'gs1-catalogos.access'),
  ('LOGISTIC', 'gs1-catalogos.write'),
  ('LOGISTIC', 'gs1-gln-hierarchy.access'),
  ('LOGISTIC', 'gs1-gln-hierarchy.write'),
  ('LOGISTIC', 'gs1-medication.access'),
  ('EQUIPOS', 'gs1-catalogos.write'),
  ('REGENT', 'gs1-lote-trace.read'),
  ('INVENTORY_MANAGER', 'gs1-proceso-b.write'),
  ('PHARMACIST', 'gs1-proceso-b.write'),
  ('PHARMACIST', 'gs1-proceso-c.write'),
  ('PHARMACIST', 'srs-registro.access'),
  ('FARM', 'gs1-proceso-c.write'),
  ('BILLING', 'invoice.read'),
  ('ADMIN_ORG', 'pathology.write'),
  ('PATHOLOGY_TECHNICIAN', 'pathology.write'),
  ('LAB_TECHNICIAN', 'pathology.write'),
  ('PATHOLOGIST', 'pathology.write'),
  ('ADMISION', 'patient-identification.read'),
  ('ADMISION', 'patient-identification.write'),
  ('super_admin', 'rbac.read'),
  ('super_admin', 'rbac.write'),
  ('WORKFLOW_DESIGNER', 'workflow-plantilla.read'),
  ('WORKFLOW_DESIGNER', 'workflow-publicacion.access'),
  ('WORKFLOW_DESIGNER', 'workflow-rol.read'),
  ('WORKFLOW_DESIGNER', 'workflow-simulacion.read'),
  ('WORKFLOW_DESIGNER', 'workflow-tipoDoc.read'),
  ('WORKFLOW_DESIGNER', 'workflow-transicion.read'),
  ('WORKFLOW_DESIGNER', 'workflow-validator.read'),
  -- Grants finos para las 3 pruebas de concepto de requirePermission():
  ('ACCOUNTANT', 'accounting.post'),
  ('ACCOUNTANT_SENIOR', 'accounting.post'),
  ('ADMIN', 'accounting.post'),
  ('DIR', 'rbac.manage'),
  ('super_admin', 'rbac.manage'),
  ('ADMIN', 'user.manage')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';
