# RECT — Rectificación de Documento Firmado

## Metadata

- **codigo**: `RECT`
- **nombre**: Rectificación de Documento Firmado (enmienda controlada)
- **modalidad**: `TRANSVERSAL` — aplica a cualquier documento firmado e inmutable del ECE (clasificación NTEC `historico`), tanto ambulatorio como hospitalario y quirúrgico.
- **NTEC artículo**: **Art. 42 NTEC** (rectificación trazable de datos inexactos sin borrar el original) — en complemento con **Art. 40 NTEC** (inmutabilidad de la firma electrónica) y **Art. 4.14 NTEC** (versionado del expediente). Norma fuente: Acuerdo n.° 1616 MINSAL (D.O. T.444 N°158, 22/08/2024; reforma D.O. n.°55 T.450, 19/03/2026). Soporte legal del derecho del paciente: **Ley de Protección de Datos Personales (Arts. 9 y 18)** — derecho ARCO de rectificación.
- **modulo_his_target**: `/ece/rectificacion` (listado transversal) + `/ece/rectificacion/nueva` (wizard) + `/ece/rectificacion/[id]` (detalle) + integración como acción contextual en cada documento firmado (`Rectificar este documento`).
- **tabla_datos**: `ece.rectificacion` (modelo Prisma `EceRectificacion` — packages/database/prisma/schema.prisma L5492-5511) con FK a `ece.documento_instancia.id` (cualquier documento del ECE). Tabla complementaria: `ece.solicitud_arco` (modelo `SolicitudArco`, schema `ece`) cuando la rectificación nace de una **solicitud del paciente** (US.F2.7.44).
- **inmutable**: `true` — la rectificación misma es un registro inmutable post-firma. El **documento original NO se modifica**: queda intacto con una **anotación enlazante** que apunta a la rectificación.
- **tipo_registro**: `CONDICIONAL` — solo procede cuando (a) se detecta un error material o de contenido en un documento firmado, **y** (b) el documento original es de naturaleza inmutable (no se puede editar), **y** (c) el error tiene impacto clínico, legal, administrativo o estadístico que justifica corregirlo dentro del expediente (no por anotación informal).

---

## Propósito normativo

El **Art. 40 NTEC** establece que un documento firmado electrónicamente es **inmutable**: ni el contenido clínico, ni los diagnósticos, ni las firmas pueden modificarse después del acto firmante. Esta inmutabilidad es la base del **valor probatorio del expediente electrónico** como descargo médico-legal y como fuente primaria de vigilancia epidemiológica (Art. 4.14 NTEC).

Sin embargo, los documentos clínicos reales contienen errores: un signo vital tecleado en columna invertida, un código CIE-10 equivocado, una fecha de procedimiento mal capturada, un nombre del paciente con dígito invertido, un valor de laboratorio adjuntado al expediente equivocado, una causa básica de defunción que omite una condición concomitante luego identificada por el médico tratante. Negar la posibilidad de corregir estos errores convertiría la inmutabilidad en una herramienta contra la verdad clínica y contra el derecho ARCO de **rectificación** del paciente (LPDP Arts. 9 y 18).

El **Art. 42 NTEC** resuelve esta tensión definiendo el mecanismo de **rectificación trazable**:

1. **El documento original NO se modifica.** Queda inmutable.
2. Se emite un **documento nuevo** (la rectificación) que captura: el campo afectado, el valor anterior, el valor corregido, la justificación clínico-administrativa, la firma del autor original (o de su superior si no está disponible) y el timestamp completo.
3. El documento original recibe una **anotación enlazante** ("Este documento tiene rectificación: ver RECT-XXX") que es **visible** en toda visualización futura del original.
4. La rectificación misma es **inmutable** una vez firmada — no se puede rectificar una rectificación; se emite una rectificación adicional si fuera necesario corregir la corrección (cadena de rectificaciones).
5. Cuando el error afecta **reportes oficiales** (mortalidad SNIS, morbilidad reportable, expediente único institucional ISSS), la rectificación dispara la **re-emisión del reporte** con el dato corregido.

Esta arquitectura garantiza simultáneamente: (a) que el dato clínico vigente sea **correcto**, (b) que el dato original capturado quede **preservado** para auditoría e investigación de quién erró cuándo y por qué, (c) que la **bitácora** registre cada acto de rectificación (Art. 55-56 NTEC), y (d) que el **derecho ARCO** del paciente sea ejercible sobre datos personales inexactos.

