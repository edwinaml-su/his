# SALA_EXP — Sala de Expulsión (Parto)

## Metadata
- **codigo**: `SALA_EXP` (seed siembra como `SALA_EXPULSION` en `ece.tipo_documento` — ver `packages/database/sql/72_sala_expulsion.sql:133-139`. Este documento usa el alias corto `SALA_EXP` en el catálogo de flujos NTEC; ambos refieren al mismo tipo).
- **nombre**: Hoja de Sala de Expulsión (Parto)
- **modalidad**: HOSPITALIZACION (sub-modalidad obstétrica — `tipo_documento.modalidad = 'hospitalario'`). Aplica solo a episodios obstétricos formalizados como ingreso por trabajo de parto, no a hospital de día ni ambulatorio.
- **NTEC artículo**: Acuerdo n.º 1616-2024, **Doc 14 NTEC §3.14 Documentos Obstétricos** (Hoja de Sala de Expulsión); Arts. 19 (cronología), 23 lit. a.4 (firma electrónica simple del médico ginecólogo), 39 (PIN argon2id), 41 lit. c (responsable firmante), 42 (rectificación trazable post-firma), 55-56 (metadatos obligatorios + nivel segundo en `nacimiento_ts`). TDR §11.6 — Sala de Partos / Materno-infantil. Insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.14 líneas 530-535.
- **modulo_his_target**: `/ece/obstetricia/expulsion` (ya implementado — cronómetro 4 fases + formulario `registrarNacimiento` + modal PIN firma). NO hay módulo legacy HIS equivalente para el período expulsivo (regla "Adecuar legacy" no aplica: documento NTEC formal sin equivalente HIS previo). Coexiste con `/ece/obstetricia/partograma` (vigilancia del trabajo de parto, doc separado).
- **tabla_datos**: `ece.sala_expulsion` (tabla 1:1 por episodio obstétrico — UNIQUE `episodio_hospitalario_id`). **NO modelada en `schema.prisma`** al 2026-05-22 — solo el modelo HISTORICO genérico `EceDocumentoObstetrico` con columna `sala_expulsion JSONB` (`packages/database/prisma/schema.prisma:5280-5301`) refleja parte de la información; la tabla operativa real vive como SQL hand-rolled (`packages/database/sql/72_sala_expulsion.sql`) y es accedida por raw SQL desde el router (`packages/trpc/src/routers/ece/sala-expulsion.router.ts`). Sub-router `periodoExpulsivoRouter` opera la columna `eventos JSONB` (`packages/database/sql/72b_sala_expulsion_eventos.sql` + `99_sala_expulsion_eventos_column.sql`).
- **inmutable**: `true` post-firma (`estado_registro = 'firmado'` no admite UPDATE; cambios solo por rectificación NTEC Art. 42). Pre-firma la fila vive en estado `borrador` y admite actualización; sin embargo el MVP actual NO expone procedure `update` — el flujo previsto es `registrarNacimiento` + `firmar` consecutivos. Anulación NO implementada (CHECK constraint en BD limita `estado_registro` a `('borrador', 'firmado')`).
- **tipo_registro**: **OBLIGATORIO** en todo episodio obstétrico que culmine en **parto vaginal** (eutócico o distócico instrumentado). Sembrado como `'maestro'` en `ece.tipo_documento` (rol de cabecera del evento de nacimiento; alimenta cascada RN). La cesárea NO genera SALA_EXP — cae bajo `ACTO_QX` (Doc 13 NTEC, Acto Quirúrgico) en quirófano; el enum `ece.tipo_parto` admite `'cesarea_emergencia'` como excepción operativa pero la cesárea programada se documenta en flujo quirúrgico.

## Propósito normativo

La Hoja de Sala de Expulsión es el **registro médico-legal del evento del parto**: documenta el **momento exacto del nacimiento** (`nacimiento_ts`), el **tipo y mecanismo del parto**, los **incidentes perineales y placentarios** y el **sangrado estimado** del puerperio inmediato. Junto con la Hoja de Atención del Recién Nacido (ATN_RN / NEONATAL) constituye la cabecera del expediente del recién nacido — TDR §11.6 establece que la apertura automática del expediente del RN se dispara desde el evento de nacimiento registrado aquí.

Cumple cuatro funciones simultáneas:

1. **Base legal del acta de nacimiento** — `nacimiento_ts` con resolución a segundo (Art. 55-56 NTEC) es el dato que MINSAL transfiere al Registro Nacional de Personas Naturales (RNPN) cuando exista interoperabilidad. La integridad criptográfica (hash chain NTEC Art. 55-56) protege esta marca temporal de manipulación retroactiva.
2. **Cronología clínica del parto** (Art. 19 NTEC) — registra los hitos del trabajo de parto en orden cronológico: inicio de fase activa → expulsivo → nacimiento → alumbramiento, alimentando la cronología longitudinal del episodio obstétrico.
3. **Trazabilidad de complicaciones maternas inmediatas** — episiotomía, desgarro perineal grado I-IV (clasificación OMS), placenta retenida, sangrado estimado, son insumos para el seguimiento de hemorragia post-parto (HPP) que dispara alerta a las 30 min sin alumbramiento (`ece.expulsion.hemorragia_post_parto_alerta`).
4. **Disparador de la cascada de atención del RN** — el evento `ece.nacimiento.registrado` (al firmar `registrarNacimiento`) emite al outbox de dominio el placeholder UUID (`atencion_rn_placeholder`) que el módulo Recién Nacido (newborn) consume para abrir el expediente neonatal con sus respectivas FICHA_IDENT, ATN_RN y eventualmente NRP si requirió reanimación.

