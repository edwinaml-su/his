-- =============================================================================
-- 244_cc0036_afiliado_consultorio.sql — CC-0036 Ola 1B (REQ-HIS-AFIL-001 S1):
-- catálogo de consultorios y médicos afiliados.
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (cc0036_afiliado_consultorio_244) —
-- NO re-aplicar. Verificado: 3 tablas + 5 policies + triggers audit (×3
-- eventos c/u; nombres en minúsculas por identifier sin comillas) + 8
-- permisos + roles ADMIN_CONSULTORIOS/MEDICO_AFILIADO en orgs activas.
--
-- Fuente: REQ-HIS-AFIL-001.md §5.1 Bloque A (Consultorio, MedicoAfiliado,
-- MedicoAfiliadoEspecialidad), US.AFIL.1.1, US.AFIL.1.2, §7 (RBAC).
--
-- Correcciones a la numeración del REQ (la numeración real del repo manda):
-- el REQ sugiere sql/240 para este bloque, pero sql/240-243 ya están
-- ocupados en main (240 expiración de reservas, 241 triage SLA watchdog,
-- 242 poller vault, 243 turnos de la Ola 1A en paralelo — NO tocar). Esta
-- migración es la 244.
--
-- Fuera de alcance de esta ola (Bloque A-contratos/B-honorarios/C-turnos y
-- Épica E2 completos): ContratoArrendamiento, ContratoJornada, ContratoCargo,
-- ConvenioHonorario, ReglaHonorario, ProduccionMedica, Liquidacion,
-- PlantillaTurno, AgendaMedico, etc. — llegan en olas siguientes del mismo
-- REQ. Por eso Consultorio/MedicoAfiliado NO tienen FK hacia esas tablas
-- (aún no existen) y no se requiere `btree_gist` (los EXCLUDE de contratos
-- llegan con esas olas).
--
-- RLS + audit: mismo patrón que sql/231_room_bed_odoo_mirror.sql (tenant
-- isolation vía public.current_org_id()/is_break_glass(), trg_audit_<Tabla>
-- vía audit.fn_audit_row()). `MedicoAfiliadoEspecialidad` no tiene
-- `organizationId` propio (tabla puente REQ-fiel) — su RLS se resuelve por
-- EXISTS contra `MedicoAfiliado`, mismo patrón que
-- `patient_child_isolation_pi` sobre `PatientIdentifier` (sql/01_rls_policies.sql).
--
-- Roles/permisos: patrón sql/238_cc0031_roles_notificaciones.sql (roles
-- nuevos, uno por organización activa, ON CONFLICT idempotente) +
-- sql/194_cc0017_rbac_parametrizable.sql (Permission/RolePermission, JOIN
-- por code). Códigos de permiso en español, tal como los define el REQ §7.1
-- (resource "consultorio"/"medico_afiliado", acciones en español) — nótese
-- que difiere de la convención inglesa usada en otros dominios
-- (accounting.post, user.manage); se respeta literal porque el REQ lo fija
-- así para este dominio de negocio.
--
-- Idempotente. Aplicar vía mcp apply_migration en una sola transacción.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Consultorio (US.AFIL.1.1)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."Consultorio" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"         uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "establishmentId"        uuid NOT NULL REFERENCES public."Establishment"(id) ON DELETE CASCADE,
  "serviceUnitId"          uuid REFERENCES public."ServiceUnit"(id) ON DELETE SET NULL,
  codigo                   varchar(40)  NOT NULL,
  nombre                   varchar(120) NOT NULL,
  piso                     varchar(20),
  "areaM2"                 numeric(8,2),
  "tipoUso"                varchar(20)  NOT NULL
    CONSTRAINT chk_consultorio_tipo_uso CHECK ("tipoUso" IN ('ARRENDADO','PROPIO','MIXTO')),
  "especialidadSugeridaId" uuid REFERENCES public."MedicalSpecialty"(id) ON DELETE SET NULL,
  "capacidadPacientesHora" int,
  "glnCodigo"              varchar(13),
  equipamiento             jsonb NOT NULL DEFAULT '{}',
  active                   boolean NOT NULL DEFAULT true,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "createdBy"              uuid,
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedBy"              uuid,
  CONSTRAINT "Consultorio_organizationId_codigo_key" UNIQUE ("organizationId", codigo)
);

