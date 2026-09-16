/**
 * docs/48 Ola 3 (C3-3) — Taxonomía de `PatientAccountService.origen`.
 *
 * La columna sigue siendo `varchar(30)` libre en BD (no hay enum Postgres:
 * ver `packages/database/sql/224_cargos_integridad.sql`) — esta constante es
 * el candado en la capa TS, validado por `capturarCargo`
 * (`packages/trpc/src/lib/charge-capture.ts`) antes de escribir la fila.
 *
 * `HOJA_GASTOS*`/`TERAPIA_RESPIRATORIA`/`HABITACION`
 * quedan definidos para cuando exista su captura real (fuera de alcance de
 * Ola 3 — docs/48 §3, C3-2 diferido) — un origen sin caller todavía no es
 * un origen inválido.
 *
 * CC-0036 Ola 5 (REQ-HIS-AFIL-001 S6, Decisión Edwin 2026-09-16 #2a) agrega:
 *   - `CONSULTA` — cargo de consulta externa capturado en el check-in de una
 *     cita con médico afiliado conocido (packages/trpc/src/routers/
 *     outpatient.router.ts realizarCheckIn), origen para atribuir producción
 *     TRATANTE.
 *   - `HONORARIO_MEDICO` — el honorario calculado es TAMBIÉN un cargo en la
 *     cuenta del paciente (packages/trpc/src/lib/produccion-atribucion.ts),
 *     distinto del cargo origen que lo generó.
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
  "CONSULTA",
  "HONORARIO_MEDICO",
  "OTRO",
] as const;

export const chargeOriginEnum = z.enum(CHARGE_ORIGINS);
export type ChargeOrigin = z.infer<typeof chargeOriginEnum>;