## Dependencias

| Dependencia | Tipo | Estado requerido | Origen |
|---|---|---|---|
| **HOJA_ING** obstétrica | Hard (bloqueante) | `firmado` o `validado` | Art. 17b NTEC. Debe existir `ece.hoja_ingreso` vinculada a `ece.episodio_hospitalario` con servicio destino gineco-obstetricia. El bridge `eceBridgeAdmision.admitirDesdeOrden` la genera al admitir el ingreso por trabajo de parto. |
| **PARTOGRAMA** | Soft (recomendado) | `firmado` o `en_curso` | Doc 14 NTEC §3.14 — partograma de vigilancia del trabajo de parto (curva de Friedman). No bloquea la creación de SALA_EXP pero su ausencia es un hallazgo de calidad clínica (el motor de cumplimiento debería marcar el episodio como "incompleto" si SALA_EXP firma sin PARTOGRAMA asociado). Persiste en `EceDocumentoObstetrico.partograma` (JSONB) + tabla operativa `EcePartogramaRegistro`. |
| **CONS_INF obstétrico** | Soft (condicional) | `firmado` por paciente + médico | Solo si se prevé episiotomía electiva o procedimientos invasivos (forceps, vacuoextractor) requieren consentimiento informado previo conforme política institucional. En urgencia obstétrica no es bloqueante (Art. 40 NTEC excepción por urgencia vital). |
| `ece.episodio_hospitalario` | Hard (FK) | activo | FK `episodio_hospitalario_id` con `ON DELETE RESTRICT`. Sin episodio hospitalario obstétrico la inserción falla. |
| `ece.personal_salud` (MC ginecólogo) | Hard (RLS) | activo | El médico que firma debe tener perfil ECE activo (`his_user_id` mapeado, `activo = true`) o `registrarNacimiento` lanza `PRECONDITION_FAILED`. |

> **Importante**: no hay FK explícita a PARTOGRAMA en el schema. La asociación es por `episodio_hospitalario_id` compartido. El cumplimiento "PARTOGRAMA antes de SALA_EXP" debe verificarse en el motor workflow ECE (`workflow-instance.router`) o en el dashboard `/ece/cumplimiento`, no se enforza en BD.

## Obligatoriedad

- **Parto vaginal eutócico**: SI — obligatoria.
- **Parto vaginal distócico** (presentación pélvica, parto prolongado, sufrimiento fetal sin cesárea): SI — obligatoria con `tipo_parto = 'distocico'`.
- **Parto vaginal instrumentado** (fórceps, vacuoextractor, espátulas): SI — obligatoria con `mecanismo_parto` en {`forceps`, `vacuoextractor`, `espatulas`}.
- **Cesárea programada**: NO — se documenta en flujo quirúrgico (`ACTO_QX`, Doc 13 NTEC). El expediente del RN se abre desde el reporte operatorio quirúrgico, no desde SALA_EXP.
- **Cesárea de emergencia**: SI — el enum `ece.tipo_parto` admite `'cesarea_emergencia'` para casos donde el trabajo de parto inició como vaginal y derivó a cesárea urgente. En ese escenario coexisten SALA_EXP (registro del intento de parto vaginal previo a la decisión) y ACTO_QX (registro de la cesárea efectivamente realizada). Decisión institucional dirime cuál es la cabecera del expediente RN.
- **Aborto / pérdida fetal**: NO — caen bajo flujos separados (legrado, AMEU). Excluidos del scope SALA_EXP.

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **MC** / **PHYSICIAN** (ginecólogo-obstetra) | LLENA + RESPONSABLE + FIRMA | Atiende el parto y registra al cierre del alumbramiento | PIN argon2id (NTEC Art. 39). Lockout 5 intentos. `firmar()` transiciona `borrador → firmado`. |
| **NURSE** / **ENFERMERIA_OBSTETRICIA** | Asistencia + registro de signos vitales maternos en `SIG_VIT` paralelo | Continuo durante el período expulsivo | Sin firma sobre SALA_EXP (firma del MC es suficiente legalmente). Acceso de lectura al registro. |
| **PEDIATRA** / **NEONATOLOGIA** | Atiende al RN inmediato post-nacimiento | Al nacimiento + reanimación si aplica | Firma sobre `ATN_RN` / `NRP` separados — NO firma SALA_EXP, pero su intervención queda referenciada vía el placeholder UUID `atencion_rn_placeholder`. |
| **MT** (Médico de Turno) | Sustituye al MC titular si la guardia es de turno | Equivalente al MC en cuanto a firma | Mismo procedure `firmar()`, requiere rol `["PHYSICIAN", "MC"]`. |