La rectificación es un mecanismo **distinto** de:

- **Supresión** (Art. 43 NTEC / modelo `EceSupresion`): inhabilita datos inadecuados o excesivos con autorización del director médico — no corrige, **inhabilita**.
- **Adendum** (práctica habitual en consentimientos informados, Art. 40 NTEC): emite un documento adicional **complementario** sin cambiar valores existentes — agrega información, no corrige error.
- **Cierre fallido + reapertura** (operativo en `HOJA_ING`, `EPI_EGR`): solo aplica antes de la firma; una vez firmado el documento, el único camino de corrección es la rectificación.

---

## Dependencias

- **`Documento original FIRMADO`** — obligatorio. La rectificación referencia (`instancia_id`) una instancia de `ece.documento_instancia` cuyo estado sea **`firmado`** o posterior (`validado`, `cerrado`). No procede rectificar un documento en `borrador` — en ese caso se edita directamente. Documentos típicamente rectificables (no exhaustivo):
  - `HC_AMB` / `HIST_CLIN` (historia clínica)
  - `IND_MED` (indicación médica firmada)
  - `EPI_EGR` (epicrisis de egreso firmada)
  - `ACT_QX` (descripción operatoria, registro anestésico)
  - `CERT_DEF` (certificado de defunción — caso especial: requiere notificación SNIS)
  - `HOJA_ING` (hoja de ingreso cerrada)
  - `RRI` (referencia/retorno firmada y enviada)
  - `RES_EST` (resultado de estudio firmado)
  - `SV` (signos vitales firmados)
  - `REG_ENF` (registro de enfermería firmado)
- **`FICHA_ID`** — siempre (raíz del expediente; el documento original que se rectifica está vinculado al paciente vía su episodio).
- **Justificación clínico-administrativa** — texto libre que documenta **por qué** existe el error y **por qué** la corrección es necesaria. Obligatorio (campo `justificacion` NOT NULL en el modelo).
- **Disponibilidad del autor original** — si el autor original (`ejecutadaPorId`) ya no está activo en la institución, debe firmar el **superior jerárquico** o el **director médico** (ver §Roles firmantes).

Excepciones documentadas:

- **Consentimiento informado (`CONS_INF`)**: no admite rectificación de **contenido** (procedimiento descrito, riesgos, alternativas, firma del paciente) — Art. 40 NTEC + restricción `analisis_workflows_ece.md` línea 481: *"inmutable tras la firma; no admite rectificación de contenido"*. Sí admite rectificación de **metadatos administrativos no constitutivos** (ej. fecha mal capturada del establecimiento) cuando la justificación lo amerite y con doble firma. Para corregir contenido constitutivo: se emite un **nuevo consentimiento** y se anula el anterior por flujo de comité.
- **Documentos clínicos asociados no inmutables (Art. 37 NTEC)**: registros operativos como Registro Diario de Consultas, tabuladores, hojas de cargo — no requieren rectificación formal; se corrigen en edición directa con bitácora estándar.

---

## Obligatoriedad

| Situación | ¿Procede RECT? | Justificación |
|---|---|---|
| Error material en documento firmado con **impacto clínico** (dosis, alergia, diagnóstico) | **SI obligatorio** | Seguridad del paciente + Art. 42 NTEC |
| Error en código CIE-10 reportado a SNIS (mortalidad/morbilidad) | **SI obligatorio** + notificación SNIS | Art. 42 NTEC + Ley SNIS Arts. 24-26 |
| Error en datos del paciente (nombre, DUI, fecha nacimiento) en documento firmado | **SI obligatorio** | LPDP Art. 9 (derecho ARCO de rectificación) |
| Error en certificado de defunción (causa básica, lugar, fecha) | **SI obligatorio** + re-emisión SNIS | Art. 42 NTEC + obligación estadística |
| Error en epicrisis de egreso (tipo de egreso, circunstancia de alta) | **SI obligatorio** | Art. 17b + 42 NTEC |
| Error tipográfico **sin impacto** clínico/legal en texto libre (ej. acento, coma) | **NO** — anotación informal o ignorar | No justifica el costo administrativo |
| Cambio de criterio clínico post-firma (no es error, es evolución) | **NO** — se emite **nota evolutiva nueva**, no rectificación | Rectificar es corregir lo erróneo, no actualizar lo vigente |
| Solicitud ARCO del paciente sobre dato inexacto | **SI obligatorio** (vía `SolicitudArco` → ejecuta `RECT`) | LPDP Art. 9, US.F2.7.44 |
| Contenido constitutivo de Consentimiento Informado firmado | **NO** — se emite nuevo `CONS_INF` y se anula el anterior | Art. 40 NTEC §inmutabilidad |
| Documentos del Art. 37 NTEC (RDC, tabuladores) | **NO** — edición directa con bitácora | No tienen el régimen de inmutabilidad |

