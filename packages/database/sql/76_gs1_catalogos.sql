-- =====================================================================
-- 76_gs1_catalogos.sql
-- GS1 Healthcare Standards — Catálogos maestros en schema ece.
--
-- Estándar: GS1 General Specifications v23 + GS1 Healthcare Implementation
--   Guidelines. Soporta DSCSA / EPCIS / FMD para trazabilidad de cadena
--   farmacéutica y logística hospitalaria.
--
-- Tablas:
--   ece.gs1_gtin  — Global Trade Item Number (14 dígitos, productos/medicamentos)
--   ece.gs1_gln   — Global Location Number (13 dígitos, ubicaciones físicas)
--   ece.gs1_sscc  — Serial Shipping Container Code (18 dígitos, pallets/containers)
--   ece.gs1_gsrn  — Global Service Relation Number (18 dígitos, pacientes y staff)
--   ece.gs1_giai  — Global Individual Asset Identifier (variable, equipos médicos)
--
-- RLS: Categoría E (Cat-E) — catálogos globales de referencia.
--   SELECT: abierto a `authenticated`.
--   INSERT/UPDATE/DELETE: solo `service_role` (BYPASSRLS).
--   No se necesitan policies explícitas de escritura porque service_role
--   las bypasa; solo se declara la policy SELECT.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP POLICY IF EXISTS + CREATE POLICY.
-- Aplicar vía mcp__supabase__apply_migration dentro de una transacción.
-- =====================================================================

-- -----------------------------------------------------------------------
-- Helper: validación de dígito verificador GS1 (algoritmo GS1-13/14/18)
-- Aplica a GTIN-14, GLN-13, SSCC-18, GSRN-18.
-- Recibe la cadena completa (incluye dígito verificador en última posición).
-- Retorna true si el código es válido.
-- -----------------------------------------------------------------------

