-- =============================================================================
-- 188_cc0012_signos_vitales_transversal.sql
-- CC-0012 — Módulo transversal de Signos Vitales (mockup avante7), anclado a
-- la cuenta activa del paciente (public."PatientAccount") además del episodio.
--
-- Cambios de modelo:
--   1. ece.signos_vitales — cuenta_id (FK a public."PatientAccount"), 5 columnas
--      de fórmula obstétrica (G·P·P·A·V), peso_lb, talla_ft, fpp_activo.
--   2. ece.signos_vitales.episodio_id pasa a NULLABLE — una toma puede anclarse
--      solo a la cuenta (registro transversal sin episodio abierto).
--   3. CHECK — al menos un ancla (episodio_id o cuenta_id) presente.
--   4. RLS — política adicional para filas ancladas solo por cuenta (sin
--      episodio): visible si la organización de la cuenta coincide con la
--      organización del establecimiento activo (GUC ece_establecimiento_id).
--   5. FIX drift verificado en vivo (proyecto ejacvsgbewcerxtjtwto, 0 filas en
--      la tabla al 2026-07-27):
--        a. paciente_id — existe en schema.prisma (EceSignosVitales.pacienteId)
--           desde CC-0007 pero NUNCA se creó la columna física. El router la
--           declara opcional y jamás la escribe. CC-0012 exige persistirla
--           siempre → se crea la columna aquí.
--        b. instancia_id NOT NULL sin DEFAULT — el INSERT del router nunca la
--           provee (el vínculo real vive en ece.documento_instancia.registro_id,
--           poblado recién al firmar). Esto vuelve NOT NULL-violation cualquier
--           `create`, incluyendo los ya anclados solo a episodio_id (bug
--           preexistente, no introducido por CC-0012). Se relaja a NULLABLE
--           para no bloquear el flujo que este mismo cambio de control habilita.
--
-- Supuestos:
--   - ece.signos_vitales existe (61_ece_06_documentos.sql) con episodio_id NOT NULL.
--   - public."PatientAccount" existe (CC-0002, SQL 176/177/178) con organizationId.
--   - ece.establecimiento.establishment_id vincula a public."Establishment"
--     (56_ece_01_catalogos.sql), y public."Establishment".organizationId es el
--     tenant golden record (schema.prisma).
--   - 65_ece_rls_hardening.sql ya habilitó RLS + policy `by_episodio_estab` en
--     ece.signos_vitales (políticas PERMISSIVE — se combinan con OR).
--   - Tabla vacía (0 filas, verificado en vivo) — el CHECK nuevo y el DROP NOT
--     NULL de instancia_id no requieren backfill.
--
-- Idempotente. Aplicar vía mcp__supabase__apply_migration en transacción.
-- =============================================================================

-- ── 0. FIX drift preexistente (ver punto 5 arriba) ───────────────────────────

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "paciente_id" uuid REFERENCES ece.paciente(id);
COMMENT ON COLUMN ece.signos_vitales."paciente_id" IS
  'FK a ece.paciente. Declarada en schema.prisma desde CC-0007 sin columna física '
  '(drift cerrado en CC-0012) — el router ahora la persiste siempre en create.';

ALTER TABLE ece.signos_vitales
  ALTER COLUMN "instancia_id" DROP NOT NULL;
COMMENT ON COLUMN ece.signos_vitales."instancia_id" IS
  'Vestigial: el vínculo real con el workflow vive en ece.documento_instancia.registro_id '
  '(poblado al firmar). NOT NULL sin DEFAULT bloqueaba todo INSERT del router (bug '
  'preexistente cerrado en CC-0012, no introducido por este cambio).';

-- ── 1. Columnas nuevas ────────────────────────────────────────────────────────

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "cuenta_id" uuid REFERENCES public."PatientAccount"(id);
COMMENT ON COLUMN ece.signos_vitales."cuenta_id" IS
  'CC-0012 — ancla transversal a la cuenta activa del paciente (public."PatientAccount"). '
  'Toda toma queda vinculada a la cuenta, con o sin episodio abierto (Art. 14 NTEC — expediente único).';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "go_gestas" smallint
    CHECK ("go_gestas" >= 0);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "go_partos_termino" smallint
    CHECK ("go_partos_termino" >= 0);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "go_partos_pretermino" smallint
    CHECK ("go_partos_pretermino" >= 0);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "go_abortos" smallint
    CHECK ("go_abortos" >= 0);
ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "go_vivos" smallint
    CHECK ("go_vivos" >= 0);
COMMENT ON COLUMN ece.signos_vitales."go_gestas" IS
  'CC-0012 — fórmula obstétrica (G·P·P·A·V): G = número de gestas. Obligatoria si paciente femenina (mockup avante7).';
COMMENT ON COLUMN ece.signos_vitales."go_partos_termino" IS
  'CC-0012 — fórmula obstétrica: P = partos a término.';
