# REQ-ECE-SV-001 — Módulo transversal de Signos Vitales anclado a la cuenta activa

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0012** |
| Fecha | 2026-07-27 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad) | `docs/CC/0006/evolucion-medica-avante7.html` (modal de signos vitales) |
| Rama | `feat/cc-0012-signos-vitales-transversal` |
| SQL | `packages/database/sql/188_cc0012_signos_vitales_transversal.sql` — **APLICADO a prod 2026-07-27 vía MCP (no re-aplicar)** |

## 1. Requerimiento
Módulo de signos vitales **reutilizable desde cualquier documento o módulo**, para cualquier paciente, que deje cada toma **grabada en la cuenta activa del paciente**. Confirmar que todos los campos y comportamientos del mockup quedan persistidos y mapeados en BD.

## 2. Diseño
- **Un solo capturador**: `apps/web/src/components/signos-vitales/` (`SignosVitalesModal` + `SignosVitalesCapture` + hook `useSignosVitales`), fiel a avante7. Reemplaza el modal duplicado de HC y el form standalone; evolución conserva su UI/persistencia (decisión CC-0006) pero consume la misma fuente de rangos/alertas.
- **Fuente única de verdad clínica**: `packages/contracts/src/validators/signos-vitales.ts` — rangos, conversiones (kg↔lb, m↔ft), IMC/ICT/Glasgow, Naegele, y los 14 umbrales de alerta crítica del mockup. Elimina las 3 copias divergentes.
- **Anclaje por cuenta**: `ece.signos_vitales.cuenta_id` FK a `PatientAccount`; `episodio_id` ahora nullable con CHECK «al menos un ancla»; política RLS `by_cuenta_estab` para filas sin episodio. El router resuelve cuenta↔episodio↔paciente server-side en ambos sentidos y **siempre** persiste `cuenta_id` y `paciente_id`.
- **Drift preexistente cerrado** (verificado en vivo, tabla con 0 filas): `paciente_id` existía en Prisma pero no en BD; `instancia_id` NOT NULL sin default bloqueaba todo INSERT del router.
- Campos nuevos en BD: `go_gestas/go_partos_termino/go_partos_pretermino/go_abortos/go_vivos` (fórmula obstétrica, obligatoria en UI si sexo F), `peso_lb`, `talla_ft` (representaciones alternas capturadas; kg/cm siguen canónicos), `fpp_activo` (switch FPP Naegele).

## 3. Mapeo de persistencia (resumen)
Todos los campos del modal avante7 → columnas de `ece.signos_vitales`; derivados (`glasgow_total`, `imc`, `ict`) se calculan server-side; `fpp` se calcula (Naegele) solo con `fpp_activo=true`; las alertas críticas se recalculan en vivo (no se persisten — son derivables). Mapeo campo a campo completo en el PR y en los tests de contrato.

## 4. Fuera de alcance / seguimiento
- Gating «núcleo obligatorio + G·P·P·A·V si F» es client-side (igual que el mockup); enforcement duro server-side queda a decisión @PO.
- Standalone con solo `?episodioId=` no muestra bloque gineco-obstétrico (no resuelve sexo/edad sin cuenta).
- E2E Playwright de los 3 flujos (por cuenta, por episodio, firma) — @QA nightly.
- `packages/ui/VitalSignsCapture.tsx` (genérico sin uso) y helpers muertos de `historia-clinica/nueva/_components/utils.ts` — limpieza en PR aparte.
