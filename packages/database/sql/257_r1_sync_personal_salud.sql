-- =============================================================================
-- 257_r1_sync_personal_salud.sql
-- ⚠ APLICADO a prod (ejacvsgbewcerxtjtwto) el 2026-09-19 vía MCP — NO re-aplicar.
-- Verificado post-apply: 2 personal_salud (centinelas PENDIENTE-DUI-*),
-- 5 asignaciones de rol activas, 3 triggers presentes, 0 grants residuales
-- de EXECUTE — exactamente lo simulado en la DIVULGACIÓN de abajo.
-- Plan de remediación 2026-09, Ola R1, ítem R1.1 (aprobado por Edwin).
--
-- Problema (R03, ver packages/trpc/src/lib/identity-resolver.ts):
--   `ece.personal_salud` tiene 0 filas en prod. Ningún usuario HIS tiene
--   `his_user_id` poblado, así que `resolvePersonalSalud`/`requirePersonalSalud`
--   siempre devuelven null/lanzan — eso deja INERTES: la emisión de valores
--   críticos IPSG-2 desde LIS (`lis.router.ts` `result.enter`), la bandeja
--   `/ece/valores-criticos`, y obliga a `certificacion.listCola` a leer con
--   rol BYPASSRLS (excepción documentada en PR #693) porque
--   `ece.current_personal_id()` nunca resuelve para ningún DIR.
--
-- Solución (principio "la data nunca bloquea" del plan): convertir la carga
-- manual en SINCRONIZACIÓN AUTOMÁTICA. Este archivo agrega:
--
--   1. `ece.fn_sync_personal_salud(p_user_id uuid)` — SECURITY DEFINER,
--      idempotente. Upsert por `his_user_id` de nombre/establecimiento/activo
--      + upsert de `ece.asignacion_rol` para los roles clínicos vigentes del
--      usuario (mapeados desde `public."Role".code`).
--   2. Backfill: recorre los `User` activos con algún rol clínico vigente y
--      los materializa — puebla prod de una vez al aplicar (el sync ES la
--      carga, no la precede).
--   3. Triggers AFTER INSERT/UPDATE/DELETE sobre `public."User"` y
--      `public."UserOrganizationRole"` que invocan la función — mantiene
--      `ece.personal_salud`/`ece.asignacion_rol` al día sin intervención
--      manual futura. Todos envuelven la llamada en un bloque
--      EXCEPTION → RAISE WARNING: un fallo del sync NUNCA debe abortar el
--      INSERT/UPDATE/DELETE real sobre User/UserOrganizationRole.
--
-- ══════════════════════════════════════════════════════════════════════════
-- DIVULGACIÓN OBLIGATORIA — resultado real del backfill, simulado contra
-- prod (SELECT de solo lectura, sin escribir nada; ejecutado 2026-09-19 vía
-- mcp__.../execute_sql sobre ejacvsgbewcerxtjtwto) ANTES de que @Orq aplique
-- este archivo. NO SUAVIZAR:
--
--   De los 6 usuarios elegibles hoy (algún rol clínico mapeado, activos):
--   SOLO 2 MATERIALIZAN — amedina@complejoavante.com y
--   wgonzalez@codecastle.com.sv — porque son los únicos con
--   `UserServiceUnitAssignment` activa (resolución (a)).
--
--   LOS OTROS 4 QUEDAN SIN FILA (RAISE NOTICE, no error) porque el
--   fallback (b) — "único Establishment activo entre las orgs del
--   usuario" — NUNCA decide para ellos: la organización real de Avante
--   (`c7eabf29-a484-4a69-9426-9ee8b06d054a`) tiene 6 establecimientos
--   activos (HE/CM/US/CL/FCM/FSC), no 1, así que el count(DISTINCT) > 1
--   y el fallback se rinde. Los 4 omitidos:
--     - emartinez@complejoavante.com — cuenta DIR de EDWIN. Su
--       `certificacion.listCola` dará PRECONDITION_FAILED hasta que (a)
--       se le cree una `UserServiceUnitAssignment`, o (b) se resuelva la
--       decisión pendiente "SUPER_ADMIN cross-org" (memoria del proyecto)
--       con un mecanismo de establecimiento explícito para superusuarios.
--     - eaguirre@complejoavante.com (ADMIN)
--     - qa.admin@his.test / qa.triagist@his.test (fixtures E2E, ADMIN)
--
--   Consecuencia operativa: R1.1 desbloquea IPSG-2 y `listCola` SOLO para
--   los 2 usuarios con asignación de servicio real — no es una solución
--   completa para todo el universo de usuarios clínicos con roles
--   corporativos/multi-sede hasta que se cierre R1.1's fallback (b) o se
--   pueble `UserServiceUnitAssignment` para el resto (Track D del plan).
-- ══════════════════════════════════════════════════════════════════════════
--
-- ── Decisión de mapeo de roles (evidencia: introspección prod 2026-09-19 vía
--    mcp__.../execute_sql, read-only, proyecto ejacvsgbewcerxtjtwto) ─────────
-- `public."UserOrganizationRole"` NO tiene columna de establecimiento — solo
-- `organizationId`. Los códigos de rol clínico vigentes en prod son (conteo
-- de usuarios activos): DIR(2), PHYSICIAN(2), NURSE(2), ENF_NRP(1), GO(1),
-- PEDIA(1), ANEST(1), ADMIN(6), ADMISSION_CLERK(1) + no-clínicos (PHARMACIST,
-- WORKFLOW_DESIGNER, SUPER_ADMIN — excluidos, sin equivalente en la Tabla 1
-- NTEC Acuerdo 1616: ADM/AC/ARCH/ENF/MT/MC/ESP/IC/DIR). El mapeo reusa la
-- evidencia ya presente en el repo:
--   - `packages/trpc/src/middleware/ece-permission.ts` (PHYSICIAN_CODES
--     incluye 'MC'/'MT', NURSE_CODES incluye 'ENF') y
--   - `public."RoleCodeAlias"` en prod (MC/MEDICO → PHYSICIAN canónico,
--     ENF/TERAPISTA/RESP → NURSE canónico) — dirección inversa a la nuestra,
--     pero confirma la equivalencia PHYSICIAN↔MC, NURSE↔ENF.
-- Mapeo aplicado (`public."Role".code` → `ece.rol.codigo`):
--   DIR → DIR · PHYSICIAN → MC · NURSE/ENF_NRP/TRIAGE_NURSE → ENF ·
--   GO/PEDIA/ANEST → ESP (especialistas) · ADMIN/ADMISSION_CLERK → ADM.
--
-- P2-3 (revisión independiente, evidencia: `public."Role"` en prod tiene 21
-- filas de cada uno de estos códigos — sembrados por org, CC-0036/CC-0017) —
-- roles corporativos/de afiliación que la primera pasada no cubrió:
--   MEDICO_AFILIADO → MC (médico externo B2B2C que documenta/firma HC del
--     paciente que trae — mismo rol funcional NTEC que un PHYSICIAN interno).
--   JEFE_MEDICO_SEDE → MC (médico de sede con función administrativa
--     adicional, pero sigue firmando documentos clínicos como médico).
--   ADMIN_CLINICO → ADM (administrativo con alcance clínico — mismo rol NTEC
--     que ADMIN/ADMISSION_CLERK).
-- SIN mapeo, con nota explícita (no son actores clínicos NTEC — roles de
-- VISIBILIDAD/GOBIERNO corporativo, no documentan ni firman en el ECE):
--   DIR_PAIS (dirección país, supervisión multi-sede — no es el DIR de
--     establecimiento que certifica Art. 21 NTEC), CONTRALOR_CORP
--     (contraloría financiera corporativa), SUPER_ADMIN (cross-org, decisión
--     pendiente de Edwin — ver memoria "SUPER_ADMIN cross-org").
-- Sin mapeo (no clínico NTEC, se ignoran para elegibilidad):
--   PHARMACIST, WORKFLOW_DESIGNER, SUPER_ADMIN, LAB_TECHNICIAN,
--   RAD_TECHNICIAN, DIR_PAIS, CONTRALOR_CORP y cualquier otro código no
--   listado arriba.
--
-- ── Decisión de establecimiento ("contexto de membresía") ───────────────────
-- No existe un vínculo User→Establishment directo. Se resuelve, en orden:
--   (a) `public."UserServiceUnitAssignment"` activa → `ServiceUnit.establishmentId`
--       (si el usuario tiene asignaciones en MÁS de un establecimiento se
--       toma el de menor UUID — orden determinístico; `personal_salud.his_user_id`
--       es UNIQUE global, no admite una fila por establecimiento — limitación
--       preexistente del modelo, no introducida por este sync, ver
--       identity-resolver.ts).
--   (b) Si no hay asignación: el único `Establishment` activo entre TODAS las
--       organizaciones donde el usuario tiene un rol vigente (si hay más de
--       uno, no se puede decidir sin ambigüedad → se omite la materialización
--       para ese usuario, con RAISE NOTICE explicando por qué).
-- El establecimiento resuelto (espacio `public."Establishment".id`) se
-- traduce al espacio `ece.establecimiento.id` vía la columna puente
-- `establishment_id` (ADR 0022, sql/216/217) — si no existe fila puente, se
-- omite la materialización (RAISE NOTICE), nunca se inventa un establecimiento.
--
-- ── Decisión de `documento_identidad` (NOT NULL, Art. 23 NTEC) ─────────────
-- `public."User"` NO tiene ningún campo de documento de identidad (DUI/NIE) —
-- confirmado por introspección de columnas. `personal-salud.router.ts` ya
-- documenta que este dato "no se puede inventar" (normativa) y por eso el
-- alta manual lo exige por formulario. Este sync NO inventa un DUI real: usa
-- un centinela inequívoco `'PENDIENTE-DUI-' || <8 chars del user id>` — mismo
-- patrón que el resto del plan (`cargo PENDIENTE_TARIFA` en vez de $0) — y lo
-- excluye del `ON CONFLICT DO UPDATE` para que, si un ADMIN lo corrige más
-- tarde directamente en BD (la UI de /profesionales-salud hoy NO expone
-- editar `documentoIdentidad` — gap reportado aparte), el sync no lo vuelva a
-- pisar. `jvpm_codigo`/`profesion` quedan NULL (tampoco derivables de `User`).
--
-- ── Qué NO hace este sync (simplificaciones deliberadas, KISS) ─────────────
-- - No desactiva `ece.asignacion_rol` de códigos que el usuario ya no tiene
--   (solo agrega/reactiva) — reconciliación completa queda para un CC aparte
--   si se necesita.
-- - No dispara ante cambios en `UserServiceUnitAssignment` (el establecimiento
--   solo se recalcula cuando cambia `User`/`UserOrganizationRole`) — gap
--   documentado, no silencioso.
-- - Si el usuario pierde TODOS sus roles clínicos mapeables, la fila existente
--   se desactiva (`activo = false`, `fecha_baja = now()`) — Art. 23 lit. f
--   NTEC ("depurar accesos al notificarse el cese"). No se borra.
--
-- Precedentes de estilo respetados: `SET search_path` fijo en toda función
-- nueva (lección search_path mutable), `documento_identidad`/`jvpm_codigo`
-- son los nombres REALES de columna (confirmados por introspección — no usar
-- `jvpm_o_jvp`, que es un bug preexistente de `personal-salud.router.ts`
-- reportado aparte, no corregido aquí por no tocar ese archivo).
--
-- Idempotente: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS + el
-- upsert usa ON CONFLICT. Reaplicar no duplica filas ni reordena nada.
-- =============================================================================

-- -----------------------------------------------------------------------
-- 1. Función de sync — un usuario por llamada.
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_sync_personal_salud(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $function$
DECLARE
  v_full_name           text;
  v_active              boolean;
  v_estab_space_a       uuid;
  v_estab_count         int;
  v_establecimiento_id  uuid; -- espacio ece.establecimiento (espacio B)
  v_institucion_id      uuid;
  v_rol_codes           text[];
  v_personal_id         uuid;
  v_existing_personal_id uuid;
BEGIN
  SELECT u."fullName", u.active INTO v_full_name, v_active
  FROM public."User" u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RETURN; -- usuario no existe (no debería pasar desde un trigger, defensivo)
  END IF;

  -- Roles clínicos vigentes mapeados a ece.rol.codigo (ver mapeo documentado
  -- en la cabecera). DISTINCT porque un usuario puede tener el mismo código
  -- ECE resultante desde dos roles RBAC distintos (p.ej. NURSE + ENF_NRP → ENF).
  SELECT array_agg(DISTINCT mapped.codigo)
  INTO v_rol_codes
  FROM (
    SELECT CASE r.code
             WHEN 'DIR'              THEN 'DIR'
             WHEN 'PHYSICIAN'        THEN 'MC'
             WHEN 'MEDICO_AFILIADO'  THEN 'MC'
             WHEN 'JEFE_MEDICO_SEDE' THEN 'MC'
             WHEN 'NURSE'            THEN 'ENF'
             WHEN 'ENF_NRP'          THEN 'ENF'
             WHEN 'TRIAGE_NURSE'     THEN 'ENF'
             WHEN 'GO'               THEN 'ESP'
             WHEN 'PEDIA'            THEN 'ESP'
             WHEN 'ANEST'            THEN 'ESP'
             WHEN 'ADMIN'            THEN 'ADM'
             WHEN 'ADMISSION_CLERK'  THEN 'ADM'
             WHEN 'ADMIN_CLINICO'    THEN 'ADM'
             ELSE NULL
           END AS codigo
    FROM public."UserOrganizationRole" uor
    JOIN public."Role" r ON r.id = uor."roleId"
    WHERE uor."userId" = p_user_id
      AND (uor."validTo" IS NULL OR uor."validTo" >= now())
  ) mapped
  WHERE mapped.codigo IS NOT NULL;

  -- Sin User activo o sin ningún rol clínico mapeable: si ya existía una fila
  -- (el usuario tuvo rol clínico antes), depurar acceso (Art. 23 lit. f).
  -- Si nunca existió, no hay nada que hacer.
  IF NOT v_active OR v_rol_codes IS NULL OR array_length(v_rol_codes, 1) IS NULL THEN
    UPDATE ece.personal_salud
    SET activo = false,
        fecha_baja = COALESCE(fecha_baja, now()),
        actualizado_en = now()
    WHERE his_user_id = p_user_id
      AND activo = true;
    RETURN;
  END IF;

  -- Resolver establecimiento (espacio A = public."Establishment".id):
  -- (a) UserServiceUnitAssignment activa, menor uuid si hay varias.
  SELECT su."establishmentId"
  INTO v_estab_space_a
  FROM public."UserServiceUnitAssignment" usa
  JOIN public."ServiceUnit" su ON su.id = usa."serviceUnitId"
  WHERE usa."userId" = p_user_id
    AND (usa."validTo" IS NULL OR usa."validTo" >= now())
  ORDER BY su."establishmentId"
  LIMIT 1;

  -- (b) Fallback: único Establishment activo entre todas las orgs del usuario.
  -- `min(uuid)` no existe en Postgres — cast a text y de vuelta a uuid
  -- (encontrado al simular este bloque contra prod antes de aplicar: sin
  -- este cast la función abortaría con 42883 la primera vez que un usuario
  -- elegible cayera en este fallback).
  IF v_estab_space_a IS NULL THEN
    SELECT count(DISTINCT e.id), min(e.id::text)::uuid
    INTO v_estab_count, v_estab_space_a
    FROM public."Establishment" e
    WHERE e.active
      AND e."organizationId" IN (
        SELECT uor."organizationId"
        FROM public."UserOrganizationRole" uor
        WHERE uor."userId" = p_user_id
          AND (uor."validTo" IS NULL OR uor."validTo" >= now())
      );
    IF v_estab_count <> 1 THEN
      v_estab_space_a := NULL;
    END IF;
  END IF;

  IF v_estab_space_a IS NULL THEN
    RAISE NOTICE 'fn_sync_personal_salud: usuario % tiene rol(es) clínico(s) % pero no se pudo resolver un establecimiento sin ambigüedad (sin UserServiceUnitAssignment y >1 Establishment activo en sus organizaciones) — se omite la materialización.',
      p_user_id, v_rol_codes;
    RETURN;
  END IF;

  -- Traducir espacio A → espacio B (ADR 0022, puente establishment_id).
  SELECT ee.id, ee.institucion_id
  INTO v_establecimiento_id, v_institucion_id
  FROM ece.establecimiento ee
  WHERE ee.establishment_id = v_estab_space_a
  LIMIT 1;

  IF v_establecimiento_id IS NULL THEN
    RAISE NOTICE 'fn_sync_personal_salud: usuario % — Establishment % no tiene fila puente en ece.establecimiento (establishment_id) — se omite la materialización.',
      p_user_id, v_estab_space_a;
    RETURN;
  END IF;

  -- Upsert ece.personal_salud por his_user_id. documento_identidad SOLO se
  -- setea en el INSERT (centinela, ver cabecera) — nunca se pisa en UPDATE.
  SELECT id INTO v_existing_personal_id
  FROM ece.personal_salud
  WHERE his_user_id = p_user_id;

  INSERT INTO ece.personal_salud
    (his_user_id, institucion_id, establecimiento_id, documento_identidad,
     nombre_completo, activo, fecha_baja, creado_en, actualizado_en)
  VALUES
    (p_user_id, v_institucion_id, v_establecimiento_id,
     'PENDIENTE-DUI-' || upper(left(replace(p_user_id::text, '-', ''), 8)),
     v_full_name, true, NULL, now(), now())
  ON CONFLICT (his_user_id) DO UPDATE SET
    nombre_completo    = EXCLUDED.nombre_completo,
    institucion_id     = EXCLUDED.institucion_id,
    establecimiento_id = EXCLUDED.establecimiento_id,
    activo             = true,
    fecha_baja         = NULL,
    actualizado_en     = now()
  RETURNING id INTO v_personal_id;

  IF v_existing_personal_id IS NULL THEN
    RAISE NOTICE 'fn_sync_personal_salud: materializada fila nueva % para usuario % con documento_identidad centinela — requiere corrección manual del DUI real (Art. 23 NTEC).',
      v_personal_id, p_user_id;
  END IF;

  -- Upsert de ece.asignacion_rol para cada código mapeado — solo agrega o
  -- reactiva, no desactiva códigos perdidos (ver "qué NO hace" en cabecera).
  INSERT INTO ece.asignacion_rol
    (personal_id, rol_id, establecimiento_id, vigente_desde, vigente_hasta, activo, asignado_en)
  SELECT v_personal_id, rl.id, v_establecimiento_id, now(), NULL, true, now()
  FROM ece.rol rl
  WHERE rl.codigo = ANY(v_rol_codes)
  ON CONFLICT ON CONSTRAINT uq_asignacion_activa DO UPDATE SET
    activo        = true,
    vigente_hasta = NULL;
END;
$function$;

COMMENT ON FUNCTION ece.fn_sync_personal_salud(uuid) IS
  'R1.1 (plan remediación 2026-09) — materializa/actualiza ece.personal_salud '
  '+ ece.asignacion_rol desde public."User"/"UserOrganizationRole" para usuarios '
  'con rol clínico NTEC. documento_identidad se puebla con centinela '
  '(PENDIENTE-DUI-*) — requiere corrección manual del DUI real, nunca inventado.';

-- P1-2 (revisión independiente) — SECDEF de ESCRITURA con owner BYPASSRLS y
-- `ece` con USAGE para `authenticated`: sin este REVOKE, cualquier sesión
-- `authenticated` podría llamar `SELECT ece.fn_sync_personal_salud(<uuid>)`
-- directamente con un uuid arbitrario y reactivar filas/asignaciones que un
-- ADMIN desactivó a mano (bypassa el `activo=false` manual). El único uso
-- legítimo es interno, vía los triggers de abajo — un trigger NO requiere
-- EXECUTE del rol que dispara el INSERT/UPDATE (se invoca por el mecanismo
-- de trigger, no por llamada directa), así que revocar de `authenticated`
-- no rompe nada. Patrón: sql/196_owasp2025_a02_secdef_hardening.sql.
REVOKE ALL ON FUNCTION ece.fn_sync_personal_salud(uuid) FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------
-- 2. Triggers — AFTER INSERT/UPDATE/DELETE en User y UserOrganizationRole.
--    (`fn_trg_*` son RETURNS trigger — no necesitan REVOKE: los triggers no
--    requieren EXECUTE del rol que dispara el INSERT/UPDATE/DELETE.)
--    Envueltos en EXCEPTION → RAISE WARNING: un fallo del sync NUNCA bloquea
--    la escritura real (principio "la data nunca bloquea").
-- -----------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ece.fn_trg_sync_personal_salud_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $function$
BEGIN
  BEGIN
    PERFORM ece.fn_sync_personal_salud(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_sync_personal_salud (trigger User) falló para usuario %: % (%)',
      NEW.id, SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION ece.fn_trg_sync_personal_salud_user() IS
  'R1.1 — dispara ece.fn_sync_personal_salud tras alta/cambio de public."User". '
  'Nunca aborta la transacción original del caller (EXCEPTION interna).';

-- `UPDATE OF "fullName", "active"` (no un AFTER UPDATE genérico): `public."User"`
-- se actualiza en cada login (`lastLoginAt`, `failedAttempts`) — sin esta
-- restricción el sync correría en el hot path de login para TODO usuario,
-- clínico o no. Solo nos interesan los dos campos que el sync realmente lee.
DROP TRIGGER IF EXISTS trg_sync_personal_salud_on_user ON public."User";
CREATE TRIGGER trg_sync_personal_salud_on_user
  AFTER INSERT OR UPDATE OF "fullName", "active" ON public."User"
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_trg_sync_personal_salud_user();

CREATE OR REPLACE FUNCTION ece.fn_trg_sync_personal_salud_uor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $function$
BEGIN
  BEGIN
    PERFORM ece.fn_sync_personal_salud(NEW."userId");
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_sync_personal_salud (trigger UserOrganizationRole) falló para usuario %: % (%)',
      NEW."userId", SQLERRM, SQLSTATE;
  END;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION ece.fn_trg_sync_personal_salud_uor() IS
  'R1.1 — dispara ece.fn_sync_personal_salud tras alta/cambio de rol '
  '(public."UserOrganizationRole"). Nunca aborta la transacción original.';

DROP TRIGGER IF EXISTS trg_sync_personal_salud_on_uor ON public."UserOrganizationRole";
CREATE TRIGGER trg_sync_personal_salud_on_uor
  AFTER INSERT OR UPDATE OF "roleId", "validTo" ON public."UserOrganizationRole"
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_trg_sync_personal_salud_uor();

-- P2-1 (revisión independiente) — un DELETE directo sobre
-- UserOrganizationRole (fuera del camino normal de la app, que usa
-- `validTo` para revocar) NO disparaba el UPDATE anterior. `OLD` (no `NEW`)
-- porque en AFTER DELETE la fila ya no existe — se re-evalúa el usuario con
-- sus roles restantes; si ya no le queda ninguno clínico,
-- fn_sync_personal_salud lo desactiva (Art. 23 lit. f).
CREATE OR REPLACE FUNCTION ece.fn_trg_sync_personal_salud_uor_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ece, public, pg_catalog
AS $function$
BEGIN
  BEGIN
    PERFORM ece.fn_sync_personal_salud(OLD."userId");
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_sync_personal_salud (trigger UserOrganizationRole DELETE) falló para usuario %: % (%)',
      OLD."userId", SQLERRM, SQLSTATE;
  END;
  RETURN OLD;
END;
$function$;

COMMENT ON FUNCTION ece.fn_trg_sync_personal_salud_uor_delete() IS
  'R1.1/P2-1 — dispara ece.fn_sync_personal_salud tras un DELETE directo de '
  'public."UserOrganizationRole" (el camino normal de revocación usa validTo, '
  'que ya cubre trg_sync_personal_salud_on_uor). Nunca aborta la transacción original.';

DROP TRIGGER IF EXISTS trg_sync_personal_salud_on_uor_delete ON public."UserOrganizationRole";
CREATE TRIGGER trg_sync_personal_salud_on_uor_delete
  AFTER DELETE ON public."UserOrganizationRole"
  FOR EACH ROW
  EXECUTE FUNCTION ece.fn_trg_sync_personal_salud_uor_delete();

-- -----------------------------------------------------------------------
-- 3. Backfill idempotente — puebla prod al aplicar (el sync ES la carga).
--    Códigos clínicos elegibles: ver mapeo en la cabecera. Envuelto en
--    EXCEPTION por usuario para que un fallo aislado no aborte el backfill
--    completo.
-- -----------------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT u.id
    FROM public."User" u
    JOIN public."UserOrganizationRole" uor ON uor."userId" = u.id
    JOIN public."Role" ro ON ro.id = uor."roleId"
    WHERE u.active
      AND (uor."validTo" IS NULL OR uor."validTo" >= now())
      AND ro.code IN (
        'DIR', 'PHYSICIAN', 'MEDICO_AFILIADO', 'JEFE_MEDICO_SEDE',
        'NURSE', 'ENF_NRP', 'TRIAGE_NURSE',
        'GO', 'PEDIA', 'ANEST', 'ADMIN', 'ADMISSION_CLERK', 'ADMIN_CLINICO'
      )
  LOOP
    BEGIN
      PERFORM ece.fn_sync_personal_salud(r.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Backfill fn_sync_personal_salud falló para usuario %: % (%)',
        r.id, SQLERRM, SQLSTATE;
    END;
  END LOOP;
END $$;

-- =============================================================================
-- Verificación manual post-apply (comentado — @Orq corre esto tras aplicar)
-- =============================================================================
-- -- Filas materializadas y con qué DUI (esperar centinelas PENDIENTE-DUI-*
-- -- para todo alta nueva; ninguna fila debía existir antes de este SQL):
-- SELECT id, his_user_id, nombre_completo, documento_identidad, establecimiento_id, activo
-- FROM ece.personal_salud
-- ORDER BY creado_en DESC;
--
-- -- Esperado (evidencia 2026-09-19, ver DIVULGACIÓN OBLIGATORIA en la
-- -- cabecera): EXACTAMENTE 2 filas nuevas — amedina@complejoavante.com y
-- -- wgonzalez@codecastle.com.sv (ambos con UserServiceUnitAssignment →
-- -- establecimiento HE), con documento_identidad centinela y activo=true.
-- -- Los otros 4 elegibles (emartinez@complejoavante.com — cuenta DIR de
-- -- Edwin —, eaguirre@complejoavante.com, qa.admin@his.test,
-- -- qa.triagist@his.test) NO deben tener fila — sin UserServiceUnitAssignment
-- -- y con >1 establecimiento activo en sus orgs, el fallback (b) no decide.
-- -- Si `count(*) != 2` después de aplicar, algo cambió en los datos desde la
-- -- simulación y hay que re-diagnosticar antes de asumir que el sync está bien.
--
-- -- Asignaciones de rol creadas:
-- SELECT ps.nombre_completo, rl.codigo, ar.activo
-- FROM ece.asignacion_rol ar
-- JOIN ece.personal_salud ps ON ps.id = ar.personal_id
-- JOIN ece.rol rl ON rl.id = ar.rol_id
-- ORDER BY ps.nombre_completo, rl.codigo;
--
-- -- Conteo esperado por rol mapeado (ajustar tras revisar backfill real):
-- SELECT rl.codigo, count(*) FROM ece.asignacion_rol ar
-- JOIN ece.rol rl ON rl.id = ar.rol_id
-- WHERE ar.activo GROUP BY rl.codigo ORDER BY rl.codigo;
--
-- -- Triggers presentes (3: user, uor insert/update, uor delete):
-- SELECT tgname, tgrelid::regclass FROM pg_trigger
-- WHERE tgname IN (
--   'trg_sync_personal_salud_on_user',
--   'trg_sync_personal_salud_on_uor',
--   'trg_sync_personal_salud_on_uor_delete'
-- );
--
-- -- EXECUTE de fn_sync_personal_salud revocado de PUBLIC/anon/authenticated
-- -- (P1-2) — debe devolver 0 filas:
-- SELECT grantee, privilege_type FROM information_schema.routine_privileges
-- WHERE routine_schema = 'ece' AND routine_name = 'fn_sync_personal_salud'
--   AND grantee IN ('PUBLIC', 'anon', 'authenticated');
-- =============================================================================
