-- =============================================================================
-- 207_ece_quirofano_centro_costo.sql
--
-- ADR 0021 (docs/adr/0021-fuente-verdad-quirurgica.md) — R05 del assessment
-- Code Castle ("modelos quirúrgicos paralelos"). El ADR verificó contra
-- information_schema.columns en producción que NI ece.reserva_sala_qx NI
-- ece.acto_quirurgico tienen columna de centro de costo, mientras que
-- public."SurgeryCase".costCenterId (sql/132_cost_center_clinical_modules.sql)
-- es HOY el único vínculo real entre el proceso quirúrgico y facturación.
--
-- Este archivo SOLO cierra ese gap. NO retira SurgeryCase, NO decide la
-- consolidación hacia ECE (ADR 0021 Opción B) — esa decisión es de Edwin y
-- está pendiente. Es, en cambio, un prerrequisito de cualquier retiro futuro:
-- si algún día se retira SurgeryCase sin que ECE tenga su propio vínculo de
-- imputación, los cargos de quirófano quedarían sin centro de costo — el área
-- donde más facturación se pierde en un hospital.
--
-- Idempotente. NO aplicado a producción por este PR — @DBA/Edwin lo revisan
-- y aplican manualmente (mcp__supabase__apply_migration / SQL Editor).
--
-- -----------------------------------------------------------------------
-- DECISIÓN: centro_costo_id se agrega a AMBAS tablas — reserva_sala_qx Y
-- acto_quirurgico — con semántica distinta. Evidencia (verificada contra
-- prod, 2026-08-22, vía psql read-only / DIRECT_URL):
--
-- 1. Solo existen 2 CostCenter reales para quirófano hoy:
--      1-QUI-MAY  "Quirófano cirugía mayor"              (tipo: productivo)
--      1-QUI-MEN  "Quirófano cirugía menor / ambulatoria" (tipo: productivo)
--    La imputación es una clasificación mayor/menor-ambulatoria del caso,
--    no una imputación por sala física individual ni por servicio
--    solicitante.
--
-- 2. ece.sala_qx YA distingue esa misma clasificación en su columna `tipo`
--    (CHECK tipo IN ('mayor','menor','ambulatoria'), sql/99). Como
--    ece.reserva_sala_qx.sala_qx_id fija qué sala se reserva, la
--    clasificación mayor/menor "nace" en la reserva — es la primera vez que
--    el sistema sabe a qué tipo de quirófano se imputará el caso. Un
--    centro_costo_id aquí soporta reportes de capacidad/ocupación de sala
--    (planificado) ANTES de que la cirugía ocurra.
--
-- 3. Pero ece.acto_quirurgico NO tiene FK a sala_qx ni a reserva_sala_qx
--    (verificado: sus únicas FKs son instancia_id, episodio_id, cirujano_id,
--    anestesiologo_id) — no hay forma de derivar el centro de costo por
--    JOIN en el momento del acto. Y el acto es el registro HISTÓRICO
--    INMUTABLE post-firma (NTEC Art. 40, trigger
--    ece.fn_bloquea_mutacion_acto_qx / trg_inmutable_acto_quirurgico,
--    sql/99_acto_quirurgico_trigger_condicional.sql, ya bloquea cualquier
--    UPDATE cuando el estado es firmado/validado/anulado — cubre esta
--    columna nueva sin cambios adicionales). Es decir: el acto es la
--    fuente de verdad de lo que REALMENTE pasó, que puede diferir de lo
--    planeado en la reserva (una cirugía reservada como "menor" puede
--    complicarse y terminar siendo, en los hechos, una cirugía mayor). La
--    imputación DEFINITIVA — la que debe alimentar facturación — vive acá,
--    no en la reserva.
--
-- 4. Precedente ya establecido en el propio proyecto (sql/132, Wave 10):
--    CADA tabla clínica que genera un cargo recibe su PROPIA columna
--    costCenterId explícita, incluso cuando existiría un JOIN posible
--    (LabOrder e ImagingOrder tienen costCenterId + ejecutorCostCenterId
--    propios; ninguno deriva de Encounter.costCenterId por join). Este
--    archivo sigue el mismo patrón: explícito en ambas tablas, no derivado.
--
-- 5. public."SurgeryCase" cubre esta misma superficie funcional con UNA sola
--    columna porque SurgeryCase es una única fila que vive todo el ciclo de
--    vida (SCHEDULED → ... → COMPLETED). ECE separa la reserva
--    (planificación) del acto (ejecución real, inmutable) en dos tablas —
--    por eso necesita dos columnas para cubrir lo que legacy cubre con una.
--
-- Resumen semántico:
--   reserva_sala_qx.centro_costo_id → imputación ESTIMADA al reservar sala
--     (capacidad/planificación). Editable mientras la reserva no esté
--     cancelada — no hay más restricción hoy porque PROG_QX aún no es un
--     tipo_documento de pleno derecho (ADR 0021 §3, pendiente paso 2 del
--     plan de migración).
--   acto_quirurgico.centro_costo_id → imputación DEFINITIVA de facturación.
--     Inmutable una vez firmado/validado/anulado (mismo trigger Art. 40 ya
--     vigente). Es la columna que debe alimentar Invoice/InvoiceItem el día
--     que exista esa integración — hoy no existe (verificado: ningún router
--     de facturación referencia ece.acto_quirurgico).
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. ece.reserva_sala_qx.centro_costo_id — imputación estimada/planificada.
-- -----------------------------------------------------------------------
ALTER TABLE ece.reserva_sala_qx
  ADD COLUMN IF NOT EXISTS centro_costo_id uuid;

