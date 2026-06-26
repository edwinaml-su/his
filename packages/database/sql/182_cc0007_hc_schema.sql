-- =============================================================================
-- 182_cc0007_hc_schema.sql
-- CC-0007 — Pantalla Historia Clínica (REQ-ECE-HC-001 v1.0).
--
-- Cambios de modelo:
--   1. ece.historia_clinica  — 6 columnas Json nuevas para datos estructurados
--                              que en CC-0001 iban como texto libre o en data:{}.
--   2. ece.historia_clinica  — CHECK de `disposicion` extendido con 'FALLECIDO'.
--   3. public."Patient"      — columna es_lgbtiq boolean (RF-01.3 banner nombre de pila).
--   4. ece.signos_vitales     — 11 columnas nuevas para Glasgow, FiO2, ICT,
--                              cintura, balance, diuresis, glucometría, FUR, FPP.
--
-- Supuestos:
--   - ece.historia_clinica y ece.signos_vitales existen (61_ece_06_documentos.sql).
--   - public."Patient" existe con columna "preferredName" (schema.prisma).
--   - No se eliminan columnas ni constraints existentes.
--   - `disposicion` es columna text con CHECK (no enum Postgres); se puede
--     modificar el CHECK en la misma transacción sin restricciones de enum.
--   - ece.historia_clinica está vacía en prod (0 filas confirmado CC-0001);
--     el UPDATE de datos legacy es no-op.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =============================================================================

-- ── 1. ece.historia_clinica — columnas Json nuevas ───────────────────────────

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "antecedentes_estructurados" jsonb;
COMMENT ON COLUMN ece.historia_clinica."antecedentes_estructurados" IS
  'CC-0007 RF-05 — antecedentes por subsección: '
  '{alergias|personales|familiares|ocupacion|habitos: {estado:"TIENE"|"NINGUNO"|"NO_APLICA", items:[]}}. '
  'Coexiste con columna antecedentes (texto libre CC-0001); la UI CC-0007 escribe aquí.';

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "plan_items" jsonb;
COMMENT ON COLUMN ece.historia_clinica."plan_items" IS
  'CC-0007 RF-12 — plan de manejo como grid [{orden:int, texto:text}].';

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "procedimientos_cpt" jsonb;
COMMENT ON COLUMN ece.historia_clinica."procedimientos_cpt" IS
  'CC-0007 RF-09 — procedimientos CPT [{codigo, descripcion, complemento?}]. Opcional.';

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "terapia_respiratoria" jsonb;
COMMENT ON COLUMN ece.historia_clinica."terapia_respiratoria" IS
  'CC-0007 RF-10 — terapia respiratoria: '
  '{gasometria:{tipo:"BASAL"|"O2",fio2?,flujo?}, nebulizaciones?, vibroterapia?, palmopercusion?}.';

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "ordenes_examenes" jsonb;
COMMENT ON COLUMN ece.historia_clinica."ordenes_examenes" IS
  'CC-0007 RF-10 — órdenes de exámenes lab/gabinete [{seccion, examen, cantidad}].';

ALTER TABLE ece.historia_clinica
  ADD COLUMN IF NOT EXISTS "ordenes_inyecciones" jsonb;
COMMENT ON COLUMN ece.historia_clinica."ordenes_inyecciones" IS
  'CC-0007 RF-10 — órdenes de inyecciones [{texto}].';

-- ── 2. disposicion CHECK — agregar FALLECIDO ─────────────────────────────────
-- CC-0001 (175_hc_avante_destino_cie11_analisis.sql) dejó 8 valores.
-- CC-0007 RF-12 / spec §5 añade FALLECIDO → 9 valores totales.
-- Los 2 valores legacy (PROCEDIMIENTO_AMBULATORIO, REFERENCIA) se conservan.

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
      'REMISION',
      'FALLECIDO'
    ])
  );

COMMENT ON COLUMN ece.historia_clinica.disposicion IS
  'RF-06 CC-0001 + RF-12 CC-0007 — "Destino" del paciente (catálogo cerrado de 9 valores). '
  'La UI CC-0007 muestra los 7 del mockup; PROCEDIMIENTO_AMBULATORIO y REFERENCIA se conservan '
  'para compat. con registros legacy. Columna reutilizada: la UI/contratos la exponen como `destino`.';