> **Drift de roles** (audit Stream F): el router actual usa `requireRole(["PHYSICIAN", "MC", "NURSE"])` para `list/get` (NURSE puede leer) pero `registrarNacimiento` y `firmar` exigen `["PHYSICIAN", "MC"]`. La página UI (`expulsion/page.tsx`) declara comentario "Roles: PHYSICIAN, MC (registro + firma). NURSE (solo lectura/lista)" — coherente. Caso especial: instituciones con obstetras profesionales (matronas tituladas) requieren mapeo a rol `MC` para poder firmar; el catálogo de personal lo permite si el `tipo_personal` está configurado.

## Campos obligatorios

Mapeados a `ece.sala_expulsion` (SQL — `packages/database/sql/72_sala_expulsion.sql`):

### Identificación y vínculos
- `id` — UUID PK (gen_random_uuid()).
- `episodio_hospitalario_id` — UUID NOT NULL, FK a `ece.episodio_hospitalario(episodio_id)`, ON DELETE RESTRICT, UNIQUE (un registro por episodio obstétrico).
- `atencion_rn_placeholder` — UUID (nullable hasta `registrarNacimiento`). UUID generado server-side dentro de la transacción de creación; el módulo newborn lo consume para abrir el expediente RN asíncronamente.

### Cronología del evento (BASE LEGAL — Art. 55-56)
- `inicio_expulsivo_ts` — TIMESTAMPTZ. Inicio del período expulsivo (dilatación completa + pujos activos). Opcional pero recomendado.
- **`nacimiento_ts`** — TIMESTAMPTZ **NOT NULL**. **Hora exacta del nacimiento — base legal del acta de nacimiento del RN**. Resolución a segundo (Art. 55-56 NTEC). Inmutable post-firma. Este campo es el que MINSAL transferirá al RNPN cuando exista interoperabilidad con el registro civil.
- `alumbramiento_ts` — TIMESTAMPTZ. Hora de expulsión de la placenta. Sirve para validar el umbral HPP de 30 min post-nacimiento (`HPP_THRESHOLD_MS` en `periodo-expulsivo.router.ts`).

### Tipo, presentación y mecanismo
- `tipo_parto` — ENUM `ece.tipo_parto` NOT NULL ∈ {`eutocico`, `distocico`, `cesarea_emergencia`}.
- `presentacion_fetal` — TEXT NOT NULL ∈ {`cefalica`, `pelvica`, `transversa`, `otra`} (CHECK constraint).
- `mecanismo_parto` — TEXT NOT NULL ∈ {`espontaneo`, `forceps`, `vacuoextractor`, `espatulas`} (CHECK constraint).

### Periné y placenta
- `episiotomia` — BOOLEAN NOT NULL DEFAULT false. Si `true`, la nota narrativa de la sección "datos" debe documentar tipo (mediolateral, media) y reparación.
- `desgarro_perineal_grado` — SMALLINT CHECK ∈ [0, 4]. Clasificación OMS: 0 (sin desgarro) / I (mucosa) / II (músculo perineal) / III (esfínter anal) / IV (rectal).
- `placenta_completa` — BOOLEAN. `true` = íntegra. `false` = retención parcial o total (dispara manejo activo: revisión manual, legrado, oxitocina).
- `sangrado_estimado_ml` — INTEGER CHECK ≥ 0. Estimación clínica del sangrado del puerperio inmediato. > 500 mL en parto vaginal o > 1000 mL en cesárea clasifica como hemorragia post-parto (HPP).

### Trazabilidad y firma
- `registrado_por` — UUID NOT NULL, FK a `ece.personal_salud(id)`. Médico que registra (puede diferir del firmante si hay relevo).
- `estado_registro` — TEXT NOT NULL DEFAULT `'borrador'` CHECK ∈ {`borrador`, `firmado`}.
- `firmado_por` — UUID, FK a `ece.personal_salud(id)`. NULL en borrador, NOT NULL post-firma.
- `firmado_en` — TIMESTAMPTZ. NULL en borrador, NOT NULL post-firma. Timestamp del acto de firma electrónica.
- `registrado_en` — TIMESTAMPTZ NOT NULL DEFAULT now(). Metadato Art. 55-56.

