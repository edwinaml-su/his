-- =============================================================================
-- 127_documento_rol_seed_12_tipos.sql
-- Poblar ece.documento_rol para los 12 tipos que estaban sin matriz rol×acción.
--
-- Auditoría 2026-05-25 detectó 12 de 30 tipos de documento sin ninguna
-- asignación en documento_rol — la matriz que el motor consulta para saber
-- qué rol institucional puede LLENA / FIRMA / AUTORIZA / RESPONSABLE.
--
-- Funciones (CHECK existing): LLENA, RESPONSABLE, AUTORIZA, FIRMA.
-- Roles disponibles (ece.rol): AC, ADM, ARCH, DIR, ENF, ESP, IC, MC, MT.
--
-- Matriz definida según NTEC + práctica clínica SLV:
--   - LLENA:       quién captura/registra el documento día-a-día.
--   - FIRMA:       quién firma electrónicamente (cierra/sella).
--   - AUTORIZA:    quién autoriza acciones especiales (anular, validar).
--   - RESPONSABLE: quién es responsable institucional (auditoría/escalado).
--
-- Idempotente: UNIQUE (tipo_documento_id, rol_id, funcion) + ON CONFLICT.
-- Aplicado a prod 2026-05-25 vía MCP (migration:
--   documento_rol_seed_12_tipos_faltantes_2026_05_25).
-- =============================================================================

WITH matriz(codigo, funcion, rol_codigo, obligatorio) AS (VALUES
  -- VAL_INI_ENF — Valoración Inicial de Enfermería (NTEC Art. 37)
  ('VAL_INI_ENF',   'LLENA',       'ENF', true),
  ('VAL_INI_ENF',   'FIRMA',       'ENF', true),
  ('VAL_INI_ENF',   'AUTORIZA',    'MC',  true),
  ('VAL_INI_ENF',   'RESPONSABLE', 'MC',  true),

  -- PARTOGRAMA — registro obstétrico (OMS; enfermería registra, gineco firma)
  ('PARTOGRAMA',    'LLENA',       'ENF', true),
  ('PARTOGRAMA',    'FIRMA',       'ESP', true),
  ('PARTOGRAMA',    'AUTORIZA',    'MC',  true),
  ('PARTOGRAMA',    'RESPONSABLE', 'MC',  true),

  -- SALA_EXPULSION — Sala de Expulsión (NTEC obstetricia)
  ('SALA_EXPULSION','LLENA',       'ENF', true),
  ('SALA_EXPULSION','FIRMA',       'ESP', true),
  ('SALA_EXPULSION','AUTORIZA',    'MC',  true),
  ('SALA_EXPULSION','RESPONSABLE', 'MC',  true),

  -- ATN_RN — Atención del Recién Nacido (NTEC neonatología)
  ('ATN_RN',        'LLENA',       'ENF', true),
  ('ATN_RN',        'FIRMA',       'ESP', true),
  ('ATN_RN',        'AUTORIZA',    'MC',  true),
  ('ATN_RN',        'RESPONSABLE', 'MC',  true),

  -- NRP — Reanimación Neonatal (decisión Apgar <7)
  ('NRP',           'LLENA',       'ENF', true),
  ('NRP',           'FIRMA',       'ESP', true),
  ('NRP',           'AUTORIZA',    'MC',  true),
  ('NRP',           'RESPONSABLE', 'MC',  true),

  -- PREOP_CHECK — Valoración Preoperatoria (NTEC Art. 28)
  ('PREOP_CHECK',   'LLENA',       'ENF', true),
  ('PREOP_CHECK',   'FIRMA',       'ESP', true),
  ('PREOP_CHECK',   'AUTORIZA',    'MC',  true),
  ('PREOP_CHECK',   'RESPONSABLE', 'MC',  true),

  -- WHO_CHK — WHO Surgical Safety Checklist (TDR §13.3, JCI IPSG.4 ME 3)
  ('WHO_CHK',       'LLENA',       'ENF', true),
  ('WHO_CHK',       'FIRMA',       'ESP', true),
  ('WHO_CHK',       'AUTORIZA',    'DIR', true),
  ('WHO_CHK',       'RESPONSABLE', 'MC',  true),

  -- PROG_QX — Programación Quirúrgica (coordinación quirúrgica)
  ('PROG_QX',       'LLENA',       'ESP', true),
  ('PROG_QX',       'FIRMA',       'ESP', true),
  ('PROG_QX',       'AUTORIZA',    'DIR', true),
  ('PROG_QX',       'RESPONSABLE', 'MC',  true),

  -- CONS_QX — Consentimiento Quirúrgico (NTEC Arts. 39/40, doble firma)
  ('CONS_QX',       'LLENA',       'ESP', true),
  ('CONS_QX',       'FIRMA',       'ESP', true),
  ('CONS_QX',       'AUTORIZA',    'DIR', true),
  ('CONS_QX',       'RESPONSABLE', 'MC',  true),

  -- REG_ANEST — Registro Anestésico (TDR §13.4)
  ('REG_ANEST',     'LLENA',       'ESP', true),
  ('REG_ANEST',     'FIRMA',       'ESP', true),
  ('REG_ANEST',     'AUTORIZA',    'MC',  true),
  ('REG_ANEST',     'RESPONSABLE', 'MC',  true),

  -- URPA — Recuperación Post-Anestésica (TDR §13.5)
  ('URPA',          'LLENA',       'ENF', true),
  ('URPA',          'FIRMA',       'ESP', true),
  ('URPA',          'AUTORIZA',    'MC',  true),
  ('URPA',          'RESPONSABLE', 'MC',  true),

  -- RES_EST — Resultado de Estudio (lab/imagen/patología; NTEC Art. 42)
  ('RES_EST',       'LLENA',       'ESP', true),
  ('RES_EST',       'FIRMA',       'ESP', true),
  ('RES_EST',       'AUTORIZA',    'MC',  true),
  ('RES_EST',       'RESPONSABLE', 'MC',  true)
)
INSERT INTO ece.documento_rol (tipo_documento_id, rol_id, funcion, obligatorio)
SELECT td.id, r.id, m.funcion, m.obligatorio
FROM matriz m
JOIN ece.tipo_documento td ON td.codigo = m.codigo
JOIN ece.rol r              ON r.codigo = m.rol_codigo
ON CONFLICT (tipo_documento_id, rol_id, funcion) DO NOTHING;