-- ── 3. public."Patient" — es_lgbtiq ─────────────────────────────────────────
-- RF-01.3: activa el banner de nombre de pila (lila).
-- Coexiste con "preferredName" ya existente en Patient.

ALTER TABLE public."Patient"
  ADD COLUMN IF NOT EXISTS "es_lgbtiq" boolean;
COMMENT ON COLUMN public."Patient"."es_lgbtiq" IS
  'CC-0007 RF-01.3 — paciente de la comunidad LGBTIQ+. '
  'Cuando TRUE y "preferredName" no nulo, la UI muestra banner lila con nombre de pila.';

-- ── 4. ece.signos_vitales — columnas nuevas ───────────────────────────────────

-- Neurológico / Glasgow
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "glasgow_ocular"  integer
    CHECK ("glasgow_ocular"  BETWEEN 1 AND 4);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "glasgow_verbal"  integer
    CHECK ("glasgow_verbal"  BETWEEN 1 AND 5);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "glasgow_motor"   integer
    CHECK ("glasgow_motor"   BETWEEN 1 AND 6);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "glasgow_total"   integer
    CHECK ("glasgow_total"   BETWEEN 3 AND 15);
COMMENT ON COLUMN ece.signos_vitales."glasgow_ocular"  IS 'CC-0007 RF-06 — Glasgow apertura ocular (1-4).';
COMMENT ON COLUMN ece.signos_vitales."glasgow_verbal"  IS 'CC-0007 RF-06 — Glasgow respuesta verbal (1-5).';
COMMENT ON COLUMN ece.signos_vitales."glasgow_motor"   IS 'CC-0007 RF-06 — Glasgow respuesta motora (1-6).';
COMMENT ON COLUMN ece.signos_vitales."glasgow_total"   IS 'CC-0007 RF-06 — Glasgow total (3-15). Calculado por la app.';

-- Glucometría capilar (mg/dL): se reutiliza la columna existente
-- ece.signos_vitales.glucometria_mgdl (operada vía raw SQL en signos-vitales.router).
-- NO se crea una columna nueva para evitar duplicación.

-- FiO2 (% fracción inspirada de oxígeno) — obligatorio junto con PA+cardiorrespiratorios
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "fio2" numeric(5,2)
    CHECK ("fio2" BETWEEN 21 AND 100);
COMMENT ON COLUMN ece.signos_vitales."fio2" IS
  'CC-0007 RF-06 — FiO₂ (%). Obligatorio al registrar signos vitales. '
  'También usado en terapia respiratoria (gasometría); aquí es el valor medido del paciente.';

-- Antropometría extendida
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "ict" numeric(5,3)
    CHECK ("ict" > 0);
COMMENT ON COLUMN ece.signos_vitales."ict" IS
  'CC-0007 RF-06 — índice cintura/talla (adimensional). Calculado por la app: cintura_cm / talla_cm.';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "perimetro_cintura" numeric(5,1)
    CHECK ("perimetro_cintura" > 0);
COMMENT ON COLUMN ece.signos_vitales."perimetro_cintura" IS 'CC-0007 RF-06 — perímetro de cintura (cm).';

-- Balance hídrico
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "balance_hidrico" numeric(7,1);
COMMENT ON COLUMN ece.signos_vitales."balance_hidrico" IS
  'CC-0007 RF-06 — balance hídrico (mL). Puede ser negativo (pérdidas > ingresos).';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "diuresis" numeric(7,1)
    CHECK ("diuresis" >= 0);
COMMENT ON COLUMN ece.signos_vitales."diuresis" IS 'CC-0007 RF-06 — diuresis horaria (mL/h).';

-- Gineco-obstétrico
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "fur" date;
COMMENT ON COLUMN ece.signos_vitales."fur" IS
  'CC-0007 RF-06 — fecha última regla. Solo paciente femenina en edad fértil. '
  'FPP se deriva por Naegele (app). La app valida que fur ≤ hoy y fur ≥ hoy - 300 días.';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "fpp" date;
COMMENT ON COLUMN ece.signos_vitales."fpp" IS
  'CC-0007 RF-06 — fecha probable de parto (Naegele). Calculada y persistida por la app.';
