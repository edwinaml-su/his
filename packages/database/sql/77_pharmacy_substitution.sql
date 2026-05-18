-- =====================================================================
-- 77_pharmacy_substitution.sql
-- US.F2.6.11 — Sustitución genérico-comercial autorizada.
--
-- Tablas:
--   ece.gs1_gtin_sustitucion  — catálogo de equivalencias GTIN AUTORIZADAS
--                               (Stream 04: relación M:M entre GTIN original
--                               y GTIN sustituto).
--   ece.pharmacy_substitution — instancia de sustitución por orden de despacho
--                               (Stream 01: flujo propuesta → autorización).
--
-- RLS:
--   gs1_gtin_sustitucion: Cat-E (catálogo global). SELECT authenticated.
--   pharmacy_substitution: Cat-B (tenant-scoped). Filtrado por org vía GUC.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + DROP/CREATE POLICY.
-- =====================================================================

-- -----------------------------------------------------------------------
-- gs1_gtin_sustitucion — equivalencias autorizadas entre GTIN
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.gs1_gtin_sustitucion (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- GTIN que se queda sin stock y necesita sustitución
  gtin_original    char(14)     NOT NULL
                     REFERENCES ece.gs1_gtin(codigo) ON DELETE RESTRICT
                     DEFERRABLE INITIALLY DEFERRED,
  -- GTIN equivalente que puede reemplazarlo
  gtin_sustituto   char(14)     NOT NULL
                     REFERENCES ece.gs1_gtin(codigo) ON DELETE RESTRICT
                     DEFERRABLE INITIALLY DEFERRED,
  -- AUTORIZADA = validada por comité farmacéutico; PROVISIONAL = pendiente revisión
  estado           text         NOT NULL DEFAULT 'AUTORIZADA'
                     CHECK (estado IN ('AUTORIZADA','PROVISIONAL','REVOCADA')),
  notas            text,
  creado_en        timestamptz  NOT NULL DEFAULT now(),
  actualizado_en   timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_gtin_sustitucion UNIQUE (gtin_original, gtin_sustituto),
  -- No se permite una sustitución consigo mismo
  CONSTRAINT ck_gtin_no_self CHECK (gtin_original <> gtin_sustituto)
);

CREATE INDEX IF NOT EXISTS idx_gtin_sustitucion_original
  ON ece.gs1_gtin_sustitucion (gtin_original)
  WHERE estado = 'AUTORIZADA';

CREATE INDEX IF NOT EXISTS idx_gtin_sustitucion_sustituto
  ON ece.gs1_gtin_sustitucion (gtin_sustituto);

COMMENT ON TABLE ece.gs1_gtin_sustitucion IS
  'Catálogo de equivalencias genérico-comercial AUTORIZADAS entre GTIN. '
  'Stream 04 — guia §2.4 (sustituciones autorizadas). '
  'Un par (original, sustituto) puede aparecer en ambas direcciones '
  'si la equivalencia es bidireccional.';

COMMENT ON COLUMN ece.gs1_gtin_sustitucion.gtin_original IS
  'GTIN-14 del medicamento original que se agota. FK a ece.gs1_gtin.';
COMMENT ON COLUMN ece.gs1_gtin_sustitucion.gtin_sustituto IS
  'GTIN-14 del equivalente autorizado. FK a ece.gs1_gtin.';
COMMENT ON COLUMN ece.gs1_gtin_sustitucion.estado IS
  'AUTORIZADA: aprobada por comité; PROVISIONAL: en revisión; REVOCADA: ya no válida.';

-- RLS Cat-E
ALTER TABLE ece.gs1_gtin_sustitucion ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gs1_gtin_sustitucion_select ON ece.gs1_gtin_sustitucion;
CREATE POLICY gs1_gtin_sustitucion_select ON ece.gs1_gtin_sustitucion
  FOR SELECT
  TO authenticated
  USING (true);

