-- =============================================================================
-- 195_cc0017_f2_abac.sql
-- CC-0017 Fase 2 — ABAC persistente + enforcement real en tRPC
--
-- Propósito:
--   a) Tabla AbacRule: reglas ABAC editables por organización, evaluadas
--      server-side por packages/trpc/src/abac/motor.ts (evaluarAbac) y
--      cableadas opt-in vía abacGuard en 3 procedures de prueba de concepto
--      (indicaciones-medicas.create, pharmacy-dispensation.reserveItem,
--      firma-electronica.confirm).
--   b) Seed idempotente por organización real: traduce las reglas hardcoded
--      de MVP_ABAC_RULES (apps/web/src/lib/auth/abac.ts) a filas AbacRule —
--      el estado inicial post-aplicación reproduce EXACTAMENTE el
--      comportamiento MVP documentado hoy, ahora editable desde /abac.
--
-- Mapeo MVP_ABAC_RULES → AbacRule (ver docs/CC/0017/REQ-SEC-ABAC-002-*.md
-- para el detalle completo):
--   patient-read-admin      → recurso=patient,       accion=access,    rol EN [super_admin,admin_clinico]
--   patient-read-clinical   → recurso=patient,       accion=access,    rol EN [medico,enfermeria]
--   patient-read-triage     → recurso=patient,       accion=access,    rol EN [triador] AND pacienteConTriaje=true
--   patient-prescribe       → recurso=prescription,  accion=prescribe, rol EN [medico]
--   patient-dispense        → recurso=dispensation,  accion=dispense,  rol EN [farmaceutico]
--   patient-sign            → recurso=signature,     accion=sign,      rol EN [medico]
--   service-access-org-mvp  → recurso=service,       accion=access,    rol EN [super_admin,admin_clinico,medico,enfermeria,triador]
--
-- Nota: `sameOrg` (organizationId igual) NO se modela como condición explícita
-- — el motor ya evalúa las reglas SCOPED a `organizationId` del tenant (RLS +
-- filtro de carga), así que el match de organización es estructural, no una
-- condición de la lista `condiciones`.
--
-- Idempotente: reejecutable sin duplicar filas ni perder datos.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- NO aplicado a prod por este agente — @Orq/@DBA decide el momento.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- a) Tabla AbacRule
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."AbacRule" (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId" uuid        NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  recurso          varchar(40) NOT NULL,
  accion           varchar(40) NOT NULL,
  effect           varchar(10) NOT NULL DEFAULT 'ALLOW',
  prioridad        integer     NOT NULL DEFAULT 100,
  descripcion      text,
  condiciones      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  active           boolean     NOT NULL DEFAULT true,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "createdBy"      uuid,
  "updatedAt"      timestamptz NOT NULL DEFAULT now(),
  "updatedBy"      uuid,
  CONSTRAINT chk_abac_rule_effect CHECK (effect IN ('ALLOW', 'DENY')),
  CONSTRAINT chk_abac_rule_condiciones_is_array CHECK (jsonb_typeof(condiciones) = 'array')
);

COMMENT ON TABLE public."AbacRule" IS
  'CC-0017 F2 — reglas ABAC persistidas por organización. Fuente de verdad para evaluarAbac()/abacGuard (packages/trpc/src/abac). Reemplaza MVP_ABAC_RULES hardcoded.';
COMMENT ON COLUMN public."AbacRule".recurso IS
  'patient | prescription | dispensation | service | signature (deriva de las 5 funciones canX de abac.ts).';
COMMENT ON COLUMN public."AbacRule".accion IS
  'access | prescribe | dispense | sign.';
COMMENT ON COLUMN public."AbacRule".condiciones IS
  'Array de predicados AND: [{ "atributo": "...", "operador": "...", "valor": ... }]. Ver AbacCondicion en @his/contracts.';
COMMENT ON COLUMN public."AbacRule".prioridad IS
  'Orden de evaluación entre reglas que matchean el mismo (recurso,accion) y mismo effect: mayor prioridad se reporta como matchedRuleId. DENY siempre gana sobre ALLOW independientemente de prioridad.';