CREATE OR REPLACE FUNCTION ece.gs1_check_digit_valid(p_code text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE STRICT
AS $$
DECLARE
  v_len    int;
  v_sum    int := 0;
  v_digit  int;
  v_weight int;
  i        int;
BEGIN
  v_len := length(p_code);
  -- Solo dígitos
  IF p_code !~ '^\d+$' THEN
    RETURN false;
  END IF;

  -- Algoritmo: suma ponderada con factor 3/1 alternado desde la derecha
  -- (penúltimo dígito tiene el primer factor, varía según longitud).
  FOR i IN 1 .. (v_len - 1) LOOP
    -- Factor: posición desde la derecha (1-based excluye check digit)
    v_weight := CASE WHEN (v_len - i) % 2 = 1 THEN 3 ELSE 1 END;
    v_sum := v_sum + substring(p_code, i, 1)::int * v_weight;
  END LOOP;

  v_digit := (10 - (v_sum % 10)) % 10;
  RETURN v_digit = substring(p_code, v_len, 1)::int;
END;
$$;

COMMENT ON FUNCTION ece.gs1_check_digit_valid(text) IS
  'Valida el dígito verificador GS1 (Módulo-10). Aplica a GTIN-14, GLN-13, SSCC-18, GSRN-18. '
  'Retorna true si la cadena es válida. IMMUTABLE — usable en CHECK constraints.';

-- -----------------------------------------------------------------------
-- GTIN — Global Trade Item Number (14 dígitos)
-- Identifica productos comerciales: medicamentos, insumos, dispositivos.
-- El código ATC (Anatomical Therapeutic Chemical) vincula con clasificación OMS.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_gtin (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            char(14)    NOT NULL
                      CHECK (ece.gs1_check_digit_valid(codigo))
                      CHECK (codigo ~ '^\d{14}$'),
  descripcion       text        NOT NULL,
  fabricante        text        NOT NULL,
  presentacion      text        NOT NULL,
  contenido_unidades numeric(10,3) NOT NULL CHECK (contenido_unidades > 0),
  principio_activo  text,
  codigo_atc        text
                      CHECK (codigo_atc IS NULL OR codigo_atc ~ '^[A-Z]\d{2}[A-Z]{2}\d{2}$'),
  activo            boolean     NOT NULL DEFAULT true,
  creado_en         timestamptz NOT NULL DEFAULT now(),
  actualizado_en    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gs1_gtin_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_gs1_gtin_codigo        ON ece.gs1_gtin (codigo);
CREATE INDEX IF NOT EXISTS idx_gs1_gtin_principio     ON ece.gs1_gtin (principio_activo)
  WHERE principio_activo IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gs1_gtin_codigo_atc    ON ece.gs1_gtin (codigo_atc)
  WHERE codigo_atc IS NOT NULL;

COMMENT ON TABLE ece.gs1_gtin IS
  'Global Trade Item Number (GTIN-14). '
  'Catálogo de productos: medicamentos, insumos y dispositivos médicos. '
  'Alineado con GS1 Healthcare + estándar ATC-OMS para principio_activo.';
COMMENT ON COLUMN ece.gs1_gtin.codigo IS
  'GTIN-14: 14 dígitos con dígito verificador GS1 Módulo-10 válido.';
COMMENT ON COLUMN ece.gs1_gtin.codigo_atc IS
  'Clasificación ATC de la OMS: 1 letra + 2 dígitos + 2 letras + 2 dígitos (p.ej. A02BC01).';
COMMENT ON COLUMN ece.gs1_gtin.contenido_unidades IS
  'Cantidad de unidades de dispensación en la presentación (ej. 30 comprimidos).';

-- -----------------------------------------------------------------------
-- GLN — Global Location Number (13 dígitos)
-- Identifica ubicaciones físicas: farmacias, depósitos, servicios, camas.
-- FK a ece.establecimiento para aislamiento multi-tenant.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_gln (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              char(13)    NOT NULL
                        CHECK (ece.gs1_check_digit_valid(codigo))
                        CHECK (codigo ~ '^\d{13}$'),
  descripcion         text        NOT NULL,
  tipo                text        NOT NULL
                        CHECK (tipo IN ('proveedor','deposito','farmacia','servicio','cama')),
  establecimiento_id  uuid        REFERENCES ece.establecimiento(id) ON DELETE SET NULL,
  activo              boolean     NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  actualizado_en      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gs1_gln_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_gs1_gln_codigo        ON ece.gs1_gln (codigo);
CREATE INDEX IF NOT EXISTS idx_gs1_gln_establecimiento ON ece.gs1_gln (establecimiento_id)
  WHERE establecimiento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gs1_gln_tipo          ON ece.gs1_gln (tipo);

COMMENT ON TABLE ece.gs1_gln IS
  'Global Location Number (GLN-13). '
  'Catálogo de ubicaciones físicas: farmacias, depósitos, servicios, camas. '
  'Alineado con GS1 General Specifications v23.';
COMMENT ON COLUMN ece.gs1_gln.codigo IS
  'GLN-13: 13 dígitos con dígito verificador GS1 Módulo-10 válido.';
COMMENT ON COLUMN ece.gs1_gln.tipo IS
  'Categoría funcional: proveedor|deposito|farmacia|servicio|cama.';

-- -----------------------------------------------------------------------
-- SSCC — Serial Shipping Container Code (18 dígitos)
-- Identifica pallets/containers logísticos. Contenido libre (JSONB) para
-- soportar EPCIS y trazabilidad de cadena de frío.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_sscc (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           char(18)    NOT NULL
                     CHECK (ece.gs1_check_digit_valid(codigo))
                     CHECK (codigo ~ '^\d{18}$'),
  tipo_contenedor  text        NOT NULL,
  origen_gln       char(13)    REFERENCES ece.gs1_gln(codigo)
                     DEFERRABLE INITIALLY DEFERRED,
  destino_gln      char(13)    REFERENCES ece.gs1_gln(codigo)
                     DEFERRABLE INITIALLY DEFERRED,
  contenido        jsonb       NOT NULL DEFAULT '[]',
  estado           text        NOT NULL DEFAULT 'activo'
                     CHECK (estado IN ('activo','en_transito','recibido','anulado')),
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gs1_sscc_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_gs1_sscc_codigo     ON ece.gs1_sscc (codigo);
CREATE INDEX IF NOT EXISTS idx_gs1_sscc_origen     ON ece.gs1_sscc (origen_gln)
  WHERE origen_gln IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gs1_sscc_destino    ON ece.gs1_sscc (destino_gln)
  WHERE destino_gln IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_gs1_sscc_contenido  ON ece.gs1_sscc USING GIN (contenido);

COMMENT ON TABLE ece.gs1_sscc IS
  'Serial Shipping Container Code (SSCC-18). '
  'Identifica pallets y containers logísticos. '
  'Soporta trazabilidad EPCIS / cadena de frío farmacéutica.';
COMMENT ON COLUMN ece.gs1_sscc.codigo IS
  'SSCC-18: 18 dígitos con dígito verificador GS1 Módulo-10 válido.';
COMMENT ON COLUMN ece.gs1_sscc.contenido IS
  'JSONB libre con lista de GTINs/lotes incluidos en el container. '
  'Estructura recomendada: [{gtin, lote, cantidad, fecha_vencimiento}].';

-- -----------------------------------------------------------------------
-- GSRN — Global Service Relation Number (18 dígitos)
-- Identifica pacientes y profesionales en el sistema de salud.
-- referencia_id apunta al id en public."Patient" o public."User" según tipo.
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_gsrn (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo              char(18)    NOT NULL
                        CHECK (ece.gs1_check_digit_valid(codigo))
                        CHECK (codigo ~ '^\d{18}$'),
  tipo                text        NOT NULL
                        CHECK (tipo IN ('paciente','profesional')),
  referencia_id       uuid        NOT NULL,
  establecimiento_id  uuid        REFERENCES ece.establecimiento(id) ON DELETE SET NULL,
  activo              boolean     NOT NULL DEFAULT true,
  creado_en           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gs1_gsrn_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_gs1_gsrn_codigo       ON ece.gs1_gsrn (codigo);
CREATE INDEX IF NOT EXISTS idx_gs1_gsrn_referencia   ON ece.gs1_gsrn (referencia_id);
CREATE INDEX IF NOT EXISTS idx_gs1_gsrn_tipo         ON ece.gs1_gsrn (tipo);
CREATE INDEX IF NOT EXISTS idx_gs1_gsrn_establecimiento ON ece.gs1_gsrn (establecimiento_id)
  WHERE establecimiento_id IS NOT NULL;

COMMENT ON TABLE ece.gs1_gsrn IS
  'Global Service Relation Number (GSRN-18). '
  'Identifica beneficiarios (pacientes) y proveedores de servicio (profesionales). '
  'referencia_id es FK polimórfica: public."Patient".id o public."User".id según tipo.';
COMMENT ON COLUMN ece.gs1_gsrn.codigo IS
  'GSRN-18: 18 dígitos con dígito verificador GS1 Módulo-10 válido.';
COMMENT ON COLUMN ece.gs1_gsrn.referencia_id IS
  'UUID del registro en public."Patient" (tipo=paciente) o public."User" (tipo=profesional). '
  'FK polimórfica sin restricción de BD para soportar ambas entidades.';

-- -----------------------------------------------------------------------
-- GIAI — Global Individual Asset Identifier (longitud variable)
-- Identifica equipos médicos individuales: serial único por dispositivo.
-- Código sin restricción de dígito verificador (GS1 lo define libre).
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_giai (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo           text        NOT NULL
                     CHECK (length(codigo) BETWEEN 1 AND 30)
                     CHECK (codigo ~ '^[0-9A-Za-z\-\.]+$'),
  descripcion      text        NOT NULL,
  fabricante       text        NOT NULL,
  modelo           text        NOT NULL,
  serial           text        NOT NULL,
  activo           boolean     NOT NULL DEFAULT true,
  creado_en        timestamptz NOT NULL DEFAULT now(),
  actualizado_en   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_gs1_giai_codigo UNIQUE (codigo)
);

CREATE INDEX IF NOT EXISTS idx_gs1_giai_codigo      ON ece.gs1_giai (codigo);
CREATE INDEX IF NOT EXISTS idx_gs1_giai_fabricante  ON ece.gs1_giai (fabricante);
CREATE INDEX IF NOT EXISTS idx_gs1_giai_serial      ON ece.gs1_giai (serial);

COMMENT ON TABLE ece.gs1_giai IS
  'Global Individual Asset Identifier (GIAI). '
  'Identifica activos individuales: equipos médicos, ventiladores, monitores, etc. '
  'Longitud variable (GS1 Spec §2.1.16). Sin dígito verificador obligatorio.';
COMMENT ON COLUMN ece.gs1_giai.codigo IS
  'GIAI: 1-30 caracteres alfanuméricos. Alfanumérico sin dígito verificador.';
COMMENT ON COLUMN ece.gs1_giai.serial IS
  'Número de serie del fabricante; combinado con fabricante+modelo forma clave natural.';

-- -----------------------------------------------------------------------
-- RLS — Categoría E (Cat-E): catálogos globales de referencia.
--
-- Política:
--   SELECT: abierto a `authenticated` (datos de referencia, sin tenant).
--   INSERT/UPDATE/DELETE: solo `service_role` (BYPASSRLS) — no se declara
--     policy explícita de escritura; el rol authenticated no puede escribir.
--
-- Estas tablas son catálogos de referencia cruzados entre establecimientos
-- (un GTIN es el mismo en toda la red), por lo que NO se aplica filtro por
-- establecimiento_id en la policy SELECT global.
-- -----------------------------------------------------------------------

ALTER TABLE ece.gs1_gtin  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.gs1_gln   ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.gs1_sscc  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.gs1_gsrn  ENABLE ROW LEVEL SECURITY;
ALTER TABLE ece.gs1_giai  ENABLE ROW LEVEL SECURITY;

-- GTIN
DROP POLICY IF EXISTS gs1_gtin_select ON ece.gs1_gtin;
CREATE POLICY gs1_gtin_select ON ece.gs1_gtin
  FOR SELECT
  TO authenticated
  USING (true);

-- GLN: SELECT global; filtra por establecimiento en la app, no en la policy,
-- porque el GLN de un proveedor externo no tiene establecimiento_id.
DROP POLICY IF EXISTS gs1_gln_select ON ece.gs1_gln;
CREATE POLICY gs1_gln_select ON ece.gs1_gln
  FOR SELECT
  TO authenticated
  USING (true);

-- SSCC
DROP POLICY IF EXISTS gs1_sscc_select ON ece.gs1_sscc;
CREATE POLICY gs1_sscc_select ON ece.gs1_sscc
  FOR SELECT
  TO authenticated
  USING (true);

-- GSRN: visible solo dentro del establecimiento del personal en sesión.
DROP POLICY IF EXISTS gs1_gsrn_select ON ece.gs1_gsrn;
CREATE POLICY gs1_gsrn_select ON ece.gs1_gsrn
  FOR SELECT
  TO authenticated
  USING (
    establecimiento_id IS NULL
    OR establecimiento_id = ece.current_establecimiento_id_safe()
  );

-- GIAI
DROP POLICY IF EXISTS gs1_giai_select ON ece.gs1_giai;
CREATE POLICY gs1_giai_select ON ece.gs1_giai
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON TABLE ece.gs1_gtin IS
  'GTIN-14: catálogo global de productos (medicamentos/insumos). '
  'RLS Cat-E: SELECT abierto a authenticated; escritura solo service_role.';
COMMENT ON TABLE ece.gs1_gln IS
  'GLN-13: catálogo global de ubicaciones físicas. '
  'RLS Cat-E: SELECT abierto a authenticated; escritura solo service_role.';
COMMENT ON TABLE ece.gs1_sscc IS
  'SSCC-18: containers logísticos. '
  'RLS Cat-E: SELECT abierto a authenticated; escritura solo service_role.';
COMMENT ON TABLE ece.gs1_gsrn IS
  'GSRN-18: pacientes y profesionales. '
  'RLS Cat-E: SELECT filtrado por establecimiento_id; escritura solo service_role.';
COMMENT ON TABLE ece.gs1_giai IS
  'GIAI: activos individuales (equipos). '
  'RLS Cat-E: SELECT abierto a authenticated; escritura solo service_role.';
