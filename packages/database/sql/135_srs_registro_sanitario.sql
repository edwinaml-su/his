-- =============================================================================
-- 135_srs_registro_sanitario.sql
-- Integración SRS El Salvador — cache local del padrón de registro sanitario
-- de medicamentos publicado en https://expedientes.srs.gob.sv/
--
-- Estrategia: drift pattern (no se agrega a schema.prisma). Toda lectura/
-- escritura via $queryRawUnsafe desde packages/trpc/src/routers/srs-registro.
--
-- Diseño:
--   1. SrsRegistroCache → snapshot por registro consultado (TTL 90 días).
--      Una fila por `registroSanitario` SRS. Datos del listado + detalle.
--   2. SrsPrincipioActivo / SrsFabricante / SrsPresentacion → tablas hijas
--      relación 1:N con SrsRegistroCache.
--   3. Columnas srs* agregadas a "Drug" cuando el usuario "importa" el
--      registro al catálogo HIS. Liga via "Drug"."srsRegistroSanitario".
--
-- Beneficios:
--   - Búsquedas repetidas no golpean SRS (cache local).
--   - Alerta de vencimiento de registro vía cron sobre Drug.srsAnualidad.
--   - Trazabilidad regulatoria: cada Drug local tiene su nro de registro SRS.
--
-- Aplicado a prod: 2026-05-25 vía MCP (srs_registro_sanitario_2026_05_25).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. Cache del padrón SRS (tabla independiente, sin tenant — catálogo país)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SrsRegistroCache" (
  "registroSanitario"           varchar(20) PRIMARY KEY,
  "idProductoSrs"               varchar(40) NOT NULL UNIQUE,
  "nombreRegistro"              varchar(300) NOT NULL,
  "titular"                     varchar(200),
  "estado"                      varchar(20) NOT NULL,
  "categoria"                   varchar(60),
  "clasificacion"               varchar(40),
  "modalidadVenta"              varchar(40),
  "vidaUtilTexto"               varchar(60),
  "vidaUtilMeses"               integer,
  "viaAdministracion"           varchar(60),
  "primeraAutorizacion"         date,
  "anualidad"                   date,
  "condicionesAlmacenamiento"   text,
  "indicacionesTerapeuticas"    text,
  "mecanismoAccion"             text,
  "regimenDosificacion"         text,
  "farmacocinetica"             text,
  "efectosAdversos"             text,
  "contraindicaciones"          text,
  "precauciones"                text,
  "principalesInteracciones"    text,
  "fichaTecnicaUrl"             text,
  "expedienteUrl"               text,
  "informeEvaluacionUrl"        text,
  "rawPayload"                  jsonb,
  "fetchedAt"                   timestamptz NOT NULL DEFAULT now(),
  "expiresAt"                   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT srs_cache_estado_chk CHECK (estado IN ('ACTIVO','CANCELADO','SUSPENDIDO','ELIMINADO'))
);

CREATE INDEX IF NOT EXISTS idx_srs_cache_titular     ON "SrsRegistroCache" ("titular");
CREATE INDEX IF NOT EXISTS idx_srs_cache_estado      ON "SrsRegistroCache" ("estado");
CREATE INDEX IF NOT EXISTS idx_srs_cache_anualidad   ON "SrsRegistroCache" ("anualidad");
CREATE INDEX IF NOT EXISTS idx_srs_cache_expires     ON "SrsRegistroCache" ("expiresAt");
CREATE INDEX IF NOT EXISTS idx_srs_cache_nombre_trgm ON "SrsRegistroCache" USING gin ("nombreRegistro" gin_trgm_ops);

