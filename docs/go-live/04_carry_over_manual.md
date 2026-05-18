# 04 — Carry-Over Manual — Items a aplicar antes del Go-Live

**Proyecto:** HIS Multipaís — Inversiones Avante  
**Autor:** @SRE — Site Reliability Engineer  
**Versión:** 1.0 — 2026-05-18  
**Estado:** pendiente de ejecución manual en Supabase SQL Editor

> Estos items no pudieron aplicarse vía auto-mode (auto-mode bloqueó la ejecución por restricciones de seguridad o por requerir coordinación manual). Deben aplicarse **antes del Día 0 de go-live**, idealmente en T-3 días, y verificarse antes del T-0.

---

## Item 1 — REVOKE EXECUTE en funciones de expiración de farmacia

**Prioridad:** ALTA — seguridad  
**Plazo:** T-3 días  
**Responsable:** SRE Lead con @DBA  

### Contexto

Las funciones `public.expire_pharmacy_reservations()` y `public.fn_expire_pharmacy_reservations()` ejecutan la lógica de expiración de reservas de farmacia (pg_cron job cada 5 minutos). Actualmente los roles `anon` y `authenticated` tienen permiso EXECUTE sobre estas funciones, lo que no es necesario — solo debe ejecutarlas el job de pg_cron con el rol `postgres` (service role).

Auto-mode bloqueó la aplicación de este REVOKE porque modifica permisos en funciones de producción, requiriendo confirmación explícita.

### SQL a aplicar

```sql
-- Revocar EXECUTE a anon y authenticated en ambas funciones
REVOKE EXECUTE ON FUNCTION public.expire_pharmacy_reservations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.expire_pharmacy_reservations() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_expire_pharmacy_reservations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_expire_pharmacy_reservations() FROM authenticated;

-- Verificar que el job pg_cron sigue funcionando (usa postgres/service_role):
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname = 'expire_pharmacy_reservations';
```

### Verificación post-aplicación

```sql
-- Verificar que los revokes están aplicados:
SELECT grantee, routine_name, privilege_type
FROM information_schema.routine_privileges
WHERE routine_name IN ('expire_pharmacy_reservations', 'fn_expire_pharmacy_reservations')
  AND grantee IN ('anon', 'authenticated');
-- Resultado esperado: 0 filas
```

### Cómo aplicar

1. Abrir Supabase SQL Editor: `https://supabase.com/dashboard/project/ejacvsgbewcerxtjtwto/sql`
2. Pegar el bloque SQL de arriba.
3. Ejecutar.
4. Correr la consulta de verificación para confirmar 0 filas.
5. Anotar fecha y actor en la tabla de seguimiento al final de este documento.

---

## Item 2 — Tighten policy en `ece.transferencia_inventario`

**Prioridad:** ALTA — seguridad multi-tenant  
**Plazo:** T-3 días  
**Responsable:** @DBA con revisión @AT  

### Contexto

La tabla `ece.transferencia_inventario` tiene políticas RLS con:
- `USING(true)` — permite que cualquier usuario autenticado vea todas las transferencias.
- `WITH CHECK(true)` — permite que cualquier usuario autenticado inserte/modifique transferencias.

Esto es un vector de cross-tenant data leak: un usuario del hospital A podría ver o modificar transferencias del hospital B.

La política debe estar scoped por GLN (Global Location Number) de la organización — un usuario solo puede ver/escribir transferencias cuyo GLN origen o destino pertenece a su organización.

### Diseño de la nueva política

**Prerrequisito:** la función `auth.jwt()` contiene el claim `org_id` (puesto por `withTenantContext` via `app.current_org_id`). Necesitamos cruzarlo con el GLN de la organización.

**Opción A — Scoped por organization_id (recomendada si la tabla tiene org FK):**

```sql
-- Primero verificar si la tabla tiene columna de organización:
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'ece' AND table_name = 'transferencia_inventario';
```

Si tiene `organization_id`:

```sql
-- Eliminar políticas permisivas actuales:
DROP POLICY IF EXISTS "transferencia_inventario_select" ON ece.transferencia_inventario;
DROP POLICY IF EXISTS "transferencia_inventario_insert" ON ece.transferencia_inventario;
DROP POLICY IF EXISTS "transferencia_inventario_update" ON ece.transferencia_inventario;

-- Crear políticas scoped por organización:
CREATE POLICY "transferencia_inventario_select_org"
  ON ece.transferencia_inventario
  FOR SELECT TO authenticated
  USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

CREATE POLICY "transferencia_inventario_insert_org"
  ON ece.transferencia_inventario
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );

CREATE POLICY "transferencia_inventario_update_org"
  ON ece.transferencia_inventario
  FOR UPDATE TO authenticated
  USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
  )
  WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
  );
```

