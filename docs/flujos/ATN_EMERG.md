# ATN_EMERG — Atención de Emergencia

## Metadata

- **codigo**: `ATN_EMERG`
- **nombre**: Atención de Emergencia (Hoja de Atención de Emergencia + hojas anexas)
- **modalidad**: `EMERGENCIA`
- **NTEC artículo**: Art. 35 (atención inicial en urgencias, contenido mínimo y conservación documental)
- **modulo_his_target**:
  - Episodio (cabecera): `/emergency` y `/emergency/new` (modelo `Encounter` con `admissionType = EMERGENCY` + `EmergencyVisit`).
  - Documento NTEC formal (anexo Art. 35): `/ece/atencion-emergencia` y `/ece/atencion-emergencia/[id]`.
  - Hojas anexas operativas que se enganchan al episodio: `/triage` (Manchester), `/ece/signos-vitales`, `/ece/indicaciones`, `/ece/registro-enfermeria`, RRI `/ece/rri`, y — si la disposición lo dispara — `/ece/hoja-ingreso` o `/ece/defuncion`.
- **tabla_datos**:
  - HIS legacy (operativo): `public.Encounter` (filtro `admissionType = 'EMERGENCY'`) + `public.EmergencyVisit` (1:1 con `Encounter`) + `public.EmergencyNote` (notas de evolución durante la visita).
  - ECE NTEC (formal Art. 35): `ece.documento_instancia` (cabecera workflow, `tipo_documento = ATN_EMERG`) + `ece.atencion_emergencia` (payload clínico).
  - Bridge HIS ↔ ECE: `eceBridgeEncounter` (sincroniza `Encounter` ↔ `ece.episodio`) y `eceBridgeTriage` (sincroniza `TriageEvaluation` ↔ `ece.hoja_triaje`, asegurando que la `triage_categoria` esté disponible para el documento ATN_EMERG).
- **inmutable**: `false` mientras el documento ECE está en `borrador` o `en_revision`; **`true` post-firma** del MT (estado `firmado`). Tras firma sólo se admite **rectificación NTEC Art. 19** (nuevo documento referencial, nunca edición destructiva del original). El registro operativo `EmergencyVisit` queda abierto hasta `dispositionAt` (cierre de la visita).
- **tipo_registro**: **OBLIGATORIO** (transaccional). Todo paciente que ingrese al área de urgencias debe generar `Encounter` `EMERGENCY` + `EmergencyVisit`. Si la atención excede el ámbito de "consulta rápida" y deriva en disposición clínica (alta, ingreso, observación, referencia, defunción), es **obligatorio** firmar el documento ECE `ATN_EMERG` (Art. 35) para cierre médico-legal.

## Propósito normativo

Art. 35 NTEC (atención inicial de emergencia): documento clínico que sustenta la **atención no programada** de un paciente. Es la evidencia médico-legal mínima de:

1. **Quién, cuándo y cómo llegó** el paciente al servicio (circunstancia, modo de arribo, hora de admisión y de triage).
2. **Qué se encontró** en la evaluación inicial (anamnesis dirigida + examen físico segmentado + signos vitales de admisión + categoría Manchester).
3. **Qué se decidió y por qué** (diagnóstico CIE-10 principal y secundarios, plan de manejo, intervenciones realizadas, disposición final).
4. **Quién firma** la atención y bajo qué responsabilidad asistencial.

El documento es **dependencia bloqueante** de toda actuación clínica posterior: si la disposición es hospitalización dispara la Orden de Ingreso (HCC/HOJA_ING Art. 17 lit. b), si es referencia dispara la RRI (Art. 40), si es defunción dispara el certificado y la cadena de custodia ampliada (Art. 35 — 10 años en muerte violenta / accidente / investigación), y si es observación habilita registros seriados de enfermería y reevaluaciones.

Adicionalmente sirve a:

