-- =============================================================================
-- 190_cc0014_expediente_pais_numerico.sql
-- CC-0014 — Prefijo de país del expediente: alfa-2 → ISO 3166-1 numérico
-- Propósito: migra los expedientes EXISTENTES (public."Patient".expediente,
--   public."Patient".mrn cuando mrn = expediente, y ece.paciente.numero_expediente)
--   del formato antiguo {ALFA2}{AA}{NNNNN} (ej. SV9000003) al formato nuevo
--   {NNN}{AA}{NNNNN} con NNN = ISO 3166-1 numérico del país, zero-pad a 3
--   dígitos (ej. 2229000003 — 222 = El Salvador).
--
-- IMPORTANTE — lo que este script NO toca:
--   - public.secuencia_expediente: el bucket de la secuencia sigue keyed por
--     (country_code alfa-2, aa). El mapeo alfa2↔numeric es 1:1, así que la
--     continuidad de correlativos ya emitidos se preserva (ej. SV9000003 ya
--     emitido → el próximo nacido-90 de SV será 2229000004, NO reinicia).
--   - public.fn_next_expediente: sigue recibiendo country_code alfa-2 sin
--     cambios (ver packages/trpc/src/lib/expediente-numbering.ts).
--
-- Idempotente: el WHERE de cada UPDATE solo alcanza filas cuyo expediente /
--   numero_expediente todavía tiene el formato antiguo (2 letras + 7 dígitos).
--   Re-ejecutar este script tras una primera corrida no vuelve a tocar nada.
-- Aplicar vía: Supabase SQL Editor o MCP execute_sql / apply_migration.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Desactivar triggers de inmutabilidad (CC-0002 §6 / sql/176) para poder
--    reescribir el prefijo de expedientes ya asignados.
-- -----------------------------------------------------------------------------
ALTER TABLE public."Patient" DISABLE TRIGGER trg_block_expediente;
ALTER TABLE ece.paciente     DISABLE TRIGGER trg_block_numero_expediente;

-- -----------------------------------------------------------------------------
-- 2. public."Patient".expediente (+ mrn cuando mrn = expediente viejo)
-- -----------------------------------------------------------------------------
-- El país se resuelve vía Patient -> Organization -> Country. El reemplazo es
-- solo de los primeros 2 caracteres (prefijo alfa-2) por el numérico
-- zero-pad a 3 dígitos; el resto del expediente ({AA}{NNNNN}) no cambia.
UPDATE public."Patient" p
SET
  "expediente" = lpad(c."isoNumeric"::text, 3, '0') || substring(p."expediente" from 3),
  "mrn" = CASE
            WHEN p."mrn" = p."expediente"
              THEN lpad(c."isoNumeric"::text, 3, '0') || substring(p."expediente" from 3)
            ELSE p."mrn"
          END
FROM public."Organization" o
JOIN public."Country" c ON c.id = o."countryId"
WHERE p."organizationId" = o.id
  AND p."expediente" ~ '^[A-Z]{2}[0-9]{7}$'
  AND substring(p."expediente" from 1 for 2) = c."isoAlpha2";

-- -----------------------------------------------------------------------------
-- 3. ece.paciente.numero_expediente (espejo NTEC del expediente HIS)
-- -----------------------------------------------------------------------------
-- El país se resuelve vía ece.paciente -> public.Establishment -> Organization
-- -> Country (ece.paciente no tiene FK directa a Organization/Country).
UPDATE ece.paciente pac
SET numero_expediente = lpad(c."isoNumeric"::text, 3, '0') || substring(pac.numero_expediente from 3)
FROM public."Establishment" est
JOIN public."Organization" o ON o.id = est."organizationId"
JOIN public."Country" c ON c.id = o."countryId"
WHERE pac.establecimiento_id = est.id
  AND pac.numero_expediente ~ '^[A-Z]{2}[0-9]{7}$'
  AND substring(pac.numero_expediente from 1 for 2) = c."isoAlpha2";

-- -----------------------------------------------------------------------------
-- 4. Reactivar triggers de inmutabilidad
-- -----------------------------------------------------------------------------
ALTER TABLE public."Patient" ENABLE TRIGGER trg_block_expediente;
ALTER TABLE ece.paciente     ENABLE TRIGGER trg_block_numero_expediente;

-- -----------------------------------------------------------------------------
-- 5. Verificación (ejecutar manualmente tras aplicar; ambos conteos deben ser 0)
-- -----------------------------------------------------------------------------
-- SELECT count(*) FROM public."Patient" WHERE "expediente" ~ '^[A-Z]{2}[0-9]{7}$';
-- SELECT count(*) FROM ece.paciente     WHERE numero_expediente ~ '^[A-Z]{2}[0-9]{7}$';
--
-- Muestra de expedientes migrados (para revisión visual):
-- SELECT id, "expediente", "mrn" FROM public."Patient"
--   WHERE "expediente" ~ '^[0-9]{10}$' ORDER BY "updatedAt" DESC LIMIT 20;