**Opción B — Scoped por GLN (si la tabla usa GLN como identificador de tenant):**

```sql
-- Scoped por GLN de origen o destino perteneciente a la organización del usuario:
CREATE POLICY "transferencia_inventario_select_gln"
  ON ece.transferencia_inventario
  FOR SELECT TO authenticated
  USING (
    gln_origen IN (
      SELECT gln FROM public."GlnLocation"
      WHERE organization_id = current_setting('app.current_org_id', true)::uuid
    )
    OR
    gln_destino IN (
      SELECT gln FROM public."GlnLocation"
      WHERE organization_id = current_setting('app.current_org_id', true)::uuid
    )
  );
```

### Acción requerida antes de aplicar

1. @DBA verificar la estructura de `ece.transferencia_inventario` (columnas, FKs).
2. Seleccionar Opción A o B según la estructura real.
3. Validar en staging (con 2 organizaciones de prueba) que:
   - Org A NO puede ver transferencias de Org B.
   - Org A SÍ puede ver sus propias transferencias.
4. Aplicar en producción.

### Verificación post-aplicación

```sql
-- Verificar que ya no hay políticas USING(true):
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'ece' AND tablename = 'transferencia_inventario';
-- Resultado: ninguna política debe tener 'true' en qual o with_check
```

---

## Item 3 — Bulk add `SET search_path` a 38 funciones con warning

**Prioridad:** MEDIA — hardening de seguridad  
**Plazo:** T-2 días (no bloquea go-live, pero está en advisors WARN)  
**Responsable:** @DBA  

### Contexto

El Supabase Advisor detecta 38 funciones con el warning `function_search_path_mutable`. Esto significa que las funciones no tienen un `search_path` fijo, lo que en teoría permite ataques de path hijacking (un usuario malicioso crea objetos con el mismo nombre en un schema de menor prioridad para que la función llame al objeto malicioso en vez del legítimo).

### Solución estándar

Para cada función con el warning, agregar al final de la definición:
```sql
SET search_path = pg_catalog, public, ece, audit;
```

### Script de bulk-fix

```sql
-- 1. Listar las funciones afectadas:
SELECT n.nspname AS schema, p.proname AS function_name,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname IN ('public', 'ece', 'audit')
  AND NOT p.prosecdef  -- no es SECURITY DEFINER (esas ya suelen ser seguras)
  AND p.proconfig IS NULL  -- no tienen search_path configurado
ORDER BY n.nspname, p.proname;

-- 2. Para cada función en la lista, ejecutar:
-- ALTER FUNCTION <schema>.<nombre>(<args>) SET search_path = pg_catalog, public, ece, audit;
```

### Procedimiento de aplicación

Dado que son 38 funciones, el enfoque práctico es:

1. Correr la consulta de listado y exportar los nombres.
2. Generar los ALTER FUNCTION usando el patrón:
   ```sql
   DO $$
   DECLARE
     func_record RECORD;
   BEGIN
     FOR func_record IN
       SELECT n.nspname || '.' || p.proname AS func_full_name,
              p.oid
       FROM pg_proc p
       JOIN pg_namespace n ON p.pronamespace = n.oid
       WHERE n.nspname IN ('public', 'ece', 'audit')
         AND p.proconfig IS NULL
         AND NOT p.prosecdef
     LOOP
       EXECUTE 'ALTER FUNCTION ' || func_record.func_full_name ||
               ' SET search_path = pg_catalog, public, ece, audit';
     END LOOP;
   END;
   $$;
   ```
3. **Cuidado:** el bloque DO aplica a TODAS las funciones sin search_path. Si alguna función tiene una razón específica para no tener search_path fijo, excluirla por nombre.

### Verificación post-aplicación

```sql
-- Verificar que el advisor ya no reporta la función:
-- Usar mcp__supabase__get_advisors y verificar que el conteo de 'function_search_path_mutable' bajó.
-- También:
SELECT p.proname, p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname IN ('public', 'ece', 'audit')
  AND p.proconfig IS NULL
  AND NOT p.prosecdef;
-- Meta: 0 filas
```

---

## Item 4 — Habilitar Auth Leaked Password Protection

**Prioridad:** ALTA — seguridad de credenciales  
**Plazo:** T-3 días  
**Responsable:** SRE Lead  

### Contexto

