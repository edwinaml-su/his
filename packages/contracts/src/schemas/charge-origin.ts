/**
 * docs/48 Ola 3 (C3-3) — Taxonomía de `PatientAccountService.origen`.
 *
 * La columna sigue siendo `varchar(30)` libre en BD (no hay enum Postgres:
 * ver `packages/database/sql/224_cargos_integridad.sql`) — esta constante es
 * el candado en la capa TS, validado por `capturarCargo`
 * (`packages/trpc/src/lib/charge-capture.ts`) antes de escribir la fila.
 *
 * `HOJA_GASTOS*`/`TERAPIA_RESPIRATORIA`/`USO_INSTALACIONES`/`HABITACION`
 * quedan definidos para cuando exista su captura real (fuera de alcance de
 * Ola 3 — docs/48 §3, C3-2 diferido) — un origen sin caller todavía no es
 * un origen inválido.
 */
import { z } from "zod";

export const CHARGE_ORIGINS = [
  "DISPENSACION_FARMACIA",
  "LABORATORIO",
  "IMAGENES",
  "HOJA_GASTOS",
  "HOJA_GASTOS_SOP",
  "HOJA_GASTOS_UCI",
  "TERAPIA_RESPIRATORIA",
  "USO_INSTALACIONES",
  "HABITACION",
  "OTRO",
] as const;

export const chargeOriginEnum = z.enum(CHARGE_ORIGINS);
export type ChargeOrigin = z.infer<typeof chargeOriginEnum>;