- **Auditoría ISSS** (cuando aplica): tiempos puerta-X, justificación clínica del nivel de atención, uso de hemoderivados, antibióticos y dispositivos.
- **Indicadores institucionales** (TDR §16): tiempo de espera por nivel de triage Manchester, tiempo puerta-aguja (ictus/IAM), puerta-balón, cumplimiento de sepsis bundle hora-1, LWBS, AMA.
- **Defensa médico-legal**: cadena de hash SHA-256 (`computeContentHash`) sobre el payload clínico firmado + hash chain en `audit.audit_log` (TDR §6.3 — inmutabilidad criptográfica 10 años).

## Dependencias

| Documento / Recurso | Obligatoriedad | Cuándo se exige | Mecanismo |
|---|---|---|---|
| **FICHA_IDENT** (paciente registrado) | Obligatoria. Si el paciente llega inconsciente o sin acompañante, se permite registro **on-the-fly como "NN"** (paciente no identificado) y reconciliación posterior contra MPI. | Antes de abrir `Encounter`. | `Patient.findFirst` con DUI/NIT/NIE o creación NN con bridge a `ece.paciente`. |
| **TRIAJE Manchester** | Fuertemente recomendada (no bloqueante por norma, pero exigida por TDR §9 y por el flujo del módulo). | Inmediato post-recepción para todo paciente que arribe al área de urgencias, salvo activación de Código Rojo / Trauma / Sepsis / Materno / Ictus / IAM (atención inmediata sin triage formal). | `TriageEvaluation` referenciado por `EmergencyVisit.triageEvaluationId`; bridge a `ece.hoja_triaje`. |
| **Signos vitales de admisión** | Obligatorios para el documento ECE firmado (Art. 35 exige examen físico y SV de ingreso). | Antes de firma del MT. | `/ece/signos-vitales` enlazado a `episodio_id`. |
| **Consentimiento de tratamiento de datos** (admin `/consents`) | Sólo si el paciente está consciente y orientado; en emergencia rige el principio de **necesidad terapéutica inmediata** (Ley de Deberes y Derechos del Paciente). | Cuando proceda; nunca bloquea la atención clínica. | Registrado en módulo legacy `/consents`. |
| **Episodio HIS abierto** (`Encounter` `EMERGENCY` + `EmergencyVisit`) | Obligatorio. Es el contenedor operativo. | Antes de crear el documento ECE `ATN_EMERG`. | Bridge `eceBridgeEncounter` espeja `Encounter` → `ece.episodio`; el documento ECE referencia `episodio_id`. |

## Obligatoriedad

**SIEMPRE** en todo paciente que ingrese por urgencias / emergencia, sin excepción.

Excepciones operativas que **no** eximen del documento (sólo modifican el flujo):

- **Código Rojo / Trauma / Ictus / IAM / Sepsis / Materno** → la atención precede al registro completo; el documento se levanta retroactivamente con marca temporal real y queda sujeto a **registro retroactivo controlado** (`/ece/registro-retroactivo`, ventana parametrizable, justificación obligatoria, auditoría reforzada).
- **LWBS** (Left Without Being Seen) → se cierra `EmergencyVisit.disposition = LWBS` y el documento ECE se firma con lo registrado (típicamente triage + motivo de consulta + nota de abandono).
- **AMA** (Against Medical Advice) → se cierra `EmergencyVisit.disposition = AMA`; el documento exige nota explícita de la negativa y, si aplica, consentimiento informado de egreso voluntario.
- **DECEASED** (defunción en urgencias) → se cierra `EmergencyVisit.disposition = DECEASED` y dispara el certificado de defunción NTEC (`/ece/defuncion`) con custodia ampliada de la pieza (5 años natural / **10 años violencia, accidente o investigación** — Art. 35).

## Roles firmantes

