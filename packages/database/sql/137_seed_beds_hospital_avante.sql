-- =============================================================================
-- 137_seed_beds_hospital_avante.sql
-- Seed inicial de camas físicas para el Hospital Avante Complejo (establecimiento
-- 68c496a8-5755-4e90-ab45-a872c36f9ce1, org c7eabf29-a484-4a69-9426-9ee8b06d054a).
--
-- Total: 66 camas distribuidas en 6 servicios físicos:
--   - Emergencia (ER):           8 camas de observación
--   - Hospitalización (HOSP):   30 camas (Medicina 1-20 + Cirugía 1-10)
--   - Sala de Partos (PARTOS):   6 camas
--   - Quirófanos (QX):           6 quirófanos
--   - UCI:                       8 camas críticas
--   - UCI Neonatal (UCIN):       8 cunas neonatales
--
-- Servicios SIN camas (CE, FAR, LAB, RX) no aparecen — no son áreas con camas
-- físicas.
--
-- Estados distribuidos para mostrar UX realista:
--   - ~85% FREE (libre)
--   - ~6%  DIRTY (limpieza post-alta)
--   - ~5%  MAINTENANCE (mantenimiento correctivo)
--   - ~3%  BLOCKED (bloqueada por incidente, aislamiento, etc.)
--   La columna `status` NO se usa para "ocupada" — esa se deriva de
--   ece.asignacion_cama (siguiendo el modelo del router eceCama).
--
-- IDEMPOTENCIA: usa INSERT ... ON CONFLICT DO NOTHING vía UNIQUE
--   (establishmentId, code). Volver a aplicar la migración es seguro.
--
-- Aplicado a prod: 2026-05-25 vía MCP (seed_beds_hospital_avante_2026_05_25).
-- =============================================================================