---

## Roles firmantes

| Rol | Acción | Momento | Mecanismo |
|---|---|---|---|
| **AUTOR_ORIGINAL** del documento a rectificar (médico tratante, enfermera responsable, etc.) | Detecta el error, **solicita** la rectificación y **firma** con PIN electrónico | Cuando se identifica el error | PIN electrónico (argon2id) contra `ece.firma_electronica` |
| **SUPERIOR_JERARQUICO** o **JEFE_SERVICIO** | Sustituye al autor original cuando éste ya no está activo en la institución | Solo si autor original no disponible | Mismo PIN electrónico; la justificación debe documentar **por qué** firma el superior |
| **DIRECTOR_MEDICO** o **COORDINADOR_ASISTENCIAL** | **Aprueba** la rectificación cuando el `impacto_clinico_o_legal` es `MEDIO`, `ALTO` o `REPORTE_OBLIGATORIO` | Después de la firma del autor original | PIN electrónico — segunda firma obligatoria en alto impacto |
| **OFICIAL_SNIS** / **EPIDEMIOLOGO** institucional | **Notificado** automáticamente cuando la rectificación afecta reporte oficial (CIE-10 de mortalidad/morbilidad, vigilancia epidemiológica obligatoria) | Post-firma del director médico | Evento `rect.snis_notificada` + tarea de re-emisión de reporte |
| **PACIENTE** (solo en flujo ARCO) | **Solicita** la rectificación (a través de admisión/atención al paciente) — no firma la rectificación misma | Pre-flujo (alimenta `SolicitudArco`) | No firma electrónica; firma manuscrita o autenticación de identidad documentada |

> **Doble firma**: cuando el impacto es `MEDIO`, `ALTO` o `REPORTE_OBLIGATORIO`, la rectificación requiere **dos firmas electrónicas**: autor original (o superior) **+** director médico. En impacto `NINGUNO` o `BAJO` basta la firma del autor original.

> **Conflicto de interés**: si el director médico es **el mismo** que el autor original del documento, la aprobación recae en el director de la **subred** o autoridad inmediatamente superior — el sistema bloquea la auto-aprobación.

---

## Campos obligatorios

Mapeo al modelo Prisma `EceRectificacion` (schema `ece`, tabla `ece.rectificacion`) y campos de proceso adicionales que el wizard debe capturar:

- `instancia_id` (UUID, FK `ece.documento_instancia.id`) — **obligatorio**. Link al documento original.
- `tabla` (VARCHAR 80) — **obligatorio**. Nombre de la tabla satélite que contiene el dato a rectificar (ej. `historia_clinica`, `certificado_defuncion`, `epicrisis_egreso`, `signos_vitales`). Permite que la corrección sepa **dónde** se guardó el valor original.
- `registro_id` (UUID) — **obligatorio**. PK del registro específico dentro de `tabla` (ej. id de la fila de `ece.signos_vitales` que tiene el dato erróneo).
- `campo` (VARCHAR 100) — **obligatorio**. Nombre del campo a rectificar (ej. `tension_arterial_sistolica`, `causa_basica_cie10`, `fecha_egreso`).
- `valor_anterior` (TEXT, nullable) — texto serializado del valor original. NULL solo cuando el campo era NULL en el original (raro).
- `valor_nuevo` (TEXT, nullable) — texto serializado del valor corregido. NULL si la rectificación es para **suprimir** un valor que se introdujo por error (ej. dato adjuntado al expediente equivocado) — caso límite que más típicamente se canaliza por `EceSupresion`.
- `justificacion` (TEXT) — **obligatorio**. Descripción libre que documenta: (a) qué error se detectó, (b) cómo se detectó, (c) por qué la corrección es necesaria, (d) si afecta reportes oficiales.
- `solicitada_por` (VARCHAR 100, nullable) — origen de la solicitud: `AUTOR_PROPIO`, `JEFE_SERVICIO`, `AUDITORIA_INTERNA`, `SOLICITUD_ARCO_PACIENTE`, `OFICIAL_SNIS`, `OTRO`. Cuando es `SOLICITUD_ARCO_PACIENTE`, debe contener el id de la `SolicitudArco`.
- `ejecutada_por` (UUID, FK `ece.personal_salud.id`) — **obligatorio**. Personal de salud que firma electrónicamente la rectificación (autor original o superior jerárquico).
- `ejecutada_en` (TIMESTAMPTZ) — **automático** (`@default(now())`). Timestamp completo a nivel segundo (Art. 55-56 NTEC).

