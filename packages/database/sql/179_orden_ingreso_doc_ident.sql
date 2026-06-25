-- CC-0005 / REQ-ECE-OI-001: denormaliza documento de identificación en la orden de ingreso (auditoría).
-- Nullable — back-compat con órdenes existentes creadas antes de CC-0005.
-- NO aplicar a prod directamente: este script es aprobado por @Orq en gate de entrega.

ALTER TABLE ece.orden_ingreso
  ADD COLUMN IF NOT EXISTS documento_tipo   text,
  ADD COLUMN IF NOT EXISTS documento_numero text;