DO $$ BEGIN
  ALTER TABLE ece.reserva_sala_qx
    ADD CONSTRAINT reserva_sala_qx_centro_costo_fkey
      FOREIGN KEY (centro_costo_id) REFERENCES public."CostCenter"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_reserva_sala_qx_centro_costo
  ON ece.reserva_sala_qx (centro_costo_id) WHERE centro_costo_id IS NOT NULL;

COMMENT ON COLUMN ece.reserva_sala_qx.centro_costo_id IS
  'Centro de costo ESTIMADO al reservar sala (ADR 0021, sql/207). Nace de la '
  'clasificación mayor/menor/ambulatoria de la sala reservada (ece.sala_qx.tipo). '
  'No es la fuente de facturación definitiva — ver ece.acto_quirurgico.centro_costo_id. '
  'Nullable: reservas previas y futuras sin este dato no deben bloquearse.';

-- -----------------------------------------------------------------------
-- 2. ece.acto_quirurgico.centro_costo_id — imputación definitiva de
--    facturación. Queda inmutable post-firma por el trigger Art. 40 ya
--    existente (trg_inmutable_acto_quirurgico, sql/99) — no requiere
--    protección adicional en este archivo.
-- -----------------------------------------------------------------------
ALTER TABLE ece.acto_quirurgico
  ADD COLUMN IF NOT EXISTS centro_costo_id uuid;

DO $$ BEGIN
  ALTER TABLE ece.acto_quirurgico
    ADD CONSTRAINT acto_quirurgico_centro_costo_fkey
      FOREIGN KEY (centro_costo_id) REFERENCES public."CostCenter"(id) ON DELETE RESTRICT;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_acto_quirurgico_centro_costo
  ON ece.acto_quirurgico (centro_costo_id) WHERE centro_costo_id IS NOT NULL;

COMMENT ON COLUMN ece.acto_quirurgico.centro_costo_id IS
  'Centro de costo DEFINITIVO de facturación del acto quirúrgico (ADR 0021, '
  'sql/207) — fuente de verdad de lo realmente ejecutado, puede diferir del '
  'estimado en ece.reserva_sala_qx.centro_costo_id (ej. una cirugía reservada '
  'como menor que se complica y termina siendo mayor). Inmutable una vez '
  'firmado/validado/anulado: cubierto por el trigger existente '
  'ece.fn_bloquea_mutacion_acto_qx (sql/99_acto_quirurgico_trigger_condicional.sql), '
  'que bloquea UPDATE de la fila completa en esos estados — sin cambios '
  'adicionales en este archivo. Nullable: actos previos y futuros sin este '
  'dato no deben bloquearse; el bridge de facturación que consuma esta '
  'columna (no implementado aún) deberá decidir cómo tratar los nulos.';