Campos adicionales de proceso (capturados por el wizard, persistidos en columnas extendidas o JSONB de metadatos):

- `documento_original_codigo` — código del workflow (`HC_AMB`, `IND_MED`, `CERT_DEF`, `EPI_EGR`, `ACT_QX`, etc.).
- `error_detectado` — descripción breve (1..500 chars) — duplica/resume `justificacion` para listados.
- `impacto_clinico_o_legal` — enum: `NINGUNO | BAJO | MEDIO | ALTO | REPORTE_OBLIGATORIO`. Determina si requiere doble firma y si dispara notificación SNIS.
- `aprobacion_director_medico` — `SI | NO | NO_REQUERIDA` + comentario opcional. NO_REQUERIDA cuando impacto ≤ BAJO.
- `firma_autor_original_ref` — referencia a `ece.firma_electronica` del autor.
- `firma_director_medico_ref` — referencia a `ece.firma_electronica` del director (nullable si NO_REQUERIDA).
- `reporte_snis_afectado` — boolean. Cuando true, dispara evento `rect.snis_notificada`.
- `rectificacion_previa_id` — UUID nullable. Cuando se rectifica una rectificación previa (cadena de rectificaciones), apunta al registro anterior.

---

## Estados

```
SOLICITADA
  -> EN_APROBACION (cuando impacto MEDIO/ALTO/REPORTE_OBLIGATORIO; salta a FIRMADA si impacto NINGUNO/BAJO)
  -> APROBADA | RECHAZADA
  -> FIRMADA (terminal — la rectificación queda firme; original sigue inmutable PERO con anotación enlazante)
  -> NOTIFICADA_SNIS (post-FIRMADA cuando reporte_snis_afectado=true)
```

Estados detallados:

- **`SOLICITADA`**: registro creado por el autor original (o solicitante ARCO). Captura `error_detectado`, `campo`, `valor_anterior`, `valor_nuevo`, `justificacion`, `impacto_clinico_o_legal`. Aún sin firma electrónica.
- **`EN_APROBACION`**: notificación al director médico. El director revisa la justificación y decide. Aplica solo cuando `impacto_clinico_o_legal ∈ {MEDIO, ALTO, REPORTE_OBLIGATORIO}`. En impactos menores el wizard salta directo a `FIRMADA` tras la firma del autor.
- **`APROBADA`**: director médico aprueba con comentario. Listo para firma final del autor original.
- **`RECHAZADA`**: director médico rechaza con motivo. Terminal en esta cadena; si el autor insiste, debe iniciar una **nueva** solicitud con justificación ampliada.
- **`FIRMADA`**: el autor original (o superior) firma electrónicamente. La rectificación es ahora **inmutable**. El sistema:
  - Activa la **anotación enlazante** en el documento original ("Este documento tiene rectificación: RECT-{id}").
  - Registra evento `rect.firmada`.
  - Si `reporte_snis_afectado=true`, encola `rect.snis_notificada` y crea tarea para el oficial SNIS.
- **`NOTIFICADA_SNIS`**: la oficina de estadística institucional re-emitió el reporte oficial con el dato corregido (cuando aplica). Estado informativo terminal.

> **Cadena de rectificaciones**: si una rectificación firmada contiene a su vez un error, no se "edita" — se emite una **nueva rectificación** que apunta a la anterior (`rectificacion_previa_id`) y al mismo registro original. La trazabilidad histórica completa queda preservada.