| Rol (código RBAC) | Acción | Momento |
|---|---|---|
| **MEDICO_URGENCIAS** (`MT` / `PHYSICIAN`) | Anamnesis + examen físico + diagnóstico CIE-10 + plan + disposición + **firma electrónica con PIN** (`firmar` mutation). | Apertura, atención y cierre del documento. La firma es del MT responsable de la disposición. |
| **ENFERMERIA** (`NURSE`) | Toma de signos vitales de admisión, ejecución del triage Manchester, administración de indicaciones cumplidas, notas de enfermería por turno (`EmergencyNote`). | Continuo durante la visita. |
| **RESIDENTE** (rol `PHYSICIAN` no acreditado como adscrito) | Puede redactar borradores y registrar la atención bajo **supervisión del MT adscrito**, pero **no puede firmar** el documento ATN_EMERG por sí solo. La firma final es siempre del adscrito. | Acompañamiento. |
| **DIR** / **ADMIN** | Anulación de la atención si se detecta error pre-firma (`anular` mutation, motivo obligatorio ≥10 chars). | Excepcional; **un documento `validado` no puede anularse**, se rectifica vía Art. 19. |

Firma electrónica = **PIN argon2-hasheado** en `ece.firma_electronica` (modelo PIN-only, doble factor en roadmap). Lockout a **5 intentos fallidos** con bloqueo temporal. Toda firma exitosa resetea contadores y emite evento outbox con `contentHash` SHA-256 del payload canónico.

## Campos obligatorios NTEC

Mínimo Art. 35; el HIS exige los marcados con (**\***) para permitir la transición a `firmado`:

- **circunstancia_llegada** — texto libre: cómo llegó (peatonal, ambulancia institucional / privada, PNC, traslado, otro). Mapeado a `EmergencyVisit.arrivalMode` (`WALK_IN | AMBULANCE | POLICE | REFERRAL | PRIVATE_VEHICLE | OTHER`).
- **motivo_consulta** (\*) — narrativa del paciente / acompañante; texto libre 5..2000 chars.
- **anamnesis_dirigida** — historia de la enfermedad actual, antecedentes relevantes, alergias, medicación previa. Forma parte del `examen_fisico` extendido en `ece.atencion_emergencia.examen_fisico` (text 5..5000) o como nota separada.
- **examen_fisico** (\*) — segmentado: estado general / signos vitales / cabeza y cuello / tórax / abdomen / extremidades / neurológico. Texto único en BD; el front lo guía con secciones plegables.
- **signos_vitales_admision** — link a `/ece/signos-vitales` o registro inline (TA, FC, FR, SatO2, T°, FiO2, glasgow, glucometría capilar cuando aplique).
- **triage_categoria** — Manchester (Rojo / Naranja / Amarillo / Verde / Azul) desde `TriageEvaluation`; referenciada por `EmergencyVisit.triageEvaluationId`. **Recomendado** y **exigido por flujo TDR §9**.
- **diagnosticos** (\*) — JSONB en `ece.atencion_emergencia.diagnosticos` con al menos `diagnostico_principal` CIE-10 + `diagnosticos_secundarios` CIE-10[]. Picker `/ece/icd10-picker`.
- **manejo_realizado** (\*) — JSONB en `ece.atencion_emergencia.manejo_realizado` con plan de manejo, intervenciones (medicación administrada en urgencias, procedimientos, exámenes solicitados), respuesta clínica.
- **disposicion_final** — `alta_ambulatoria | observacion | orden_ingreso | referencia | defunción` (texto libre alineado con `EmergencyVisit.disposition`: `DISCHARGED | ADMITTED | TRANSFERRED | DECEASED | LWBS | AMA`).
- **firma_medico_responsable** (\*) — vía `firmar` mutation con PIN; transiciona el estado workflow y sella el `contentHash` en el evento `ece.atencion_emergencia.firmada`.
- **metadatos**: `episodioId` (FK), `pacienteId` (FK), `registrado_por` (FK personal_salud), `registrado_en` (timestamp), `instancia_id` (FK documento_instancia), `estado_registro` (`vigente | anulado`).

## Estados (flujo_estado)

```
borrador → en_revision (opcional) → firmado → validado (opcional, según plantilla) 
                                       ↓
                                    anulado (sólo si NO validado)
```

| codigo | descripción |
|---|---|
| `borrador` | Documento creado, editable, MT puede continuar registrando. Visible sólo para el equipo asistencial. |
| `en_revision` | (Opcional, según plantilla del establecimiento) revisión por adscrito antes de firma del residente. Editable. |
| `firmado` | MT ejecutó `firmar` con PIN. **Inmutable** clínicamente. Cuenta el `contentHash`. Liberación contra ISSS / RRI / Epicrisis. |
| `validado` | (Opcional) validación administrativa / DIR. No anulable. |
| `anulado` | Anulado pre-validación por DIR/ADMIN con motivo. `estado_registro = 'anulado'`. La instancia conserva el rastro completo. |