WITH ids AS (
  SELECT
    'c7eabf29-a484-4a69-9426-9ee8b06d054a'::uuid AS org_id,
    '68c496a8-5755-4e90-ab45-a872c36f9ce1'::uuid AS estab_id,
    'b2a5de8e-b69e-4f0e-8d3d-909563a40f26'::uuid AS er_id,
    'e5b3e10d-0d4b-4a09-9584-514851560f5b'::uuid AS hosp_id,
    'b4bf9c96-2f13-48e6-9bce-b44cfbd087fc'::uuid AS partos_id,
    'f894e646-631a-4c46-8380-0e292370b14e'::uuid AS qx_id,
    '90019d30-b3f7-40b0-b728-77d4fdc5978f'::uuid AS uci_id,
    '4b68bcf1-ac81-42a6-9cc9-72b8f5f3708e'::uuid AS ucin_id
)
INSERT INTO "Bed" (
  id, "organizationId", "establishmentId", "serviceUnitId",
  code, room, status, isolation, active, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  ids.org_id,
  ids.estab_id,
  service_unit_id,
  code,
  room,
  status::"BedStatus",
  isolation,
  true,
  now(),
  now()
FROM ids, (VALUES
  -- ── Emergencia: 8 camas observación ─────────────────────────────────────
  ('OBS-01', 'OBS-1', 'FREE',         NULL,         'er_id'),
  ('OBS-02', 'OBS-1', 'FREE',         NULL,         'er_id'),
  ('OBS-03', 'OBS-1', 'DIRTY',        NULL,         'er_id'),
  ('OBS-04', 'OBS-2', 'FREE',         NULL,         'er_id'),
  ('OBS-05', 'OBS-2', 'FREE',         'gotitas',    'er_id'),
  ('OBS-06', 'OBS-2', 'FREE',         NULL,         'er_id'),
  ('OBS-07', 'OBS-3', 'MAINTENANCE',  NULL,         'er_id'),
  ('OBS-08', 'OBS-3', 'FREE',         NULL,         'er_id'),

  -- ── Hospitalización: 30 camas (Medicina 1-20 + Cirugía 1-10) ────────────
  -- Medicina Interna (3 habitaciones x 2 camas + 4 hab x 3 camas + 2 hab privadas = 20)
  ('MED-101', '101', 'FREE',          NULL,         'hosp_id'),
  ('MED-102', '101', 'FREE',          NULL,         'hosp_id'),
  ('MED-103', '102', 'FREE',          NULL,         'hosp_id'),
  ('MED-104', '102', 'DIRTY',         NULL,         'hosp_id'),
  ('MED-105', '103', 'FREE',          NULL,         'hosp_id'),
  ('MED-106', '103', 'FREE',          NULL,         'hosp_id'),
  ('MED-107', '104', 'FREE',          NULL,         'hosp_id'),
  ('MED-108', '104', 'FREE',          NULL,         'hosp_id'),
  ('MED-109', '104', 'FREE',          NULL,         'hosp_id'),
  ('MED-110', '105', 'FREE',          NULL,         'hosp_id'),
  ('MED-111', '105', 'FREE',          NULL,         'hosp_id'),
  ('MED-112', '105', 'BLOCKED',       'contacto',   'hosp_id'),
  ('MED-113', '106', 'FREE',          NULL,         'hosp_id'),
  ('MED-114', '106', 'FREE',          NULL,         'hosp_id'),
  ('MED-115', '106', 'FREE',          NULL,         'hosp_id'),
  ('MED-116', '107', 'FREE',          NULL,         'hosp_id'),
  ('MED-117', '107', 'FREE',          NULL,         'hosp_id'),
  ('MED-118', '107', 'FREE',          NULL,         'hosp_id'),
  ('MED-119', '108', 'FREE',          NULL,         'hosp_id'),
  ('MED-120', '109', 'FREE',          'protector',  'hosp_id'),

  -- Cirugía (5 habitaciones x 2 camas = 10)
  ('CIR-201', '201', 'FREE',          NULL,         'hosp_id'),
  ('CIR-202', '201', 'FREE',          NULL,         'hosp_id'),
  ('CIR-203', '202', 'FREE',          NULL,         'hosp_id'),
  ('CIR-204', '202', 'FREE',          NULL,         'hosp_id'),
  ('CIR-205', '203', 'DIRTY',         NULL,         'hosp_id'),
  ('CIR-206', '203', 'FREE',          NULL,         'hosp_id'),
  ('CIR-207', '204', 'FREE',          NULL,         'hosp_id'),
  ('CIR-208', '204', 'MAINTENANCE',   NULL,         'hosp_id'),
  ('CIR-209', '205', 'FREE',          NULL,         'hosp_id'),
  ('CIR-210', '205', 'FREE',          NULL,         'hosp_id'),

  -- ── Sala de Partos: 6 camas ─────────────────────────────────────────────
  ('PARTO-01', 'P-1', 'FREE',         NULL,         'partos_id'),
  ('PARTO-02', 'P-1', 'FREE',         NULL,         'partos_id'),
  ('PARTO-03', 'P-2', 'DIRTY',        NULL,         'partos_id'),
  ('PARTO-04', 'P-2', 'FREE',         NULL,         'partos_id'),
  ('PARTO-05', 'P-3', 'FREE',         NULL,         'partos_id'),
  ('PARTO-06', 'P-3', 'FREE',         NULL,         'partos_id'),

  -- ── Quirófanos: 6 salas ─────────────────────────────────────────────────
  ('QX-01',   'QF-1', 'FREE',         NULL,         'qx_id'),
  ('QX-02',   'QF-2', 'FREE',         NULL,         'qx_id'),
  ('QX-03',   'QF-3', 'FREE',         NULL,         'qx_id'),
  ('QX-04',   'QF-4', 'MAINTENANCE',  NULL,         'qx_id'),
  ('QX-05',   'QF-5', 'FREE',         NULL,         'qx_id'),
  ('QX-06',   'QF-6', 'FREE',         NULL,         'qx_id'),

  -- ── UCI: 8 camas críticas ───────────────────────────────────────────────
  ('UCI-01',  'UCI-1', 'FREE',        NULL,         'uci_id'),
  ('UCI-02',  'UCI-1', 'FREE',        NULL,         'uci_id'),
  ('UCI-03',  'UCI-2', 'FREE',        'respiratorio','uci_id'),
  ('UCI-04',  'UCI-2', 'FREE',        NULL,         'uci_id'),
  ('UCI-05',  'UCI-3', 'FREE',        NULL,         'uci_id'),
  ('UCI-06',  'UCI-3', 'DIRTY',       NULL,         'uci_id'),
  ('UCI-07',  'UCI-4', 'FREE',        NULL,         'uci_id'),
  ('UCI-08',  'UCI-4', 'FREE',        NULL,         'uci_id'),

  -- ── UCIN: 8 cunas neonatales ────────────────────────────────────────────
  ('NEO-01',  'NEO-A', 'FREE',        NULL,         'ucin_id'),
  ('NEO-02',  'NEO-A', 'FREE',        NULL,         'ucin_id'),
  ('NEO-03',  'NEO-A', 'FREE',        NULL,         'ucin_id'),
  ('NEO-04',  'NEO-A', 'FREE',        NULL,         'ucin_id'),
  ('NEO-05',  'NEO-B', 'FREE',        NULL,         'ucin_id'),
  ('NEO-06',  'NEO-B', 'FREE',        NULL,         'ucin_id'),
  ('NEO-07',  'NEO-B', 'BLOCKED',     'protector',  'ucin_id'),
  ('NEO-08',  'NEO-B', 'FREE',        NULL,         'ucin_id')
) AS beds_data(code, room, status, isolation, service_unit_key)
CROSS JOIN LATERAL (
  SELECT CASE service_unit_key
    WHEN 'er_id'     THEN ids.er_id
    WHEN 'hosp_id'   THEN ids.hosp_id
    WHEN 'partos_id' THEN ids.partos_id
    WHEN 'qx_id'     THEN ids.qx_id
    WHEN 'uci_id'    THEN ids.uci_id
    WHEN 'ucin_id'   THEN ids.ucin_id
  END AS service_unit_id
) AS resolve
ON CONFLICT ("establishmentId", code) DO NOTHING;