---

## Transiciones

| origen | destino | rol | condición |
|---|---|---|---|
| (nuevo) | `SOLICITADA` | AUTOR_ORIGINAL o JEFE_SERVICIO o (sistema, cuando viene de `SolicitudArco`) | Documento original existe y está en estado `firmado/validado/cerrado` |
| `SOLICITADA` | `EN_APROBACION` | sistema (automática) | `impacto_clinico_o_legal ∈ {MEDIO, ALTO, REPORTE_OBLIGATORIO}` |
| `SOLICITADA` | `FIRMADA` | AUTOR_ORIGINAL | `impacto_clinico_o_legal ∈ {NINGUNO, BAJO}` + firma electrónica del autor |
| `EN_APROBACION` | `APROBADA` | DIRECTOR_MEDICO | Aprobación con comentario; firma electrónica del director registrada |
| `EN_APROBACION` | `RECHAZADA` | DIRECTOR_MEDICO | Rechazo con motivo (terminal) |
| `APROBADA` | `FIRMADA` | AUTOR_ORIGINAL o SUPERIOR_JERARQUICO | Firma electrónica final del autor |
| `FIRMADA` | `NOTIFICADA_SNIS` | sistema (automática) o OFICIAL_SNIS | `reporte_snis_afectado=true` y re-emisión de reporte oficial completada |

**Bloqueos transversales**:

- No se puede transicionar a `FIRMADA` si el documento original cambió de estado y ya **no es inmutable** (caso edge: borrador re-abierto antes de aprobar la rectificación) — el sistema cancela la solicitud y notifica.
- No se puede aprobar la propia rectificación: si el director médico es el `ejecutada_por`, la transición `EN_APROBACION → APROBADA` se delega al director de subred o autoridad superior.
- Una vez `FIRMADA`, no hay transiciones reversibles — para corregir, emitir nueva rectificación encadenada.

---

## Eventos

Eventos de dominio publicados (`packages/contracts/src/events`) — el motor de workflow ECE los consume para auditoría, notificaciones y orquestación:

- **`rect.solicitada`** — emitido al crear el registro. Payload: `{ rectificacionId, documentoOriginalId, documentoOriginalCodigo, campo, valorAnterior, valorNuevo, impacto, solicitadaPor, autorOriginalId }`. Consumidores: bitácora de accesos (Art. 55-56), notificación al director (si impacto MEDIO+).
- **`rect.en_aprobacion`** — emitido en transición a `EN_APROBACION`. Payload: `{ rectificacionId, directorAsignadoId, impacto }`. Consumidor: bandeja del director médico.
- **`rect.aprobada`** — emitido cuando el director firma aprobación. Payload: `{ rectificacionId, directorId, comentario, firmaRef }`. Consumidor: notifica al autor original que puede firmar.
- **`rect.rechazada`** — emitido cuando el director rechaza. Payload: `{ rectificacionId, directorId, motivo }`. Consumidor: notifica al solicitante; si la solicitud venía de `SolicitudArco`, actualiza el estado de la solicitud ARCO a `RECHAZADA` con motivo derivado.
- **`rect.firmada`** — emitido cuando el autor original firma la rectificación. Payload: `{ rectificacionId, documentoOriginalId, autorId, firmaRef, reporteSnisAfectado, impacto }`. Consumidores:
  - Activa la **anotación enlazante** en el documento original (UI lo muestra como banner permanente).
  - Bitácora de accesos.
  - Hash-chain de auditoría (`audit.audit_log`) — registro inmutable de la rectificación con SHA-256.
  - Si `reporteSnisAfectado=true`: encola `rect.snis_notificada` y crea tarea para el oficial SNIS.
- **`rect.snis_notificada`** — emitido cuando el oficial SNIS confirma re-emisión del reporte oficial afectado (mortalidad, morbilidad, vigilancia epidemiológica). Payload: `{ rectificacionId, tipoReporte, fechaReemision, oficialSnisId, referenciaExterna }`. Consumidor: cierre de la cadena; informativo en el expediente.
- **`rect.cadena_extendida`** — emitido cuando una rectificación se emite encadenada a una rectificación previa. Payload: `{ rectificacionId, rectificacionPreviaId, profundidadCadena }`. Consumidor: alerta de calidad si la profundidad excede umbral (típicamente >2 — señal de problema sistémico).