-- -----------------------------------------------------------------------
-- pharmacy_substitution — instancias de sustitución por despacho
-- -----------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS ece.pharmacy_substitution (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  -- FK lógica al orden de despacho (public."Prescription".id o futuro PharmacyOrder.id)
  prescription_id       uuid         NOT NULL,
  organization_id       uuid         NOT NULL,
  -- El ítem específico de la receta que se va a sustituir
  prescription_item_id  uuid         NOT NULL,
  gtin_original         char(14)     NOT NULL
                          REFERENCES ece.gs1_gtin(codigo) ON DELETE RESTRICT
                          DEFERRABLE INITIALLY DEFERRED,
  gtin_sustituto        char(14)     NOT NULL
                          REFERENCES ece.gs1_gtin(codigo) ON DELETE RESTRICT
                          DEFERRABLE INITIALLY DEFERRED,
  -- FK de auditoría: enlace al catálogo de equivalencia que autorizó este par
  sustitucion_catalogo_id uuid       NOT NULL
                          REFERENCES ece.gs1_gtin_sustitucion(id) ON DELETE RESTRICT,
  -- PENDIENTE_AUTORIZACION → AUTORIZADA | RECHAZADA
  status                text         NOT NULL DEFAULT 'PENDIENTE_AUTORIZACION'
                          CHECK (status IN ('PENDIENTE_AUTORIZACION','AUTORIZADA','RECHAZADA')),
  -- Farmacéutico que propone
  propuesto_por_id      uuid         NOT NULL,
  propuesto_en          timestamptz  NOT NULL DEFAULT now(),
  -- Médico prescriptor que autoriza/rechaza
  autorizado_por_id     uuid,
  autorizado_en         timestamptz,
  -- Motivo del médico (obligatorio al autorizar o rechazar)
  motivo                text,
  -- EPCIS WHAT dimension: persiste gtins para el evento de dispensación
  epcis_what            jsonb        GENERATED ALWAYS AS (
                          jsonb_build_object(
                            'original', gtin_original,
                            'sustituto', gtin_sustituto,
                            'substitutionId', id::text
                          )
                        ) STORED,
  creado_en             timestamptz  NOT NULL DEFAULT now(),
  actualizado_en        timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT ck_sub_no_self CHECK (gtin_original <> gtin_sustituto),
  -- Un ítem de receta solo puede tener una sustitución activa a la vez
  CONSTRAINT uq_sub_item_pendiente UNIQUE (prescription_item_id)
);

CREATE INDEX IF NOT EXISTS idx_pharm_sub_prescription
  ON ece.pharmacy_substitution (prescription_id);
CREATE INDEX IF NOT EXISTS idx_pharm_sub_org
  ON ece.pharmacy_substitution (organization_id);
CREATE INDEX IF NOT EXISTS idx_pharm_sub_autorizado_por
  ON ece.pharmacy_substitution (autorizado_por_id)
  WHERE autorizado_por_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pharm_sub_status
  ON ece.pharmacy_substitution (status)
  WHERE status = 'PENDIENTE_AUTORIZACION';

COMMENT ON TABLE ece.pharmacy_substitution IS
  'Instancia de sustitución genérico-comercial por prescripción. '
  'US.F2.6.11 — flujo propuesta → autorización médica → dispensación con GTIN alternativo. '
  'epcis_what es columna generada para incluir en evento EPCIS al dispensar.';

COMMENT ON COLUMN ece.pharmacy_substitution.epcis_what IS
  'JSONB generado: {original, sustituto, substitutionId}. '
  'Se incluye en EpcisEvent.WHAT dimension al confirmar la dispensación.';

-- RLS Cat-B (tenant-scoped)
ALTER TABLE ece.pharmacy_substitution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pharm_sub_select ON ece.pharmacy_substitution;
CREATE POLICY pharm_sub_select ON ece.pharmacy_substitution
  FOR SELECT
  TO authenticated
  USING (
    organization_id = ece.current_establecimiento_id_safe()
    OR current_setting('app.current_org_id', true) = organization_id::text
  );

DROP POLICY IF EXISTS pharm_sub_insert ON ece.pharmacy_substitution;
CREATE POLICY pharm_sub_insert ON ece.pharmacy_substitution
  FOR INSERT
  TO authenticated
  WITH CHECK (
    organization_id = ece.current_establecimiento_id_safe()
    OR current_setting('app.current_org_id', true) = organization_id::text
  );

DROP POLICY IF EXISTS pharm_sub_update ON ece.pharmacy_substitution;
CREATE POLICY pharm_sub_update ON ece.pharmacy_substitution
  FOR UPDATE
  TO authenticated
  USING (
    organization_id = ece.current_establecimiento_id_safe()
    OR current_setting('app.current_org_id', true) = organization_id::text
  );