## Transiciones

| origen | destino | rol | acción tRPC | condición |
|---|---|---|---|---|
| (nada) | `borrador` | MEDICO_URGENCIAS | `atencionEmergencia.create` | Episodio HIS abierto + tipo_documento `ATN_EMERG` configurado en workflow engine + personal_salud activo del MT. |
| `borrador` | `borrador` | MEDICO_URGENCIAS | `atencionEmergencia.update` | Edición de campos clínicos. |
| `borrador` | `en_revision` | MEDICO_URGENCIAS (residente) | transición workflow `solicitar_revision` | Sólo si plantilla lo exige. |
| `en_revision` | `borrador` | MEDICO_URGENCIAS (adscrito) | transición workflow `devolver` | Devuelve para corrección con observaciones. |
| `borrador` \| `en_revision` | `firmado` | MEDICO_URGENCIAS | `atencionEmergencia.firmar(pin)` | `disposicion_final` definida + PIN válido + firma no bloqueada + signos vitales registrados. |
| `firmado` | `validado` | DIR / ADMIN | transición workflow `validar` | (Opcional) Validación administrativa. |
| `borrador` \| `en_revision` \| `firmado` (si no validado) | `anulado` | DIR / ADMIN | `atencionEmergencia.anular({ motivoAnulacion })` | Motivo ≥10 chars. **Conflict si `validado`**: rectificar vía Art. 19. |

## Eventos (outbox `ece.*`)

| evento | momento | payload |
|---|---|---|
| `ece.atencion_emergencia.creada` | Post-`create` | `{ atencionId, instanciaId, episodioId, pacienteId, registradoPor, organizationId }` |
| `ece.atencion_emergencia.actualizada` | Post-`update` (opcional, según plantilla) | `{ atencionId, camposCambiados[], actualizadoPor }` |
| `ece.atencion_emergencia.disposicion_definida` | Cuando `update` setea `disposicion` por primera vez | `{ atencionId, disposicion, definidaPor }` — dispara hooks en HIS para preparar `HOJA_ING`, `RRI`, certificado de defunción o seguimiento ambulatorio. |
| `ece.atencion_emergencia.firmada` | Post-`firmar` exitoso | `{ atencionId, instanciaId, episodioId, contentHash (sha256), firmaId, firmadoPor, firmadaEn, organizationId }` — `contentHash` cubre `{id, episodio_id, motivo_consulta, examen_fisico, diagnosticos, manejo_realizado}`. |
| `ece.atencion_emergencia.anulada` | Post-`anular` | `{ atencionId, instanciaId, motivoAnulacion, anuladoPor, organizationId }` |

Todos los eventos viajan por el outbox de dominio (`emitDomainEvent`) y quedan inmutables en `audit.audit_log` con hash chain (TDR §6.3).

## Drift conocido

Trazabilidad de hallazgos previos relacionados al documento:

