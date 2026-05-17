-- =====================================================================
-- 58_ece_03_paciente.sql
-- Fase 2 ECE — Ficha de Identificación del Paciente (Art. 15 NTEC)
-- Acuerdo n.° 1616 MINSAL, 2024.
--
-- Opción B (10_dba_schema_integracion.md §3):
--   public.Patient es el MPI (golden record). Esta tabla es el registro
--   DOCUMENTAL NTEC; no duplica datos demográficos. La columna
--   public_patient_id es el ACL (Application Control Link) hacia el MPI.
--   Puede ser NULL mientras el paciente NTEC aún no fue vinculado al MPI
--   (p.ej. registro en papel ingresado retrospectivamente).
--
-- Dependencias:
--   55_ece_00_extensions.sql  — schema ece + pg_trgm
--   (public."Patient" y public."Establishment" ya existen en el MPI)
--
-- Idempotente: usa IF NOT EXISTS / DO $$ … $$ para bloques condicionales.
-- =====================================================================

-- =====================================================================
-- 1. TABLA PRINCIPAL: ece.paciente
-- =====================================================================
-- Registro documental NTEC Art. 15. Una fila = un expediente abierto en
-- un establecimiento. El MPI (public.Patient) puede tener N expedientes
-- en N establecimientos; el vínculo inverso es public_patient_id.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.paciente (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ---- ACL hacia el MPI (Opción B) -----------------------------------
  -- NULL = paciente NTEC aún no vinculado al MPI. La vinculación se hace
  -- a posteriori mediante el proceso de matching/dedup. SET NULL si el
  -- registro MPI es eliminado (soft-delete no rompe FK; hard-delete raro).
  public_patient_id        uuid        REFERENCES public."Patient"(id)
                                         ON DELETE SET NULL ON UPDATE CASCADE,

  -- ---- Identificación del establecimiento ----------------------------
  -- Usamos public."Establishment" (Opción B); no existe ece.establecimiento.
  establecimiento_id       uuid        NOT NULL
                                         REFERENCES public."Establishment"(id)
                                         ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Número de expediente único por establecimiento (Art. 11-12 NTEC).
  -- El patrón lo define cada establecimiento (patron_num_expediente).
  numero_expediente        text        NOT NULL,

  -- ---- Identificadores nacionales (Art. 15 lit. a) ------------------
  -- NUI: Número Único de Identidad emitido por RNPN.
  -- Formato RNPN: 20 caracteres alfanuméricos en mayúsculas.
  -- Obligatorio excepto cuando tipo_registro_identidad = 'sin_documento'.
  nui                      text        CHECK (nui ~ '^[A-Z0-9]{20}$'),
  cun                      text,        -- Código Único de Nacimiento (neonatos)
  dui                      text        CHECK (dui ~ '^\d{8}-\d$'),
  carnet_minoridad         text,
  pasaporte                text,

  -- Tipo de registro según disponibilidad de documentos.
  tipo_registro_identidad  text        NOT NULL DEFAULT 'verificado'
                             CHECK (tipo_registro_identidad IN (
                               'verificado',          -- documentos presentados y verificados
                               'version_paciente',    -- dato declarado sin documento
                               'version_responsable', -- dato dado por familiar/tutor
                               'sin_documento',       -- paciente no porta documentos (incluye NN)
                               'desconocido'          -- identidad desconocida
                             )),

  -- ---- datos_paciente: columnas NTEC no cubiertas por public.Patient --
  -- Los datos demográficos base (nombre, fecha nacimiento, sexo) viven en
  -- public.Patient. Aquí solo las columnas NTEC sin equivalente en MPI.
  estado_familiar          text,       -- soltero, casado, acompañado, divorciado, viudo
  ocupacion                text,       -- texto libre; codificado en MPI vía occupationId
  nacionalidad             text,       -- texto libre; complementa birthPlaceGeoId del MPI
  direccion                text,       -- dirección actual declarada en esta visita
  telefono                 text,       -- teléfono de contacto declarado en esta visita

  -- Estado del expediente (Art. 4.15/4.16, 34 NTEC)
  estado_expediente        text        NOT NULL DEFAULT 'activo'
                             CHECK (estado_expediente IN ('activo', 'pasivo')),
  fallecido                boolean     NOT NULL DEFAULT false,

  -- ---- datos_responsable: referencia a tabla auxiliar ---------------
  -- Ver ece.responsable_paciente (1:N por paciente)

  -- ---- datos_afiliacion_ISSS: referencia a tabla auxiliar -----------
  -- Ver ece.afiliacion_isss (1:1 por paciente)

  -- ---- observaciones ------------------------------------------------
  observaciones            text,

  -- ---- Trazabilidad (Art. 15 lit. j) --------------------------------
  responsable_toma_datos   uuid        REFERENCES public."User"(id)
                                         ON DELETE SET NULL ON UPDATE CASCADE,
  fecha_hora_creacion      timestamptz NOT NULL DEFAULT now(),

  -- Estado del registro para ciclo de vida documental
  estado_registro          text        NOT NULL DEFAULT 'vigente'
                             CHECK (estado_registro IN (
                               'vigente',
                               'rectificado',  -- corregido con trazabilidad
                               'unificado'     -- expediente absorbido por otro (Art. 14 lit. g)
                             )),
  -- Apunta al expediente sobreviviente cuando estado_registro = 'unificado'
  expediente_maestro_id    uuid        REFERENCES ece.paciente(id)
                                         ON DELETE RESTRICT ON UPDATE CASCADE,

  -- ---- Constraints de integridad ------------------------------------
  -- numero_expediente único por establecimiento (Art. 11 NTEC)
  CONSTRAINT uq_num_expediente
    UNIQUE (establecimiento_id, numero_expediente),

  -- NUI obligatorio salvo cuando el tipo de registro no lo permite.
  -- 'sin_documento' y 'desconocido' son los únicos casos sin NUI.
  CONSTRAINT ck_nui_requerido
    CHECK (
      nui IS NOT NULL
      OR tipo_registro_identidad IN ('sin_documento', 'desconocido')
    ),

  -- Un expediente unificado debe apuntar a su maestro.
  CONSTRAINT ck_unificado_tiene_maestro
    CHECK (
      estado_registro <> 'unificado'
      OR expediente_maestro_id IS NOT NULL
    ),

  -- Un expediente no puede apuntarse a sí mismo.
  CONSTRAINT ck_maestro_no_autorreferencial
    CHECK (expediente_maestro_id <> id)
);