### Eventos JSONB (campo `eventos` — SQL 72b + 99_sala_expulsion_eventos_column)
- **`eventos`** — JSONB NOT NULL DEFAULT `'[]'::jsonb`. Append-only array de eventos cronológicos del período expulsivo y alumbramiento. **Estructura por elemento** (`ExpulsionEvento` en `periodo-expulsivo.router.ts`):
  ```
  {
    id:        UUID,        // generado en router (randomUUID())
    tipo:      enum,         // ver tipos abajo
    timestamp: ISO-8601,
    nota?:     string,       // máx 500 char
    datos?:    object        // metadatos libres específicos al tipo
  }
  ```
  Tipos admitidos (`tipoEventoEnum`):
  - `inicio_pujos` — paciente inicia pujos activos en período expulsivo.
  - `posicion_madre_cambio` — cambio postural (litotomía → cuclillas → lateral, etc.). Datos típicos: `{ desde, hacia }`.
  - `amniotomia` — rotura artificial de membranas (amniorrexis). Datos típicos: `{ caracteristicas_liquido: 'claro'|'meconial'|'sanguinolento', operador }`.
  - `episiotomia` — momento de la episiotomía. Datos típicos: `{ tipo: 'mediolateral'|'media' }`.
  - `desgarro` — registro del momento en que se identifica desgarro. Datos típicos: `{ grado: 0..4, localizacion }`.
  - `nacimiento` — sintético (redundante con `nacimiento_ts`); permite registrar variaciones cronológicas si se descubre discrepancia.
  - `alumbramiento` — registro del momento de expulsión de placenta. **Dispara validación HPP** si Δt(alumbramiento, nacimiento) > 30 min.
  - `sangrado_anormal` — alerta clínica intra-evento. Datos típicos: `{ ml_estimado, manejo: 'oxitocina'|'masaje_uterino'|'transfusion'|'otro' }`.

> **Política de inmutabilidad de eventos**: append-only por operador SQL `||` (JSONB concat). No hay UPDATE in-place de elementos individuales. Rectificación NTEC Art. 42 obliga a NUEVO evento que refiera el ID del original (no implementado todavía — deuda HF-10 ampliada).

### Adicionales operativos (sugeridos — no en schema actual)
- `tactos_vaginales` — registros sucesivos (timestamps + hallazgos: dilatación, borramiento, estación, presentación, variedad). Hoy NO modelado como columna ni evento estructurado; debería persistirse como evento `tacto_vaginal` en `eventos` JSONB o tabla satélite. **GAP de modelado** vs. analisis_workflows_ece.md §3.14.
- `analgesia_obstetrica` — tipo (epidural, raquídea, óxido nitroso, ninguna) + hora + operador. Hoy NO modelado en SALA_EXP directamente; debería extraerse de `ece.indicaciones_medicas` o `ACTO_QX` (si epidural fue colocada por anestesiólogo).
- `complicaciones_maternas` — narrativa estructurada (HPP, eclampsia, embolia LA, etc.) con manejo. Parcialmente cubierto por `sangrado_anormal` evento + `sangrado_estimado_ml` columna. Deuda de modelado para complicaciones no hemorrágicas.

## Estados

```
borrador ──registrarNacimiento──► (estado se crea en 'borrador')
   │
   ├─firmar──► firmado  (MC verifica PIN argon2id) ◄── disparador outbox ece.sala_exp.firmada (drift: hoy no emite firmada-evento, solo nacimiento-evento)
   │              │
   │              └── inmutable (sin transiciones posteriores en MVP)
   │
   └── (anulación NO implementada — CHECK constraint solo admite borrador|firmado)
```

> El motor de workflow ECE (`workflow-instance.router`) podría modelar transiciones adicionales (`firmado → validado → rectificado`) si se siembra `flujo_estado` y `flujo_transicion` para tipo SALA_EXPULSION. Hoy estos no están sembrados — la tabla opera con su CHECK constraint binario.

## Transiciones

| origen | destino | rol | condición | acción tRPC |
|---|---|---|---|---|
| (nuevo) | `borrador` | MC/PHYSICIAN | Episodio hospitalario obstétrico activo + sin SALA_EXP previa para ese episodio (UNIQUE constraint) + personal_salud activo asociado | `eceSalaExpulsion.registrarNacimiento({ episodioHospitalarioId, tipoParto, nacimientoTs, presentacionFetal, mecanismoParto, ... })` |
| `borrador` | `firmado` | MC/PHYSICIAN | PIN argon2id correcto (lockout 5 intentos) + `estado_registro = 'borrador'` | `eceSalaExpulsion.firmar({ id, pin })` |
| `firmado` | — | — | inmutable (CHECK binario en BD impide cualquier otro valor) | — |
| `borrador` | (sin destino) | MC/PHYSICIAN | Append de evento al cronograma (no transición de estado) | `periodoExpulsivo.registrarEvento({ salaId, tipo, timestamp, nota?, datos? })` |

> El procedure `registrarEvento` (sub-router `periodoExpulsivoRouter`) NO transiciona estado — solo agrega al array JSONB `eventos`. Funciona tanto en `borrador` como en `firmado` (no hay guard de estado). **GAP de seguridad menor**: tras firma, idealmente los eventos también deberían ser inmutables o requerir firma de rectificación. Hoy un MC puede seguir agregando eventos a una SALA_EXP firmada.

## Eventos

Emitidos al outbox de dominio (`outbox.domain_events`) vía `emitDomainEvent` dentro de la misma transacción:

