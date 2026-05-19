-- B-05 (S2-Tier4): Trigger inmutabilidad + NOT NULL basicCauseCode en DeathCertificate legacy
-- NTEC Art. 21 (causa básica obligatoria) + Art. 40 (inmutabilidad post-creación).
-- PRE-REQUISITO: SELECT COUNT(*) FROM "DeathCertificate" WHERE "basicCauseCode" IS NULL; = 0
-- Resultado confirmado en 2026-05-19: 0 filas con NULL. Aplicado a Supabase: 2026-05-19.

ALTER TABLE "DeathCertificate" ALTER COLUMN "basicCauseCode" SET NOT NULL;

-- Trigger inmutabilidad: ningún UPDATE ni DELETE permitido post-creación.
CREATE OR REPLACE FUNCTION public.fn_bloquea_death_certificate() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'mutacion_no_permitida: certificado defuncion legacy es inmutable (Art. 40 NTEC)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bloquea_death_cert ON "DeathCertificate";
CREATE TRIGGER trg_bloquea_death_cert
  BEFORE UPDATE OR DELETE ON "DeathCertificate"
  FOR EACH ROW EXECUTE FUNCTION public.fn_bloquea_death_certificate();
