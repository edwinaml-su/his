# REQ-MPI-EXP-001 — Expediente con país en dígitos ISO 3166-1 numeric

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0014** |
| Fecha | 2026-07-28 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| SQL | `packages/database/sql/190_cc0014_expediente_pais_numerico.sql` — **APLICADO a prod 2026-07-28 (105 pacientes + 1 espejo ECE migrados; no re-aplicar)** |
| Rama | `feat/cc-0014-expediente-numerico` |

## 1. Requerimiento
El componente de país del número de expediente pasa de ISO 3166-1 **alfa-2** (`SV`) a ISO 3166-1 **numérico** con 3 dígitos (`222`), para **todos** los expedientes (nuevos y existentes).

## 2. Formato
- Antes: `{ALFA2}{AA}{NNNNN}` → `SV9000003`
- Ahora: `{NNN}{AA}{NNNNN}` → `2229000003` (10 dígitos; 222=El Salvador, 320=Guatemala, 340=Honduras; zero-pad a 3)
- `AA` (año de nacimiento) y correlativo `NNNNN` sin cambios.

## 3. Diseño
- `Country.isoNumeric` (ya existía, unique) es la fuente del prefijo; `patient.create` valida que la organización tenga país con alfa-2 Y numérico.
- **El bucket de la secuencia no cambia**: `secuencia_expediente`/`fn_next_expediente` siguen keyed por (alfa-2, AA) — el mapeo alfa2↔numeric es 1:1, así que la continuidad de correlativos se preserva (el próximo nacido-90 SV es `2229000004`, no reinicia).
- Migración de existentes con bypass temporal de los triggers de inmutabilidad (`trg_block_expediente`, `trg_block_numero_expediente`) dentro de la misma transacción: `Patient.expediente`, `Patient.mrn` (cuando mrn=expediente) y `ece.paciente.numero_expediente`. Idempotente (regex de formato viejo).

## 4. Verificación en prod (2026-07-28)
- Formato viejo restante: 0 (Patient) / 0 (ece.paciente). Migrados: 105. Triggers reactivados: 2/2.
