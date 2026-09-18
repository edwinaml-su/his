-- =============================================================================
-- 252_care_task_source_type_lab_order_item.sql — extensión CC-0040
--
-- Amplía el vocabulario del CHECK CareTask_sourceType_check (sql/209) con
-- 'LAB_ORDER_ITEM': la escogitación de exámenes (lis.order.create) genera
-- una CareTask de supervisión POR EXAMEN, no por orden. Sin este ALTER, el
-- INSERT lanza 23514 y revierte la transacción completa de la orden
-- (hallazgo pre-PR — misma lección que el drift de vocabulario sql/202:
-- tests con Prisma mockeado no ejecutan CHECKs reales). Idempotente.
-- =============================================================================

ALTER TABLE public."CareTask" DROP CONSTRAINT IF EXISTS "CareTask_sourceType_check";
ALTER TABLE public."CareTask" ADD CONSTRAINT "CareTask_sourceType_check"
  CHECK ("sourceType" IN (
    'INDICACION_ITEM',
    'LAB_ORDER',
    'LAB_ORDER_ITEM',
    'IMAGING_ORDER',
    'TRANSFER',
    'MANUAL'
  ));