---

## Drift conocido

Hallazgos del audit Stream J (workflows ECE) y observaciones del análisis `analisis_workflows_ece.md` relacionados con rectificación:

- **Schema `ece.rectificacion` está creado y poblado por el seed `08_seed_workflows.sql`**, pero el router tRPC dedicado (`packages/trpc/src/routers/ece/rectificacion.router.ts`) **no existe aún** — la lista de routers actual (`ls packages/trpc/src/routers/ece/`) confirma su ausencia. Acción: backlog F2-S15+ debe crear el router con `crearRectificacion`, `aprobar`, `rechazar`, `firmar`, `listar`, `obtenerPorId`, `obtenerCadena`.
- **Falta UI** `/ece/rectificacion/*` — no existe ruta en `apps/web/src/app/(clinical)/ece/rectificacion/`. El wizard de 3 pasos (capturar error → revisar aprobación → firmar) está pendiente.
- **Anotación enlazante en documentos originales no implementada**: los componentes de visualización de `HC_AMB`, `EPI_EGR`, `CERT_DEF`, etc. **no consultan** todavía `ece.rectificacion` para mostrar el banner "Este documento tiene rectificación". Requiere helper compartido `useRectificacionesDelDocumento(instanciaId)` y banner común en `packages/ui`.
- **Integración con `SolicitudArco`**: el modelo `SolicitudArco` (US.F2.7.44) existe en schema con `tipo='RECTIFICACION'`, pero el "ejecutadaEn" del flujo ARCO **no encadena** automáticamente con la creación del registro `ece.rectificacion`. Requiere implementar la transición `SolicitudArco.estado: APROBADA → ejecutar RECT` con bridge transaccional.
- **Doble firma obligatoria** en impacto MEDIO+ no está enforced a nivel de base de datos. Debe agregarse trigger `ece.fn_rectificacion_requiere_doble_firma` análogo al patrón del consentimiento informado.
- **Cadena de hash de auditoría**: las inserts en `ece.rectificacion` deben dispararse en triggers `02_audit_triggers.sql` para que entren en la cadena criptográfica (`audit.audit_log`). Verificar que el SQL de hardening cubra la tabla `ece.rectificacion` — si no, agregar en próximo archivo numerado.
- **Notificación SNIS automatizada**: el evento `rect.snis_notificada` está diseñado pero el consumidor (workflow tarea → bandeja oficial SNIS) no existe; queda como deuda backlog Fase 3.
- **Bloqueo de auto-aprobación director==autor**: regla de negocio definida pero no codificada — pendiente en router cuando se cree.
- **Trigger `trg_inmutable_rectificacion`**: análogo al `trg_inmutable_consentimiento_informado`, debe bloquear UPDATE/DELETE sobre `ece.rectificacion` cuando `estado='FIRMADA'`. No existe todavía en `packages/database/sql/`.

---

## Descripción markdown rica

### Filosofía: corregir sin borrar

La rectificación es el **único mecanismo legal** para corregir un error en un documento clínico firmado electrónicamente bajo el régimen NTEC. El **Art. 40 NTEC** prohíbe modificar el contenido firmado; el **Art. 42 NTEC** habilita la rectificación trazable como solución a la tensión entre **inmutabilidad probatoria** y **verdad clínica**.

Conceptualmente: el documento original es un **hecho histórico** que se preserva exactamente como fue firmado. La rectificación es un **hecho histórico nuevo** que dice "el dato correcto es X". Ambos hechos quedan en el expediente. La presentación clínica al usuario muestra el dato **corregido** prominentemente, **con anotación visible** de que existe corrección, y permite navegar al original.

### El documento original NO se toca

Cuando el autor original (o superior) firma la rectificación:

1. **NO se ejecuta UPDATE** sobre la tabla satélite (`ece.historia_clinica`, `ece.certificado_defuncion`, etc.) — el dato original permanece intacto en la columna original. Lo que cambia es la **vista** que la aplicación construye al consultar el registro: aplica las rectificaciones firmadas sobre el snapshot original para presentar el valor corregido.
2. **NO se ejecuta DELETE** ni `soft-delete` del documento original — el registro queda con su firma original, su hash de cadena de auditoría, su `prev_hash` y `chain_hash` íntegros.
3. **SI se actualiza la `documento_instancia`** del original para reflejar que tiene rectificaciones asociadas (campo `tiene_rectificaciones=true` o conteo) — esta es una operación de **metadato administrativo**, no de contenido clínico, y no rompe la inmutabilidad bajo Art. 40.

### Banner de rectificación en la UI

Cuando un usuario abre un documento original que tiene rectificaciones firmadas:

```
+---------------------------------------------------------+
|  AVISO: Este documento tiene 1 rectificacion firmada   |
|  - Campo: causa_basica_cie10                            |
|  - Original: I21.9 (Infarto agudo de miocardio NE)      |
|  - Corregido: I21.0 (Infarto transmural pared anterior) |
|  - Firmado por: Dr. M. Lopez (Director Medico)          |
|  - Fecha: 2026-05-22 14:32:18                           |
|  - Justificacion: hallazgo histopatologico posterior    |
|  Ver detalle de rectificacion: RECT-a1b2-c3d4           |
+---------------------------------------------------------+
```

El banner es **permanente** y se renderiza en cada visualización futura del documento (consultas posteriores, impresiones, exportaciones, copias certificadas Art. 21 NTEC). Las **copias certificadas** del expediente incluyen tanto el original como las rectificaciones firmadas — si una copia certificada se emite **antes** de una rectificación posterior, la rectificación queda fuera de esa copia, lo cual es correcto: la copia retrata el expediente al momento de la certificación.

### Doble firma en alto impacto

Cuando `impacto_clinico_o_legal ∈ {MEDIO, ALTO, REPORTE_OBLIGATORIO}`:

- **Primera firma**: autor original (o superior jerárquico si autor no disponible). Captura la solicitud y la justificación.
- **Segunda firma**: director médico. Aprueba con comentario propio y firma electrónica independiente.
- **Cierre**: autor original firma la versión final aprobada (o el sistema toma la firma de solicitud como definitiva, según diseño de UX — recomendación: requerir confirmación final del autor para evitar rectificaciones aprobadas que el autor ya no sostiene).

Ejemplos de impacto **ALTO** o **REPORTE_OBLIGATORIO**:

- Corrección de causa básica en certificado de defunción (afecta mortalidad SNIS).
- Corrección de diagnóstico CIE-10 de egreso en epicrisis (afecta morbilidad SNIS, contabilidad ISSS, índices hospitalarios).
- Corrección de identidad del paciente (nombre, DUI) en documento firmado — afecta el derecho ARCO y la integridad del expediente único institucional.
- Corrección de fecha/hora de procedimiento quirúrgico (afecta facturación, estadística, peritajes).
- Corrección de medicamento/dosis en indicación médica firmada que ya se administró (alta criticidad — disparar también revisión farmacovigilancia).

Ejemplos de impacto **BAJO** o **NINGUNO**:

- Error tipográfico en texto libre sin valor clínico (acento, coma, espacio).
- Corrección de campo administrativo no constitutivo (número de habitación interno).
- Corrección de redacción sin cambio de significado.

### Reportes oficiales SNIS y re-emisión

Cuando `reporte_snis_afectado=true`, la firma de la rectificación dispara:

1. Evento `rect.snis_notificada` (planificado).
2. Tarea automática en bandeja del oficial SNIS / epidemiólogo institucional.
3. Identificación del reporte oficial afectado (mortalidad mensual, vigilancia obligatoria, estadística trimestral) y de la fecha de cierre del periodo reportado.
4. Re-emisión del reporte oficial con el dato corregido, manteniendo trazabilidad del reporte original (no se sobrescribe — se emite versión `R1`, `R2`, etc.).
5. Notificación a SNIS / MINSAL con la justificación de la corrección.

Casos típicos:

- **Mortalidad**: rectificación de causa básica en certificado de defunción => re-emisión del bloque de mortalidad del mes correspondiente.
- **Morbilidad**: rectificación de diagnóstico CIE-10 de egreso => actualización del reporte de morbilidad hospitalaria.
- **Vigilancia epidemiológica**: rectificación de caso reportable (dengue, COVID, tuberculosis) => actualización del sistema de vigilancia.

