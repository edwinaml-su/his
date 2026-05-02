-- =============================================================================
-- HIS Multi-país | US-2.8 — Audit Log Hash Chain (append-only + tamper-evident)
-- TDR §6.3: la tabla audit."AuditLog" ya es append-only (triggers en 02_audit_triggers.sql).
-- Aquí encadenamos cada fila con el hash de la anterior (SHA-256 de pgcrypto)
-- para detectar borrados/modificaciones forzadas a nivel BD (acceso superuser).
--
-- Diseño:
--   - BEFORE INSERT: lee la última fila (id desc) para tomar su signatureHash
--     como prevHash de la nueva. Calcula NEW.signatureHash con pgcrypto.digest().
--   - LOCK TABLE ... IN EXCLUSIVE MODE: serializa los inserts para evitar race
--     condition (dos transacciones leyendo el mismo "último" y escribiendo
--     ambas con el mismo prevHash → cadena bifurcada). EXCLUSIVE permite SELECT
--     concurrente (lectores no se bloquean), sólo bloquea escritores entre sí.
--     Justificación append-only: no hay updates legítimos que esperar.
--
--   - Primer registro: si no hay filas previas, prevHash queda NULL. La función
--     fn_compute_chain_hash usa coalesce(prevHash,'') para que el cálculo sea
--     determinístico también en ese caso.
--
--   - fn_verify_chain(from_id): recorre la tabla en orden de id ascendente y
--     re-calcula el hash de cada fila con su prevHash registrado; cualquier
--     desviación indica tamper. Devuelve solo las filas rotas, no toda la tabla.
-- =============================================================================

-- 1) Función de cálculo del hash de una fila ----------------------------------
-- search_path explícito: pgcrypto vive en `extensions` en Supabase y en
-- `public` en self-hosted Postgres. Listamos ambos para que `digest()` y
-- `encode()` resuelvan en cualquier ambiente del MVP.
CREATE OR REPLACE FUNCTION audit.fn_compute_chain_hash(rec audit."AuditLog")
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public, extensions, audit
AS $$
  -- SHA-256 hex de la concatenación canónica de los campos invariables.
  -- Orden estable (definido en el contrato US-2.8): prevHash | id | action |
  -- entity | entityId | beforeJson | afterJson | userId | occurredAt.
  -- coalesce + '' para que NULLs no rompan la concatenación.
  SELECT encode(
    digest(
      coalesce(rec."prevHash", '')         ||
      rec.id::text                          ||
      rec.action::text                      ||
      rec.entity                            ||
      coalesce(rec."entityId", '')         ||
      coalesce(rec."beforeJson"::text, '') ||
      coalesce(rec."afterJson"::text, '')  ||
      coalesce(rec."userId"::text, '')     ||
      rec."occurredAt"::text,
      'sha256'
    ),
    'hex'
  );
$$;

-- 2) Trigger BEFORE INSERT que setea prevHash + signatureHash -----------------
CREATE OR REPLACE FUNCTION audit.fn_audit_log_chain()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, extensions, audit
AS $$
DECLARE
  v_prev_hash text;
BEGIN
  -- Serializa los INSERTs para evitar prevHash duplicado bajo concurrencia.
  -- EXCLUSIVE permite SELECT concurrente (lectura no se bloquea); solo dos
  -- escritores se ordenan secuencialmente. Append-only ⇒ no hay UPDATE/DELETE
  -- legítimos que pudieran ser perjudicados por el lock.
  LOCK TABLE audit."AuditLog" IN EXCLUSIVE MODE;

  -- Recupera el signatureHash de la última fila insertada (cadena previa).
  -- Si la tabla está vacía → primer registro: prevHash queda NULL.
  SELECT a."signatureHash"
    INTO v_prev_hash
    FROM audit."AuditLog" a
   ORDER BY a.id DESC
   LIMIT 1;

  NEW."prevHash" := v_prev_hash;
  NEW."signatureHash" := audit.fn_compute_chain_hash(NEW);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auditlog_chain ON audit."AuditLog";
CREATE TRIGGER trg_auditlog_chain
  BEFORE INSERT ON audit."AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit.fn_audit_log_chain();

-- 3) Función de verificación de la cadena -------------------------------------
-- Devuelve sólo las filas cuyo signatureHash registrado NO coincide con el
-- recalculado a partir de su contenido + prevHash. Si la tabla está sana,
-- devuelve 0 filas.
CREATE OR REPLACE FUNCTION audit.fn_verify_chain(from_id bigint DEFAULT 0)
RETURNS TABLE(broken_id bigint, expected_hash text, actual_hash text)
LANGUAGE sql STABLE AS $$
  SELECT a.id                                AS broken_id,
         audit.fn_compute_chain_hash(a)      AS expected_hash,
         a."signatureHash"                   AS actual_hash
    FROM audit."AuditLog" a
   WHERE a.id >= from_id
     AND ( a."signatureHash" IS DISTINCT FROM audit.fn_compute_chain_hash(a) )
   ORDER BY a.id ASC;
$$;

-- 4) Estadística ligera (count + last id + last hash) -------------------------
-- Útil para la UI de integridad sin escanear toda la tabla.
CREATE OR REPLACE FUNCTION audit.fn_chain_stats()
RETURNS TABLE(total_rows bigint, last_id bigint, last_hash text)
LANGUAGE sql STABLE AS $$
  SELECT (SELECT count(*) FROM audit."AuditLog")                  AS total_rows,
         (SELECT max(id)  FROM audit."AuditLog")                  AS last_id,
         (SELECT a."signatureHash"
            FROM audit."AuditLog" a
           ORDER BY a.id DESC LIMIT 1)                            AS last_hash;
$$;

COMMENT ON FUNCTION audit.fn_compute_chain_hash(audit."AuditLog") IS
  'US-2.8: SHA-256 canónico de la fila (incluye prevHash). Determinístico.';
COMMENT ON FUNCTION audit.fn_audit_log_chain() IS
  'US-2.8: trigger BEFORE INSERT que encadena prevHash + signatureHash. EXCLUSIVE LOCK serializa escritores.';
COMMENT ON FUNCTION audit.fn_verify_chain(bigint) IS
  'US-2.8: devuelve filas con hash inválido a partir de from_id (0 = todas).';