CREATE INDEX IF NOT EXISTS idx_consultorio_organization    ON public."Consultorio" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_consultorio_establishment    ON public."Consultorio" ("establishmentId");
CREATE INDEX IF NOT EXISTS idx_consultorio_service_unit     ON public."Consultorio" ("serviceUnitId");
CREATE INDEX IF NOT EXISTS idx_consultorio_active           ON public."Consultorio" (active);

COMMENT ON TABLE public."Consultorio" IS
  'Catálogo de consultorios por sede — US.AFIL.1.1 (REQ-HIS-AFIL-001, CC-0036, sql/244).';

ALTER TABLE public."Consultorio" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."Consultorio" TO authenticated;

DROP POLICY IF EXISTS tenant_isolation_select ON public."Consultorio";
CREATE POLICY tenant_isolation_select ON public."Consultorio"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS tenant_isolation_modify ON public."Consultorio";
CREATE POLICY tenant_isolation_modify ON public."Consultorio"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP TRIGGER IF EXISTS trg_audit_Consultorio ON public."Consultorio";
CREATE TRIGGER trg_audit_Consultorio
  AFTER INSERT OR UPDATE OR DELETE ON public."Consultorio"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- -----------------------------------------------------------------------------
-- 2. MedicoAfiliado (US.AFIL.1.2)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."MedicoAfiliado" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organizationId"         uuid NOT NULL REFERENCES public."Organization"(id) ON DELETE CASCADE,
  "userId"                 uuid REFERENCES public."User"(id) ON DELETE SET NULL,
  "nombreCompleto"         varchar(200) NOT NULL,
  "tipoDocumentoId"        uuid REFERENCES public."IdentifierType"(id) ON DELETE SET NULL,
  "numeroDocumento"        varchar(40),
  "jvpmNumero"             varchar(30)  NOT NULL,
  "especialidadPrincipalId" uuid REFERENCES public."MedicalSpecialty"(id) ON DELETE SET NULL,
  "tipoRelacion"           varchar(30)  NOT NULL
    CONSTRAINT chk_medico_afiliado_tipo_relacion CHECK ("tipoRelacion" IN (
      'AFILIADO_ARRENDATARIO','AFILIADO_SIN_CONSULTORIO','STAFF_INTERNO'
    )),
  nit                      varchar(40),
  nrc                      varchar(20),
  "esContribuyenteIva"     boolean NOT NULL DEFAULT false,
  estado                   varchar(20) NOT NULL DEFAULT 'PROSPECTO'
    CONSTRAINT chk_medico_afiliado_estado CHECK (estado IN (
      'PROSPECTO','ACTIVO','SUSPENDIDO','INACTIVO'
    )),
  "fechaIngreso"           date,
  "fechaBaja"              date,
  "motivoBaja"             varchar(300),
  "permiteCompensacion"    boolean NOT NULL DEFAULT true,
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "createdBy"              uuid,
  "updatedAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedBy"              uuid,
  CONSTRAINT "MedicoAfiliado_organizationId_jvpmNumero_key" UNIQUE ("organizationId", "jvpmNumero")
);

CREATE INDEX IF NOT EXISTS idx_medico_afiliado_organization ON public."MedicoAfiliado" ("organizationId");
CREATE INDEX IF NOT EXISTS idx_medico_afiliado_user         ON public."MedicoAfiliado" ("userId") WHERE "userId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_medico_afiliado_estado        ON public."MedicoAfiliado" (estado);

COMMENT ON TABLE public."MedicoAfiliado" IS
  'Médico especialista afiliado (contraparte económica) — US.AFIL.1.2 (REQ-HIS-AFIL-001, CC-0036, sql/244). D5: entidad de negocio, no un User (userId opcional).';

