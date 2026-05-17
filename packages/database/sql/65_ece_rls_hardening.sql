-- ============================================================================
-- 65_ece_rls_hardening.sql
--
-- HABILITACIÓN DE RLS EN 39 TABLAS RESTANTES DEL SCHEMA `ece`.
--
-- Motivación: Supabase advisory crítico — `service_role` (BYPASSRLS) está
-- protegido, pero `anon` y `authenticated` veían filas sin filtro. NTEC
-- Art. 45-52 obliga aislamiento por establecimiento.
--
-- Estrategia:
--   - Catálogos globales (rol, tipo_documento, …): SELECT permissive
--     a `authenticated`; INSERT/UPDATE/DELETE solo `service_role` (BYPASSRLS
--     hace el trabajo, no se necesita policy explícita para escritura).
--   - Infraestructura por establecimiento (establecimiento, servicio, cama):
--     SELECT solo si establecimiento_id matches `app.ece_establecimiento_id`.
--   - Personal (personal_salud, firma_electronica, asignacion_rol): SELECT
--     según establecimiento; FE adicional: el dueño SELF.
--   - Datos clínicos por episodio: JOIN con episodio_atencion.establecimiento_id.
--   - Datos por paciente: JOIN con paciente.establecimiento_id.
--   - Historial inmutable (documento_instancia_historial): SELECT por episodio;
--     INSERT/UPDATE/DELETE bloqueado (trigger lo escribe via service_role).
--
-- IMPORTANTE: `ece.set_ece_context(personal_id, establecimiento_id)` (definida
-- en SQL 62) setea los GUC. Las queries de aplicación corren via `withEceContext`
-- que demota a `authenticated` y aplica las policies. El `service_role` siempre
-- bypasa.
--
-- Idempotente: ENABLE ROW LEVEL SECURITY es no-op si ya está; las policies
-- usan DROP+CREATE para garantizar el shape exacto.
-- ============================================================================

-- Helper: extrae el GUC del establecimiento activo. NULL si no está seteado
-- (caso fuera de tx con contexto ECE — la policy negará acceso).
CREATE OR REPLACE FUNCTION ece.current_establecimiento_id_safe()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.ece_establecimiento_id', true), '')::uuid
$$;

COMMENT ON FUNCTION ece.current_establecimiento_id_safe() IS
  'Extrae el GUC app.ece_establecimiento_id de forma segura (NULL si no seteado). Usada por policies RLS de ece.*';

-- ============================================================================
-- A. CATÁLOGOS GLOBALES — SELECT abierto a authenticated
-- ============================================================================

ALTER TABLE ece.rol               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.catalogo_valor    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.tipo_documento    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.flujo_estado      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.flujo_transicion  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.documento_rol     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.perfil_acceso     ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.institucion       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS catalogo_read_all ON ece.rol;
CREATE POLICY catalogo_read_all ON ece.rol FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.catalogo_valor;
CREATE POLICY catalogo_read_all ON ece.catalogo_valor FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.tipo_documento;
CREATE POLICY catalogo_read_all ON ece.tipo_documento FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.flujo_estado;
CREATE POLICY catalogo_read_all ON ece.flujo_estado FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.flujo_transicion;
CREATE POLICY catalogo_read_all ON ece.flujo_transicion FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.documento_rol;
CREATE POLICY catalogo_read_all ON ece.documento_rol FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.perfil_acceso;
CREATE POLICY catalogo_read_all ON ece.perfil_acceso FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS catalogo_read_all ON ece.institucion;
CREATE POLICY catalogo_read_all ON ece.institucion FOR SELECT TO authenticated USING (true);

-- ============================================================================
-- B. INFRAESTRUCTURA POR ESTABLECIMIENTO
-- ============================================================================