-- gin_trgm_ops requiere extensión pg_trgm. Ya está habilitada en el proyecto
-- (verificable con SELECT * FROM pg_extension WHERE extname='pg_trgm').
-- Si falta: CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- RLS: catálogo público nacional — todos los usuarios autenticados leen.
ALTER TABLE "SrsRegistroCache" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srs_cache_read ON "SrsRegistroCache";
CREATE POLICY srs_cache_read ON "SrsRegistroCache"
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS srs_cache_write ON "SrsRegistroCache";
CREATE POLICY srs_cache_write ON "SrsRegistroCache"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- B. Tablas hijas del cache (multi-valor por registro)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "SrsPrincipioActivo" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registroSanitario"      varchar(20) NOT NULL REFERENCES "SrsRegistroCache"("registroSanitario") ON DELETE CASCADE,
  "nombrePrincipioActivo"  varchar(200) NOT NULL,
  "concentracion"          varchar(40),
  "unidadMedida"           varchar(20),
  UNIQUE ("registroSanitario", "nombrePrincipioActivo")
);
CREATE INDEX IF NOT EXISTS idx_srs_pa_pa ON "SrsPrincipioActivo" ("nombrePrincipioActivo");
ALTER TABLE "SrsPrincipioActivo" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srs_pa_all ON "SrsPrincipioActivo";
CREATE POLICY srs_pa_all ON "SrsPrincipioActivo"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "SrsFabricante" (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registroSanitario" varchar(20) NOT NULL REFERENCES "SrsRegistroCache"("registroSanitario") ON DELETE CASCADE,
  "idFabricanteSrs"   varchar(40),
  "nombreFabricante"  varchar(200) NOT NULL,
  "paisFabricante"    varchar(80),
  "tipo"              varchar(30) NOT NULL DEFAULT 'FABRICANTE',
  "renovacion"        date,
  CONSTRAINT srs_fabricante_tipo_chk CHECK (tipo IN ('FABRICANTE','ACONDICIONADOR'))
);
CREATE INDEX IF NOT EXISTS idx_srs_fab_reg ON "SrsFabricante" ("registroSanitario");
ALTER TABLE "SrsFabricante" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srs_fab_all ON "SrsFabricante";
CREATE POLICY srs_fab_all ON "SrsFabricante"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "SrsFormaFarmaceutica" (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registroSanitario"      varchar(20) NOT NULL REFERENCES "SrsRegistroCache"("registroSanitario") ON DELETE CASCADE,
  "nombreFormaFarmaceutica" varchar(120) NOT NULL,
  UNIQUE ("registroSanitario", "nombreFormaFarmaceutica")
);
ALTER TABLE "SrsFormaFarmaceutica" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srs_ff_all ON "SrsFormaFarmaceutica";
CREATE POLICY srs_ff_all ON "SrsFormaFarmaceutica"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS "SrsPresentacion" (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "registroSanitario"  varchar(20) NOT NULL REFERENCES "SrsRegistroCache"("registroSanitario") ON DELETE CASCADE,
  "codigoPresentacion" varchar(40),
  "nombrePresentacion" varchar(200) NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_srs_pres_reg ON "SrsPresentacion" ("registroSanitario");
ALTER TABLE "SrsPresentacion" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS srs_pres_all ON "SrsPresentacion";
CREATE POLICY srs_pres_all ON "SrsPresentacion"
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- C. Columnas SRS en "Drug" — trazabilidad regulatoria cuando se importa
-- ---------------------------------------------------------------------------
-- Todas nullable; un Drug local puede existir sin registro SRS asociado
-- (medicamentos extranjeros, magistrales, fórmulas hospitalarias).

ALTER TABLE "Drug"
  ADD COLUMN IF NOT EXISTS "srsRegistroSanitario"        varchar(20),
  ADD COLUMN IF NOT EXISTS "srsIdProducto"               varchar(40),
  ADD COLUMN IF NOT EXISTS "srsTitular"                  varchar(200),
  ADD COLUMN IF NOT EXISTS "srsPrimeraAutorizacion"      date,
  ADD COLUMN IF NOT EXISTS "srsAnualidad"                date,
  ADD COLUMN IF NOT EXISTS "srsCategoria"                varchar(60),
  ADD COLUMN IF NOT EXISTS "srsClasificacion"            varchar(40),
  ADD COLUMN IF NOT EXISTS "srsEstado"                   varchar(20),
  ADD COLUMN IF NOT EXISTS "srsCondicionesAlmacenamiento" text,
  ADD COLUMN IF NOT EXISTS "srsIndicacionesTerapeuticas"  text,
  ADD COLUMN IF NOT EXISTS "srsContraindicaciones"        text,
  ADD COLUMN IF NOT EXISTS "srsPrecauciones"              text,
  ADD COLUMN IF NOT EXISTS "srsEfectosAdversos"           text,
  ADD COLUMN IF NOT EXISTS "srsInteracciones"             text,
  ADD COLUMN IF NOT EXISTS "srsVidaUtilMeses"             integer,
  ADD COLUMN IF NOT EXISTS "srsViaAdministracion"         varchar(60),
  ADD COLUMN IF NOT EXISTS "srsFichaTecnicaUrl"           text,
  ADD COLUMN IF NOT EXISTS "srsExpedienteUrl"             text,
  ADD COLUMN IF NOT EXISTS "srsInformeEvaluacionUrl"      text,
  ADD COLUMN IF NOT EXISTS "srsUltimaSincronizacion"      timestamptz;

-- Único parcial: si srsRegistroSanitario está seteado, debe ser único por org
-- (permite el mismo registro en distintas orgs si el formulario es local).
CREATE UNIQUE INDEX IF NOT EXISTS uq_drug_srs_registro_org
  ON "Drug" ("organizationId", "srsRegistroSanitario")
  WHERE "srsRegistroSanitario" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drug_srs_anualidad
  ON "Drug" ("srsAnualidad")
  WHERE "srsAnualidad" IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_drug_srs_estado
  ON "Drug" ("srsEstado")
  WHERE "srsEstado" IS NOT NULL;