ALTER TABLE public."MedicoAfiliado" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."MedicoAfiliado" TO authenticated;

DROP POLICY IF EXISTS tenant_isolation_select ON public."MedicoAfiliado";
CREATE POLICY tenant_isolation_select ON public."MedicoAfiliado"
  FOR SELECT
  USING ("organizationId" = public.current_org_id() OR public.is_break_glass());

DROP POLICY IF EXISTS tenant_isolation_modify ON public."MedicoAfiliado";
CREATE POLICY tenant_isolation_modify ON public."MedicoAfiliado"
  FOR ALL
  USING ("organizationId" = public.current_org_id())
  WITH CHECK ("organizationId" = public.current_org_id());

DROP TRIGGER IF EXISTS trg_audit_MedicoAfiliado ON public."MedicoAfiliado";
CREATE TRIGGER trg_audit_MedicoAfiliado
  AFTER INSERT OR UPDATE OR DELETE ON public."MedicoAfiliado"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- -----------------------------------------------------------------------------
-- 3. MedicoAfiliadoEspecialidad — puente n:m, sin organizationId propio.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public."MedicoAfiliadoEspecialidad" (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "medicoAfiliadoId" uuid NOT NULL REFERENCES public."MedicoAfiliado"(id) ON DELETE CASCADE,
  "specialtyId"      uuid NOT NULL REFERENCES public."MedicalSpecialty"(id) ON DELETE RESTRICT,
  "esPrincipal"      boolean NOT NULL DEFAULT false,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MedicoAfiliadoEspecialidad_medicoAfiliadoId_specialtyId_key" UNIQUE ("medicoAfiliadoId", "specialtyId")
);

CREATE INDEX IF NOT EXISTS idx_medico_afiliado_especialidad_medico ON public."MedicoAfiliadoEspecialidad" ("medicoAfiliadoId");

COMMENT ON TABLE public."MedicoAfiliadoEspecialidad" IS
  'Especialidades del médico afiliado (n:m) — US.AFIL.1.2 (REQ-HIS-AFIL-001, CC-0036, sql/244).';

ALTER TABLE public."MedicoAfiliadoEspecialidad" ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public."MedicoAfiliadoEspecialidad" TO authenticated;

-- Patrón `patient_child_isolation_pi` (sql/01_rls_policies.sql): tabla puente
-- sin organizationId propio, RLS vía EXISTS contra el padre. Sin bypass de
-- break-glass explícito en SELECT (esta tabla no contiene PHI ni justifica
-- el acceso de emergencia; el padre MedicoAfiliado sí lo tiene para SELECT).
DROP POLICY IF EXISTS medico_afiliado_especialidad_isolation ON public."MedicoAfiliadoEspecialidad";
CREATE POLICY medico_afiliado_especialidad_isolation ON public."MedicoAfiliadoEspecialidad"
  FOR ALL
  USING (EXISTS (
    SELECT 1 FROM public."MedicoAfiliado" ma
    WHERE ma.id = "medicoAfiliadoId"
      AND (ma."organizationId" = public.current_org_id() OR public.is_break_glass())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public."MedicoAfiliado" ma
    WHERE ma.id = "medicoAfiliadoId"
      AND ma."organizationId" = public.current_org_id()
  ));

DROP TRIGGER IF EXISTS trg_audit_MedicoAfiliadoEspecialidad ON public."MedicoAfiliadoEspecialidad";
CREATE TRIGGER trg_audit_MedicoAfiliadoEspecialidad
  AFTER INSERT OR UPDATE OR DELETE ON public."MedicoAfiliadoEspecialidad"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_row();

