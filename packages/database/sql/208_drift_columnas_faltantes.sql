-- =====================================================================
-- 208_drift_columnas_faltantes.sql
-- Cierra 4 de los 6 "bugs activos" del censo de drift schema.prisma↔BD
-- (docs/45_registro_drift_schema.md §4.1-4.4, R09 Code Castle).
--
-- Cada columna de este archivo es un campo que schema.prisma YA declara y
-- que código de producción YA lee/escribe vía el cliente tipado de Prisma
-- (no $queryRaw) — la columna real nunca se creó (o se creó y se perdió
-- en un ALTER que quedó como no-op, ver notas por caso abajo). Sin esto,
-- las rutas de código listadas lanzan `column "..." does not exist` en
-- cada invocación.
--
-- Los otros 2 bugs del censo (§4.4 AuditDashboardConfig.outlierAlertEnabled
-- SÍ vive aquí — ver caso 4; §4.5 EcePaciente NO vive aquí porque la
-- decisión fue la inversa: la demografía no pertenece a ece.paciente, se
-- sacaron los 4 campos de schema.prisma y el código pasó a leer
-- public."Patient" — ver patient-dedup.router.ts).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS en las 4 tablas. Ninguna requiere
-- backfill (todas nullable o con DEFAULT seguro para filas existentes).
-- No se otorgan GRANTs nuevos: las 4 tablas ya tienen INSERT/SELECT/UPDATE/
-- DELETE de tabla completa para `authenticated` (verificado contra prod,
-- information_schema.role_table_grants) — Postgres no usa privilegios por
-- columna en este proyecto, así que ALTER TABLE ADD COLUMN no necesita
-- GRANT adicional.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CASO 1 — ClinicalNote.editHistory (§4.1)
--
-- Usado por packages/trpc/src/routers/ehr-notes.router.ts: create (línea
-- ~100) y addendum (~137) escriben `editHistory: [historyEntry]`; update
-- (~157-173) selecciona `editHistory`, arma el historial nuevo con
-- buildEditHistory() y lo reescribe. Sin la columna, crear/addendar/editar
-- CUALQUIER nota SOAP falla — es el módulo de evolución médica, alto
-- tráfico. schema.prisma:2547 ya declara el campo (Json?, sin @map); solo
-- faltó la migración SQL correspondiente (29_ehr_notes_hardening.sql solo
-- deja un comentario "índice no requerido", nunca un ALTER real).
-- ---------------------------------------------------------------------

ALTER TABLE public."ClinicalNote"
  ADD COLUMN IF NOT EXISTS "editHistory" JSONB;

COMMENT ON COLUMN public."ClinicalNote"."editHistory" IS
  'Historial de cambios pre-firma. Array [{at, by, action, diff}], máx 50 '
  'entradas (las más viejas se descartan). Usado por ehr-notes.router.ts '
  '(create/addendum/update). docs/45_registro_drift_schema.md §4.1.';

-- ---------------------------------------------------------------------
-- CASO 2 — DietPlan.allergens (§4.2)
--
-- Usado por packages/trpc/src/routers/nutrition.router.ts (~222-228,
-- findAllergyConflicts): cruza los alérgenos del plan dietético contra
-- PatientAllergy.substanceText para bloquear planes incompatibles con las
-- alergias del paciente (UAT-BUG-02) — es un chequeo de seguridad
-- alimentaria, no solo técnico.
--
-- YA existe 54_diet_plan_allergens.sql con el ALTER correcto
-- (`ADD COLUMN IF NOT EXISTS "allergens" TEXT[] NOT NULL DEFAULT '{}'`),
-- pero nunca se aplicó a prod — confirmado por introspección directa
-- (information_schema.columns sobre public."DietPlan": 15 columnas, sin
-- "allergens"). Este caso repite ese mismo ALTER aquí para que quede
-- efectivamente aplicado; 54_diet_plan_allergens.sql no se modifica
-- (queda como constancia histórica del intento original).
-- ---------------------------------------------------------------------

ALTER TABLE public."DietPlan"
  ADD COLUMN IF NOT EXISTS "allergens" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public."DietPlan"."allergens" IS
  'Alergenos declarados en el plan (e.g. {NUTS,DAIRY,GLUTEN}). Comparados '
  'contra PatientAllergy.substanceText (uppercase) en nutrition.router.ts '
  '(findAllergyConflicts). UAT-BUG-02. '
  'docs/45_registro_drift_schema.md §4.2 — reintento de 54_diet_plan_allergens.sql, '
  'que nunca se aplicó a prod.';

