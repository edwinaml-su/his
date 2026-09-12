-- =============================================================================
-- 233_operating_room_charge_code.sql — OperatingRoom.chargeCode
--
-- docs/48 §5 C3-2 (cierre) — decisión de Edwin 2026-09-12: el disparador del
-- cargo de quirófano es la RESERVA de sala (acto administrativo: crear/
-- confirmar el `SurgeryCase` con `operatingRoomId`), no el acto quirúrgico en
-- sí (puramente médico). `packages/trpc/src/routers/surgery.router.ts`
-- (`case.create` / `case.cancel`) es el punto real: `public."SurgeryCase"` es
-- HOY el único vínculo real entre el proceso quirúrgico y facturación (ADR
-- 0021, sql/207) — `ece.reserva_sala_qx` referencia `ece.sala_qx`, un
-- catálogo paralelo SIN FK a `public."OperatingRoom"` (verificado: sql/99 no
-- declara ninguna relación entre ambos). Bridging los dos espacios de GUC
-- (ece vs public) para un catálogo que ni siquiera comparte identidad de fila
-- no es "complejo" sino estructuralmente imposible sin inventar un mapeo que
-- no existe hoy — se usa el punto public.* real, tal como prevé el propio
-- plan (docs/48 §3 C3-2, fallback "implementa el cargo en el punto public.*
-- más cercano").
--
-- Mismo patrón que `Room.chargeCode` (sql/231): código de tarifario opcional,
-- resuelto por `capturarCargo` (packages/trpc/src/lib/charge-capture.ts). Si
-- es NULL, el router cae al code sintético determinista `QX-<code|SIN_SALA>`
-- — el resolver no lo encuentra ⇒ línea PENDIENTE_TARIFA visible (R3: nunca
-- 0, nunca silencio), no un ALTER adicional.
--
-- Idempotente. Aplicar vía mcp apply_migration en una sola transacción.
--
-- APLICADO a prod 2026-09-12 vía mcp__<org>__apply_migration (proyecto
-- ejacvsgbewcerxtjtwto) — NO re-aplicar.
-- =============================================================================

BEGIN;

ALTER TABLE public."OperatingRoom"
  ADD COLUMN IF NOT EXISTS "chargeCode" varchar(40);

COMMENT ON COLUMN public."OperatingRoom"."chargeCode" IS
  'Código de tarifario del cargo de reserva de sala (USO_INSTALACIONES) — '
  'docs/48 C3-2, sql/233. NULL ⇒ el router usa el sintético QX-<code|SIN_SALA> '
  '(PENDIENTE_TARIFA visible, nunca cargo en 0). Editable desde el admin de '
  'quirófanos si existe esa pantalla; si no, solo vía este campo de schema.';

COMMIT;