-- -----------------------------------------------------------------------------
-- 4. Permission — recursos "consultorio" y "medico_afiliado" (REQ §7.1).
-- -----------------------------------------------------------------------------
INSERT INTO public."Permission" (id, code, resource, action, "createdAt")
SELECT gen_random_uuid(), v.code, v.resource, v.action, now()
FROM (VALUES
  ('consultorio.leer',        'consultorio',      'leer'),
  ('consultorio.crear',       'consultorio',      'crear'),
  ('consultorio.editar',      'consultorio',      'editar'),
  ('consultorio.desactivar',  'consultorio',      'desactivar'),
  ('medico_afiliado.leer',    'medico_afiliado',  'leer'),
  ('medico_afiliado.crear',   'medico_afiliado',  'crear'),
  ('medico_afiliado.editar',  'medico_afiliado',  'editar'),
  ('medico_afiliado.dar_baja','medico_afiliado',  'dar_baja')
) AS v(code, resource, action)
ON CONFLICT (code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. Roles nuevos — uno por organización activa (patrón sql/238 §1).
-- -----------------------------------------------------------------------------
INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, v.code, v.name, v.description, true, now(), now()
FROM public."Organization" o
CROSS JOIN (VALUES
  ('ADMIN_CONSULTORIOS', 'Administrador de Consultorios', 'CC-0036 — gestiona catálogo de consultorios y afiliados (REQ-HIS-AFIL-001 §7.2)'),
  ('MEDICO_AFILIADO',    'Médico Afiliado',                'CC-0036 — acceso propio del médico afiliado (agenda/liquidaciones/estado de cuenta, ABAC $user.medicoAfiliadoId — REQ-HIS-AFIL-001 §7.2/7.3)')
) AS v(code, name, description)
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 6. RolePermission — ADMIN/DIR/ADMIN_CONSULTORIOS administran el catálogo
--    completo; MEDICO_AFILIADO solo lee (su propio registro, acotado por
--    ABAC en una ola posterior — ver nota en medico-afiliado.router.ts).
--    JOIN por code, patrón sql/194 §RolePermission.
-- -----------------------------------------------------------------------------
INSERT INTO public."RolePermission" ("roleId", "permissionId", effect)
SELECT r.id, p.id, 'ALLOW'
FROM (VALUES
  ('ADMIN',               'consultorio.leer'),
  ('ADMIN',               'consultorio.crear'),
  ('ADMIN',               'consultorio.editar'),
  ('ADMIN',               'consultorio.desactivar'),
  ('ADMIN',               'medico_afiliado.leer'),
  ('ADMIN',               'medico_afiliado.crear'),
  ('ADMIN',               'medico_afiliado.editar'),
  ('ADMIN',               'medico_afiliado.dar_baja'),
  ('DIR',                 'consultorio.leer'),
  ('DIR',                 'consultorio.crear'),
  ('DIR',                 'consultorio.editar'),
  ('DIR',                 'consultorio.desactivar'),
  ('DIR',                 'medico_afiliado.leer'),
  ('DIR',                 'medico_afiliado.crear'),
  ('DIR',                 'medico_afiliado.editar'),
  ('DIR',                 'medico_afiliado.dar_baja'),
  ('ADMIN_CONSULTORIOS',  'consultorio.leer'),
  ('ADMIN_CONSULTORIOS',  'consultorio.crear'),
  ('ADMIN_CONSULTORIOS',  'consultorio.editar'),
  ('ADMIN_CONSULTORIOS',  'consultorio.desactivar'),
  ('ADMIN_CONSULTORIOS',  'medico_afiliado.leer'),
  ('ADMIN_CONSULTORIOS',  'medico_afiliado.crear'),
  ('ADMIN_CONSULTORIOS',  'medico_afiliado.editar'),
  ('ADMIN_CONSULTORIOS',  'medico_afiliado.dar_baja'),
  ('MEDICO_AFILIADO',     'medico_afiliado.leer')
) AS g(role_code, perm_code)
JOIN public."Role" r ON r.code = g.role_code
JOIN public."Permission" p ON p.code = g.perm_code
ON CONFLICT ("roleId", "permissionId") DO UPDATE SET effect = 'ALLOW';

COMMIT;