- **HF-27 (resuelto en d45260c — PR #192, S5 remediación 2026-05-19)**: schema drift entre el router y la BD real `ece.atencion_emergencia`. Las columnas TS no coincidían (faltaban `circunstancia_llegada`, `manejo_realizado` como JSONB; sobraban campos del diseño inicial). Mapeo corregido y verificado por MCP. **Cerrado.**
- **HF-28 (resuelto en d45260c)**: `create` insertaba `atencion_emergencia` sin crear primero el `documento_instancia` que provee `instancia_id NOT NULL`. Se reordenaron los pasos: 1) resolver personal_salud, 2) resolver tipo_documento + estado inicial, 3) `INSERT documento_instancia`, 4) `INSERT atencion_emergencia` con `instancia_id`. **Cerrado.**
- **HF-29 (resuelto en d45260c)**: `firmar` aceptaba un `firmaId` arbitrario del cliente — bypass de la verificación de PIN. Reescrito para usar `verifyPin(ctx.user.id, pin)` contra `ece.firma_electronica` con argon2 + lockout (5 intentos) + bloqueo temporal. **Cerrado.**
- **HF-31 (resuelto en d45260c)**: fixtures de tests desalineadas con columnas reales. Tests reescritos. **Cerrado.**
- **H3-03 — auditoría Stream A (2026-05-19, prioridad P1)**: evaluaciones de triage en estado `IN_PROGRESS` quedan huérfanas en emergencia masiva, saturando la cola y enmascarando pacientes sin atender. Recomendación: job de expiración (`pg_cron`) que cancele evaluaciones con `startedAt > 2h`. **Bloqueante para contextos de alto volumen.** No es defecto del documento ATN_EMERG en sí, pero afecta su dependencia (TRIAJE).
- **Riesgo Stream A (P1)**: actualmente no existe verificación de unicidad por `(patientId, admissionType=EMERGENCY, open=true)`; un mismo paciente puede tener dos encuentros de emergencia abiertos en paralelo si dos recepcionistas registran simultáneamente. Mitigación operativa hasta que se añada el chequeo en `encounter.openIfMissing`.

## Descripción markdown rica

### Flujo operativo end-to-end

```
                            ┌────────────────────────────┐
                            │ Llegada del paciente       │
                            │ (peatonal / ambulancia /   │
                            │  PNC / traslado / privado) │
                            └────────────┬───────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ Registro inicial / FICHA_IDENT    │
                       │ (NN permitido si inconsciente)    │
                       │ → Patient + bridge ece.paciente   │
                       └─────────────────┬─────────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ TRIAJE Manchester (ENF)           │
                       │ → TriageEvaluation + bridge       │
                       │   ece.hoja_triaje                 │
                       │ (omitido si Código activo)        │
                       └─────────────────┬─────────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ Encounter EMERGENCY +             │
                       │ EmergencyVisit (HIS legacy)       │
                       │ Bridge → ece.episodio             │
                       └─────────────────┬─────────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ Documento ECE ATN_EMERG           │
                       │ (estado: borrador)                │
                       │ create → documento_instancia +    │
                       │ atencion_emergencia               │
                       └─────────────────┬─────────────────┘
                                         │
            ┌────────────────────────────┼────────────────────────────┐
            │                            │                            │
   Signos vitales              Examen físico +              Indicaciones / EMAR
   (/ece/signos-vitales)       diagnósticos                 (/ece/indicaciones)
            │                            │                            │
            └────────────────────────────┼────────────────────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ MT define disposicion_final       │
                       │ → ece.atencion_emergencia         │
                       │ → evento disposicion_definida     │
                       └─────────────────┬─────────────────┘
                                         │
                       ┌─────────────────▼─────────────────┐
                       │ firmar(pin) — PIN argon2          │
                       │ contentHash sha256 + outbox       │
                       │ estado: firmado (INMUTABLE)       │
                       └─────────────────┬─────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────────┐
              │                          │                              │
   alta_ambulatoria          orden_ingreso (HOJA_ING)         referencia (RRI Art. 40)
   (cierra EmergencyVisit    Encounter → Inpatient            /ece/rri
    DISCHARGED)              admission                        TRANSFERRED
              │                          │                              │
              │              observación               defunción (Art. 35)
              │              (EmergencyVisit           /ece/defuncion
              │               observationStartedAt)    DECEASED → custodia
              │                                        ampliada 5/10 años
              ▼
        Indicadores TDR §16
        (LWBS, AMA, puerta-X)
```

### Énfasis clave

- **Dispositivos de gatillado**: si la disposición final es **hospitalización** (`disposicion = 'orden_ingreso'`, `EmergencyVisit.disposition = ADMITTED`) **dispara** la creación de la **Orden de Ingreso Hospitalario** (HOJA_ING) y la apertura del episodio de internamiento (Art. 17 lit. b NTEC). Si es **referencia** (`disposicion = 'referencia'`, `TRANSFERRED`) **dispara** el documento **RRI** (Art. 40), incluyendo teleinterconsulta cuando aplique. Si es **defunción** (`DECEASED`) **dispara** el certificado de defunción NTEC (CIE-10 estructurada) y activa la **custodia documental ampliada** (5 años natural / 10 años violencia, accidente o investigación — Art. 35).