### Cadena de rectificaciones (poco frecuente, importante modelar)

Una rectificación firmada **no se rectifica directamente**: se emite una **nueva rectificación** que (a) apunta al mismo documento original, (b) referencia la rectificación previa vía `rectificacion_previa_id`, (c) corrige el dato. La UI presenta al usuario la **versión vigente** (la cadena más reciente firmada) con anotación del número total de rectificaciones en la cadena. Si la profundidad supera un umbral (típicamente 2 rectificaciones para el mismo campo), el sistema dispara alerta de calidad — esto típicamente indica un problema sistémico (ej. dato mal capturado por interfaz defectuosa de un equipo médico).

### Integración con derecho ARCO del paciente

El **paciente** (o representante legal) tiene derecho a **solicitar la rectificación** de datos personales inexactos en su expediente (LPDP Arts. 9 y 18). El flujo es:

1. Paciente presenta solicitud en admisión / atención al usuario.
2. Se registra `SolicitudArco` con `tipo='RECTIFICACION'`, `documento_target=<nombre del documento>`, `motivo`.
3. Estado inicial: `PENDIENTE` → revisión por personal autorizado.
4. Si procede: estado `APROBADA` → ejecuta automáticamente la creación de `ece.rectificacion` con `solicitada_por='SOLICITUD_ARCO_PACIENTE'` y referencia a la `SolicitudArco`.
5. La rectificación sigue su ciclo normal (firma del autor, aprobación director si impacto alto).
6. Cuando la rectificación pasa a `FIRMADA`, la `SolicitudArco` pasa a `EJECUTADA`.
7. Notificación al paciente del resultado (canal según preferencia: email, SMS, presencial).

Si la solicitud del paciente es **rechazada** por personal autorizado (ej. el dato cuestionado **no es inexacto** — el paciente discrepa con el diagnóstico clínico, no hay error material), la `SolicitudArco` pasa a `RECHAZADA` con `motivo_respuesta` documentado, y el paciente puede ejercer recurso ante la autoridad reguladora correspondiente.

### Bitácora y cadena de hash criptográfica

Toda operación sobre `ece.rectificacion` se registra en:

- **Bitácora de accesos** (`ece.bitacora_acceso`) — Art. 55-56 NTEC, 2 años mínimo.
- **Cadena hash inmutable** (`audit.audit_log`) — TDR §6.3, 10 años mínimo, con `prev_hash`, `payload_hash`, `chain_hash` SHA-256. El router de verificación de cadena (`auditIntegrityRouter`) puede revalidar la cadena en cualquier momento; cualquier alteración no autorizada de la tabla es detectable.

### Conservación

- Rectificaciones de documentos del **expediente clínico** (Art. 4.14 NTEC): conservación equivalente al expediente — **10 años post última atención** (régimen del Acuerdo 1616 MINSAL).
- Rectificaciones de **certificados de defunción**: conservación permanente (vital record).
- Rectificaciones derivadas de **solicitud ARCO**: registro de la solicitud ARCO en `ece.solicitud_arco` con misma retención + rectificación con retención de expediente.

### Resumen ejecutivo para implementación

| Aspecto | Decisión |
|---|---|
| ¿Se modifica el documento original? | **NO** — queda intacto |
| ¿Cómo se hace visible la corrección? | Banner permanente + anotación enlazante |
| ¿Quién firma? | Autor original (o superior); director médico si impacto MEDIO+ |
| ¿Cuándo es obligatoria? | Cualquier error material en documento firmado con impacto clínico/legal/estadístico |
| ¿Cuándo NO procede? | Cambio de criterio (eso es nota evolutiva nueva) o contenido constitutivo de CONS_INF (eso es nuevo consentimiento) |
| ¿Afecta SNIS? | Sí, cuando dato afecta reporte oficial — dispara re-emisión |
| ¿Es inmutable la rectificación misma? | Sí — para corregir error en rectificación se emite **nueva** rectificación encadenada |
| ¿Integra con derecho ARCO? | Sí — `SolicitudArco.tipo='RECTIFICACION'` ejecuta `ece.rectificacion` cuando se aprueba |
| ¿Existe el router tRPC? | **NO** — pendiente backlog (drift conocido) |
| ¿Existe la UI? | **NO** — pendiente backlog (drift conocido) |
