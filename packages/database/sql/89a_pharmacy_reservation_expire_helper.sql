-- =====================================================================
-- 89a_pharmacy_reservation_expire_helper.sql
-- Categoría A/D mixta (función real definida en un archivo que solo
-- falla por dependencia de plataforma) — feat/db-portable, segunda
-- pasada @DBA, 2026-08-19.
--
-- Root cause: public.expire_pharmacy_reservations() SÍ tiene su
-- `CREATE OR REPLACE FUNCTION` en el corpus (línea 132 de
-- 89_pharmacy_reservation_expire_cron.sql), pero ese archivo falla en una
-- reconstrucción fuera de Supabase por una causa 100% ajena a esta función:
-- la extensión `pg_cron` no está disponible fuera de la imagen de Supabase
-- (categoría A, documentada en docs/runbooks/db-reconstruccion-fuera-de-supabase.md
-- §3.2 — confirmado con `pg_available_extensions`, 0 filas). El archivo
-- llama `cron.schedule(...)` al final → falla → el runner trata todo el
-- archivo como una transacción implícita → ROLLBACK incluye la
-- `CREATE FUNCTION` de las líneas previas. Consumidores posteriores
-- (155_fix_security_definer_search_path.sql,
-- 196_owasp2025_a02_secdef_hardening.sql) ven "function does not exist"
-- pese a que 89 sí la declara.
--
-- Extraída aquí vía pg_get_functiondef() por introspección de SOLO LECTURA
-- contra prod (mcp__.../execute_sql, ejacvsgbewcerxtjtwto, sin escritura) —
-- idéntica en cuerpo a la de 89_pharmacy_reservation_expire_cron.sql (con
-- el SET search_path explícito que 96/155 ya le fijaron en prod). No se
-- toca 89_pharmacy_reservation_expire_cron.sql — sigue siendo el archivo
-- correcto para un target que sí tenga pg_cron (ej. Supabase real, o RDS
-- con el parameter group habilitado); este archivo es solo el fallback
-- para que la función exista cuando pg_cron no está.
--
-- Fuera de alcance de este archivo: NO se extrae
-- public.set_pharma_reservation_updated_at() (el otro `CREATE FUNCTION`
-- de 89) porque ningún archivo posterior falla por su ausencia en el
-- diagnóstico actual — si aparece un consumidor nuevo, se agrega aparte.
--
-- Nota de numeración: sufijo "89a" para que exista antes de sus
-- consumidores reales (155, 196). `sort -V` ordena "89a" antes que "89"
-- (verificado) — sin problema: la función no depende de que 89 haya
-- corrido antes (solo referencia public."PharmacyReservation" y
-- public."NotificationOutbox", ya creadas por Prisma en Fase 1; los
-- cuerpos plpgsql no se validan contra objetos referenciados en CREATE,
-- solo en ejecución).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.expire_pharmacy_reservations()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_row public."PharmacyReservation"%ROWTYPE;
BEGIN
  FOR v_row IN
    UPDATE public."PharmacyReservation"
    SET status = 'EXPIRED', "updatedAt" = now()
    WHERE status = 'RESERVED'
      AND "expiresAt" < now()
    RETURNING *
  LOOP
    BEGIN
      INSERT INTO public."NotificationOutbox" (
        "organizationId",
        "channel",
        "payload",
        "createdAt",
        "status"
      ) VALUES (
        v_row."organizationId",
        'PHARMACY',
        jsonb_build_object(
          'event',          'RESERVATION_EXPIRED',
          'reservationId',  v_row."id",
          'pharmacyOrderId', v_row."pharmacyOrderId",
          'patientId',      v_row."patientId",
          'gtin',           v_row."gtin",
          'lote',           v_row."lote",
          'expiredAt',      now()
        ),
        now(),
        'PENDING'
      );
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END;
$function$;

COMMENT ON FUNCTION public.expire_pharmacy_reservations() IS
  'Expira reservas RESERVED cuyo expiresAt < now() y encola notificación outbox. '
  'Llamada por pg_cron cada 5 min en Supabase; fuera de Supabase requiere un '
  'scheduler externo (ver docs/runbooks/db-reconstruccion-fuera-de-supabase.md §3.2).';