- **Relación con TRIAJE Manchester**: aunque normativamente la NTEC no lo impone como bloqueante, la operación del HIS y el TDR §9 lo exigen para todo paciente que cruce la puerta de urgencias. La categoría Manchester condiciona los **tiempos máximos parametrizables** por organización (Rojo 0 min, Naranja 10 min, Amarillo 60 min, Verde 120 min, Azul 240 min — valores por defecto MINSAL ajustables por institución). El campo `triage_categoria` del documento ATN_EMERG no se duplica en la tabla `ece.atencion_emergencia`: se **deriva por JOIN** desde `EmergencyVisit.triageEvaluationId → TriageEvaluation` (HIS) o desde `ece.hoja_triaje` (ECE), garantizando una sola fuente de verdad. Esta es la **regla de "adecuar legacy, no duplicar"** aplicada: `/triage` (Manchester) es módulo HIS legacy maduro; el flujo ECE lo consume vía bridge, no recrea una hoja paralela.

- **Códigos de activación hospitalaria** (TDR §12.2): cuando se activa Código Rojo, Trauma, Ictus, IAM, Sepsis, Materno o Activación Masiva, el paciente entra **directamente** al área de reanimación / shock y la atención precede al registro completo. El documento ATN_EMERG se levanta retroactivamente respetando hora real, y queda sujeto a auditoría reforzada y a **registro retroactivo controlado** (módulo `/ece/registro-retroactivo` con ventana parametrizable y motivo obligatorio). Los cronómetros automáticos del Código (puerta-aguja, puerta-balón, sepsis bundle hora-1) se anexan como métricas asociadas al `EmergencyVisit`.

- **Campos obligatorios para auditoría ISSS**: cuando el paciente es afiliado ISSS, el documento ATN_EMERG debe poder responder a la auditoría administrativa: identificador del afiliado, justificación clínica del nivel de atención prestado, uso de hemoderivados (link a `TransfusionRequest` / `Transfusion`), antibioticoterapia administrada (link a `MedicationAdministration`), procedimientos realizados con sus códigos, dispositivos implantados (link al inventario por `serial/lote/GS1`), tiempo total de la estancia en urgencias (`arrivedAt → dispositionAt`). Toda esa trazabilidad se construye por **join** desde el `Encounter`/`EmergencyVisit`, sin duplicar campos en `ece.atencion_emergencia`.

- **Inmutabilidad y rectificación**: una vez `firmado`, el documento **no admite UPDATE/DELETE**. Cualquier corrección clínica posterior requiere **rectificación NTEC Art. 19**: nuevo documento que referencia al original, conservando ambos en el expediente y emitiendo evento outbox específico (módulo `/ece/rectificaciones`). El `contentHash` del firmado original queda como referencia inalterable y la cadena de `audit.audit_log` detectará cualquier intento de manipulación directa en BD.

- **Custodia y conservación**: Art. 35 NTEC. Expediente con disposición de **defunción por causa natural** → 5 años. Defunción por **violencia, accidente o sujeta a investigación** → **10 años**. La cadena de hash criptográfica + `audit.audit_log` garantiza la inmutabilidad. El módulo de **archivo y purga programada** (módulo de cumplimiento, beyond MVP) honrará estas reglas a partir de `dispositionAt` y `dischargeType`.

- **Indicadores que alimenta el documento** (BI, TDR §16 — fase posterior, contratos ya disponibles): tiempo de espera por nivel de triage Manchester, tiempo de atención efectiva, LWBS, AMA, tasa de ingreso desde urgencias, tasa de referencia, cumplimiento de cronómetros de Códigos (puerta-aguja para ictus, puerta-balón para IAM con SST, sepsis bundle hora-1, tiempo a antibiótico en sepsis). Estos KPIs se exponen vía outbox `ece.atencion_emergencia.firmada` consumido por el pipeline BI (DA / DE / BIA).