Supabase ofrece integración con HaveIBeenPwned (HIBP) para detectar contraseñas comprometidas en brechas conocidas. Si un usuario intenta registrarse o cambiar contraseña a una que ya fue expuesta en una brecha, el sistema la rechaza.

Esta protección no estaba habilitada en el proyecto HIS. Es especialmente importante en un sistema de salud donde las credenciales comprometidas pueden permitir acceso a PHI.

### Cómo habilitar

Esta configuración es **solo vía Supabase Dashboard** (no tiene API/SQL):

1. Ir a: `https://supabase.com/dashboard/project/ejacvsgbewcerxtjtwto/auth/providers`
2. Hacer clic en "Security" o "Advanced" en la sección de Auth.
3. Buscar "Leaked Password Protection" o "HaveIBeenPwned integration".
4. Activar el toggle.
5. Guardar.

### Verificación

- Crear un usuario de prueba con contraseña común conocida como comprometida (ej. `Password123!`).
- El sistema debe rechazarla con mensaje "Contraseña comprometida. Por favor elige otra."
- Si la acepta: la función no está habilitada. Verificar los pasos anteriores.

### Nota

Esta verificación consume una API externa (HIBP). La contraseña NO se envía a HIBP en texto plano — se usa el protocolo k-Anonymity (se envía solo los primeros 5 caracteres del hash SHA-1). No hay riesgo de exposición.

---

## Item 5 — Drug.allergyExcipients ALTER en producción (carry-over F2-S7)

**Prioridad:** MEDIA — funcionalidad de alergias  
**Plazo:** T-2 días  
**Responsable:** @DBA  
**Fuente:** Sprint F2-S7 Stream 07 carry-over explícito  

### Contexto

Stream 07 (Cross-check alergias) implementó la detección de alergias cruzadas basada en principios activos. La columna `allergyExcipients` en la tabla `Drug` fue agregada al schema Prisma pero la migración ALTER TABLE en producción quedó pendiente como deuda explícita.

Sin esta columna, el cross-check de excipientes alérgenos funciona en modo degradado (solo verifica principios activos, no excipientes).

### SQL a aplicar

```sql
-- Verificar si la columna ya existe:
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'Drug'
  AND column_name = 'allergyExcipients';

-- Si no existe, agregar:
ALTER TABLE public."Drug"
ADD COLUMN IF NOT EXISTS "allergyExcipients" text[] DEFAULT '{}';

-- Crear índice GIN para búsqueda eficiente de excipientes:
CREATE INDEX IF NOT EXISTS idx_drug_allergy_excipients
ON public."Drug" USING GIN ("allergyExcipients");
```

### Verificación

```sql
-- Verificar columna e índice:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'Drug' AND column_name = 'allergyExcipients';
-- Debe retornar 1 fila

SELECT indexname FROM pg_indexes
WHERE tablename = 'Drug' AND indexname = 'idx_drug_allergy_excipients';
-- Debe retornar 1 fila
```

---

## Tabla de seguimiento: aplicación de items

| Item | Responsable | Fecha planificada | SQL aplicado | Verificado | Fecha de cierre | Actor |
|---|---|---|---|---|---|---|
| 1 — REVOKE EXECUTE farmacia | SRE Lead | T-3 | [ ] | [ ] | | |
| 2 — Policy ece.transferencia_inventario | @DBA | T-3 | [ ] | [ ] | | |
| 3 — search_path 38 funciones | @DBA | T-2 | [ ] | [ ] | | |
| 4 — Leaked Password Protection | SRE Lead | T-3 | [ ] (dashboard) | [ ] | | |
| 5 — Drug.allergyExcipients | @DBA | T-2 | [ ] | [ ] | | |

**Criterio de go-live:** items 1, 2 y 4 deben estar completados (ALTA prioridad). Los items 3 y 5 pueden ir como primer sprint post go-live si no se logran antes.

---

## Items que NO son carry-over manual (ya aplicados vía SQL o en código)

Para referencia, los siguientes items de F2-S7 carry-over se resolvieron directamente:

- `Drug.allergyExcipients` schema Prisma — ya en `schema.prisma` (solo falta la migración SQL del item 5).
- pg_cron `expire_pharmacy_reservations` — aplicado en `89_pharmacy_reservation_expire_cron.sql`.
- `GsrnHistory` + EXCLUDE constraint — aplicado en `93_gsrn_history.sql`.
- `ece.bedside_validation` inmutable — aplicado en `91_bedside_validation.sql`.
- `ece.gs1_epcis_event` — aplicado en `94_farmacovigilancia_epcis.sql`.