CREATE INDEX IF NOT EXISTS idx_abac_rule_org_recurso_accion
  ON public."AbacRule" ("organizationId", recurso, accion, active);

ALTER TABLE public."AbacRule" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS abac_rule_tenant ON public."AbacRule";
CREATE POLICY abac_rule_tenant ON public."AbacRule"
  FOR ALL TO authenticated
  USING (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  )
  WITH CHECK (
    "organizationId" = COALESCE(current_setting('app.current_org_id', true), '')::uuid
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON public."AbacRule" TO authenticated;

-- -----------------------------------------------------------------------------
-- b) Seed — traduce MVP_ABAC_RULES a filas AbacRule por organización real
--    (excluye orgs de prueba RLS). Idempotente: NOT EXISTS por
--    (organizationId, recurso, accion, descripcion) evita duplicar en reruns.
-- -----------------------------------------------------------------------------
INSERT INTO public."AbacRule"
  ("organizationId", recurso, accion, effect, prioridad, descripcion, condiciones, active)
SELECT o.id, v.recurso, v.accion, 'ALLOW', v.prioridad, v.descripcion, v.condiciones::jsonb, true
FROM public."Organization" o
CROSS JOIN (VALUES
  (
    'patient', 'access', 200,
    'Administradores leen cualquier paciente para soporte / reporting (MVP: patient-read-admin).',
    '[{"atributo":"rol","operador":"EN","valor":["super_admin","admin_clinico"]}]'
  ),
  (
    'patient', 'access', 100,
    'Personal clínico accede a pacientes de su organización (MVP: patient-read-clinical).',
    '[{"atributo":"rol","operador":"EN","valor":["medico","enfermeria"]}]'
  ),
  (
    'patient', 'access', 100,
    'Triador ve solo pacientes con triage activo (MVP: patient-read-triage).',
    '[{"atributo":"rol","operador":"EN","valor":["triador"]},{"atributo":"pacienteConTriaje","operador":"ES_VERDADERO","valor":true}]'
  ),
  (
    'prescription', 'prescribe', 100,
    'Solo médicos prescriben — separación TDR §6.2 (MVP: patient-prescribe).',
    '[{"atributo":"rol","operador":"EN","valor":["medico"]}]'
  ),
  (
    'dispensation', 'dispense', 100,
    'Solo farmacéuticos dispensan — separación TDR §6.2 (MVP: patient-dispense).',
    '[{"atributo":"rol","operador":"EN","valor":["farmaceutico"]}]'
  ),
  (
    'signature', 'sign', 100,
    'Firma asistencial: solo médicos en su organización (MVP: patient-sign).',
    '[{"atributo":"rol","operador":"EN","valor":["medico"]}]'
  ),
  (
    'service', 'access', 100,
    'MVP: cualquier rol activo en la organización accede a sus unidades de servicio (MVP: service-access-org-mvp).',
    '[{"atributo":"rol","operador":"EN","valor":["super_admin","admin_clinico","medico","enfermeria","triador"]}]'
  )
) AS v(recurso, accion, prioridad, descripcion, condiciones)
WHERE o."legalName" NOT LIKE 'RLS-Test%'
  AND NOT EXISTS (
    SELECT 1 FROM public."AbacRule" ar
    WHERE ar."organizationId" = o.id
      AND ar.recurso = v.recurso
      AND ar.accion = v.accion
      AND ar.descripcion = v.descripcion
  );

-- -----------------------------------------------------------------------------
-- Verificación (ejecutar manualmente tras aplicar):
-- -----------------------------------------------------------------------------
-- SELECT o."legalName", count(*) FROM public."AbacRule" ar
--   JOIN public."Organization" o ON o.id = ar."organizationId"
--   GROUP BY o."legalName" ORDER BY 1;
-- -- Debe dar 7 reglas seed por cada org real.