ALTER TABLE ece.establecimiento ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.servicio        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.cama            ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS establecimiento_by_ctx ON ece.establecimiento;
CREATE POLICY establecimiento_by_ctx ON ece.establecimiento
  FOR ALL TO authenticated
  USING (id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS servicio_by_estab ON ece.servicio;
CREATE POLICY servicio_by_estab ON ece.servicio
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

DROP POLICY IF EXISTS cama_by_servicio ON ece.cama;
CREATE POLICY cama_by_servicio ON ece.cama
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.servicio s
     WHERE s.id = ece.cama.servicio_id
       AND s.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- ============================================================================
-- C. PERSONAL Y SEGURIDAD
-- ============================================================================

ALTER TABLE ece.personal_salud  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.firma_electronica ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.asignacion_rol  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS personal_by_estab ON ece.personal_salud;
CREATE POLICY personal_by_estab ON ece.personal_salud
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

-- Firma electrónica: el dueño SELF puede leer/escribir (vía personal_id).
-- Sin GUC SELF activo, denegado. Catálogos no usan esta tabla.
DROP POLICY IF EXISTS firma_self_only ON ece.firma_electronica;
CREATE POLICY firma_self_only ON ece.firma_electronica
  FOR ALL TO authenticated
  USING (
    personal_id = NULLIF(current_setting('app.ece_personal_id', true), '')::uuid
  );

DROP POLICY IF EXISTS asignacion_rol_by_estab ON ece.asignacion_rol;
CREATE POLICY asignacion_rol_by_estab ON ece.asignacion_rol
  FOR ALL TO authenticated
  USING (establecimiento_id = ece.current_establecimiento_id_safe());

-- ============================================================================
-- D. DATOS POR PACIENTE (FK paciente_id; paciente.establecimiento_id es el filtro)
-- ============================================================================

ALTER TABLE ece.identificador_paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.responsable_paciente   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.afiliacion_isss        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS by_paciente_estab ON ece.identificador_paciente;
CREATE POLICY by_paciente_estab ON ece.identificador_paciente
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.paciente p
     WHERE p.id = ece.identificador_paciente.paciente_id
       AND p.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

DROP POLICY IF EXISTS by_paciente_estab ON ece.responsable_paciente;
CREATE POLICY by_paciente_estab ON ece.responsable_paciente
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.paciente p
     WHERE p.id = ece.responsable_paciente.paciente_id
       AND p.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

DROP POLICY IF EXISTS by_paciente_estab ON ece.afiliacion_isss;
CREATE POLICY by_paciente_estab ON ece.afiliacion_isss
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.paciente p
     WHERE p.id = ece.afiliacion_isss.paciente_id
       AND p.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- ============================================================================
-- E. DATOS POR EPISODIO (FK episodio_id; episodio_atencion.establecimiento_id)
-- ============================================================================

ALTER TABLE ece.episodio_hospitalario       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.asignacion_cama             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.episodio_estado_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.signos_vitales              ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.hoja_triaje                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.atencion_emergencia         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.indicaciones_medicas        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.registro_enfermeria         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.consentimiento_informado    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.rri                         ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.orden_ingreso               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.hoja_ingreso                ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.acto_quirurgico             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.documentos_obstetricos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.epicrisis_egreso            ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.certificado_defuncion       ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.certificado_incapacidad_isss ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.solicitud_estudio           ENABLE ROW LEVEL SECURITY;

-- Macro mental: cada tabla con `episodio_id` tiene esta policy:
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'episodio_hospitalario',
      'asignacion_cama',
      'episodio_estado_log',
      'signos_vitales',
      'hoja_triaje',
      'atencion_emergencia',
      'indicaciones_medicas',
      'registro_enfermeria',
      'consentimiento_informado',
      'rri',
      'orden_ingreso',
      'hoja_ingreso',
      'acto_quirurgico',
      'documentos_obstetricos',
      'epicrisis_egreso',
      'certificado_defuncion',
      'certificado_incapacidad_isss',
      'solicitud_estudio'
    ])
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS by_episodio_estab ON ece.%I', t);
    EXECUTE format($f$
      CREATE POLICY by_episodio_estab ON ece.%I
        FOR ALL TO authenticated
        USING (EXISTS (
          SELECT 1 FROM ece.episodio_atencion ea
           WHERE ea.id = ece.%I.episodio_id
             AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
        ))
    $f$, t, t);
  END LOOP;
END $$;

-- ============================================================================
-- F. TABLAS HIJAS SIN COLUMNA TENANT DIRECTA (FK a parent)
-- ============================================================================

ALTER TABLE ece.indicacion_item             ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.administracion_medicamento  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.resultado_estudio           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.documento_instancia_historial ENABLE ROW LEVEL SECURITY;

-- indicacion_item → indicaciones_medicas.episodio_id
DROP POLICY IF EXISTS by_parent_episodio ON ece.indicacion_item;
CREATE POLICY by_parent_episodio ON ece.indicacion_item
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.indicaciones_medicas im
      JOIN ece.episodio_atencion ea ON ea.id = im.episodio_id
     WHERE im.id = ece.indicacion_item.indicacion_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- administracion_medicamento → indicacion_item → indicaciones_medicas
DROP POLICY IF EXISTS by_parent_episodio ON ece.administracion_medicamento;
CREATE POLICY by_parent_episodio ON ece.administracion_medicamento
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.indicacion_item ii
      JOIN ece.indicaciones_medicas im ON im.id = ii.indicacion_id
      JOIN ece.episodio_atencion ea ON ea.id = im.episodio_id
     WHERE ii.id = ece.administracion_medicamento.indicacion_item_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- resultado_estudio → solicitud_estudio.episodio_id
DROP POLICY IF EXISTS by_parent_episodio ON ece.resultado_estudio;
CREATE POLICY by_parent_episodio ON ece.resultado_estudio
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.solicitud_estudio se
      JOIN ece.episodio_atencion ea ON ea.id = se.episodio_id
     WHERE se.id = ece.resultado_estudio.solicitud_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- documento_instancia_historial → documento_instancia
-- Inmutable: solo SELECT permitido a authenticated; INSERT/UPDATE/DELETE
-- bloqueado (los triggers escriben via service_role que bypasa RLS).
DROP POLICY IF EXISTS historial_read_by_instancia ON ece.documento_instancia_historial;
CREATE POLICY historial_read_by_instancia ON ece.documento_instancia_historial
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.documento_instancia di
      JOIN ece.episodio_atencion ea ON ea.id = di.episodio_id
     WHERE di.id = ece.documento_instancia_historial.instancia_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- ============================================================================
-- VERIFICACIÓN: las 7 tablas con RLS preexistente no se tocan
-- (paciente, episodio_atencion, historia_clinica, evolucion_medica,
--  documento_instancia, bitacora_acceso, rectificacion ya tenían políticas).
-- ============================================================================