COMMENT ON TABLE ece.paciente IS
  'Ficha de Identificación NTEC Art. 15 (Acuerdo n.° 1616 MINSAL). '
  'Registro DOCUMENTAL; golden record demográfico en public.Patient (Opción B). '
  'public_patient_id = ACL hacia el MPI. Prohibido duplicar (Art. 14 lit. g NTEC).';

COMMENT ON COLUMN ece.paciente.public_patient_id IS
  'ACL hacia public.Patient (MPI). NULL = registro NTEC pendiente de vinculación al MPI.';
COMMENT ON COLUMN ece.paciente.nui IS
  'Número Único de Identidad RNPN. Formato: 20 caracteres [A-Z0-9]. '
  'Obligatorio cuando tipo_registro_identidad IN (verificado, version_paciente, version_responsable).';
COMMENT ON COLUMN ece.paciente.tipo_registro_identidad IS
  'Calidad de la identificación del paciente al momento del registro.';
COMMENT ON COLUMN ece.paciente.estado_registro IS
  'vigente = activo; rectificado = corregido con trazabilidad; '
  'unificado = absorbido por expediente_maestro_id (Art. 14 lit. g NTEC).';

-- =====================================================================
-- 2. ÍNDICES — búsqueda y deduplicación
-- =====================================================================

-- Búsqueda directa por identificadores (exacta)
CREATE INDEX IF NOT EXISTS idx_paciente_nui
  ON ece.paciente (nui)
  WHERE nui IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paciente_dui
  ON ece.paciente (dui)
  WHERE dui IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paciente_public_patient
  ON ece.paciente (public_patient_id)
  WHERE public_patient_id IS NOT NULL;

-- Búsqueda fuzzy por nombre (trigram). Las columnas de nombre viven en
-- public.Patient; aquí indexamos dirección/observaciones si se buscan.
-- El índice de nombre se pone sobre la vista v_paciente (61_ece_vistas.sql).
-- Trigram sobre NUI para detectar duplicados con 1 carácter de diferencia.
CREATE INDEX IF NOT EXISTS idx_paciente_nui_trgm
  ON ece.paciente USING gin (nui gin_trgm_ops)
  WHERE nui IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paciente_cun
  ON ece.paciente (cun)
  WHERE cun IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_paciente_estado_expediente
  ON ece.paciente (establecimiento_id, estado_expediente);

-- =====================================================================
-- 3. TABLA AUXILIAR: ece.identificador_paciente
-- Identificadores adicionales / históricos por paciente.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.identificador_paciente (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id   uuid        NOT NULL
                              REFERENCES ece.paciente(id)
                              ON DELETE CASCADE ON UPDATE CASCADE,
  tipo          text        NOT NULL
                              CHECK (tipo IN (
                                'nui', 'cun', 'dui', 'carnet_minoridad',
                                'pasaporte', 'otro'
                              )),
  valor         text        NOT NULL,
  vigente       boolean     NOT NULL DEFAULT true,
  registrado_en timestamptz NOT NULL DEFAULT now(),

  -- Evita duplicados del mismo tipo+valor activo por paciente.
  CONSTRAINT uq_identificador_vigente
    UNIQUE (paciente_id, tipo, valor)
);

COMMENT ON TABLE ece.identificador_paciente IS
  'Identificadores adicionales e históricos del paciente (p.ej. DUI anterior, '
  'CUN, carnet de minoridad). Permite trazabilidad de cambios de documento.';

CREATE INDEX IF NOT EXISTS idx_ident_paciente_valor
  ON ece.identificador_paciente (tipo, valor)
  WHERE vigente = true;

