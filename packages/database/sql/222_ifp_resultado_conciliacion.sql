-- =====================================================================
-- 222_ifp_resultado_conciliacion.sql
--
-- Completa R04: la cola de conciliación farmacia/eMAR
-- (ece.indicacion_farmacia_pendiente, sql/201) registra QUÉ se firmó,
-- pero no tenía dónde registrar el RESULTADO de la conciliación — a qué
-- public."PrescriptionItem" (Drug estructurado) corresponde el ítem de
-- texto libre. Sin ese vínculo, `bedside.administration.record`
-- (packages/trpc/src/routers/bedside.router.ts) no puede resolver el
-- PrescriptionItem de una indicación nativa ECE y el circuito BCMA nunca
-- termina en éxito (hallazgo E2E bedside-hard-stops, 2026-09-09).
--
-- Esta columna es el punto de aterrizaje del vínculo bajo CUALQUIER
-- resultado de la decisión R06 / ADR 0023 (punto único de prescripción):
--   - Conciliación manual de farmacia (flujo R04 original): el
--     farmacéutico elige/crea la receta y deja aquí el item.
--   - Opción A del ADR 0023 (generación automática de Prescription al
--     firmar la indicación): firmar() puede auto-conciliar la fila de la
--     cola escribiendo el item generado en esta misma columna.
-- Quién ESCRIBE la columna sigue siendo la decisión R06 pendiente de
-- dirección; este archivo solo crea el destino y su invariante.
--
-- Requiere sql/201 aplicado antes (crea la tabla). Idempotente.
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration
-- (después de 201, que a la fecha de este archivo tampoco consta como
-- aplicado — verificar con el método del barrido SQL vs prod).
-- =====================================================================

ALTER TABLE ece.indicacion_farmacia_pendiente
    ADD COLUMN IF NOT EXISTS prescription_item_id UUID NULL;

DO $$ BEGIN
    -- FK dura a public."PrescriptionItem": el vínculo alimenta administración
    -- de medicamentos (MedicationAdministration.prescriptionItemId NOT NULL) —
    -- integridad referencial real, no referencia blanda.
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'fk_ifp_prescription_item'
           AND conrelid = 'ece.indicacion_farmacia_pendiente'::regclass
    ) THEN
        ALTER TABLE ece.indicacion_farmacia_pendiente
            ADD CONSTRAINT fk_ifp_prescription_item
            FOREIGN KEY (prescription_item_id)
            REFERENCES public."PrescriptionItem"(id)
            ON DELETE RESTRICT;
    END IF;

    -- Invariante: RECONCILIADO exige el vínculo. Evita que un flujo futuro
    -- marque la fila como conciliada sin dejar el PrescriptionItem — eso
    -- dejaría el BCMA bloqueado en silencio (record filtra por ambas cosas).
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'chk_ifp_reconciliado_con_item'
           AND conrelid = 'ece.indicacion_farmacia_pendiente'::regclass
    ) THEN
        ALTER TABLE ece.indicacion_farmacia_pendiente
            ADD CONSTRAINT chk_ifp_reconciliado_con_item
            CHECK (estado <> 'RECONCILIADO' OR prescription_item_id IS NOT NULL);
    END IF;
END $$;

-- Lookup de administration.record: indicacion_id + estado RECONCILIADO.
CREATE INDEX IF NOT EXISTS idx_ifp_indicacion_reconciliado
    ON ece.indicacion_farmacia_pendiente (indicacion_id)
    WHERE estado = 'RECONCILIADO';

COMMENT ON COLUMN ece.indicacion_farmacia_pendiente.prescription_item_id IS
    'Resultado de la conciliación: PrescriptionItem (Drug estructurado) al que '
    'farmacia mapeó este ítem de texto libre. NOT NULL cuando estado=RECONCILIADO '
    '(chk_ifp_reconciliado_con_item). Lo consume bedside.administration.record '
    'para resolver el PrescriptionItem de la administración BCMA. Ver sql/222.';

-- =====================================================================
-- Verificación post-apply
-- =====================================================================
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'ece.indicacion_farmacia_pendiente'::regclass;
-- Esperado: incluye fk_ifp_prescription_item + chk_ifp_reconciliado_con_item.
-- =====================================================================
