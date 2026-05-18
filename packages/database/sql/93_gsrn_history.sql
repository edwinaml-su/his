-- =====================================================================
-- 93_gsrn_history.sql
-- Historial inmutable de pulseras GSRN por paciente (US.F2.6.37-40).
--
-- Tabla: public."GsrnHistory"
--   Registra cada emisión y revocación de pulsera GSRN.
--   La primera fila por paciente migra desde Patient.gsrn.
--
-- RLS: Categoría B (tenant-scoped, organizationId obligatorio).
--   SELECT: authenticated con organization_id = app.current_org_id.
--   INSERT: authenticated (ADMISSION, ADMIN roles vía app-layer RBAC).
--   UPDATE: service_role only (inmutable desde app — no se actualizan filas).
--   DELETE: service_role only.
--
-- Audit: cada lookup de identificación de paciente escribe en audit.audit_log
--        vía el router tRPC (no via trigger SQL — el router tiene el contexto
--        de usuario y propósito del acceso). Las mutaciones de esta tabla sí
--        disparan el trigger de hash chain de audit si se añade la tabla
--        al conjunto auditado en 02_audit_triggers.sql + 05_audit_hash_chain.sql.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE POLICY.
-- =====================================================================

-- -----------------------------------------------------------------------
-- Enum de estado de pulsera
-- -----------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'gsrn_status' AND typnamespace = 'public'::regnamespace
  ) THEN
    CREATE TYPE public.gsrn_status AS ENUM ('ACTIVE', 'REVOKED');
  END IF;
END
$$;

-- -----------------------------------------------------------------------
-- Tabla GsrnHistory
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public."GsrnHistory" (
  id                   uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  "patientId"          uuid          NOT NULL
                         REFERENCES public."Patient"(id) ON DELETE CASCADE,
  "organizationId"     uuid          NOT NULL,
  gsrn                 char(18)      NOT NULL
                         CHECK (gsrn ~ '^\d{18}$'),
  status               gsrn_status   NOT NULL DEFAULT 'ACTIVE',
  "assignedAt"         timestamptz   NOT NULL DEFAULT now(),
  "revokedAt"          timestamptz,
  "assignedById"       uuid,         -- User.id que emitió la pulsera
  "revokedById"        uuid,         -- User.id que revocó
  "motivoRevocacion"   text,         -- libre cuando status = REVOKED
  "createdAt"          timestamptz   NOT NULL DEFAULT now(),
  "updatedAt"          timestamptz   NOT NULL DEFAULT now(),

  -- Solo puede haber un GSRN ACTIVE por paciente por organización.
  CONSTRAINT uq_gsrn_history_active_patient
    EXCLUDE USING btree ("patientId" WITH =, "organizationId" WITH =)
    WHERE (status = 'ACTIVE'),

  -- El código GSRN es globalmente único entre organizaciones (estándar GS1).
  CONSTRAINT uq_gsrn_history_code UNIQUE (gsrn)
);

COMMENT ON TABLE public."GsrnHistory" IS
  'Historial inmutable de pulseras GSRN por paciente (US.F2.6.37-40). '
  'Una sola fila ACTIVE por paciente/organización en todo momento.';

COMMENT ON COLUMN public."GsrnHistory".gsrn IS
  'GSRN-18: 18 dígitos numéricos. Dígito verificador GS1 Módulo-10 '
  'validado a nivel aplicación (gs1CheckDigitValid en router).';

COMMENT ON COLUMN public."GsrnHistory"."motivoRevocacion" IS
  'Razón de la revocación: DETERIORO_PULSERA, ALTA_HOSPITALARIA, CORRECCION_ERROR, etc.';

-- -----------------------------------------------------------------------
-- Índices
-- -----------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_gsrn_history_patient
  ON public."GsrnHistory" ("patientId");

CREATE INDEX IF NOT EXISTS idx_gsrn_history_gsrn
  ON public."GsrnHistory" (gsrn);

CREATE INDEX IF NOT EXISTS idx_gsrn_history_org
  ON public."GsrnHistory" ("organizationId");

CREATE INDEX IF NOT EXISTS idx_gsrn_history_status
  ON public."GsrnHistory" (status)
  WHERE status = 'ACTIVE';

-- -----------------------------------------------------------------------
-- updatedAt auto-update trigger
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_updated_at_gsrn_history()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_gsrn_history_updated_at ON public."GsrnHistory";
CREATE TRIGGER trg_gsrn_history_updated_at
  BEFORE UPDATE ON public."GsrnHistory"
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_gsrn_history();

-- -----------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------

ALTER TABLE public."GsrnHistory" ENABLE ROW LEVEL SECURITY;

-- SELECT: tenant propio
DROP POLICY IF EXISTS gsrn_history_select_tenant ON public."GsrnHistory";
CREATE POLICY gsrn_history_select_tenant
  ON public."GsrnHistory"
  FOR SELECT
  TO authenticated
  USING (
    "organizationId" = current_setting('app.current_org_id', true)::uuid
  );

-- INSERT: authenticated (RBAC en app-layer)
DROP POLICY IF EXISTS gsrn_history_insert_tenant ON public."GsrnHistory";
CREATE POLICY gsrn_history_insert_tenant
  ON public."GsrnHistory"
  FOR INSERT
  TO authenticated
  WITH CHECK (
    "organizationId" = current_setting('app.current_org_id', true)::uuid
  );

-- UPDATE / DELETE: solo service_role (inmutabilidad desde app)
-- (service_role bypasea RLS; no se necesitan policies explícitas)

-- -----------------------------------------------------------------------
-- Migración inicial: poblar desde Patient.gsrn donde exista
-- Solo corre si la tabla está vacía para ser idempotente.
-- -----------------------------------------------------------------------

INSERT INTO public."GsrnHistory" (
  id,
  "patientId",
  "organizationId",
  gsrn,
  status,
  "assignedAt"
)
SELECT
  gen_random_uuid(),
  p.id,
  p."organizationId",
  p.gsrn,
  'ACTIVE',
  COALESCE(p."createdAt", now())
FROM public."Patient" p
WHERE p.gsrn IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."GsrnHistory" gh
    WHERE gh."patientId" = p.id
  )
ON CONFLICT (gsrn) DO NOTHING;
