-- =============================================================================
-- HE-20: Tabla satélite ece.consentimiento_quirurgico
--
-- Almacena los campos específicos de CONS_QX (NTEC §4.12) que no existen
-- en ece.consentimiento_informado. Relación 1:1 vía consentimiento_id.
-- RLS delegada: la policy verifica la existencia de la fila padre en
-- ece.consentimiento_informado (que ya tiene sus propias policies RLS).
--
-- Columnas alineadas exactamente con el INSERT de
-- packages/trpc/src/routers/ece/consentimiento.router.ts:844-856.
-- =============================================================================

CREATE TABLE IF NOT EXISTS ece.consentimiento_quirurgico (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consentimiento_id                 uuid NOT NULL UNIQUE
    REFERENCES ece.consentimiento_informado(id) ON DELETE CASCADE,
  tipo_anestesia                    text NOT NULL
    CHECK (tipo_anestesia IN ('general', 'regional', 'local', 'sedacion', 'combinada')),
  transfusion_autorizada            boolean NOT NULL DEFAULT false,
  ampliacion_quirurgica_autorizada  boolean NOT NULL DEFAULT false,
  fotografia_grabacion_autorizada   boolean NOT NULL DEFAULT false,
  registrado_en                     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cons_qx_consentimiento
  ON ece.consentimiento_quirurgico (consentimiento_id);

-- RLS: hereda visibilidad del consentimiento padre
ALTER TABLE ece.consentimiento_quirurgico ENABLE ROW LEVEL SECURITY;

CREATE POLICY cons_qx_select_by_consentimiento ON ece.consentimiento_quirurgico
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ece.consentimiento_informado ci
      WHERE ci.id = consentimiento_quirurgico.consentimiento_id
    )
  );

CREATE POLICY cons_qx_insert_by_consentimiento ON ece.consentimiento_quirurgico
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM ece.consentimiento_informado ci
      WHERE ci.id = consentimiento_quirurgico.consentimiento_id
    )
  );

-- UPDATE y DELETE bloqueados: la inmutabilidad del consentimiento firmado
-- (trigger fn_bloquea_mutacion_consentimiento en consentimiento_informado)
-- hace innecesario mutar esta tabla satélite post-firma.

GRANT SELECT, INSERT ON ece.consentimiento_quirurgico TO authenticated;
