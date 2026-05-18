-- =====================================================================
-- 82_equipment_gs1_extension.sql
-- Extiende public."BiomedicalEquipment" con identificadores GS1:
--   • giai_code   — Global Individual Asset Identifier (18 dígitos).
--   • gln_ubicacion_actual — GLN de la ubicación física actual,
--       FK a ece.gs1_gln (tabla creada aquí si no existe).
--
-- También crea ece.gs1_gln y ece.epcis_event_equipment (stub mínimo)
-- si aún no existen, para soportar historialUbicaciones y EPCIS.
--
-- Idempotente: usa ALTER TABLE ... ADD COLUMN IF NOT EXISTS +
-- CREATE TABLE IF NOT EXISTS.
-- Aplicar vía mcp__supabase__apply_migration.
-- =====================================================================

-- Asegurar que el schema ECE existe (ya creado en 56_ece_01_catalogos.sql,
-- pero se repite por seguridad).
create schema if not exists ece;

-- ---------------------------------------------------------------------
-- ece.gs1_gln — Catálogo de ubicaciones GS1 GLN (13 dígitos numéricos)
-- Stub mínimo; se puede extender con dirección, lat/lon, etc.
-- ---------------------------------------------------------------------
-- ece.gs1_gln ya fue creada en scripts anteriores con columnas:
-- codigo (PK text), descripcion text, tipo text, activo boolean, creado_en timestamptz
-- Este script solo la referencia vía FK — no la recrea.
-- Para referencia, el constraint de GLN 13 dígitos vive en esa tabla.

-- ---------------------------------------------------------------------
-- ece.epcis_event_equipment — Eventos EPCIS de movimiento de activos
-- Basado en GS1 EPCIS 2.0, sólo campos relevantes para trazabilidad
-- interna de equipos biomédicos.
-- ---------------------------------------------------------------------
create table if not exists ece.epcis_event_equipment (
  id              uuid        primary key default gen_random_uuid(),
  equipment_id    uuid        not null
                    references public."BiomedicalEquipment"(id) on delete cascade,
  event_time      timestamptz not null default now(),
  -- EPCIS event type: OBJECT_EVENT (movimiento/observación de un activo)
  event_type      text        not null default 'OBJECT_EVENT',
  -- EPCIS bizStep (vocabulario GS1): "storing", "transporting", "repackaging", etc.
  biz_step        text,
  -- GLN de destino (dónde quedó el activo después del evento)
  gln_destino     text        references ece.gs1_gln(codigo) deferrable initially deferred,
  -- GLN de origen (dónde estaba antes del evento); nullable si es primer registro
  gln_origen      text        references ece.gs1_gln(codigo) deferrable initially deferred,
  -- Usuario que registró el evento
  recorded_by     uuid,
  -- Payload JSON libre para metadatos adicionales (EPCIS extensions)
  payload         jsonb,
  creado_en       timestamptz not null default now()
);

comment on table ece.epcis_event_equipment is
  'Bitácora de eventos EPCIS 2.0 para trazabilidad de equipos biomédicos. '
  'Cada registro de "Actualizar ubicación" genera un OBJECT_EVENT.';

create index if not exists idx_epcis_equip_equipment_id
  on ece.epcis_event_equipment (equipment_id, event_time desc);

create index if not exists idx_epcis_equip_gln_destino
  on ece.epcis_event_equipment (gln_destino)
  where gln_destino is not null;

-- ---------------------------------------------------------------------
-- Extender public."BiomedicalEquipment" con columnas GS1
-- ---------------------------------------------------------------------

-- GIAI: Global Individual Asset Identifier — 18 dígitos numéricos GS1
alter table public."BiomedicalEquipment"
  add column if not exists giai_code text
    constraint uq_biomedequip_giai_code unique
    constraint chk_biomedequip_giai_digits check (giai_code ~ '^\d{18}$');

comment on column public."BiomedicalEquipment".giai_code is
  'GS1 Global Individual Asset Identifier (GIAI). 18 dígitos numéricos. '
  'Identifica de forma global y única este activo biomédico.';

-- GLN de la ubicación actual (puede cambiar con cada movimiento EPCIS)
alter table public."BiomedicalEquipment"
  add column if not exists gln_ubicacion_actual text
    constraint fk_biomedequip_gln
      references ece.gs1_gln(codigo) deferrable initially deferred;

comment on column public."BiomedicalEquipment".gln_ubicacion_actual is
  'GLN (GS1 Global Location Number) de la ubicación física actual del activo. '
  'Se actualiza en cada evento EPCIS registrado por actualizarUbicacion.';

create index if not exists idx_biomedequip_giai_code
  on public."BiomedicalEquipment" (giai_code)
  where giai_code is not null;

create index if not exists idx_biomedequip_gln_ubicacion
  on public."BiomedicalEquipment" (gln_ubicacion_actual)
  where gln_ubicacion_actual is not null;
