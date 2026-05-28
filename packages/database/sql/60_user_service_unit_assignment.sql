-- 60_user_service_unit_assignment.sql
-- Asignación scoped de usuarios a unidades operativas (servicios).
--
-- ANTES: `UserOrganizationRole(userId, organizationId, roleId)` solo scopea
--        rol por organización. Un NURSE veía pacientes de TODOS los servicios
--        de la org (Emergencias, UCI, Pediatría, etc.).
--
-- AHORA: capa adicional `UserServiceUnitAssignment` que indica EN QUÉ
--        servicios opera cada usuario. Roles cross-servicio (ADMIN, DIR, COO,
--        CFO, CEO, MEDICAL_DIRECTOR, AUDITOR) NO requieren entry — pueden
--        ver todo dentro de su org.
--
-- Diseño (NIVEL A — sidebar/rutas):
--   - Sin entries para un usuario = sin restricción de servicio (compat backward)
--   - Con entries = el usuario solo ve items del sidebar / páginas raíz de esos
--     servicios. Data layer queda intacto (Nivel B futuro).
--   - validFrom/validTo permite asignaciones temporales (cobertura, rotación).
--
-- Idempotente: IF NOT EXISTS en todo.

CREATE TABLE IF NOT EXISTS public."UserServiceUnitAssignment" (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"        UUID NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "serviceUnitId" UUID NOT NULL REFERENCES public."ServiceUnit"(id) ON DELETE CASCADE,
  -- Rol opcional: si está, la asignación solo aplica cuando el usuario actúa
  -- como ese rol específico. NULL = aplica con cualquier rol que tenga el
  -- usuario en la organización del servicio.
  "roleId"        UUID REFERENCES public."Role"(id) ON DELETE SET NULL,
  "validFrom"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "validTo"       TIMESTAMPTZ,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "createdBy"     UUID REFERENCES public."User"(id) ON DELETE SET NULL,
  -- Una asignación única por (user, service, rol-opcional). Múltiples filas
  -- permitidas si el usuario opera en varios servicios.
  CONSTRAINT user_service_role_unique UNIQUE ("userId", "serviceUnitId", "roleId")
);

CREATE INDEX IF NOT EXISTS "UserServiceUnitAssignment_userId_idx"
  ON public."UserServiceUnitAssignment" ("userId");

CREATE INDEX IF NOT EXISTS "UserServiceUnitAssignment_serviceUnitId_idx"
  ON public."UserServiceUnitAssignment" ("serviceUnitId");

-- Index parcial: solo asignaciones vigentes (las queries por user filtran así).
CREATE INDEX IF NOT EXISTS "UserServiceUnitAssignment_active_idx"
  ON public."UserServiceUnitAssignment" ("userId", "serviceUnitId")
  WHERE "validTo" IS NULL;

-- RLS:
--   - SELECT por authenticated: el usuario solo ve sus propias asignaciones
--     o ADMIN puede ver todas vía break-glass.
--   - INSERT/UPDATE/DELETE solo service_role + ADMIN del tenant.
ALTER TABLE public."UserServiceUnitAssignment" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_service_unit_own_or_admin
  ON public."UserServiceUnitAssignment";
CREATE POLICY user_service_unit_own_or_admin
  ON public."UserServiceUnitAssignment"
  FOR SELECT
  USING (
    "userId" = current_user_id() OR is_break_glass()
  );

-- Comment para docs / introspección.
COMMENT ON TABLE public."UserServiceUnitAssignment" IS
  'Scoping de usuarios a unidades operativas (servicios). Nivel A — sidebar/rutas. Nivel B (data filter) pendiente. Roles cross-servicio (ADMIN, DIR, COO, CFO, CEO, MEDICAL_DIRECTOR, AUDITOR) NO requieren entry — bypassean.';
