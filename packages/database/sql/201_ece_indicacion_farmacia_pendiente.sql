-- =====================================================================
-- 201_ece_indicacion_farmacia_pendiente.sql
--
-- R04 (Code Castle) — consumer de 'ece.indicaciones.firmadas'.
--
-- Contexto: el router `indicaciones-medicas.router.ts` emite
-- 'ece.indicaciones.firmadas' al outbox (public."DomainEvent") desde
-- Fase 2, pero nunca existió un consumer — farmacia/eMAR nunca se enteraban
-- de que un médico firmó una indicación. Este archivo crea el destino que el
-- consumer TS (packages/trpc/src/ece/mar-consumer.ts) materializa DENTRO de
-- la misma transacción que la firma.
--
-- Por qué NO se usa public.PrescriptionItem / public.MedicationAdministration
-- (el modelo "oficial" de farmacia/eMAR):
--   Ambos exigen `drugId` NOT NULL (FK duro a public."Drug"). La indicación
--   ECE (`ece.indicacion_item`) NO tiene ningún vínculo estructurado al
--   catálogo de medicamentos — solo `descripcion` en texto libre. Resolver
--   `drugId` desde texto libre requiere fuzzy-matching contra el catálogo,
--   lo cual es ambiguo (una descripción puede matchear múltiples
--   presentaciones/dosis/fabricantes) e inaceptable para un sistema que
--   administra medicamentos. Ver reporte del sprint para el detalle completo.
--
-- Por qué NO se reutiliza ece.administracion_medicamento (el "eMAR" nativo
-- de ECE que ya usa `registrarAdministracion`):
--   `registro_enf_id` es NOT NULL y referencia `ece.registro_enfermeria`
--   (una nota de enfermería por turno) — estructuralmente no puede existir
--   una fila de esa tabla ANTES de que enfermería haya valorado al paciente
--   en el turno. No hay forma de precrear líneas "programadas/pendientes"
--   ahí sin inventar una nota de enfermería ficticia. Además (hallazgo
--   colateral, verificado contra prod 2026-08-19): el CHECK
--   `administracion_medicamento_estado_check` vigente en prod solo permite
--   {'administrado','omitido','diferido'} — el router usa
--   {'PROGRAMADA','ADMINISTRADO','OMITIDA','RECHAZADA'} (mayúsculas,
--   vocabulario distinto). `registrarAdministracion` está roto en prod hoy
--   (violación de CHECK garantizada). Fuera del alcance de este archivo —
--   requiere su propia migración + decisión de qué vocabulario gana.
--
-- Este archivo crea una cola de conciliación explícita: farmacia ve QUÉ
-- se firmó (texto verbatim, sin traducir dosis/vía/frecuencia — se copian
-- tal cual del origen ECE) y decide manualmente a qué `Drug` corresponde al
-- despachar. No se inventa ningún mapeo automático de posología.
--
-- Idempotencia: UNIQUE(indicacion_item_id) — el consumer usa
-- `ON CONFLICT (indicacion_item_id) DO NOTHING`, así que reprocesar el mismo
-- evento (retry, replay) nunca duplica filas.
--
-- PENDIENTE DE APPLY MANUAL en Supabase SQL Editor / MCP apply_migration.
-- NO aplicado en este PR (worktree sin permiso de escritura a prod).
-- =====================================================================

CREATE TABLE IF NOT EXISTS ece.indicacion_farmacia_pendiente (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    indicacion_id       UUID        NOT NULL REFERENCES ece.indicaciones_medicas(id)
                                        ON DELETE CASCADE,
    indicacion_item_id  UUID        NOT NULL REFERENCES ece.indicacion_item(id)
                                        ON DELETE CASCADE,
    episodio_id         UUID        NOT NULL REFERENCES ece.episodio_atencion(id),
    medico_prescriptor  UUID        NOT NULL REFERENCES ece.personal_salud(id),
    -- Copia VERBATIM de ece.indicacion_item — sin traducción. El farmacéutico
    -- decide manualmente a qué Drug corresponde antes de dispensar.
    descripcion         TEXT        NOT NULL,
    dosis               TEXT,
    via                 TEXT,
    frecuencia          TEXT,
    duracion            TEXT,
    -- Referencia blanda (sin FK cross-schema) al evento de outbox que originó
    -- esta fila — trazabilidad forense, no integridad referencial.
    domain_event_id     UUID,
    estado              TEXT        NOT NULL DEFAULT 'PENDIENTE_REVISION_FARMACIA'
                            CHECK (estado IN ('PENDIENTE_REVISION_FARMACIA', 'RECONCILIADO', 'DESCARTADO')),
    creado_en           TIMESTAMPTZ NOT NULL DEFAULT now(),
    reconciliado_en     TIMESTAMPTZ,
    reconciliado_por    UUID        REFERENCES ece.personal_salud(id),

    CONSTRAINT uq_ifp_indicacion_item UNIQUE (indicacion_item_id)
);

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ifp_episodio') THEN
        CREATE INDEX idx_ifp_episodio ON ece.indicacion_farmacia_pendiente(episodio_id);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_ifp_estado') THEN
        CREATE INDEX idx_ifp_estado ON ece.indicacion_farmacia_pendiente(estado);
    END IF;
END $$;

COMMENT ON TABLE ece.indicacion_farmacia_pendiente IS
    'R04 — cola de conciliación farmacia/eMAR. Materializada por el consumer '
    'TS (mar-consumer.ts) al firmar una indicación con ítems tipo=medicamento. '
    'Datos verbatim (sin mapeo automático a Drug) — requiere revisión manual '
    'del farmacéutico. Ver 201_ece_indicacion_farmacia_pendiente.sql.';

-- ─── RLS (mismo patrón que ece.indicacion_item / ece.administracion_medicamento
--      en 65_ece_rls_hardening.sql — por episodio via ece.episodio_atencion) ──

ALTER TABLE ece.indicacion_farmacia_pendiente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS by_parent_episodio ON ece.indicacion_farmacia_pendiente;
CREATE POLICY by_parent_episodio ON ece.indicacion_farmacia_pendiente
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ece.episodio_atencion ea
     WHERE ea.id = ece.indicacion_farmacia_pendiente.episodio_id
       AND ea.establecimiento_id = ece.current_establecimiento_id_safe()
  ));

-- =====================================================================
-- Verificación post-apply (queries de comprobación)
-- =====================================================================
-- SELECT conname FROM pg_constraint
--  WHERE conrelid = 'ece.indicacion_farmacia_pendiente'::regclass;
-- Esperado: incluye uq_ifp_indicacion_item + el CHECK de estado.
--
-- SELECT relrowsecurity FROM pg_class WHERE oid = 'ece.indicacion_farmacia_pendiente'::regclass;
-- Esperado: true.
-- =====================================================================