| Evento | Disparador | Aggregate | Payload (campos clave) |
|---|---|---|---|
| **`ece.nacimiento.registrado`** | `registrarNacimiento()` exitoso | `SalaExpulsion` | `{ salaExpulsionId, episodioHospitalarioId, nacimientoTs (ISO), tipoParto, rnPlaceholderId, medicoId }`. **Disparador de la cascada RN** — el módulo newborn consume `rnPlaceholderId` para abrir el expediente del RN. |
| **`ece.expulsion.hemorragia_post_parto_alerta`** | `registrarEvento({ tipo: 'alumbramiento' })` cuando Δt(alumbramiento, nacimiento) > 30 min | `SalaExpulsion` | `{ salaId, alumbramientoTs, nacimientoTs, organizationId, establecimientoId }`. Alerta clínica que alimenta el módulo de notificaciones Beta.15 (canal urgente → jefe de turno + obstetra). |
| **(propuesto) `ece.sala_exp.firmada`** | `firmar()` exitoso | `SalaExpulsion` | `{ salaExpulsionId, episodioId, mcId, firmadoEn, payloadHash }`. **NO emitido hoy** — drift de coherencia con otros documentos NTEC (HOJA_ING emite `firmada`, SALA_EXP no). Deuda Beta.15. |
| **(propuesto) `ece.sala_exp.rn_nacido_vivo`** | sintético derivado de `ece.nacimiento.registrado` cuando ATN_RN registra APGAR > 0 | `SalaExpulsion` | `{ salaExpulsionId, rnPacienteId, apgar1, apgar5 }`. Alimenta dashboard materno-infantil. |
| **(propuesto) `ece.sala_exp.nrp_requerido`** | sintético derivado de ATN_RN cuando `requirio_reanimacion = true` | `SalaExpulsion` | `{ salaExpulsionId, rnPacienteId, motivoNRP }`. Dispara `NRP` (Reanimación Neonatal) en el expediente RN. |

Suscriptores observados:

- **Módulo Recién Nacido (newborn)** — consume `ece.nacimiento.registrado` para abrir expediente RN (FICHA_IDENT del recién nacido + ATN_RN inicial) usando el `rnPlaceholderId`.
- **Audit hash chain** — `payloadHash` se enlaza al `chain_hash` previo del episodio obstétrico (NTEC §6.3, retención 10 años para casos de defunción RN).
- **Beta.15 alerting** — `ece.expulsion.hemorragia_post_parto_alerta` dispara notificación urgente (WhatsApp/SMS al jefe de turno + dashboard pulsante para obstetra y banco de sangre).
- **BI / indicadores materno-infantiles** — distribución de tipo_parto, tasa de episiotomía, tasa de cesárea (proxy desde `cesarea_emergencia`), tasa de desgarros III-IV, HPP rate.
- **Interoperabilidad RNPN (futuro)** — `nacimiento_ts` + datos del RN consolidados en ATN_RN se exportarán al Registro Nacional de Personas Naturales para el acta de nacimiento.

## Documentos dependientes (que esto habilita)

Una vez `ece.nacimiento.registrado` se emite, el motor de cascada habilita:

| Doc dependiente | Frecuencia | SLA | Rol responsable |
|---|---|---|---|
| **FICHA_IDENT del RN** | una vez | inmediato post-nacimiento | ENF / ADM. Apertura automática del expediente del recién nacido con `paciente_id` distinto del de la madre (CUN / NUI provisional). |
| **ATN_RN** (Atención del Recién Nacido) | una vez | inmediato (APGAR 1' obligatorio) | PEDIATRA / NEONATOLOGIA. Captura APGAR 1'/5'/10', Capurro, Ballard, Silverman-Andersen, Downes, antropometría, profilaxis ocular, vitamina K, vacunas inmediatas (BCG, Hep B). |
| **NRP** (Reanimación Neonatal) | condicional | inmediato si APGAR 1' ≤ 6 | NEONATOLOGIA. Cabecera de reanimación con maniobras realizadas, tiempos, medicamentos administrados al RN. |
| **EPICRISIS_OBSTETRICA** | una vez al alta materna | día de egreso | MC / Jefe de Servicio. Resumen del episodio obstétrico incluyendo SALA_EXP + PARTOGRAMA + cualquier ACTO_QX. |
| **NOTIFICACION_RNPN** (futuro) | una vez post-firma | dentro de 30 días Art. 21 Código Civil | Registro civil del establecimiento. Notificación al RNPN del nacimiento con `nacimiento_ts` + datos del RN. |

## Drift conocido

### HF-10 — columna `eventos` JSONB (audit Stream F PR #183)

**Identificado el 2026-05-19** en audit Stream F (Obstetricia). El router `periodo-expulsivo.router.ts:232-236` ejecutaba `UPDATE ece.sala_expulsion SET eventos = eventos || ${...}::jsonb` y `SELECT eventos FROM ece.sala_expulsion ...` contra una columna que **no existía en BD**. Toda escritura/lectura del cronograma de eventos fallaba con `ERROR 42703 (column does not exist)`.

**Estado al 2026-05-22**:

- `packages/database/sql/72b_sala_expulsion_eventos.sql` — ALTER TABLE con `ADD COLUMN IF NOT EXISTS eventos JSONB NOT NULL DEFAULT '[]'::jsonb`. **Idempotente y seguro de reaplicar.**
- `packages/database/sql/99_sala_expulsion_eventos_column.sql` — variante de hotfix (mismo ALTER, sin `IF NOT EXISTS` — debe ejecutarse una sola vez en proyectos que aún no aplicaron 72b). Existe redundancia entre los dos archivos por razones de orden de aplicación: 72b es el archivo canónico, 99 es el de emergencia para entornos rezagados.
- **Pendiente**: confirmar aplicación a Supabase production (`mcp__supabase__list_tables` debería mostrar la columna en `ece.sala_expulsion`). PR de aplicación referenciado como pendiente — verificar con `mcp__supabase__execute_sql` consulta `SELECT column_name FROM information_schema.columns WHERE table_schema='ece' AND table_name='sala_expulsion';`. Si la columna no aparece en producción, **HF-10 sigue siendo bloqueante operativo** para el cronómetro de UI y el cronograma de eventos.
- **Schema.prisma sin modelo `EceSalaExpulsion`**: el `schema.prisma` solo expone `EceDocumentoObstetrico` (histórico genérico con columna `salaExpulsion JSONB`) — la tabla operativa `ece.sala_expulsion` no está modelada como Prisma model. El router opera 100% en raw SQL (`prisma.$queryRaw` / `$executeRaw`). Esto es **decisión deliberada** para evitar drift Prisma vs SQL durante MVP, pero implica que `prisma.eceSalaExpulsion` NO existe y todos los accesos van por raw SQL con tipado manual (`SalaExpulsionRow` interface).

### Drift adicional (auditoría Stream F)

| ID | Severidad | Descripción | Ruta afectada |
|---|---|---|---|
| **SE-01** | P1-ALTO | No emite evento `ece.sala_exp.firmada` al firmar (inconsistencia con otros documentos NTEC). Beta.15 no recibe señal del acto de firma de SALA_EXP. | `sala-expulsion.router.ts:389-403` (procedure `firmar`) |
| **SE-02** | P1-ALTO | No hay procedure `update` — el flujo actual fuerza a `registrarNacimiento` con datos completos, sin posibilidad de corregir en estado `borrador`. En la práctica, si hubo error en `nacimientoTs` o cualquier campo, el médico debe anular el registro y crear uno nuevo — pero **anulación NO está implementada** (el CHECK constraint binario lo impide). | `sala-expulsion.router.ts` (procedure faltante) |
| **SE-03** | P2-MEDIO | El placeholder `atencion_rn_placeholder` es un UUID generado server-side **sin garantía de que el módulo newborn lo materialice** — si el flujo asíncrono falla, queda un UUID huérfano apuntando a nada. No hay job de reconciliación. | `sala-expulsion.router.ts:303-309` |
| **SE-04** | P2-MEDIO | Eventos JSONB siguen siendo modificables (append) tras firma — inconsistente con la inmutabilidad del documento principal. | `periodo-expulsivo.router.ts:207-267` (procedure `registrarEvento` sin guard de `estado_registro`) |
| **SE-05** | P2-MEDIO | `presentacion_fetal` y `mecanismo_parto` son CHECK constraints de TEXT en BD pero enum Zod en TS — duplicación que invita a drift si se agregan valores en un lado. Mejor migrar a ENUM tipado (`ece.presentacion_fetal` / `ece.mecanismo_parto`). | `72_sala_expulsion.sql:67-76` + Zod schema en router |
| **SE-06** | P3-BAJO | `tactos_vaginales` y `analgesia_obstetrica` mencionados en `analisis_workflows_ece.md` como sub-formularios pero no modelados en SALA_EXP — quedan dispersos en otros documentos o sin persistir. GAP de modelado vs spec NTEC. | `72_sala_expulsion.sql` (estructura tabla) |
| **SE-07** | P3-BAJO | Coexisten dos archivos SQL casi idénticos (`72b_*` y `99_*`) para el mismo ALTER — riesgo de confusión en aplicación futura. Consolidar. | `packages/database/sql/` |

### Coexistencia legítima (no duplicación)

- `/ece/obstetricia/expulsion` (este flujo) — Doc 14 NTEC, parto vaginal.
- `/ece/obstetricia/partograma` — vigilancia del trabajo de parto previa al expulsivo. Comparte `episodio_hospitalario_id` pero documento distinto.
- `/ece/obstetricia/` (página índice) — landing del módulo.

Sin duplicación detectada. NO hay módulo legacy HIS equivalente a documentar el parto (a diferencia de triaje o admisión) — el dominio nace en ECE.

## Descripción markdown rica

### Por qué `nacimiento_ts` es la base legal del expediente

La Hoja de Sala de Expulsión es uno de los pocos documentos del HIS donde un **único campo** (una marca temporal de un único instante) tiene **valor legal pleno**: el `nacimiento_ts` con resolución a segundo es lo que se asienta en el acta de nacimiento del Registro Nacional de Personas Naturales (RNPN). Tres consecuencias arquitectónicas:

1. **Audit hash chain no negociable** — el `payloadHash` calculado al firmar (NTEC Art. 55-56) encadena la marca temporal a la cadena criptográfica del episodio. Cualquier intento de modificar `nacimiento_ts` post-firma rompe la cadena y el verificador `auditIntegrityRouter` lo detecta. Esta es la razón por la cual el CHECK constraint binario `('borrador', 'firmado')` no admite `validado` ni `rectificado` — el estado terminal es el firmado y solo via rectificación NTEC Art. 42 se introduce una nota correctiva (sin tocar la fila original).
2. **Reloj de servidor con NTP sincronizado** — la BD debe usar `NOW()` en transacción atómica al momento exacto del nacimiento; el operador (MC) confirma el timestamp al cierre del registro pero NO digita un valor arbitrario. El router admite `nacimientoTs` como input del cliente — riesgo de manipulación intencional (registrar como nacimiento un timestamp distinto al real). **Mitigación pendiente** (Beta.15): cotejar `nacimientoTs` input contra `now()` server con tolerancia de ±5 min; si se desvía, exigir justificación documentada (parto fuera del hospital, registro retrospectivo de paciente trasladada en período expulsivo).
3. **Interoperabilidad RNPN futura** — TDR §11.6 menciona "notificación al registro civil (cuando exista interoperabilidad)". El payload de exportación al RNPN tomará `nacimiento_ts` + datos del RN consolidados en ATN_RN. El protocolo de transferencia no está definido todavía (MINSAL aún no publica especificación de la API RNPN); el contrato de eventos del HIS es agnóstico.

### Eventos JSONB para timeline operativo

El array `eventos` es el corazón del componente UI del cronómetro de cuatro fases (latente → activa → expulsiva → alumbramiento). La UI (`expulsion/page.tsx`) lo opera localmente como estado React mientras el parto está en curso y emite `registrarEvento` para cada hito clínico, manteniendo una cronología distribuida entre cliente (estado efímero del cronómetro) y servidor (persistencia inmutable).

El patrón JSONB append-only se eligió sobre tabla satélite (`ece.sala_expulsion_evento`) por dos razones pragmáticas:

1. **Latencia de UI** — el cronograma es leído frecuentemente para renderizar el timeline; un único `SELECT eventos FROM sala_expulsion WHERE id = ?` evita N+1 contra tabla satélite.
2. **Reglas de orden cronológico** — el array JSONB conserva el orden de inserción sin necesidad de columna `ordinal` ni `ORDER BY timestamp` explícito (aunque el router debería validarlo más estrictamente).

El trade-off es que **el JSONB no es indexable por tipo de evento eficientemente** (requiere `jsonb_path_query` o un índice GIN); en la práctica, las queries siempre cargan el array completo por sala y filtran en memoria. Para volúmenes esperados (5-20 eventos por parto, máximo unos cientos de partos/mes por hospital) la decisión es razonable.

### HPP — alerta de hemorragia post-parto

La alerta `ece.expulsion.hemorragia_post_parto_alerta` se dispara cuando el evento `alumbramiento` se registra con un Δt > 30 minutos desde el evento `nacimiento`. El umbral viene de NTEC Doc 14 §3.3 (sospecha de retención placentaria con riesgo de hemorragia). La emisión ocurre **dentro de la misma transacción** que el `registrarEvento`, garantizando que la alerta nunca se pierda (patrón outbox + exactly-once).

Suscriptores de la alerta:

- **Jefe de turno obstétrico** — notificación push + WhatsApp.
- **Banco de sangre** — pre-alerta para preparar reserva (las 2-4 unidades de glóbulos rojos del protocolo HPP).
- **Dashboard de sala de partos** — indicador visual pulsante.
- **Beta.15 escalation** — si no hay acuse de recibo en 5 minutos, escala al director médico de guardia.

**Importante**: la alerta no clasifica todavía la severidad (HPP leve vs masiva). Una mejora razonable (Beta.16 o post-MVP) sería emitir variantes con `nivel_alerta ∈ {sospecha, confirmada_leve, confirmada_masiva}` derivado del `sangrado_estimado_ml` registrado en la columna estructurada al firmar.

### Cesárea: por qué NO va aquí

El catálogo `ece.tipo_parto` admite `cesarea_emergencia` como un valor del enum, pero la NTEC §3.13 Acto Quirúrgico cubre formalmente la cirugía cesárea. La regla operativa institucional es:

- **Cesárea programada** (electiva, agendada con anticipación) → flujo quirúrgico estándar: HOJA_ING → CONS_INF (quirúrgico) → VAL_PREOP → CHECKLIST_QX → ACTO_QX → URPA. **NO se crea SALA_EXP**. El expediente del RN se abre desde el reporte operatorio quirúrgico (registro de hallazgos + atención inmediata del RN por neonatólogo presente en quirófano).
- **Cesárea de emergencia derivada de trabajo de parto** (la paciente ingresó por parto vaginal y derivó a cesárea urgente por sufrimiento fetal, distocia, prolapso de cordón, etc.) → **coexisten SALA_EXP (vacía o parcial, documentando el período expulsivo intentado) y ACTO_QX (la cesárea efectivamente realizada)**. El `tipo_parto = 'cesarea_emergencia'` deja constancia de la decisión clínica. Política institucional dirime si la cabecera del expediente del RN cuelga de SALA_EXP o de ACTO_QX — el módulo newborn debe ser configurable.
- **Parto vaginal post-cesárea** (VBAC — Vaginal Birth After Cesarean) → SALA_EXP estándar con `tipo_parto = 'eutocico'` o `'distocico'`. El antecedente quirúrgico se registra en HOJA_ING / antecedentes pero no condiciona el flujo del registro de parto actual.

### Cascada de habilitación post-firma

El evento `ece.nacimiento.registrado` (no `firmada` — drift SE-01) es lo que el módulo newborn consume hoy. El placeholder UUID `rnPlaceholderId` es **un compromiso atómico** del HIS: el sistema garantiza que ese UUID será el `paciente_id` del recién nacido cuando se materialice el expediente. Si el módulo newborn falla en consumir el evento por cualquier razón (downtime, cola atascada), el reintento exactly-once del outbox lo garantiza eventualmente.

La materialización del RN incluye:

1. **`ece.paciente` del RN** con `paciente_id = rnPlaceholderId`, datos mínimos del nacimiento (sexo, peso, talla — heredados de ATN_RN), `fecha_nacimiento = nacimiento_ts`, relación `madre_paciente_id` apuntando a la paciente del episodio obstétrico.
2. **`ece.episodio_atencion` neonatal** con modalidad hospitalario, episodio paralelo al de la madre (no es sub-episodio).
3. **`ATN_RN`** como cabecera del expediente neonatal con APGAR, Capurro, etc.
4. **`NRP`** solo si la atención inmediata determinó necesidad de reanimación (APGAR 1' ≤ 6 típicamente).

### Retención (Art. 34-35 NTEC)

- **Expediente RN**: retención estándar 5 años activo (Art. 34).
- **Caso de defunción RN intra-parto o neonatal**: 10 años (Art. 35). El evento `ece.expulsion.hemorragia_post_parto_alerta` no implica defunción, pero indica riesgo; el seguimiento del outcome se hace en ATN_RN + EPICRISIS_OBSTETRICA.
- **Backups y cifrado**: igual que cualquier documento NTEC (Art. 48 — cifrados, ubicación geográfica distinta).

### HF-10 como riesgo operativo del Go-Live

Mientras la columna `eventos` no esté confirmada en BD producción Supabase, el cronograma de fases del UI no puede persistir hitos clínicos (amniotomía, episiotomía intra-parto, sangrado anormal, etc.). El parto se podría registrar igualmente vía `registrarNacimiento` con campos estructurados (nacimiento_ts, tipo_parto, episiotomia bool, etc.), pero la **trazabilidad fina del evento por evento se perdería**. Para Go-Live es imprescindible verificar la presencia de la columna y ejecutar el smoke test del cronómetro completo. El comando de verificación es:

```sql
SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_schema = 'ece'
   AND table_name = 'sala_expulsion'
   AND column_name = 'eventos';
```

Si retorna 0 filas, ejecutar `72b_sala_expulsion_eventos.sql` (idempotente) vía `mcp__supabase__apply_migration`.

---

**Referencias cruzadas**:

- TDR: §11.6 (Sala de Partos / Materno-infantil), §11.7 (Egreso), §3 (Acuerdo 1616-2024 marco).
- Insumo: `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` §3.14 (Documentos Obstétricos, líneas 530-535).
- Audit: Stream F (Obstetricia) — referencias HF-01..HF-10 en el log de audit 2026-05-19.
- SQL: `packages/database/sql/72_sala_expulsion.sql` (tabla principal + RLS Cat-E), `72b_sala_expulsion_eventos.sql` (columna eventos), `99_sala_expulsion_eventos_column.sql` (hotfix HF-10).
- Router: `packages/trpc/src/routers/ece/sala-expulsion.router.ts` (CRUD + firma), `periodo-expulsivo.router.ts` (eventos JSONB + alerta HPP).
- UI: `apps/web/src/app/(clinical)/ece/obstetricia/expulsion/page.tsx` (cronómetro 4 fases + formulario nacimiento + modal PIN).
- Norma: MINSAL Acuerdo n.° 1616 (2024), Arts. 17b, 19, 23 lit. a.4, 34, 35, 39, 41 lit. c, 42, 48, 55-56. NTEC Doc 14 §3.14.
- ADR: pendiente — formalizar decisión "SALA_EXP usa raw SQL, no Prisma model" y "JSONB append-only para eventos vs tabla satélite".
- Documentos hermanos: `docs/flujos/HOJA_ING.md`, `docs/flujos/ATN_EMERG.md` (cascada del episodio).