COMMENT ON COLUMN ece.signos_vitales."go_partos_pretermino" IS
  'CC-0012 — fórmula obstétrica: P = partos pretérmino.';
COMMENT ON COLUMN ece.signos_vitales."go_abortos" IS
  'CC-0012 — fórmula obstétrica: A = abortos.';
COMMENT ON COLUMN ece.signos_vitales."go_vivos" IS
  'CC-0012 — fórmula obstétrica: V = nacidos vivos.';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "peso_lb" numeric(6,2)
    CHECK ("peso_lb" > 0);
COMMENT ON COLUMN ece.signos_vitales."peso_lb" IS
  'CC-0012 — peso en libras, capturado con conversión bidireccional kg↔lb en la UI (mockup avante7). '
  'peso_kg sigue siendo la unidad canónica; peso_lb es la representación alterna capturada.';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "talla_ft" numeric(5,2)
    CHECK ("talla_ft" > 0);
COMMENT ON COLUMN ece.signos_vitales."talla_ft" IS
  'CC-0012 — talla en pies, capturada con conversión bidireccional m↔ft en la UI (mockup avante7). '
  'talla_cm sigue siendo la unidad canónica; talla_ft es la representación alterna capturada.';

ALTER TABLE ece.signos_vitales
  ADD COLUMN IF NOT EXISTS "fpp_activo" boolean;
COMMENT ON COLUMN ece.signos_vitales."fpp_activo" IS
  'CC-0012 — estado del interruptor "Fecha probable de parto (Naegele)" del mockup avante7 '
  'al momento de guardar la toma. NULL = no aplicaba (paciente no en edad fértil / no femenina).';

-- ── 2. episodio_id pasa a NULLABLE ────────────────────────────────────────────
-- CC-0012 — toma transversal sin episodio (ancla solo por cuenta_id).

ALTER TABLE ece.signos_vitales
  ALTER COLUMN "episodio_id" DROP NOT NULL;

-- ── 3. CHECK — al menos un ancla ──────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'chk_signos_vitales_ancla'
       AND conrelid = 'ece.signos_vitales'::regclass
  ) THEN
    ALTER TABLE ece.signos_vitales
      ADD CONSTRAINT chk_signos_vitales_ancla
      CHECK (episodio_id IS NOT NULL OR cuenta_id IS NOT NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE ece.signos_vitales VALIDATE CONSTRAINT chk_signos_vitales_ancla;

COMMENT ON CONSTRAINT chk_signos_vitales_ancla ON ece.signos_vitales IS
  'CC-0012 — toda toma debe anclarse a al menos un contexto: episodio_id (clínico) o cuenta_id (cuenta del paciente).';

-- ── 4. Índice sobre cuenta_id ──────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "idx_signos_vitales_cuenta_id"
  ON ece.signos_vitales ("cuenta_id")
  WHERE "cuenta_id" IS NOT NULL;

-- ── 5. RLS — política adicional para filas ancladas solo por cuenta ──────────
-- 65_ece_rls_hardening.sql ya creó `by_episodio_estab` (EXISTS episodio_atencion
-- con establecimiento_id = GUC activo). Esa policy no cubre filas con
-- episodio_id NULL (cuenta-only). Se agrega una policy PERMISSIVE adicional
-- (se combinan con OR): visible si la organización de la cuenta coincide con
-- la organización del establecimiento activo (mismo golden record HIS que
-- resuelve ece.establecimiento.establishment_id → public."Establishment").
--
-- FOR ALL sin WITH CHECK explícito: sigue el mismo estilo que las policies de
-- 65_ece_rls_hardening.sql (USING se reutiliza también como WITH CHECK en
-- policies FOR ALL sin cláusula WITH CHECK explícita — comportamiento estándar
-- de Postgres RLS).

DROP POLICY IF EXISTS by_cuenta_estab ON ece.signos_vitales;
CREATE POLICY by_cuenta_estab ON ece.signos_vitales
  FOR ALL TO authenticated
  USING (
    cuenta_id IS NOT NULL
    AND EXISTS (
      SELECT 1
        FROM public."PatientAccount" pa
        JOIN ece.establecimiento est ON est.id = ece.current_establecimiento_id_safe()
        JOIN public."Establishment" e ON e.id = est.establishment_id
       WHERE pa.id = ece.signos_vitales.cuenta_id
         AND e."organizationId" = pa."organizationId"
    )
  );

COMMENT ON POLICY by_cuenta_estab ON ece.signos_vitales IS
  'CC-0012 — RLS para tomas ancladas solo por cuenta_id (sin episodio_id). '
  'Policy PERMISSIVE adicional a by_episodio_estab (65) — se combinan con OR. '
  'Requiere que ece.establecimiento del contexto activo tenga establishment_id '
  'resuelto hacia public."Establishment" con la misma organizationId que la cuenta.';
