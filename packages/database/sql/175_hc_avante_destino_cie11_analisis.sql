-- =====================================================================
-- 175_hc_avante_destino_cie11_analisis.sql
-- Control de cambios CC-0001 — pantalla Historia Clínica (Avante v1.0).
-- Requerimiento_HC_Avante_v1.0.md (NTEC Art. 7). Cambios de modelo:
--
--   RF-05  Análisis clínico  → nueva columna ece.historia_clinica.analisis_clinico
--   RF-06  Destino (8 opc.)  → reusar columna `disposicion`, migrar su CHECK
--                              de 4 valores legacy a los 8 valores Destino
--   RF-03  Diagnósticos CIE-11→ relajar ece.fn_validate_diagnosticos_cie10 para
--                              aceptar códigos CIE-11 MMS además de CIE-10 legacy,
--                              y la clave JSON 'codigo' (dominio) o 'code' (legacy)
--   RF-04  Signos vitales     → ece.signos_vitales.observaciones (texto por toma)
--
-- ece.historia_clinica está VACÍA en prod al 2026-06-23 (0 filas) — la migración
-- de `disposicion` no tiene datos que mapear; el UPDATE guardado queda por
-- seguridad/idempotencia si aparecieran filas legacy.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =====================================================================

-- ── RF-05 — Análisis clínico ──────────────────────────────────────────
ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS analisis_clinico text;

COMMENT ON COLUMN ece.historia_clinica.analisis_clinico IS
  'RF-05 CC-0001 — razonamiento/correlación clínica (entre Diagnósticos y Plan).';

-- ── RF-06 — Destino (catálogo cerrado de 8 opciones) ──────────────────
-- Reusa la columna `disposicion`. Mapea valores legacy → Destino (no-op si vacía).
UPDATE ece.historia_clinica
SET disposicion = CASE disposicion
    WHEN 'alta_ambulatoria' THEN 'ALTA_MEDICA'
    WHEN 'orden_ingreso'    THEN 'INGRESO'
    WHEN 'referencia'       THEN 'REFERENCIA'
    WHEN 'observacion'      THEN 'OBSERVACION'
    ELSE disposicion
  END
WHERE disposicion IN ('alta_ambulatoria', 'orden_ingreso', 'referencia', 'observacion');

ALTER TABLE ece.historia_clinica
  DROP CONSTRAINT IF EXISTS historia_clinica_disposicion_check;

ALTER TABLE ece.historia_clinica
  ADD CONSTRAINT historia_clinica_disposicion_check
  CHECK (
    disposicion IS NULL OR disposicion = ANY (ARRAY[
      'INGRESO',
      'ALTA_MEDICA',
      'ALTA_VOLUNTARIA',
      'SEGUIMIENTO',
      'OBSERVACION',
      'PROCEDIMIENTO_AMBULATORIO',
      'REFERENCIA',
      'REMISION'
    ])
  );

COMMENT ON COLUMN ece.historia_clinica.disposicion IS
  'RF-06 CC-0001 — "Destino" del paciente (catálogo cerrado de 8 valores). '
  'Columna reutilizada: la UI/contratos la exponen como `destino`.';

-- ── RF-03 — Diagnósticos CIE-11 ───────────────────────────────────────
-- Relaja el validador: acepta CIE-10 legacy (A00, J45.0) y CIE-11 MMS
-- (1A00, BA00.0, XS25, KA62.1/KB23.0, 2A00&XH8TR4), y la clave JSON 'codigo'
-- (dominio CIE-11) o 'code' (legacy). El nombre se conserva para no recrear el
-- CHECK chk_hc_diagnosticos_cie10 que lo referencia. La autoridad real del
-- catálogo CIE-11 es la WHO ICD API (RN-02); aquí solo se valida la superficie.
CREATE OR REPLACE FUNCTION ece.fn_validate_diagnosticos_cie10(diagnosticos jsonb)
  RETURNS boolean
  LANGUAGE plpgsql
  STABLE
  SET search_path TO 'ece', 'public', 'pg_catalog'
AS $function$
DECLARE
  elemento jsonb;
  codigo   text;
BEGIN
  IF diagnosticos IS NULL THEN
    RETURN TRUE;
  END IF;

  IF jsonb_typeof(diagnosticos) <> 'array' THEN
    RETURN FALSE;
  END IF;

  FOR elemento IN SELECT jsonb_array_elements(diagnosticos)
  LOOP
    -- Acepta clave 'codigo' (CIE-11, dominio) o 'code' (legacy CIE-10).
    codigo := COALESCE(elemento ->> 'codigo', elemento ->> 'code');

    IF codigo IS NULL OR length(codigo) = 0 THEN
      RETURN FALSE;
    END IF;

    -- Superficie CIE-10 o CIE-11 MMS (stem, extensión, clúster postcoordinado).
    IF upper(codigo) !~ '^[A-Z0-9]{2,}([./&-][A-Z0-9]+)*$' THEN
      RETURN FALSE;
    END IF;
  END LOOP;

  RETURN TRUE;
END;
$function$;

-- ── RF-04 — Observaciones por toma de signos vitales ──────────────────
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS observaciones text;

COMMENT ON COLUMN ece.signos_vitales.observaciones IS
  'RF-04 CC-0001 — nota opcional por toma de signos vitales.';
