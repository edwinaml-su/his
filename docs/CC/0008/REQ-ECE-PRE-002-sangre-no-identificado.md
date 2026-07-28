# REQ-ECE-PRE-002 — Pre-registro: tipo de sangre + paciente no identificado

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0008b** (iteración 2 del CC-0008) |
| Fecha | 2026-07-27 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad visual) | `docs/CC/0008/preregistro2.html` |
| Pantalla | `/patients/new` (pre-registro) |
| Rama | `feat/cc-0008-sangre-noid` |
| SQL | `packages/database/sql/187_cc0008b_sangre_no_identificado.sql` — **APLICADO a prod 2026-07-27 vía MCP (no re-aplicar)** |

## 1. Requerimiento
1. **Tipo de sangre** obligatorio en el pre-registro: select de 13 valores (A/B/AB/O × +/−/Du, más «No reportado en documento de identificación») + **banner permanente de seguridad** (verde solo con documento presentado y valor concreto; rojo en los demás estados con texto específico). El valor confiable proviene del documento escaneado.
2. **Paciente no identificado** (emergencia): toggle que genera identidad temporal — nombre «Paciente {masculino|femenino} no identificado DDMMAAAA-NN» con **correlativo diario por organización** asignado por BD; oculta documento/nombres/apellidos/fecha; sangre forzada a NR. La identidad real se captura después en Admisión.

## 2. Diseño aprobado
- `Patient.bloodTypeAbo/bloodRh` ya existían; `bloodRh` acepta ahora `Du`; columna nueva `bloodTypeNotReported` (distingue «no reportado en documento» de «sin capturar»).
- Secuencia `public.secuencia_no_identificado(organization_id, fecha)` + `fn_next_no_identificado` (patrón CC-0002, upsert atómico SECURITY DEFINER). `unknownLabel = DDMMAAAA-NN` se genera server-side dentro de la transacción de `patient.create`.
- No identificado: `birthDate` null, expediente con AA del **año actual**, `isUnknown=true` (alimenta la bandeja `PATIENT_NN_TO_RESOLVE` existente), hook ECE con `tipo_registro_identidad='desconocido'`.
- **Divergencia deliberada:** triage crea NN con formato `NN-yyyyMMdd-HHmmss` (flujo distinto, no tocado); el pre-registro usa `DDMMAAAA-NN` según mockup.
- Escaneo de documento (`parse-documento.ts`) ahora entrega `tipoSangre`.
- Se cerraron además gaps de fidelidad de la iteración 1 vs preregistro2.html: grid de 3 columnas en nombres/apellidos, section-heads, fecha DD/MM/AAAA con máscara + edad inline, hints, botones «Crear preregistro»/«Cancelar».

## 3. Fuera de alcance
- Cambio del formato NN de triage (divergencia documentada).
- Flujo de resolución de identidad en Admisión (ya existe bandeja `PATIENT_NN_TO_RESOLVE`).
- `docs/DESIGN-SPEC.md` sigue como plantilla sin llenar (deuda preexistente de CC-0008).
