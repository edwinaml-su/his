-- ============================================================================
-- 238_cc0031_roles_notificaciones.sql
-- CC-0031 Fase 0 — Roles + alias + defaults de notificación, prerequisito del
-- puente Workflow Inbox / CareTask → Notification.
--
-- ⚠️ APLICADO a prod 2026-09-15 vía MCP (cc0031_roles_notificaciones_238) —
-- NO re-aplicar. Verificado: 7 roles × orgs activas, 29 alias globales,
-- 966 filas RoleNotificationDefault.
--
-- Motivación (docs/audit/2026-09-15_cobertura/00-inventario-infra-notificaciones.md
-- §5.1): `TASK_REQUIRED_ROLES` (packages/contracts/src/schemas/workflow-inbox.ts)
-- referencia ~30 códigos de rol que NO existen en `public."Role"` (14 filas
-- reales) — cada uno es una tarea que nunca le aparece a nadie en el puente
-- de notificaciones nuevo. Paridad TS obligatoria en
-- packages/contracts/src/schemas/notification-roles.ts (test de cobertura en
-- __tests__/notification-roles.test.ts) — si agregas un rol/alias acá,
-- agrégalo también ahí.
--
-- Tres secciones, cada una idempotente:
--   1. Roles reales nuevos (uno por organización activa) — patrón de
--      sql/75_specialized_roles.sql pero parametrizado por Organization en
--      vez de un solo UUID hardcodeado (CC-0031 los necesita en TODA org).
--   2. RoleCodeAlias globales nuevos — mismo patrón que
--      sql/194_cc0017_rbac_parametrizable.sql §2 (índices únicos parciales,
--      NO se re-declaran los 6 alias ya sembrados por sql/194).
--   3. RoleNotificationDefault — equivalente SQL de
--      packages/database/seed-notifications-defaults.ts (que solo cubre
--      PHYSICIAN/NURSE/PHARMACIST/ADMIN vía `expandDefaultsForRole`). Acá se
--      siembra la matriz FALLBACK_DEFAULTS de
--      packages/infrastructure/src/notifications/routing.ts (CRITICAL→INBOX+
--      EMAIL, WARNING→INBOX, INFO→INBOX) para TODOS los roles — incluidos
--      PHYSICIAN/NURSE/PHARMACIST/ADMIN si el seed TS no corrió todavía (00
--      §1.2: `RoleNotificationDefault` = 0 filas en prod) — `ON CONFLICT DO
--      NOTHING` deja que una corrida posterior del seed TS (con su matriz más
--      fina) gane si se ejecuta después.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Roles nuevos — uno por organización activa. Criterio: ver
--    docs/audit/2026-09-15_cobertura/04-resumen-ejecutivo-y-cc0031.md §4 Fase 0.
-- ---------------------------------------------------------------------------

INSERT INTO public."Role" (id, "organizationId", code, name, description, active, "createdAt", "updatedAt")
SELECT gen_random_uuid(), o.id, v.code, v.name, v.description, true, now(), now()
FROM public."Organization" o
CROSS JOIN (VALUES
  ('LAB_TECHNICIAN', 'Técnico de Laboratorio', 'Procesa muestras/órdenes de laboratorio (CC-0026 LAB_TO_PROCESS)'),
  ('RAD_TECHNICIAN', 'Técnico de Radiología/Imágenes', 'Ejecuta estudios de imagen (CC-0026 IMAGING_TO_REPORT)'),
  ('FACTURACION',    'Facturación',                    'Resuelve cargos PENDIENTE_TARIFA y reclamos a aseguradora (RN-HIS-BOT-001)'),
  ('CALIDAD',        'Calidad / Gestión de riesgos',    'Revisa eventos adversos e incidentes (INCIDENT_TO_REVIEW)'),
  ('BODEGA',         'Bodega / Logística',              'GS1 inbound/transfer/return/recall, inventario (F2-S7)'),
  ('GERENTE',        'Gerente',                         'Escalamiento administrativo/financiero (CC-0031 Fase 3)'),
  ('ADMIN_CLINICO',  'Administrador Clínico',           'Escalamiento de tareas de enfermería vencidas (CC-0031 Fase 3)')
) AS v(code, name, description)
WHERE o.active = true
ON CONFLICT ("organizationId", code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. RoleCodeAlias nuevos (globales — organizationId NULL). Ver
--    packages/contracts/src/schemas/notification-roles.ts
--    (CC0031_NEW_ROLE_ALIASES) para el criterio de cada mapeo "sin
--    correspondencia 1:1 obvia".
-- ---------------------------------------------------------------------------

INSERT INTO public."RoleCodeAlias" ("organizationId", "sourceCode", "canonicalCode")
VALUES
  (NULL, 'PHARM',        'PHARMACIST'),
  (NULL, 'TRIAGIST',     'TRIAGE_NURSE'),
  (NULL, 'TRIAGE',       'TRIAGE_NURSE'),
  (NULL, 'ADM',          'ADMISSION_CLERK'),
  (NULL, 'ADMISION',     'ADMISSION_CLERK'),
  (NULL, 'ANESTH',       'ANEST'),
  (NULL, 'LAB_TECH',     'LAB_TECHNICIAN'),
  (NULL, 'LAB',          'LAB_TECHNICIAN'),
  (NULL, 'RAD',          'RAD_TECHNICIAN'),
  (NULL, 'RADIOLOGO',    'RAD_TECHNICIAN'),
  (NULL, 'LAB_VALIDATOR','PHYSICIAN'),
  (NULL, 'RECEPCION',    'ADMISSION_CLERK'),
  (NULL, 'RESP',         'NURSE'),
  (NULL, 'TERAPISTA',    'NURSE'),
  (NULL, 'NUTRI',        'PHYSICIAN'),
  (NULL, 'OBSTETRA',     'GO'),
  (NULL, 'NEONATOLOGO',  'PEDIA'),
  (NULL, 'BB',           'LAB_TECHNICIAN'),
  (NULL, 'DPO',          'ADMIN'),
  (NULL, 'FARMACO',      'PHARMACIST'),
  (NULL, 'MANTENIMIENTO','ADMIN'),
  (NULL, 'BIOMEDICA',    'ADMIN'),
  (NULL, 'LIMPIEZA',     'ADMIN')
ON CONFLICT ("sourceCode") WHERE "organizationId" IS NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. RoleNotificationDefault — FALLBACK_DEFAULTS (routing.ts) para todos los
--    roles (pre-existentes + nuevos) de toda organización, si aún no tienen
--    fila para esa combinación (roleId, severity, channel).
-- ---------------------------------------------------------------------------

INSERT INTO public."RoleNotificationDefault" ("roleId", severity, channel, enabled)
SELECT r.id, v.severity::"NotificationSeverity", v.channel::"NotificationChannel", v.enabled
FROM public."Role" r
CROSS JOIN (VALUES
  ('CRITICAL', 'INBOX', true),
  ('CRITICAL', 'EMAIL', true),
  ('WARNING',  'INBOX', true),
  ('WARNING',  'EMAIL', false),
  ('INFO',     'INBOX', true),
  ('INFO',     'EMAIL', false)
) AS v(severity, channel, enabled)
WHERE r.active = true
ON CONFLICT ("roleId", severity, channel) DO NOTHING;
