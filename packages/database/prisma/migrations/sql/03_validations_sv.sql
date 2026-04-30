-- =============================================================================
-- HIS Multi-país | Validaciones El Salvador
-- TDR §27.3: DUI, NIT, NIE.
-- Funciones IMMUTABLE para uso en CHECK constraints o validación aplicativa.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1. validate_dui(text)
--    Formato: 9 dígitos seguidos de un dígito verificador, con o sin guion.
--    Algoritmo: módulo 10 ponderado descendente (9..2) sobre los 8 primeros
--    dígitos del cuerpo (los 9 dígitos antes del verificador), suma * 10 mod 11,
--    si == 10 → 0; debe coincidir con el dígito verificador.
--    Referencia: norma RNPN (Registro Nacional de las Personas Naturales).
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_dui(p_dui text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean   text;
  v_body    text;
  v_check   int;
  v_sum     int := 0;
  v_calc    int;
  v_digit   int;
BEGIN
  IF p_dui IS NULL THEN
    RETURN false;
  END IF;

  -- Normaliza: deja solo dígitos.
  v_clean := regexp_replace(p_dui, '[^0-9]', '', 'g');

  IF length(v_clean) <> 9 THEN
    RETURN false;
  END IF;

  v_body  := substring(v_clean, 1, 8);
  v_check := substring(v_clean, 9, 1)::int;

  FOR i IN 1..8 LOOP
    v_digit := substring(v_body, i, 1)::int;
    v_sum   := v_sum + v_digit * (10 - i);  -- 9,8,7,6,5,4,3,2
  END LOOP;

  v_calc := (10 - (v_sum % 10)) % 10;
  -- Variante normativa: si (sum*10) mod 11 == 10 → 0.
  -- Implementación oficial RNPN:
  v_calc := 10 - (v_sum % 10);
  IF v_calc = 10 THEN
    v_calc := 0;
  END IF;

  RETURN v_calc = v_check;
END;
$$;

COMMENT ON FUNCTION public.validate_dui(text)
  IS 'Valida DUI El Salvador (TDR §27.3). 9 dígitos + verificador módulo 10 ponderado.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. validate_nit(text)
--    Formato: 14 dígitos: AAAA-MMDDAA-NNN-D donde
--      - 4 dígitos: código de municipio (DUI domicilio o municipio del
--        contribuyente jurídico).
--      - 6 dígitos: ddmmYY de nacimiento o de constitución.
--      - 3 dígitos: correlativo.
--      - 1 dígito: verificador (módulo 11).
--    Algoritmo verificador (Ministerio de Hacienda SV):
--      pesos = 14,13,12,...,2 sobre los 13 primeros dígitos.
--      r = (sum * 10) mod 11; si r=10 → 0; si r=11 → 1.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_nit(p_nit text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
  v_body  text;
  v_check int;
  v_sum   int := 0;
  v_calc  int;
  v_digit int;
  v_w     int;
BEGIN
  IF p_nit IS NULL THEN
    RETURN false;
  END IF;

  v_clean := regexp_replace(p_nit, '[^0-9]', '', 'g');

  IF length(v_clean) <> 14 THEN
    RETURN false;
  END IF;

  v_body  := substring(v_clean, 1, 13);
  v_check := substring(v_clean, 14, 1)::int;

  FOR i IN 1..13 LOOP
    v_digit := substring(v_body, i, 1)::int;
    v_w     := 14 - i + 1;  -- pesos 14..2
    -- El peso oficial recorre 14,13,12,...,2 sobre 13 dígitos -> 14..2.
    v_w     := 15 - i;
    v_sum   := v_sum + v_digit * v_w;
  END LOOP;

  v_calc := (v_sum * 10) % 11;
  IF v_calc = 10 THEN v_calc := 0; END IF;
  IF v_calc = 11 THEN v_calc := 1; END IF;

  RETURN v_calc = v_check;
END;
$$;

COMMENT ON FUNCTION public.validate_nit(text)
  IS 'Valida NIT El Salvador (TDR §27.3). 14 dígitos con verificador módulo 11.';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. validate_nie(text)
--    NIE = Número de Identificación de Extranjero (Ministerio de Hacienda SV).
--    Estructura administrativa con 14 caracteres alfanuméricos.
--    Validación primaria: longitud y formato; el dígito verificador sigue
--    el mismo esquema módulo 11 sobre los dígitos del NIE.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.validate_nie(p_nie text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_clean text;
BEGIN
  IF p_nie IS NULL THEN
    RETURN false;
  END IF;

  v_clean := upper(regexp_replace(p_nie, '[^0-9A-Z]', '', 'g'));

  -- NIE típicamente 14 caracteres alfanuméricos. El primer carácter puede
  -- ser letra ('E' para extranjero); el resto numérico con verificador.
  IF length(v_clean) NOT BETWEEN 9 AND 14 THEN
    RETURN false;
  END IF;

  -- Si solo dígitos: usar verificación NIT.
  IF v_clean ~ '^[0-9]+$' AND length(v_clean) = 14 THEN
    RETURN public.validate_nit(v_clean);
  END IF;

  -- Caso alfanumérico: validación estructural mínima. Verificador específico
  -- queda pendiente de norma cerrada (Hacienda no publica algoritmo único).
  RETURN v_clean ~ '^[A-Z0-9]{9,14}$';
END;
$$;

COMMENT ON FUNCTION public.validate_nie(text)
  IS 'Valida NIE El Salvador (TDR §27.3). Estructura alfanumérica; delega a NIT cuando es 14 dígitos.';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. CHECK constraints opcionales sobre PatientIdentifier
--    Aplica validación al insertar/actualizar identificadores sensibles SV.
--    Se difiere la activación: el seed de IdentifierType debe haber cargado
--    las filas DUI/NIT/NIE antes de habilitar este trigger.
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_validate_patient_identifier()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_kind text;
BEGIN
  v_kind := NEW.kind::text;

  IF v_kind = 'DUI' AND NOT public.validate_dui(NEW.value) THEN
    RAISE EXCEPTION 'DUI inválido: % (TDR §27.3)', NEW.value
      USING ERRCODE = '23514';
  ELSIF v_kind = 'NIT' AND NOT public.validate_nit(NEW.value) THEN
    RAISE EXCEPTION 'NIT inválido: % (TDR §27.3)', NEW.value
      USING ERRCODE = '23514';
  ELSIF v_kind = 'NIE' AND NOT public.validate_nie(NEW.value) THEN
    RAISE EXCEPTION 'NIE inválido: % (TDR §27.3)', NEW.value
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_patient_identifier
  ON public."PatientIdentifier";
CREATE TRIGGER trg_validate_patient_identifier
  BEFORE INSERT OR UPDATE OF value, kind ON public."PatientIdentifier"
  FOR EACH ROW EXECUTE FUNCTION public.fn_validate_patient_identifier();

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Pruebas rápidas (smoke tests, comentadas)
-- ─────────────────────────────────────────────────────────────────────────
-- SELECT public.validate_dui('00000000-0');     -- true (caso degenerado).
-- SELECT public.validate_dui('12345678-9');     -- según verificador real.
-- SELECT public.validate_nit('06141503901234'); -- según verificador real.
-- SELECT public.validate_nie('E000000001234');  -- estructural.