-- ---------------------------------------------------------------------
-- CASO 3 — PharmacyReservation.cancelMotivo + .updatedAt (§4.3)
--
-- cancelMotivo: usado por packages/trpc/src/routers/pharmacy-dispensation.router.ts
-- (~226-232, cancelReservation): `update({ data: { status: "CANCELLED",
-- cancelMotivo: input.motivo } })`.
--
-- updatedAt: schema.prisma:2174 lo declara `@updatedAt` → Prisma inyecta
-- `updatedAt = now()` en el SET de TODO UPDATE sobre este modelo, exista
-- o no en el `data` explícito. O sea que sin esta columna, no solo falla
-- cancelReservation — CUALQUIER update futuro a PharmacyReservation falla
-- igual.
--
-- Agravante encontrado en este censo (no estaba en docs/45): la tabla YA
-- tiene un trigger activo `trg_pharma_reservation_updated_at`
-- (public.set_pharma_reservation_updated_at(), creado por
-- 89_pharmacy_reservation_expire_cron.sql) que hace
-- `NEW."updatedAt" = now()` en cada UPDATE. Ese trigger SÍ se creó
-- (CREATE OR REPLACE FUNCTION + CREATE TRIGGER no son no-ops), pero el
-- `CREATE TABLE IF NOT EXISTS public."PharmacyReservation"` del mismo
-- archivo 89 fue un no-op silencioso porque 86_pharmacy_reservation.sql ya
-- había creado la tabla antes SIN cancelMotivo/updatedAt — así que el
-- trigger quedó apuntando a una columna inexistente. Confirmado con
-- pg_get_functiondef(): el cuerpo de la función referencia
-- NEW."updatedAt" tal cual. Sin esta columna, CUALQUIER UPDATE a
-- PharmacyReservation revienta también a nivel de trigger, no solo por el
-- SET que agrega Prisma. Esta ALTER TABLE resuelve ambas rutas de falla a
-- la vez.
-- ---------------------------------------------------------------------

ALTER TABLE public."PharmacyReservation"
  ADD COLUMN IF NOT EXISTS "cancelMotivo" TEXT;

ALTER TABLE public."PharmacyReservation"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now();

COMMENT ON COLUMN public."PharmacyReservation"."cancelMotivo" IS
  'Motivo de cancelación, capturado en cancelReservation '
  '(pharmacy-dispensation.router.ts). docs/45_registro_drift_schema.md §4.3.';

COMMENT ON COLUMN public."PharmacyReservation"."updatedAt" IS
  'Mapeada a @updatedAt en schema.prisma — Prisma la inyecta en el SET de '
  'todo UPDATE sobre este modelo. También leída por el trigger '
  'trg_pharma_reservation_updated_at (89_pharmacy_reservation_expire_cron.sql), '
  'que ya estaba activo apuntando a esta columna antes de que existiera. '
  'docs/45_registro_drift_schema.md §4.3.';

-- ---------------------------------------------------------------------
-- CASO 4 — AuditDashboardConfig.outlierAlertEnabled (§4.4)
--
-- Distinto a los tres anteriores: no es un campo Prisma sin sincronizar,
-- es un archivo SQL numerado (95_f2_s15_d_audit_rbac.sql, migración 03,
-- línea 21) cuyo CREATE TABLE declara la columna correctamente, pero cuya
-- aplicación a prod quedó incompleta. Verificado con introspección
-- (information_schema.columns): la tabla SÍ existe con las otras 6
-- columnas, el trigger trg_audit_dashboard_updated_at SÍ existe, la
-- policy "AuditDashboardConfig: org_isolation" (renombrada en prod a
-- audit_dashboard_config_select) SÍ existe — solo falta esta columna.
-- Alcance confirmado como acotado a esta única columna: las migraciones
-- 04 (User.accountStatus) y 05 (ece.documento_instancia.confidencial) del
-- mismo archivo 95 SÍ están aplicadas en prod (verificado por separado).
--
-- Usado por packages/trpc/src/routers/audit-outlier.router.ts vía
-- $queryRaw/$executeRawUnsafe con la columna hardcodeada en el SQL
-- (getConfig ~127, upsertConfig ~449/455/461).
-- ---------------------------------------------------------------------

ALTER TABLE public."AuditDashboardConfig"
  ADD COLUMN IF NOT EXISTS "outlierAlertEnabled" BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public."AuditDashboardConfig"."outlierAlertEnabled" IS
  'Habilita alertas de outlier para la org. Leída/escrita vía $queryRaw en '
  'audit-outlier.router.ts (getConfig/upsertConfig). Declarada en '
  '95_f2_s15_d_audit_rbac.sql migración 03 pero nunca aplicada a prod — '
  'única columna faltante de esa migración (04 y 05 del mismo archivo sí '
  'están aplicadas). docs/45_registro_drift_schema.md §4.4.';
