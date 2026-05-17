-- =====================================================================
-- 61_ece_06_documentos.sql
-- Tablas de datos clínicos de los 19 formularios ECE (NTEC §3.1–3.19).
-- Norma: Acuerdo n.° 1616 (MINSAL, 2024).
--
-- Convenciones:
--   * instancia_id   — FK a ece.documento_instancia.id (motor de workflow).
--   * episodio_id    — FK desnormalizada a ece.episodio_atencion.id.
--                      Se incluye en todas las tablas para evitar doble
--                      JOIN en consultas frecuentes.
--   * Columnas NTEC mínimas tipadas; resto de campos variables en JSONB.
--   * Series temporales (partograma, anestesia, URPA) en JSONB — no se
--     explotan en filas para no generar escrituras masivas en BD OLTP.
--   * Tablas HISTÓRICAS: solo INSERT; correcciones por rectificación.
--   * Idempotente: usa CREATE TABLE IF NOT EXISTS + DO $$ para índices.
-- =====================================================================

-- -----------------------------------------------------------------------
-- §3.2 Historia Clínica
-- Tipo registro: transaccional/histórico (rectificable).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.historia_clinica (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id        UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id         UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- variables NTEC mínimas tipadas
    tipo_consulta       TEXT        NOT NULL
                            CHECK (tipo_consulta IN ('primera_vez', 'subsecuente')),
    motivo_consulta     TEXT,
    enfermedad_actual   TEXT,
    disposicion         TEXT        CHECK (disposicion IN (
                            'alta_ambulatoria', 'referencia', 'observacion', 'orden_ingreso')),
    plan_manejo         TEXT,
    -- campos variables en JSONB
    antecedentes        JSONB,
    -- {personales, familiares, gineco_obstetricos, alergias, habitos}
    examen_fisico       JSONB,
    -- {sistemas: [{sistema, hallazgo}], impresion_general}
    diagnosticos        JSONB,
    -- [{cie10, descripcion, tipo: 'presuntivo'|'definitivo'}]
    -- trazabilidad
    registrado_por      UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro     TEXT        NOT NULL DEFAULT 'vigente'
                            CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hc_instancia') THEN
        CREATE INDEX idx_hc_instancia ON ece.historia_clinica(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hc_episodio') THEN
        CREATE INDEX idx_hc_episodio ON ece.historia_clinica(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.historia_clinica IS
    'NTEC §3.2. Historia clínica del episodio. Rectificable mediante nueva versión; '
    'el motor de workflow trackea versiones vía documento_instancia.';

-- -----------------------------------------------------------------------
-- §3.3 Signos Vitales
-- Tipo registro: transaccional, serie temporal por episodio.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.signos_vitales (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id             UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- timestamp de la toma (clave de la serie temporal)
    fecha_hora_toma         TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- variables NTEC tipadas (unidades SI)
    presion_sistolica       SMALLINT    CHECK (presion_sistolica BETWEEN 40 AND 300),
    presion_diastolica      SMALLINT    CHECK (presion_diastolica BETWEEN 20 AND 200),
    frecuencia_cardiaca     SMALLINT    CHECK (frecuencia_cardiaca BETWEEN 20 AND 300),
    frecuencia_respiratoria SMALLINT    CHECK (frecuencia_respiratoria BETWEEN 4 AND 60),
    temperatura             NUMERIC(4,1) CHECK (temperatura BETWEEN 30.0 AND 45.0),
    saturacion_o2           SMALLINT    CHECK (saturacion_o2 BETWEEN 50 AND 100),
    peso_kg                 NUMERIC(6,2) CHECK (peso_kg > 0),
    talla_cm                NUMERIC(5,1) CHECK (talla_cm > 0),
    imc                     NUMERIC(5,2),    -- calculado por app; guardado para auditoría
    perimetro_cefalico_cm   NUMERIC(5,1),
    escala_dolor            SMALLINT    CHECK (escala_dolor BETWEEN 0 AND 10),
    glucometria_mgdl        NUMERIC(5,1),
    -- trazabilidad
    registrado_por          UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro         TEXT        NOT NULL DEFAULT 'vigente'
                                CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sv_instancia') THEN
        CREATE INDEX idx_sv_instancia ON ece.signos_vitales(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_sv_episodio_ts') THEN
        CREATE INDEX idx_sv_episodio_ts ON ece.signos_vitales(episodio_id, fecha_hora_toma DESC);
    END IF;
END $$;

COMMENT ON TABLE ece.signos_vitales IS
    'NTEC §3.3. Registro de signos vitales. Múltiples registros por episodio (serie temporal). '
    'Columnas tipadas con rangos fisiológicos. imc calculado por capa de aplicación.';

-- -----------------------------------------------------------------------
-- §3.4 Hoja de Triaje / Clasificación
-- Tipo registro: transaccional.
-- Nota: hoja_triaje referencia signos_vitales capturados en ese momento.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.hoja_triaje (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id                 UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    fecha_hora_clasificacion    TIMESTAMPTZ NOT NULL DEFAULT now(),
    motivo_consulta             TEXT,
    -- nivel de prioridad según protocolo Manchester / CTAS institucional
    nivel_prioridad             TEXT        NOT NULL,
    destino_asignado            TEXT,
    signos_vitales_id           UUID        REFERENCES ece.signos_vitales(id),
    -- hallazgos adicionales del triaje en JSONB
    evaluacion_triaje           JSONB,
    -- {via_aerea, respiracion, circulacion, deficit_neurologico, exposicion}
    -- trazabilidad
    registrado_por              UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro             TEXT        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_triaje_instancia') THEN
        CREATE INDEX idx_triaje_instancia ON ece.hoja_triaje(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_triaje_episodio') THEN
        CREATE INDEX idx_triaje_episodio ON ece.hoja_triaje(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.hoja_triaje IS
    'NTEC §3.4. Clasificación de urgencias. nivel_prioridad sigue protocolo institucional '
    '(Manchester, CTAS o equivalente). evaluacion_triaje en JSONB para variabilidad clínica.';

-- -----------------------------------------------------------------------
-- §3.5 Atención de Emergencia
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.atencion_emergencia (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id             UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    circunstancia_llegada   TEXT,
    motivo_consulta         TEXT,
    examen_fisico           TEXT,
    disposicion             TEXT        CHECK (disposicion IN (
                                'alta_ambulatoria', 'observacion',
                                'orden_ingreso', 'referencia')),
    -- diagnósticos y manejo en JSONB (múltiples CIE-10)
    diagnosticos            JSONB,
    -- [{cie10, descripcion, tipo: 'presuntivo'|'definitivo'}]
    manejo_realizado        JSONB,
    -- [{tipo: 'medicamento'|'procedimiento'|'otro', descripcion}]
    -- trazabilidad
    registrado_por          UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro         TEXT        NOT NULL DEFAULT 'vigente'
                                CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ae_instancia') THEN
        CREATE INDEX idx_ae_instancia ON ece.atencion_emergencia(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ae_episodio') THEN
        CREATE INDEX idx_ae_episodio ON ece.atencion_emergencia(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.atencion_emergencia IS
    'NTEC §3.5. Registro del episodio de emergencia. '
    'diagnosticos y manejo_realizado en JSONB para soportar múltiples entradas.';

-- -----------------------------------------------------------------------
-- §3.6 Indicaciones Médicas (encabezado + ítems de detalle)
-- Tipo registro: transaccional, versionado.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.indicaciones_medicas (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id        UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id         UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    fecha_hora          TIMESTAMPTZ NOT NULL DEFAULT now(),
    version             SMALLINT    NOT NULL DEFAULT 1,
    vigencia            TEXT        NOT NULL DEFAULT 'activa'
                            CHECK (vigencia IN ('activa', 'suspendida', 'modificada')),
    medico_prescriptor  UUID        NOT NULL REFERENCES ece.personal_salud(id),
    transcripcion_enf   UUID        REFERENCES ece.personal_salud(id),
    registrado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro     TEXT        NOT NULL DEFAULT 'vigente'
                            CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_im_instancia') THEN
        CREATE INDEX idx_im_instancia ON ece.indicaciones_medicas(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_im_episodio') THEN
        CREATE INDEX idx_im_episodio ON ece.indicaciones_medicas(episodio_id);
    END IF;
END $$;

-- Sub-tabla: detalle de cada ítem de la indicación
CREATE TABLE IF NOT EXISTS ece.indicacion_item (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    indicacion_id   UUID    NOT NULL REFERENCES ece.indicaciones_medicas(id)
                                ON DELETE CASCADE,
    tipo            TEXT    NOT NULL
                        CHECK (tipo IN ('medicamento', 'dieta', 'cuidado', 'estudio', 'reposo')),
    descripcion     TEXT    NOT NULL,
    dosis           TEXT,
    via             TEXT,
    frecuencia      TEXT,
    duracion        TEXT
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_iitem_indicacion') THEN
        CREATE INDEX idx_iitem_indicacion ON ece.indicacion_item(indicacion_id);
    END IF;
END $$;

COMMENT ON TABLE ece.indicaciones_medicas IS
    'NTEC §3.6. Hoja de indicaciones médicas (encabezado). '
    'Versionada: cada modificación genera nueva fila con version+1 y suspende la anterior.';
COMMENT ON TABLE ece.indicacion_item IS
    'Detalle de cada ítem de una indicación médica. Cascade delete con el encabezado.';

-- -----------------------------------------------------------------------
-- §3.7 Registro de Enfermería + Administración de Medicamentos (Kardex)
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.registro_enfermeria (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id    UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id     UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    turno           TEXT        NOT NULL
                        CHECK (turno IN ('matutino', 'vespertino', 'nocturno')),
    nota_evolucion  TEXT,
    plan_cuidados   TEXT,
    -- valoración adicional de enfermería en JSONB
    valoracion_enf  JSONB,
    -- {dolor, caidas_riesgo, ulceras_presion, estado_emocional}
    registrado_por  UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro TEXT        NOT NULL DEFAULT 'vigente'
                        CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_re_instancia') THEN
        CREATE INDEX idx_re_instancia ON ece.registro_enfermeria(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_re_episodio') THEN
        CREATE INDEX idx_re_episodio ON ece.registro_enfermeria(episodio_id);
    END IF;
END $$;

-- Sub-tabla: kardex de administración de medicamentos
CREATE TABLE IF NOT EXISTS ece.administracion_medicamento (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    registro_enf_id     UUID        NOT NULL REFERENCES ece.registro_enfermeria(id)
                                        ON DELETE CASCADE,
    indicacion_item_id  UUID        NOT NULL REFERENCES ece.indicacion_item(id),
    hora_programada     TIMESTAMPTZ,
    hora_aplicada       TIMESTAMPTZ,
    estado              TEXT        NOT NULL
                            CHECK (estado IN ('administrado', 'omitido', 'diferido')),
    motivo_omision      TEXT,
    responsable         UUID        NOT NULL REFERENCES ece.personal_salud(id)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_adm_registro') THEN
        CREATE INDEX idx_adm_registro ON ece.administracion_medicamento(registro_enf_id);
    END IF;
END $$;

COMMENT ON TABLE ece.registro_enfermeria IS
    'NTEC §3.7. Registro de enfermería por turno. valoracion_enf en JSONB para escalas variables.';
COMMENT ON TABLE ece.administracion_medicamento IS
    'Kardex de administración de medicamentos. motivo_omision requerido si estado = omitido.';

-- -----------------------------------------------------------------------
-- §3.8 Evolución Médica (SOAP)
-- Tipo registro: transaccional/histórico, múltiples notas por episodio.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.evolucion_medica (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id    UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id     UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    fecha_hora      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- nota SOAP como columnas separadas (NTEC §3.8 exige los cuatro campos)
    subjetivo       TEXT,
    objetivo        TEXT,
    analisis        TEXT,
    plan            TEXT,
    -- diagnósticos de la nota (puede diferir del diagnóstico de ingreso)
    diagnostico_cie10 JSONB,
    -- [{cie10, descripcion}]
    registrado_por  UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro TEXT        NOT NULL DEFAULT 'vigente'
                        CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_evol_instancia') THEN
        CREATE INDEX idx_evol_instancia ON ece.evolucion_medica(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_evol_episodio_ts') THEN
        CREATE INDEX idx_evol_episodio_ts ON ece.evolucion_medica(episodio_id, fecha_hora DESC);
    END IF;
END $$;

COMMENT ON TABLE ece.evolucion_medica IS
    'NTEC §3.8. Notas de evolución médica (formato SOAP). '
    'Múltiples registros por episodio; se navega en orden cronológico por fecha_hora.';

-- -----------------------------------------------------------------------
-- §3.9 Consentimiento Informado
-- Tipo registro: HISTÓRICO — inmutable tras la firma (Art. 35 NTEC).
-- paciente_id y episodio_id son columnas propias (puede existir fuera de episodio activo).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.consentimiento_informado (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    paciente_id             UUID        NOT NULL REFERENCES ece.paciente(id),
    episodio_id             UUID        REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    tipo                    TEXT        NOT NULL
                                CHECK (tipo IN (
                                    'hospitalizacion', 'quirurgico', 'anestesico',
                                    'procedimiento', 'transfusion', 'otro')),
    procedimiento_descrito  TEXT        NOT NULL,
    riesgos_explicados      TEXT,
    alternativas            TEXT,
    medico_que_informa      UUID        NOT NULL REFERENCES ece.personal_salud(id),
    firmante_rol            TEXT        NOT NULL
                                CHECK (firmante_rol IN ('paciente', 'representante_legal')),
    firmante_nombre         TEXT        NOT NULL,
    firmante_documento      TEXT        NOT NULL,
    -- referencia a objeto de firma/huella resguardado (storage externo)
    evidencia_firma_ref     TEXT,
    fecha_hora              TIMESTAMPTZ NOT NULL DEFAULT now()
    -- sin estado_registro: inmutable; correcciones requieren nuevo consentimiento
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ci_instancia') THEN
        CREATE INDEX idx_ci_instancia ON ece.consentimiento_informado(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ci_paciente') THEN
        CREATE INDEX idx_ci_paciente ON ece.consentimiento_informado(paciente_id);
    END IF;
END $$;

COMMENT ON TABLE ece.consentimiento_informado IS
    'NTEC §3.9 / Art. 35. HISTÓRICO — inmutable. '
    'Correcciones implican nuevo consentimiento; nunca UPDATE de contenido clínico. '
    'evidencia_firma_ref apunta a objeto en storage (no almacena binario en BD).';

-- -----------------------------------------------------------------------
-- §3.10 Referencia, Retorno e Interconsulta (RRI)
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.rri (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    paciente_id                 UUID        NOT NULL REFERENCES ece.paciente(id),
    episodio_id                 UUID        REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    tipo                        TEXT        NOT NULL
                                    CHECK (tipo IN (
                                        'referencia', 'retorno',
                                        'interconsulta', 'teleinterconsulta')),
    establecimiento_origen_id   UUID        REFERENCES ece.establecimiento(id),
    establecimiento_destino_id  UUID        REFERENCES ece.establecimiento(id),
    especialidad_solicitada     TEXT,
    motivo                      TEXT,
    resumen_clinico             TEXT,
    respuesta_interconsultante  TEXT,
    solicitado_por              UUID        NOT NULL REFERENCES ece.personal_salud(id),
    respondido_por              UUID        REFERENCES ece.personal_salud(id),
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro             TEXT        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rri_instancia') THEN
        CREATE INDEX idx_rri_instancia ON ece.rri(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_rri_paciente') THEN
        CREATE INDEX idx_rri_paciente ON ece.rri(paciente_id);
    END IF;
END $$;

COMMENT ON TABLE ece.rri IS
    'NTEC §3.10. Referencia, Retorno e Interconsulta. '
    'Cubre presencial y teleinterconsulta. respuesta_interconsultante la llena el especialista destino.';

-- -----------------------------------------------------------------------
-- §3.11 Orden de Ingreso Hospitalario
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.orden_ingreso (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    paciente_id             UUID        NOT NULL REFERENCES ece.paciente(id),
    episodio_origen_id      UUID        REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    circunstancia_ingreso   TEXT        NOT NULL,
    fecha_hora_orden        TIMESTAMPTZ NOT NULL DEFAULT now(),
    motivo_ingreso          TEXT        NOT NULL,
    servicio_ingreso_id     UUID        REFERENCES ece.servicio(id),
    procedencia             TEXT        NOT NULL,
    modalidad               TEXT        NOT NULL
                                CHECK (modalidad IN ('hospitalizacion', 'hospital_de_dia')),
    diagnostico_ingreso     JSONB,
    -- [{cie10, descripcion, tipo: 'presuntivo'|'definitivo'}]
    medico_ordena           UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro         TEXT        NOT NULL DEFAULT 'vigente'
                                CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_oi_instancia') THEN
        CREATE INDEX idx_oi_instancia ON ece.orden_ingreso(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_oi_paciente') THEN
        CREATE INDEX idx_oi_paciente ON ece.orden_ingreso(paciente_id);
    END IF;
END $$;

COMMENT ON TABLE ece.orden_ingreso IS
    'NTEC §3.11. Orden de ingreso hospitalario. '
    'diagnostico_ingreso en JSONB: puede ser presuntivo al momento de la orden.';

-- -----------------------------------------------------------------------
-- §3.12 Hoja de Ingreso / Apertura de Episodio Hospitalario
-- Tipo registro: transaccional (1:1 con episodio hospitalario).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.hoja_ingreso (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id             UUID        NOT NULL UNIQUE REFERENCES ece.episodio_atencion(id),
    orden_ingreso_id        UUID        NOT NULL REFERENCES ece.orden_ingreso(id),
    servicio_id             UUID        REFERENCES ece.servicio(id),
    cama_id                 UUID        REFERENCES ece.cama(id),
    fecha_hora_ingreso      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- datos adicionales al ingreso en JSONB
    datos_administrativos   JSONB,
    -- {numero_cama, piso, pabellon, medico_responsable_nombre}
    responsable_admision    UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro         TEXT        NOT NULL DEFAULT 'vigente'
                                CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_hi_instancia') THEN
        CREATE INDEX idx_hi_instancia ON ece.hoja_ingreso(instancia_id);
    END IF;
END $$;

COMMENT ON TABLE ece.hoja_ingreso IS
    'NTEC §3.12. Hoja de ingreso hospitalario. '
    'Relación 1:1 con episodio (UNIQUE en episodio_id). '
    'datos_administrativos en JSONB para campos de admisión variables por establecimiento.';

-- -----------------------------------------------------------------------
-- §3.13 Acto Quirúrgico
-- Tipo registro: HISTÓRICO — inmutable.
-- Series temporales (anestesia, URPA) en JSONB (no explosión en filas OLTP).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.acto_quirurgico (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id                 UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    diagnostico_pre             TEXT,
    diagnostico_post            TEXT,
    procedimiento_realizado     TEXT,
    hallazgos                   TEXT,
    hora_inicio                 TIMESTAMPTZ,
    hora_fin                    TIMESTAMPTZ,
    cirujano_id                 UUID        NOT NULL REFERENCES ece.personal_salud(id),
    anestesiologo_id            UUID        REFERENCES ece.personal_salud(id),
    -- series temporales y estructuras complejas en JSONB
    valoracion_preop            JSONB,
    -- {asa_clase, ayuno_horas, alergias_relevantes, ...}
    checklist_cirugia_segura    JSONB,
    -- {entrada: {confirmaciones[]}, pausa: {...}, salida: {...}}
    ayudantes                   JSONB,
    -- [{personal_salud_id, rol: 'primer_ayudante'|'instrumentista'|...}]
    registro_anestesico         JSONB,
    -- serie temporal: [{timestamp, farmacos[], tipo_anestesia, parametros_vitales{}}]
    recuperacion_urpa           JSONB,
    -- serie temporal: [{timestamp, aldrete_score, parametros_vitales{}, observacion}]
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro             TEXT        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado_registro IN ('vigente', 'rectificado'))
    -- Note: inmutabilidad se refuerza a nivel de workflow (estado firmado = sin UPDATE)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_aq_instancia') THEN
        CREATE INDEX idx_aq_instancia ON ece.acto_quirurgico(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_aq_episodio') THEN
        CREATE INDEX idx_aq_episodio ON ece.acto_quirurgico(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.acto_quirurgico IS
    'NTEC §3.13. Acto quirúrgico. HISTÓRICO. '
    'registro_anestesico y recuperacion_urpa son series temporales en JSONB: '
    'evitar explosión en filas para monitoreo transanestésico (lectura cada 5 min). '
    'checklist_cirugia_segura sigue protocolo OMS tres fases.';

-- -----------------------------------------------------------------------
-- §3.14 Documentos Obstétricos
-- Tipo registro: transaccional/histórico.
-- Sub-tablas: partograma (serie temporal), parto, recién nacido.
-- Series temporales en JSONB — partograma tiene lecturas cada 30-60 min.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.documentos_obstetricos (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id                 UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    semanas_gestacion           SMALLINT,
    paridad                     TEXT,
    -- GXXPXX (gestaciones/partos) — texto libre según convención obstétrica
    fecha_ultima_regla          DATE,
    fecha_probable_parto        DATE,
    -- serie temporal dilatación/descenso/FCF — JSONB (lecturas cada 30-60 min)
    partograma                  JSONB,
    -- [{timestamp, dilatacion_cm, altura_presentacion, fcf_lpm, contracciones_x10min,
    --   tension_sistolica, tension_diastolica, temperatura, orina_ml, observacion}]
    -- datos de labor de parto
    labor_parto                 JSONB,
    -- {inicio_labor, tipo_inicio: 'espontaneo'|'inducido', oxitocina, amniorrexis,
    --   duracion_primera_fase_min, duracion_segunda_fase_min, duracion_tercera_fase_min}
    -- datos de sala de expulsión
    sala_expulsion              JSONB,
    -- {hora_expulsion, via: 'vaginal'|'cesarea', indicacion_cesarea,
    --   episiotomia, laceraccion_grado, anestesia_tipo, alumbramiento}
    -- atención al recién nacido (puede generar CUN/NUI propio)
    atencion_rn                 JSONB,
    -- [{orden_nacimiento, hora, peso_g, talla_cm, perimetro_cefalico_cm,
    --   apgar_1min, apgar_5min, sexo, llanto_inmediato, reanimacion}]
    recien_nacido_paciente_id   UUID        REFERENCES ece.paciente(id),
    -- FK al paciente creado para el RN (puede ser NULL si aún no se crea el expediente)
    registrado_por              UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en               TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro             TEXT        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_obs_instancia') THEN
        CREATE INDEX idx_obs_instancia ON ece.documentos_obstetricos(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_obs_episodio') THEN
        CREATE INDEX idx_obs_episodio ON ece.documentos_obstetricos(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.documentos_obstetricos IS
    'NTEC §3.14. Documentos obstétricos unificados. '
    'partograma en JSONB: serie temporal de lecturas cada 30-60 min — '
    'explosión en filas generaría >50 filas/parto en tabla crítica OLTP. '
    'recien_nacido_paciente_id se popula cuando se crea el expediente del RN.';

-- -----------------------------------------------------------------------
-- §3.15 Epicrisis / Hoja de Egreso
-- Tipo registro: HISTÓRICO — inmutable (Art. 40 NTEC).
-- 1:1 con episodio hospitalario.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.epicrisis_egreso (
    id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                    UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id                     UUID        NOT NULL UNIQUE REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    fecha_hora_egreso               TIMESTAMPTZ NOT NULL,
    tipo_egreso                     TEXT        NOT NULL
                                        CHECK (tipo_egreso IN ('vivo', 'fallecido')),
    circunstancia_alta              TEXT        NOT NULL,
    -- diagnósticos de egreso (obligatorio por NTEC)
    diagnosticos_egreso             JSONB       NOT NULL,
    -- [{cie10, descripcion, tipo: 'principal'|'secundario'|'complicacion'}]
    -- campos de resumen clínico
    resumen_evolucion               TEXT,
    procedimientos_realizados       JSONB,
    -- [{codigo, descripcion, fecha}]
    resultados_complementarios      TEXT,
    manejo_terapeutico              TEXT,
    indicaciones_alta               TEXT,
    citas_seguimiento               JSONB,
    -- [{especialidad, fecha_aproximada, observacion}]
    medico_tratante_id              UUID        NOT NULL REFERENCES ece.personal_salud(id),
    visto_jefe_servicio_id          UUID        REFERENCES ece.personal_salud(id),
    registrado_en                   TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro                 TEXT        NOT NULL DEFAULT 'vigente'
                                        CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_epi_instancia') THEN
        CREATE INDEX idx_epi_instancia ON ece.epicrisis_egreso(instancia_id);
    END IF;
END $$;

COMMENT ON TABLE ece.epicrisis_egreso IS
    'NTEC §3.15 / Art. 40. Epicrisis de egreso. HISTÓRICO. '
    'Relación 1:1 con episodio (UNIQUE en episodio_id). '
    'diagnosticos_egreso NOT NULL — requerido por norma para liquidación ISSS/IGSS.';

-- -----------------------------------------------------------------------
-- §3.16 Certificado de Defunción
-- Tipo registro: HISTÓRICO — inmutable.
-- Solo aplica cuando tipo_egreso = 'fallecido' en epicrisis.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.certificado_defuncion (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id            UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id             UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    epicrisis_id            UUID        NOT NULL REFERENCES ece.epicrisis_egreso(id),
    -- variables NTEC tipadas (Ley del Registro del Estado Familiar)
    fecha_hora_defuncion    TIMESTAMPTZ NOT NULL,
    causa_basica_cie10      TEXT        NOT NULL,
    causas_intermedias      JSONB,
    -- [{cie10, descripcion, intervalo_aproximado}]
    causas_contribuyentes   JSONB,
    -- [{cie10, descripcion}]
    clasificacion           TEXT        NOT NULL
                                CHECK (clasificacion IN (
                                    'natural', 'violenta', 'accidente_transito',
                                    'en_investigacion')),
    numero_certificado      TEXT,
    -- número oficial MINSAL asignado al emitir
    medico_certificante_id  UUID        NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en           TIMESTAMPTZ NOT NULL DEFAULT now()
    -- sin estado_registro: inmutable absoluto (documento legal externo)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cd_instancia') THEN
        CREATE INDEX idx_cd_instancia ON ece.certificado_defuncion(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cd_episodio') THEN
        CREATE INDEX idx_cd_episodio ON ece.certificado_defuncion(episodio_id);
    END IF;
END $$;

COMMENT ON TABLE ece.certificado_defuncion IS
    'NTEC §3.16. Certificado de defunción. HISTÓRICO — inmutable absoluto (documento legal). '
    'Requiere epicrisis_id con tipo_egreso = ''fallecido''. '
    'causas_intermedias y causas_contribuyentes en JSONB (múltiples CIE-10 con intervalo).';

-- -----------------------------------------------------------------------
-- §3.17 Certificado de Incapacidad ISSS
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.certificado_incapacidad_isss (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id        UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    paciente_id         UUID        NOT NULL REFERENCES ece.paciente(id),
    episodio_id         UUID        REFERENCES ece.episodio_atencion(id),
    -- variables NTEC / ISSS tipadas
    numero_afiliado     TEXT        NOT NULL,
    numero_patronal     TEXT,
    diagnostico_cie10   TEXT        NOT NULL,
    dias_incapacidad    SMALLINT    NOT NULL CHECK (dias_incapacidad > 0),
    fecha_inicio        DATE        NOT NULL,
    fecha_fin           DATE        NOT NULL,
    CONSTRAINT chk_incap_fechas CHECK (fecha_fin >= fecha_inicio),
    numero_formulario   TEXT,
    -- número de formulario ISSS (asignado al imprimir)
    medico_autorizado_id UUID       NOT NULL REFERENCES ece.personal_salud(id),
    registrado_en       TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro     TEXT        NOT NULL DEFAULT 'vigente'
                            CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_incap_instancia') THEN
        CREATE INDEX idx_incap_instancia ON ece.certificado_incapacidad_isss(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_incap_paciente') THEN
        CREATE INDEX idx_incap_paciente ON ece.certificado_incapacidad_isss(paciente_id);
    END IF;
END $$;

COMMENT ON TABLE ece.certificado_incapacidad_isss IS
    'NTEC §3.17. Certificado de incapacidad laboral ISSS. '
    'Constraint chk_incap_fechas valida coherencia de fechas en BD (no solo en app). '
    'numero_formulario se registra tras impresión oficial.';

-- -----------------------------------------------------------------------
-- §3.18 Solicitud de Estudio (Laboratorio / Imagenología / Gabinete)
-- Tipo registro: transaccional.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.solicitud_estudio (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id        UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    episodio_id         UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    -- variables NTEC tipadas
    tipo                TEXT        NOT NULL
                            CHECK (tipo IN ('laboratorio', 'imagenologia', 'gabinete')),
    examenes            JSONB       NOT NULL,
    -- [{codigo_loinc_o_local, nombre_examen, urgente: bool, observacion}]
    indicacion_clinica  TEXT,
    medico_solicitante_id UUID      NOT NULL REFERENCES ece.personal_salud(id),
    fecha_hora          TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado              TEXT        NOT NULL DEFAULT 'solicitado'
                            CHECK (estado IN (
                                'solicitado', 'en_proceso',
                                'resultado_listo', 'anulado')),
    registrado_en       TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_se_instancia') THEN
        CREATE INDEX idx_se_instancia ON ece.solicitud_estudio(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_se_episodio_ts') THEN
        CREATE INDEX idx_se_episodio_ts ON ece.solicitud_estudio(episodio_id, fecha_hora DESC);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_se_estado') THEN
        CREATE INDEX idx_se_estado ON ece.solicitud_estudio(estado)
            WHERE estado IN ('solicitado', 'en_proceso');
    END IF;
END $$;

COMMENT ON TABLE ece.solicitud_estudio IS
    'NTEC §3.18. Solicitud de estudios complementarios. '
    'examenes en JSONB: lista de ítems (código LOINC o local + flag urgente). '
    'Índice parcial en estado filtra solo solicitudes activas — la mayoría terminan en resultado_listo.';

-- -----------------------------------------------------------------------
-- §3.18 (cont.) Resultado de Estudio
-- Tipo registro: HISTÓRICO — inmutable tras validación.
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ece.resultado_estudio (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    instancia_id                UUID        NOT NULL REFERENCES ece.documento_instancia(id),
    solicitud_id                UUID        NOT NULL REFERENCES ece.solicitud_estudio(id),
    -- resultados por analito en JSONB
    valores                     JSONB       NOT NULL,
    -- [{analito, valor_texto, valor_numerico, unidad, rango_referencia_texto,
    --   flag: 'normal'|'alto'|'bajo'|'critico', metodo}]
    interpretacion              TEXT,
    -- texto libre del profesional validador
    responsable_validacion_id   UUID        NOT NULL REFERENCES ece.personal_salud(id),
    fecha_hora_informe          TIMESTAMPTZ NOT NULL DEFAULT now(),
    estado_registro             TEXT        NOT NULL DEFAULT 'vigente'
                                    CHECK (estado_registro IN ('vigente', 'rectificado'))
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_res_instancia') THEN
        CREATE INDEX idx_res_instancia ON ece.resultado_estudio(instancia_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_res_solicitud') THEN
        CREATE INDEX idx_res_solicitud ON ece.resultado_estudio(solicitud_id);
    END IF;
END $$;

COMMENT ON TABLE ece.resultado_estudio IS
    'NTEC §3.18 (resultado). Resultado de estudios complementarios. '
    'valores en JSONB: soporta laboratorio (múltiples analitos), imagen (un informe texto) '
    'y gabinete (trazado ECG, espirometría etc.) sin cambio de esquema. '
    'flag ''critico'' en valores debe disparar alerta en capa de aplicación.';