-- =====================================================================
-- 4. TABLA AUXILIAR: ece.responsable_paciente
-- Datos del responsable / familiar (Art. 15 lit. c NTEC).
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.responsable_paciente (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id uuid        NOT NULL
                            REFERENCES ece.paciente(id)
                            ON DELETE CASCADE ON UPDATE CASCADE,
  nombre      text        NOT NULL,
  parentesco  text,        -- madre, padre, tutor, cónyuge, otro
  documento   text,        -- DUI u otro doc del responsable
  telefono    text,
  vigente     boolean     NOT NULL DEFAULT true,
  registrado_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ece.responsable_paciente IS
  'Datos del responsable o familiar del paciente (Art. 15 lit. c NTEC). '
  'Relación 1:N: un paciente puede tener múltiples responsables a lo largo del tiempo.';

CREATE INDEX IF NOT EXISTS idx_responsable_paciente
  ON ece.responsable_paciente (paciente_id)
  WHERE vigente = true;

-- =====================================================================
-- 5. TABLA AUXILIAR: ece.afiliacion_isss
-- Verificación de derechohabiencia ISSS (Art. 15 lit. d NTEC).
-- =====================================================================
CREATE TABLE IF NOT EXISTS ece.afiliacion_isss (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  paciente_id          uuid        NOT NULL UNIQUE
                                     REFERENCES ece.paciente(id)
                                     ON DELETE CASCADE ON UPDATE CASCADE,
  numero_afiliado      text        NOT NULL,
  tipo_derechohabiente text        NOT NULL
                         CHECK (tipo_derechohabiente IN (
                           'cotizante',
                           'beneficiario',
                           'pensionado'
                         )),
  numero_patronal      text,
  vigente              boolean     NOT NULL DEFAULT true,
  verificado_en        timestamptz,
  registrado_en        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ece.afiliacion_isss IS
  'Derechohabiencia ISSS (Art. 15 lit. d NTEC). '
  'Relación 1:1 con ece.paciente; UNIQUE sobre paciente_id.';

-- =====================================================================
-- 6. FUNCIÓN + TRIGGER: deduplicación por NUI / DUI
--
-- Estrategia: BLOQUEAR insert de un NUI/DUI ya activo (estado_registro =
-- 'vigente' o 'rectificado') en el mismo establecimiento.
-- Los duplicados entre establecimientos NO se bloquean aquí; eso es
-- responsabilidad del proceso MDM (matching MPI).
-- El unificador explícito marca estado_registro = 'unificado' y fija
-- expediente_maestro_id; eso no activa el bloqueo.
-- =====================================================================
CREATE OR REPLACE FUNCTION ece.fn_check_dedup_nui_dui()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
AS $$
DECLARE
  v_conflicto_nui uuid;
  v_conflicto_dui uuid;
BEGIN
  -- Solo aplica a registros vigentes/rectificados (los unificados son copias
  -- históricas; el maestro ya tiene el NUI correcto).
  IF NEW.estado_registro = 'unificado' THEN
    RETURN NEW;
  END IF;

  -- Detectar duplicado de NUI en el mismo establecimiento
  IF NEW.nui IS NOT NULL THEN
    SELECT id INTO v_conflicto_nui
    FROM ece.paciente
    WHERE establecimiento_id = NEW.establecimiento_id
      AND nui = NEW.nui
      AND estado_registro IN ('vigente', 'rectificado')
      AND id <> NEW.id   -- excluye el propio registro en UPDATE
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'NTEC Art. 14 lit. g: NUI % ya existe en este establecimiento (expediente %). '
        'Use el proceso de unificación de expedientes.',
        NEW.nui, v_conflicto_nui
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  -- Detectar duplicado de DUI en el mismo establecimiento
  IF NEW.dui IS NOT NULL THEN
    SELECT id INTO v_conflicto_dui
    FROM ece.paciente
    WHERE establecimiento_id = NEW.establecimiento_id
      AND dui = NEW.dui
      AND estado_registro IN ('vigente', 'rectificado')
      AND id <> NEW.id
    LIMIT 1;

    IF FOUND THEN
      RAISE EXCEPTION
        'NTEC Art. 14 lit. g: DUI % ya existe en este establecimiento (expediente %). '
        'Use el proceso de unificación de expedientes.',
        NEW.dui, v_conflicto_dui
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger BEFORE para que el error corte antes del write.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_dedup_nui_dui'
      AND tgrelid = 'ece.paciente'::regclass
  ) THEN
    CREATE TRIGGER trg_dedup_nui_dui
      BEFORE INSERT OR UPDATE OF nui, dui, estado_registro
      ON ece.paciente
      FOR EACH ROW
      EXECUTE FUNCTION ece.fn_check_dedup_nui_dui();
  END IF;
END;
$$;

COMMENT ON FUNCTION ece.fn_check_dedup_nui_dui() IS
  'Bloquea INSERT/UPDATE que introduzca un NUI o DUI duplicado activo dentro '
  'del mismo establecimiento. Implementa Art. 14 lit. g NTEC. '
  'Los duplicados cross-establecimiento se manejan en el proceso MDM/MPI.';
