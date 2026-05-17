# E.F2.7 — Cumplimiento, Firma Electrónica, RBAC y Auditoría

> **Épica:** Expediente Clínico Electrónico — Controles normativos transversales
> **Release objetivo:** Fase 2 — Sprint 4-6
> **Propietario:** @PO
> **Trazabilidad normativa base:** Norma Técnica del Expediente Clínico, Acuerdo n.° 1616 MINSAL (D.O. T.444, N°158, 22/08/2024); Ley Protección de Datos Personales; Ley SNIS Arts. 24-26.

---

## Visión

Garantizar que el ECE de Avante Complejo Hospitalario cumpla íntegramente con la NTEC y la legislación salvadoreña vigente: firma electrónica simple con valor legal, inmutabilidad criptográfica, trazabilidad completa de accesos, control de acceso por perfil, certificación restringida, contingencia operativa, conservación diferenciada y codificación CIE-10.

---

## Definition of Ready (DoR)

- Tablas `ece.firma_electronica`, `ece.bitacora_acceso`, `ece.rectificacion`, `ece.perfil_acceso`, `ece.personal_salud` desplegadas en Supabase.
- Triggers de inmutabilidad (`fn_bloquea_mutacion`) y auditoría (`fn_audita_insert`) activos.
- Catálogos CIE-10 (4 dígitos) importados.
- RLS habilitado en tablas del schema `ece`.
- Router tRPC usando `withTenantContext` para toda operación tenant-scoped.
- Ambiente de preview Vercel activo.

## Definition of Done (DoD)

- Todos los criterios Gherkin pasan en QAF.
- Tests unitarios y E2E con cobertura >= 80%.
- `npm run typecheck` y `npm run lint` sin errores.
- RLS verificado: ningún rol accede a datos de otro establecimiento.
- Entrada en matriz de trazabilidad (`docs/backlog/fase2/trazabilidad.md`).
- Review @QA aprobado.
- Artículos NTEC cubiertos documentados en encabezado de cada PR.

---

## KPIs de Producto

| KPI | Meta | Medición |
|---|---|---|
| Cobertura de firma electrónica | 100% de documentos firmables con FES | Query `documento_instancia WHERE requiere_firma AND firma_id IS NULL` |
| Integridad bitácora | 0 accesos sin registro | Alerta si `bitacora_acceso` tiene gap > 0 en ventana 1h |
| Rectificaciones vs. eliminaciones | 0 DELETE directos en tablas históricas | Monitor trigger violations |
| Cumplimiento retención | 0 expedientes vencidos sin acción supervisada | Job nocturno con reporte |
| Tiempo promedio firma PIN | < 8 segundos (P95) | RUM en modal firma |
| Bloqueos por PIN fallido | Alerta si > 3 bloqueos/día/usuario | Dashboard SRE |

---

## Sección 1 — Firma Electrónica Simple

> Fundamento: Art. 4.17, Art. 23 lit. a.4 NTEC
> Mecanismo: PIN 6 dígitos + hash SHA-256 + IP + user_agent + timestamp; vínculo único e innegable usuario↔acto.

---

### US.F2.7.1 — Configurar PIN de firma electrónica

**Como** profesional de salud,
**quiero** configurar mi PIN de 6 dígitos al activar mi cuenta,
**para** contar con una firma electrónica simple con valor legal conforme al Art. 23 lit. a.4 NTEC.

**Criterios de aceptación:**

```gherkin
Feature: Configuración de PIN de firma electrónica

  Scenario: Primer acceso — flujo de configuración obligatoria
    Given el profesional "Dr. García" inicia sesión por primera vez
    And no tiene PIN configurado en ece.firma_electronica
    When el sistema detecta la ausencia de PIN
    Then redirige a la pantalla "Configurar firma electrónica" antes de cualquier otra acción
    And el sistema muestra los requisitos: 6 dígitos, no secuencial, no repetitivo

  Scenario: PIN válido configurado correctamente
    Given el Dr. García está en la pantalla de configuración de PIN
    When ingresa "483920" como PIN y lo confirma
    Then el sistema almacena argon2id(PIN) en ece.firma_electronica.hash_credencial
    And muestra confirmación "Firma electrónica activada"
    And registra el evento en ece.bitacora_acceso con tipo_acceso = 'configuracion_firma'

  Scenario: PIN débil rechazado
    Given el Dr. García está configurando su PIN
    When ingresa "123456" (secuencial) o "111111" (repetitivo)
    Then el sistema rechaza con mensaje "PIN no cumple los requisitos de seguridad"
    And no almacena ningún hash
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** `ece.firma_electronica`, `ece.personal_salud`, auth Supabase
**Trazabilidad normativa:** analisis §3 metadatos obligatorios; Art. 4.17, Art. 23 lit. a.4 NTEC
**Trazabilidad GS1:** N/A
**Notas técnicas:** Hash con argon2id (ya definido en `02_seguridad_personal.sql`). Endpoint tRPC `firma.configurarPin`. Nunca almacenar PIN en claro ni en logs.

---

### US.F2.7.2 — Modal "Confirme con PIN" antes de firmar

**Como** profesional de salud,
**quiero** ver un modal de confirmación con PIN antes de que cualquier documento quede firmado,
**para** que mi firma sea un acto consciente e innegable (Art. 23 lit. a.4 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Modal de confirmación de firma

  Scenario: Firma de historia clínica con PIN correcto
    Given el Dr. García completó una historia clínica
    When presiona "Firmar documento"
    Then aparece modal "Confirme su firma con PIN" mostrando: nombre del documento, fecha/hora, IP de sesión
    When ingresa su PIN correcto "483920"
    Then el sistema valida argon2id(PIN) contra hash almacenado
    And crea registro en documento_instancia con firma_id vinculado
    And almacena SHA-256(payload || personal_id || timestamp || ip) como evidencia
    And cierra el modal y muestra badge "Firmado"

  Scenario: PIN incorrecto — intento fallido
    Given el modal de firma está abierto
    When el Dr. García ingresa un PIN incorrecto
    Then el sistema muestra "PIN incorrecto. Intentos restantes: 4"
    And registra intento fallido en ece.bitacora_acceso con autorizado = false

  Scenario: Cache de 15 minutos activo
    Given el Dr. García firmó exitosamente hace 10 minutos en la misma sesión
    When presiona "Firmar" en otro documento
    Then el modal no solicita PIN nuevamente
    And aplica la firma usando el token de sesión cacheado
    And registra el uso del cache en bitácora

  Scenario: Cache expirado — solicita PIN de nuevo
    Given han pasado 16 minutos desde la última firma del Dr. García
    When presiona "Firmar"
    Then el modal solicita PIN nuevamente
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.1, componente `<FirmaModal>` en `packages/ui`
**Trazabilidad normativa:** Art. 4.17, Art. 23 lit. a.4 NTEC; §5 restricciones transversales
**Notas técnicas:** Cache client-side en memoria (no localStorage) con TTL 15 min. Hash del acto: `SHA-256(JSON.stringify(payload) + personal_id + clock_timestamp + ip_origen)`.

---

### US.F2.7.3 — Bloqueo tras 5 intentos fallidos de PIN

**Como** administrador del sistema,
**quiero** que el sistema bloquee automáticamente la firma electrónica tras 5 intentos fallidos consecutivos,
**para** proteger la identidad del profesional ante accesos no autorizados (Art. 23 lit. f NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Bloqueo por intentos fallidos de PIN

  Scenario: Bloqueo automático al quinto intento
    Given el Dr. García tiene 4 intentos fallidos consecutivos registrados
    When ingresa un PIN incorrecto una vez más
    Then el sistema bloquea su firma_electronica (vigente = false, revocada_en = now())
    And muestra "Firma bloqueada. Contacte al administrador o use el enlace de recuperación."
    And envía notificación al rol ADM del establecimiento

  Scenario: Contador se reinicia tras firma exitosa
    Given el Dr. García tiene 3 intentos fallidos
    When ingresa su PIN correcto
    Then el sistema reinicia el contador de intentos a 0
    And no bloquea la cuenta

  Scenario: Administrador desbloquea firma
    Given la firma del Dr. García está bloqueada
    And el ADM "admin@avante.sv" tiene rol con permiso 'administra_firma'
    When el ADM accede a "Gestión de personal > Dr. García > Desbloquear firma"
    And confirma con su propia firma (doble factor)
    Then se reactiva vigente = true en ece.firma_electronica
    And se registra el desbloqueo en bitacora_auditoria
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.2, campo `intentos_fallidos` en `ece.firma_electronica` (agregar columna)
**Trazabilidad normativa:** Art. 23 lit. f NTEC; §5 restricciones transversales
**Notas técnicas:** Columna `intentos_fallidos integer default 0` + `bloqueada_en timestamptz` a agregar en migración. El contador se resetea en firma exitosa.

---

### US.F2.7.4 — Recuperación de PIN vía email + MFA

**Como** profesional de salud,
**quiero** poder recuperar acceso a mi firma electrónica si olvido el PIN,
**para** no quedar bloqueado permanentemente y seguir atendiendo pacientes.

**Criterios de aceptación:**

```gherkin
Feature: Recuperación de PIN de firma

  Scenario: Solicitud de recuperación exitosa
    Given el Dr. García no recuerda su PIN
    When hace clic en "¿Olvidaste tu PIN?" en el modal de firma
    Then el sistema envía un enlace de un solo uso a su correo registrado (vigente 30 minutos)
    And registra la solicitud en bitacora_acceso con tipo_acceso = 'recuperacion_pin'

  Scenario: Enlace de recuperación usado correctamente
    Given el Dr. García recibió el enlace de recuperación
    When accede al enlace dentro de los 30 minutos
    And el sistema (opcionalmente) solicita código TOTP si MFA está habilitado
    Then muestra el formulario para configurar nuevo PIN
    And al guardar, actualiza hash_credencial y resetea intentos_fallidos
    And invalida el enlace de recuperación usado

  Scenario: Enlace expirado
    Given han pasado 35 minutos desde que se generó el enlace
    When el Dr. García intenta usarlo
    Then el sistema rechaza con "Enlace expirado. Solicite uno nuevo."
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.1, US.F2.7.3, servicio de email (Resend/SMTP configurado)
**Trazabilidad normativa:** Art. 23 NTEC (integridad del mecanismo de firma)
**Notas técnicas:** Token de recuperación: UUID v4 almacenado hasheado en tabla `ece.token_recuperacion_pin(hash, personal_id, expira_en, usado_en)`. No reutilizable.

---

### US.F2.7.5 — Auditoría del historial de firmas por profesional

**Como** director del establecimiento,
**quiero** consultar el historial completo de firmas electrónicas de un profesional,
**para** verificar la autenticidad e integridad de los actos médicos firmados (Art. 23 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Historial de firmas electrónicas

  Scenario: DIR consulta historial de un profesional
    Given el DIR "dir@avante.sv" tiene rol DIR
    When accede a "Auditoría > Firmas > Buscar por profesional: Dr. García"
    And filtra por rango de fechas "2026-05-01 a 2026-05-31"
    Then ve tabla con: documento firmado, tipo, timestamp exacto (seg), IP, hash del acto
    And puede exportar en CSV

  Scenario: Verificación de integridad de una firma
    Given el DIR visualiza el historial
    When hace clic en "Verificar" sobre una firma específica
    Then el sistema recalcula SHA-256(payload || personal_id || timestamp || ip)
    And compara con el hash almacenado
    And muestra "Firma íntegra" o "ALERTA: Hash no coincide"
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.2, rol DIR configurado
**Trazabilidad normativa:** Art. 23 lit. a.4, Art. 55-56 NTEC
**Notas técnicas:** Query sobre `documento_instancia JOIN personal_salud` filtrando por `firma_id IS NOT NULL`. Exportación CSV vía stream tRPC.

---

### US.F2.7.6 — Firma electrónica en receta GS1 (caso especial)

**Como** médico prescriptor,
**quiero** que la receta con códigos GS1/GTIN quede firmada electrónicamente de la misma forma que cualquier documento clínico,
**para** que la trazabilidad farmacéutica esté ligada al acto de prescripción del profesional.

**Criterios de aceptación:**

```gherkin
Feature: Firma electrónica en receta GS1

  Scenario: Prescripción con GTIN firmada por médico
    Given el Dr. García prescribió items con GTIN escaneado
    When presiona "Firmar receta"
    Then el modal de PIN aparece con resumen de ítems (GTIN, descripción, dosis)
    When confirma con PIN
    Then receta queda con firma_id vinculado al documento_instancia
    And el hash incluye el array de GTINs en el payload firmado

  Scenario: Receta sin firma no puede dispensarse en farmacia
    Given una receta con GTINs sin firma del prescriptor
    When el farmacéutico intenta validarla en Farmacia
    Then el sistema rechaza con "Receta no firmada. No se puede dispensar."
```

**SP:** 2 | **MoSCoW:** Must
**Dependencias:** US.F2.7.2, módulo GS1 (Streams 7-8) — solo el aspecto de firma aplica aquí
**Trazabilidad normativa:** Art. 23 NTEC; §5 restricciones transversales
**Trazabilidad GS1:** El payload firmado incluye GTINs para trazabilidad completa prescripción→dispensación

---

## Sección 2 — Inmutabilidad y Rectificación

> Fundamento: Art. 42 NTEC
> Mecanismo: Triggers Postgres bloquean UPDATE/DELETE; correcciones pasan exclusivamente por `ece.rectificacion`.

---

### US.F2.7.7 — Bloqueo de modificación directa en documentos históricos

**Como** responsable de cumplimiento,
**quiero** que el sistema bloquee físicamente cualquier intento de modificar o eliminar documentos históricos,
**para** garantizar la inmutabilidad legal del expediente (Art. 42 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Inmutabilidad de documentos históricos

  Scenario: Intento de UPDATE directo sobre consentimiento_informado
    Given existe un consentimiento_informado con id "abc-123"
    When cualquier usuario o proceso intenta UPDATE sobre esa fila
    Then Postgres lanza excepción "Documento inmutable (Art. 42 NTEC). Use el flujo de rectificación."
    And el intento queda registrado en bitacora_auditoria con operacion = 'INTENTO_MUTACION'

  Scenario: Intento de DELETE directo sobre epicrisis_egreso
    Given existe una epicrisis con id "xyz-456"
    When cualquier proceso intenta DELETE
    Then Postgres bloquea y lanza la misma excepción
    And el sistema de alertas notifica al SRE

  Scenario: Tablas protegidas confirmadas
    Given el sistema está desplegado
    Then los triggers trg_inmutable_* existen en todas las tablas históricas:
      consentimiento_informado, epicrisis_egreso, certificado_defuncion,
      acto_quirurgico, documento_instancia_historial, bitacora_acceso,
      bitacora_auditoria, rectificacion, supresion
```

**SP:** 2 | **MoSCoW:** Must
**Dependencias:** `07_auditoria_seguridad.sql` desplegado (trigger ya definido)
**Trazabilidad normativa:** Art. 42 NTEC; §5 restricciones transversales; CLAUDE.md "Audit hash chain"
**Notas técnicas:** Trigger `fn_bloquea_mutacion` ya existe en `07_auditoria_seguridad.sql`. Esta US cubre la verificación funcional + alerta SRE.

---

### US.F2.7.8 — Flujo de rectificación con motivo obligatorio y firma

**Como** médico tratante,
**quiero** poder rectificar un dato incorrecto en un documento ya firmado,
**para** corregir errores sin borrar el original, manteniendo trazabilidad completa (Art. 42 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Flujo de rectificación de documentos

  Scenario: Rectificación exitosa de diagnóstico en historia clínica
    Given el Dr. García tiene una historia clínica firmada con diagnóstico "J00" erróneo
    When accede al documento y hace clic en "Rectificar"
    Then aparece modal con: campo a rectificar, valor actual (solo lectura), campo nuevo valor, motivo obligatorio
    When ingresa motivo "Error tipográfico: código correcto es J06.9" y nuevo valor "J06.9"
    And confirma con PIN
    Then se inserta fila en ece.rectificacion con valor_anterior = "J00", valor_nuevo = "J06.9", justificacion, ejecutada_por, timestamp
    And el documento original permanece intacto
    And el documento muestra badge "Rectificado" visible para todos los usuarios con acceso

  Scenario: Rectificación sin motivo rechazada
    Given el modal de rectificación está abierto
    When el usuario deja el campo motivo vacío y presiona Confirmar
    Then el sistema rechaza con "El motivo de rectificación es obligatorio."

  Scenario: Visualización del historial de rectificaciones
    Given un documento con 2 rectificaciones registradas
    When cualquier usuario autorizado accede al documento
    Then puede ver el enlace "Ver historial de rectificaciones (2)"
    And al hacer clic ve: campo, valor anterior, valor nuevo, motivo, quién, cuándo
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.2 (PIN), US.F2.7.7, tabla `ece.rectificacion`
**Trazabilidad normativa:** Art. 42 NTEC; §5 "Inmutabilidad y rectificación trazable"
**Notas técnicas:** Badge "Rectificado" se computa con `EXISTS(SELECT 1 FROM ece.rectificacion WHERE instancia_id = ?)`.

---

### US.F2.7.9 — Visualización con badge "Rectificado" y link al original

**Como** profesional de salud,
**quiero** que los documentos rectificados muestren visualmente su estado y enlace al registro original,
**para** mantener contexto clínico completo y cumplir con la trazabilidad Art. 42 NTEC.

**Criterios de aceptación:**

```gherkin
Feature: Indicador visual de rectificación

  Scenario: Badge visible en documento rectificado
    Given la historia clínica "HC-001" tiene rectificaciones
    When cualquier usuario con acceso abre el documento
    Then ve el badge naranja "Rectificado" junto al título
    And ve el texto "Última rectificación: 2026-05-16 10:32:45 — Dr. García"
    And hay un enlace "Ver historial completo de cambios"

  Scenario: Documento sin rectificaciones no muestra badge
    Given la historia clínica "HC-002" nunca ha sido rectificada
    When un usuario la abre
    Then no aparece ningún badge de rectificación
    And el documento muestra badge "Firmado" en verde

  Scenario: Comparación de versiones
    Given el usuario hace clic en "Ver historial completo de cambios"
    Then puede seleccionar dos versiones y ver diff resaltado de los campos modificados
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.8
**Trazabilidad normativa:** Art. 42 NTEC
**Notas técnicas:** Componente `<RectificacionBadge>` en `packages/ui`. Diff usando librería `diff` de npm.

---

### US.F2.7.10 — Supresión autorizada de datos (Art. 43 NTEC)

**Como** director del establecimiento,
**quiero** poder autorizar la supresión de datos inadecuados o excesivos en el expediente,
**para** cumplir con el Art. 43 NTEC y el derecho de supresión de la Ley de Protección de Datos.

**Criterios de aceptación:**

```gherkin
Feature: Supresión autorizada de datos

  Scenario: Flujo de solicitud y autorización de supresión
    Given el paciente "Juan Pérez" solicitó supresión de datos excesivos
    When el ARCH registra la solicitud en el sistema indicando instancia_id y motivo
    Then la solicitud queda en estado "Pendiente de autorización DIR"
    And el DIR recibe notificación

    When el DIR revisa y aprueba con su firma PIN
    Then se inserta fila en ece.supresion con autorizada_por = DIR, ejecutada_en = now()
    And el campo afectado se marca como suprimido (no se borra físicamente)
    And se registra en bitacora_auditoria con operacion = 'SUPRIME'

  Scenario: Supresión rechazada por DIR
    Given una solicitud de supresión pendiente
    When el DIR la rechaza indicando motivo
    Then el estado cambia a "Rechazada" con motivo registrado
    And el solicitante recibe notificación del rechazo
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.7, tabla `ece.supresion`, rol DIR
**Trazabilidad normativa:** Art. 43 NTEC; Ley de Protección de Datos Personales Art. 18
**Notas técnicas:** La supresión no borra; marca el campo con un flag `suprimido = true` o reemplaza con valor especial `[SUPRIMIDO]`. El trigger de inmutabilidad se exime mediante `security definer` function autorizada.

---

### US.F2.7.11 — Hash chain de auditoría en ECE (integración con audit.audit_log del HIS)

**Como** responsable de cumplimiento,
**quiero** que cada inserción en tablas auditadas del ECE quede enlazada al hash chain del HIS,
**para** garantizar inmutabilidad criptográfica a 10 años (TDR §6.3, CLAUDE.md "Audit hash chain").

**Criterios de aceptación:**

```gherkin
Feature: Hash chain de auditoría ECE

  Scenario: Inserción en historia_clinica genera entrada en audit_log con hash chain
    Given el sistema tiene el trigger fn_audita_insert en historia_clinica
    When se inserta una nueva historia clínica
    Then se genera entrada en audit.audit_log con:
      prev_hash = último hash de la cadena para 'ece.historia_clinica'
      payload_hash = SHA-256(payload JSON)
      chain_hash = SHA-256(prev_hash || payload_hash)

  Scenario: Verificación de integridad de cadena no detecta roturas
    Given 100 entradas consecutivas en audit_log para ece.historia_clinica
    When auditIntegrityRouter verifica la cadena
    Then todas las entradas reportan "íntegra"
    And el reporte muestra "Cadena verificada: 100/100 entradas"
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** `audit.audit_log` del HIS (ya existe), triggers ECE del `07_auditoria_seguridad.sql`
**Trazabilidad normativa:** Art. 42 NTEC; TDR §6.3; CLAUDE.md §Audit hash chain
**Notas técnicas:** Ajustar `fn_audita_insert` para que también inserte en `audit.audit_log` o use el trigger existente del HIS según patrón establecido.

---

## Sección 3 — Bitácora de Accesos y Reportería

> Fundamento: Art. 55-56 NTEC
> Tabla: `ece.bitacora_acceso`; conservación mínima 2 años; `clock_timestamp()` a nivel segundo.

---

### US.F2.7.12 — Registro automático de toda lectura/escritura en expediente

**Como** responsable de cumplimiento,
**quiero** que el sistema registre automáticamente cada acceso (lectura, escritura, intento denegado) al expediente,
**para** tener trazabilidad completa exigida por Art. 55 NTEC.

**Criterios de aceptación:**

```gherkin
Feature: Registro automático de accesos

  Scenario: Lectura de historia clínica registrada en bitácora
    Given el Dr. García accede a la historia clínica del paciente "Juan Pérez"
    When el router tRPC ejecuta la query con withTenantContext
    Then se inserta fila en ece.bitacora_acceso con:
      personal_id = Dr. García
      componente = 'historia_clinica'
      tipo_acceso = 'lectura'
      autorizado = true
      recurso_id = id de la historia clínica
      ip_origen = IP real del request
      ocurrido_en = clock_timestamp()

  Scenario: Intento de acceso denegado registrado
    Given un usuario sin permiso intenta acceder a epicrisis_egreso
    When RLS rechaza el acceso
    Then se inserta fila en bitacora_acceso con autorizado = false
    And el sistema responde al usuario con error 403

  Scenario: Export de expediente registrado
    Given el Dr. García descarga el PDF del expediente
    When se genera el PDF
    Then se registra tipo_acceso = 'export' con recurso_id del expediente
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** `ece.bitacora_acceso` desplegada, middleware tRPC
**Trazabilidad normativa:** Art. 55 lit. a, b, c NTEC; §5 restricciones transversales
**Notas técnicas:** Middleware tRPC `bitacoraMiddleware` que intercepta todos los procedimientos del schema `ece` e inserta en bitacora_acceso. Usar `ctx.request.ip` + `X-Forwarded-For` header.

---

### US.F2.7.13 — Alerta por acceso fuera de horario o IP inusual

**Como** director del establecimiento,
**quiero** recibir alertas cuando alguien acceda al expediente fuera del horario institucional o desde una IP no habitual,
**para** detectar accesos no autorizados (Art. 56 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Alertas de acceso inusual

  Scenario: Acceso fuera de horario (22:00 - 06:00) genera alerta
    Given el horario institucional está configurado como 06:00-22:00
    When cualquier usuario accede a un expediente a las 23:15
    Then el sistema inserta el acceso en bitacora_acceso normalmente
    And envía alerta al DIR vía email/notificación con: usuario, recurso, hora, IP
    And registra la alerta en tabla ece.alerta_acceso

  Scenario: IP fuera de rangos habituales genera alerta
    Given el establecimiento tiene rangos IP configurados "192.168.1.0/24"
    When un acceso llega desde IP "200.100.50.30" (externa)
    Then el sistema genera alerta al DIR indicando IP y usuario
    And el acceso queda marcado como ip_inusual = true en bitacora_acceso

  Scenario: Múltiples accesos rápidos al mismo expediente (posible extracción masiva)
    Given un usuario accede al mismo expediente más de 20 veces en 5 minutos
    Then el sistema genera alerta de "acceso masivo sospechoso" al DIR y al SRE
```

**SP:** 5 | **MoSCoW:** Should
**Dependencias:** US.F2.7.12, servicio de email, tabla `ece.alerta_acceso` (nueva), tabla `ece.config_horario` (nueva)
**Trazabilidad normativa:** Art. 56 NTEC
**Notas técnicas:** Job Supabase Edge Function o cron que evalúa bitacora_acceso cada 15 minutos. Rangos IP configurables por establecimiento.

---

### US.F2.7.14 — Reporte "quién accedió al expediente X"

**Como** director del establecimiento,
**quiero** generar un reporte de todos los accesos a un expediente específico,
**para** responder a solicitudes del paciente (Art. 56 NTEC) o investigaciones internas.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de accesos por expediente

  Scenario: DIR genera reporte de accesos al expediente del paciente "Juan Pérez"
    Given el DIR busca el expediente por NUI o nombre
    When selecciona el expediente y solicita "Reporte de accesos"
    And filtra por rango de fechas
    Then el sistema retorna tabla con: profesional, rol, tipo_acceso, ip_origen, fecha/hora exacta, componente
    And los accesos aparecen ordenados cronológicamente descendente

  Scenario: Reporte exportable en PDF/CSV
    Given el DIR generó el reporte
    When hace clic en "Exportar PDF" o "Exportar CSV"
    Then el sistema genera el archivo con membrete del establecimiento y firma digital del sistema
    And registra la exportación en bitacora_acceso con tipo_acceso = 'export_reporte_accesos'

  Scenario: Paciente solicita reporte de accesos a su expediente (Art. 56)
    Given el paciente "Juan Pérez" accede al Portal del Paciente
    When solicita "¿Quién vio mi expediente?"
    Then ve tabla de accesos (nombre del profesional, fecha, tipo) sin datos internos sensibles
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.12, rol DIR, Portal del Paciente (Beta.20)
**Trazabilidad normativa:** Art. 56 NTEC; Ley de Protección de Datos Personales Art. 9

---

### US.F2.7.15 — Conservación de bitácora por 2 años mínimos

**Como** administrador del sistema,
**quiero** que la bitácora de accesos se conserve al menos 2 años y no pueda ser eliminada,
**para** cumplir con Art. 56 NTEC y estar preparado ante auditorías o litigios.

**Criterios de aceptación:**

```gherkin
Feature: Retención de bitácora de accesos

  Scenario: Intento de DELETE en bitacora_acceso bloqueado
    Given existe ece.bitacora_acceso con trigger trg_inmutable_bitacora_acceso
    When cualquier proceso intenta DELETE o UPDATE sobre la tabla
    Then Postgres lanza excepción de inmutabilidad
    And el intento se registra en bitacora_auditoria

  Scenario: Reporte de antigüedad de la bitácora
    Given el administrador accede a "Auditoría > Retención de bitácora"
    Then ve: total de registros, registro más antiguo, registro más reciente
    And alerta si el registro más antiguo tiene menos de 2 años (falta retención)

  Scenario: Archivado automático de registros con más de 2 años
    Given el job nocturno de retención se ejecuta
    When encuentra registros de bitacora_acceso con más de 2 años
    Then los archiva en tabla ece.bitacora_acceso_archivo (particionada) sin eliminar del origen
    And genera reporte de archivado en ece.log_archivado
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.12, trigger inmutabilidad ya en `07_auditoria_seguridad.sql`
**Trazabilidad normativa:** Art. 56 NTEC

---

### US.F2.7.16 — Dashboard de auditoría de accesos para DIR

**Como** director del establecimiento,
**quiero** un dashboard que muestre métricas de acceso al expediente en tiempo real,
**para** supervisar continuamente la seguridad del sistema (Art. 55-56 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Dashboard de auditoría de accesos

  Scenario: DIR visualiza métricas del día
    Given el DIR accede a "Auditoría > Dashboard"
    Then ve tarjetas con: total de accesos hoy, accesos denegados, accesos fuera de horario, usuarios activos
    And gráfico de barras de accesos por hora del día
    And tabla de Top 10 expedientes más accedidos

  Scenario: Filtros por período y servicio
    Given el DIR está en el Dashboard de Auditoría
    When filtra por "Servicio: Emergencias" y "Período: última semana"
    Then las métricas se actualizan mostrando solo accesos a expedientes del servicio indicado

  Scenario: Alerta visible en dashboard cuando hay accesos inusuales
    Given existen alertas no revisadas en ece.alerta_acceso
    When el DIR abre el Dashboard
    Then ve badge rojo con el número de alertas pendientes
    And puede hacer clic para ir a la lista de alertas
```

**SP:** 5 | **MoSCoW:** Should
**Dependencias:** US.F2.7.12, US.F2.7.13, US.F2.7.14, rol DIR
**Trazabilidad normativa:** Art. 55-56 NTEC
**Notas técnicas:** Query sobre `ece.bitacora_acceso` con índice `idx_bacc_personal`. Considerar materializar métricas diarias en tabla resumen para performance.

---

## Sección 4 — RBAC/RLS y Perfiles de Acceso

> Fundamento: Art. 33, 45, 52 NTEC
> Tablas: `ece.perfil_acceso`, `ece.asignacion_rol`, `ece.personal_salud`

---

### US.F2.7.17 — Catálogo de perfiles de acceso por rol

**Como** administrador del sistema,
**quiero** gestionar un catálogo de perfiles de acceso que defina qué puede hacer cada rol sobre cada recurso,
**para** implementar RBAC conforme al Art. 45 y 52 NTEC.

**Criterios de aceptación:**

```gherkin
Feature: Catálogo de perfiles de acceso

  Scenario: Administrador crea perfil de acceso para rol MÉDICO
    Given el ADM accede a "Configuración > Perfiles de Acceso"
    When selecciona rol "MÉDICO" y recurso "historia_clinica"
    And asigna permisos: lectura, escritura, firma
    Then se insertan 3 filas en ece.perfil_acceso con unique(rol_id, recurso, permiso)
    And el cambio queda en bitacora_auditoria

  Scenario: Visualización de la matriz rol-permiso
    Given hay perfiles configurados para todos los roles
    When el ADM accede a "Matriz de permisos"
    Then ve una tabla: roles en columnas, recursos en filas, permisos marcados con checkboxes

  Scenario: Permiso duplicado rechazado
    Given ya existe perfil_acceso(rol=MÉDICO, recurso='historia_clinica', permiso='lectura')
    When el ADM intenta crear el mismo triple
    Then el sistema rechaza por violación de constraint unique
    And muestra "Este permiso ya está asignado a este rol."
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** `ece.perfil_acceso`, `ece.rol` con catálogo base sembrado
**Trazabilidad normativa:** Art. 45, 52 NTEC; §5 "Confidencialidad y control de acceso"
**Notas técnicas:** Roles base: `DIR`, `MC`, `MT`, `ENF`, `ADM`, `ARCH`, `ESP`, `FARM`. Recursos base según tablas clínicas del schema `ece`.

---

### US.F2.7.18 — RLS policies en tablas del schema ECE

**Como** arquitecto de seguridad,
**quiero** que todas las tablas del schema `ece` tengan RLS habilitado con policies correctas,
**para** que ningún usuario acceda a datos de otro establecimiento (Art. 33 NTEC, CLAUDE.md §RLS).

**Criterios de aceptación:**

```gherkin
Feature: Row Level Security en schema ECE

  Scenario: Usuario de establecimiento A no puede leer expedientes de establecimiento B
    Given existe personal_salud usuario_A con establecimiento_id = "estab-A"
    And existe paciente_B con establecimiento_id = "estab-B"
    When usuario_A ejecuta SELECT sobre ece.paciente con withTenantContext
    Then NO retorna filas de establecimiento B
    And el resultado está vacío o solo contiene filas de estab-A

  Scenario: RLS con demote a rol authenticated
    Given un router tRPC usa withTenantContext(prisma, ctx.tenant, ...)
    When ejecuta query sobre ece.historia_clinica
    Then SET LOCAL ROLE authenticated aplica antes de la query
    And RLS policies de authenticated se evalúan correctamente

  Scenario: Todas las tablas ECE tienen RLS habilitado
    Given el esquema ece está desplegado
    When se ejecuta SELECT tablename FROM pg_tables WHERE schemaname='ece' AND rowsecurity = false
    Then el resultado está vacío (ninguna tabla sin RLS)
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** `07_auditoria_seguridad.sql` (andamiaje base), CLAUDE.md §Contrato RLS
**Trazabilidad normativa:** Art. 33, 45, 52 NTEC; §5 "Confidencialidad y control de acceso"
**Notas técnicas:** Extender policies base de `07_auditoria_seguridad.sql` para todas las tablas del schema `ece`. Usar patrón `withTenantContext` del proyecto.

---

### US.F2.7.19 — Asignación y revocación de roles a personal

**Como** administrador del establecimiento,
**quiero** asignar y revocar roles al personal de salud desde la interfaz,
**para** mantener el principio de mínimo privilegio actualizado (Art. 52 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Gestión de roles del personal

  Scenario: ADM asigna rol MÉDICO al Dr. García en servicio Emergencias
    Given el Dr. García existe en ece.personal_salud sin rol asignado
    When el ADM selecciona "Dr. García > Asignar Rol > MÉDICO > Servicio: Emergencias"
    Then se inserta fila en ece.asignacion_rol con vigente = true
    And el Dr. García puede acceder a historia_clinica según perfil de MÉDICO
    And el cambio queda en bitacora_auditoria

  Scenario: ADM revoca rol
    Given el Dr. García tiene rol MÉDICO asignado
    When el ADM revoca el rol
    Then se actualiza vigente = false en ece.asignacion_rol (no se borra)
    And el Dr. García pierde acceso inmediatamente (RLS evalúa vigente = true)
    And el cambio queda en bitacora_auditoria con timestamp

  Scenario: Personal sin rol no puede acceder a expedientes
    Given un usuario auth.users sin entrada en asignacion_rol vigente
    When intenta acceder a cualquier recurso del schema ece
    Then RLS retorna 0 filas (acceso efectivamente denegado)
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.17, `ece.asignacion_rol`
**Trazabilidad normativa:** Art. 52 NTEC; §5 restricciones transversales

---

### US.F2.7.20 — Depuración anual de usuarios inactivos

**Como** administrador del sistema,
**quiero** que el sistema identifique y proponga depurar usuarios inactivos por más de 1 año,
**para** cumplir con el Art. 23 lit. f NTEC (cese laboral = cese de acceso inmediato).

**Criterios de aceptación:**

```gherkin
Feature: Depuración de usuarios inactivos

  Scenario: Job nocturno detecta usuarios inactivos
    Given el cron nocturno se ejecuta a las 02:00
    When identifica personal_salud con último acceso (max(ocurrido_en) en bitacora_acceso) > 365 días
    Then genera reporte "Usuarios inactivos candidatos a depuración"
    And envía el reporte al ADM vía email
    And NO desactiva automáticamente (requiere confirmación humana)

  Scenario: ADM confirma depuración de usuario inactivo
    Given el ADM revisó el reporte y seleccionó al usuario "enfermera_baja@avante.sv"
    When confirma la depuración con su firma PIN
    Then se actualiza personal_salud.activo = false y fecha_baja = now()
    And se revocan todas sus asignacion_rol (vigente = false)
    And se registra en bitacora_auditoria
    And se invalida su firma_electronica (vigente = false)

  Scenario: Cese laboral urgente — depuración inmediata
    Given el ADM recibió notificación de cese de la Dra. López
    When accede a "Personal > Dra. López > Dar de baja"
    Then el sistema realiza todos los pasos de la depuración inmediatamente
    Y muestra confirmación con timestamp exacto de cese de acceso
```

**SP:** 5 | **MoSCoW:** Should
**Dependencias:** US.F2.7.19, cron Supabase o Edge Function, US.F2.7.12 (bitácora)
**Trazabilidad normativa:** Art. 23 lit. f NTEC

---

### US.F2.7.21 — Reporte de matriz "quién tiene qué permiso"

**Como** director del establecimiento,
**quiero** generar un reporte que muestre todos los permisos activos por usuario y por rol,
**para** auditar el cumplimiento del principio de mínimo privilegio (Art. 52 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Reporte de matriz de permisos

  Scenario: DIR genera matriz completa de permisos
    Given el DIR accede a "Auditoría > Matriz de Permisos"
    Then ve tabla: usuario / rol / servicio / recursos / permisos / fecha asignación
    And puede filtrar por servicio o por rol
    And puede exportar en CSV

  Scenario: Detección de permisos excesivos (alerta)
    Given la configuración estándar define permisos máximos por rol
    When el reporte detecta un usuario con más permisos que el estándar de su rol
    Then resalta la fila en amarillo con etiqueta "Permiso excesivo — revisar"

  Scenario: Reporte histórico de cambios de permisos
    Given el DIR quiere ver la evolución de permisos del Dr. García
    When filtra el reporte por usuario y activa "Incluir histórico"
    Then ve también asignaciones revocadas (vigente = false) con fecha de revocación
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.17, US.F2.7.19
**Trazabilidad normativa:** Art. 52 NTEC; Art. 45 NTEC

---

### US.F2.7.22 — Control de acceso a notas internas (confidencialidad reforzada)

**Como** médico tratante,
**quiero** que las notas de evolución marcadas como "interna" no sean visibles en el Portal del Paciente ni para roles no clínicos,
**para** proteger la confidencialidad médica (Art. 33 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Notas internas confidenciales

  Scenario: Nota de evolución marcada como interna no visible en portal
    Given el Dr. García redactó una nota de evolución con flag interna = true
    When el paciente accede al Portal del Paciente
    Then la nota NO aparece en su vista del expediente

  Scenario: Nota interna visible para personal clínico autorizado
    Given la nota interna existe en evolucion_medica
    When el Dr. García (MC) o la Dra. López (ENF) acceden al expediente
    Then la nota aparece con badge "Nota interna"

  Scenario: Rol ADM no puede ver notas internas
    Given el ADM "admin@avante.sv" accede al expediente del paciente
    When abre la sección de evolución médica
    Then las notas con interna = true NO aparecen en su vista
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.18, columna `interna boolean default false` en `ece.evolucion_medica`
**Trazabilidad normativa:** Art. 33 NTEC

---

## Sección 5 — Certificación Restringida DIR

> Fundamento: Art. 21 NTEC
> Solo el rol `DIR` o su delegado puede certificar copia del expediente.

---

### US.F2.7.23 — Solicitud de certificación de expediente

**Como** cualquier usuario autorizado,
**quiero** poder solicitar la certificación de una copia del expediente,
**para** que la solicitud quede en una cola gestionada por la Dirección (Art. 21 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Solicitud de certificación de expediente

  Scenario: ARCH crea solicitud de certificación
    Given el ARCH recibió una petición del paciente "Juan Pérez"
    When accede a "Expediente > Juan Pérez > Solicitar certificación"
    And completa: motivo (judicial / administrativo / personal), destinatario, documentos a certificar
    Then se crea registro en ece.solicitud_certificacion con estado = 'pendiente_dir'
    And el DIR recibe notificación con los detalles

  Scenario: Solicitud registrada en bitácora
    Given la solicitud fue creada
    Then se registra en bitacora_acceso con tipo_acceso = 'solicitud_certificacion'
    And el solicitante recibe confirmación con número de seguimiento
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.12, tabla `ece.solicitud_certificacion` (nueva), rol DIR
**Trazabilidad normativa:** Art. 21 NTEC; §2.2 "Archivo / certificación"

---

### US.F2.7.24 — Cola de certificaciones pendientes para DIR

**Como** director del establecimiento,
**quiero** ver la cola de solicitudes de certificación pendientes y poder aprobar o rechazar cada una,
**para** ejercer mi rol como único autorizador de certificaciones (Art. 21 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Cola de certificaciones DIR

  Scenario: DIR visualiza cola de solicitudes pendientes
    Given existen 3 solicitudes de certificación en estado 'pendiente_dir'
    When el DIR accede a "Dirección > Certificaciones pendientes"
    Then ve tabla: solicitante, expediente, motivo, fecha solicitud, documentos a certificar
    And puede ordenar por fecha o por urgencia

  Scenario: DIR aprueba y certifica con firma
    Given el DIR selecciona la solicitud de "Juan Pérez"
    When hace clic en "Certificar" y confirma con PIN
    Then el estado cambia a 'certificada'
    And se genera PDF de la copia certificada con sello digital + firma DIR + timestamp
    And se inserta en bitacora_auditoria con operacion = 'INSERT' en tabla ece.certificacion

  Scenario: DIR rechaza solicitud
    Given el DIR considera improcedente la solicitud
    When hace clic en "Rechazar" e ingresa motivo
    Then el estado cambia a 'rechazada' con motivo registrado
    And el solicitante recibe notificación del rechazo con motivo
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.23, US.F2.7.2 (PIN), tabla `ece.certificacion`
**Trazabilidad normativa:** Art. 21 NTEC
**Notas técnicas:** PDF generado con librería `pdf-lib` o servicio de reportes. Sello digital = QR con hash del documento para verificación posterior.

---

### US.F2.7.25 — Auditoría completa de cada certificación emitida

**Como** responsable de cumplimiento,
**quiero** tener un registro completo e inmutable de cada certificación emitida,
**para** responder ante autoridades judiciales o auditorías (Art. 21 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Auditoría de certificaciones

  Scenario: Registro inmutable de certificación
    Given se emitió una certificación del expediente de "Juan Pérez"
    Then existe fila en ece.certificacion con: solicitud_id, expediente_id, dir_firmante, timestamp, hash_pdf
    And el trigger trg_inmutable_certificacion bloquea UPDATE/DELETE sobre esa fila

  Scenario: DIR consulta historial de certificaciones emitidas
    Given el DIR accede a "Auditoría > Certificaciones"
    Then ve listado de todas las certificaciones con: expediente, solicitante, motivo, fecha, DIR firmante
    And puede exportar para presentar ante una auditoría externa

  Scenario: Verificación de autenticidad de copia certificada
    Given una entidad externa recibió una copia certificada con QR
    When escanea el QR
    Then el sistema verifica que el hash del PDF coincide con el almacenado
    And responde "Certificación auténtica emitida el [fecha] por [DIR]"
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.24, trigger inmutabilidad
**Trazabilidad normativa:** Art. 21 NTEC; Art. 55 NTEC

---

## Sección 6 — Plan de Contingencia y Digitación en Papel

> Fundamento: Art. 6 lit. c, Art. 23 lit. c NTEC
> Modo papel con digitación posterior vinculada al mismo número de expediente.

---

### US.F2.7.26 — Activación del modo contingencia por ADM/DIR

**Como** director del establecimiento,
**quiero** activar el modo contingencia cuando el sistema no está disponible,
**para** que el personal sepa que debe operar en papel y registrar con el mismo número de expediente (Art. 6 lit. c NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Activación de modo contingencia

  Scenario: DIR activa modo contingencia
    Given el sistema presenta falla o mantenimiento programado
    When el DIR accede a "Administración > Modo contingencia > Activar"
    And confirma con PIN y motivo ("falla de red", "mantenimiento", etc.)
    Then el sistema muestra banner rojo "MODO CONTINGENCIA ACTIVO" a todos los usuarios
    And envía notificación a todo el personal activo del establecimiento
    And registra en ece.log_contingencia: activado_por, motivo, activado_en

  Scenario: Desactivación del modo contingencia
    Given el modo contingencia está activo y el sistema se restableció
    When el DIR lo desactiva con firma PIN
    Then el banner desaparece
    And el sistema muestra alerta "Digitalice los registros en papel generados durante la contingencia"
    And registra desactivado_en en ece.log_contingencia
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** tabla `ece.log_contingencia` (nueva), sistema de notificaciones
**Trazabilidad normativa:** Art. 6 lit. c, Art. 23 lit. c NTEC

---

### US.F2.7.27 — Digitación posterior de registros en papel con timestamp diferenciado

**Como** personal de ESDOMED,
**quiero** poder digitalizar los registros generados en papel durante una contingencia,
**para** incorporarlos al expediente electrónico con trazabilidad clara del origen (Art. 23 lit. c NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Digitación retrospectiva de registros en contingencia

  Scenario: ARCH digitaliza una nota médica en papel
    Given el modo contingencia terminó y hay notas en papel del 2026-05-16
    When el ARCH accede a "Contingencia > Digitalizar registros"
    And selecciona tipo de documento (historia clínica, signos vitales, etc.)
    And ingresa: número de expediente original, fecha/hora del registro en papel (creado_en_papel_ts), contenido
    And confirma con PIN
    Then se crea el registro en la tabla correspondiente con:
      digitado_ts = clock_timestamp() (hora de digitalización)
      creado_en_papel_ts = fecha/hora informada por el ARCH
      origen = 'contingencia'
      log_contingencia_id = FK al período de contingencia

  Scenario: Indicador visual "Capturado en contingencia" visible
    Given existe un registro digitado desde papel en el expediente
    When cualquier usuario abre ese documento
    Then ve badge amarillo "Capturado en contingencia"
    And tooltip muestra: "Registrado en papel el [creado_en_papel_ts]. Digitalizado el [digitado_ts] por [ARCH]."

  Scenario: Registro digitado sin período de contingencia activo rechazado
    Given no hay ningún período de contingencia registrado para la fecha indicada
    When el ARCH intenta digitalizar con creado_en_papel_ts = fecha sin contingencia
    Then el sistema advierte "No hay período de contingencia registrado para esa fecha. ¿Desea continuar con justificación?"
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.26, columnas `digitado_ts`, `creado_en_papel_ts`, `origen`, `log_contingencia_id` en tablas de documentos
**Trazabilidad normativa:** Art. 6 lit. c, Art. 23 lit. c NTEC

---

### US.F2.7.28 — Formularios imprimibles para contingencia

**Como** director del establecimiento,
**quiero** poder imprimir formularios normalizados desde el sistema para usar durante una contingencia,
**para** que la captura en papel sea ordenada y facilite la digitalización posterior.

**Criterios de aceptación:**

```gherkin
Feature: Formularios de contingencia imprimibles

  Scenario: Impresión de formularios durante contingencia activa
    Given el modo contingencia está activo
    When el usuario accede a "Contingencia > Imprimir formularios"
    Then puede seleccionar: Historia clínica, Signos vitales, Evolución médica, Indicaciones
    And al imprimir, el PDF incluye: nombre del establecimiento, número de expediente prellenado (si está disponible), fecha, campos en blanco para llenar

  Scenario: Formularios disponibles incluso offline (PWA)
    Given el sistema está completamente inaccesible (falla total)
    Then los formularios en caché de la PWA siguen disponibles para impresión
    And incluyen instrucciones de digitación posterior
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.26, generación PDF
**Trazabilidad normativa:** Art. 6 lit. c NTEC

---

## Sección 7 — Conservación Diferenciada y Retención

> Fundamento: Art. 34-35 NTEC
> Estado `activo/pasivo`; reglas de retención por diagnóstico; eliminación supervisada.

---

### US.F2.7.29 — Estado activo/pasivo del expediente

**Como** personal de archivo (ARCH),
**quiero** que el sistema gestione automáticamente el estado activo/pasivo del expediente según la actividad del paciente,
**para** cumplir con Art. 34 NTEC (pasivo = sin actividad 5 años).

**Criterios de aceptación:**

```gherkin
Feature: Estado activo y pasivo del expediente

  Scenario: Job nocturno marca expediente como pasivo
    Given el expediente del paciente "Ana Martínez" no tiene actividad desde hace 5 años (1826 días)
    When el job nocturno evalúa estado_expediente
    Then actualiza paciente.estado_expediente = 'pasivo'
    And registra el cambio en bitacora_auditoria

  Scenario: Expediente pasivo se reactiva al generar nueva actividad
    Given el expediente de "Ana Martínez" está en estado 'pasivo'
    When se crea un nuevo episodio_atencion para ella
    Then estado_expediente vuelve a 'activo' automáticamente

  Scenario: Reporte de expedientes pasivos
    Given el ARCH accede a "Archivo > Expedientes pasivos"
    Then ve listado con: paciente, último acceso, diagnósticos de cierre, regla de retención aplicable
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** campo `estado_expediente` en `ece.paciente`, cron nocturno
**Trazabilidad normativa:** Art. 34 NTEC; §3.1 "Expediente activo / pasivo"

---

### US.F2.7.30 — Reglas de retención por diagnóstico

**Como** responsable de cumplimiento,
**quiero** que el sistema aplique reglas de retención diferenciadas según el diagnóstico del expediente,
**para** cumplir con Art. 35 NTEC.

**Criterios de aceptación:**

```gherkin
Feature: Reglas de retención diferenciada

  Scenario: Expediente de paciente crónico (diabetes, HTA, etc.)
    Given el expediente tiene diagnóstico CIE-10 de enfermedad crónica (E11, I10, etc.)
    And el paciente está vivo según el registro
    When el job de retención evalúa el expediente
    Then la regla aplicable es "Retener mientras el paciente esté vivo + 5 años post-mortem"
    And el campo fecha_vencimiento_retencion queda NULL (indefinido)

  Scenario: Expediente de caso de violencia o accidente de tránsito
    Given el expediente tiene diagnóstico de causa externa (CIE-10 V01-Y98 o X85-Y09)
    When el job de retención evalúa
    Then la regla aplicable es "10 años desde el cierre del último episodio"
    And fecha_vencimiento_retencion = cierre_ultimo_episodio + 10 años

  Scenario: Expediente estándar (sin criterio especial)
    Given el expediente no cumple criterios de crónico ni de causa externa
    When el job de retención evalúa
    Then la regla es "5 años naturales desde el cierre del último episodio"

  Scenario: Reporte de expedientes próximos a vencer retención (90 días)
    Given el job genera el reporte mensual
    Then lista expedientes donde fecha_vencimiento_retencion BETWEEN now() AND now() + 90 días
    And clasifica por regla aplicada y por servicio
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.29, tabla `ece.regla_retencion` (catálogo), campo `fecha_vencimiento_retencion` en `ece.paciente`
**Trazabilidad normativa:** Art. 35 NTEC

---

### US.F2.7.31 — Eliminación supervisada con doble firma

**Como** director del establecimiento,
**quiero** que la eliminación física de un expediente vencido requiera doble firma (jefe ARCH + DIR),
**para** garantizar que ningún expediente se elimine sin supervisión auditada (Art. 35 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Eliminación supervisada de expedientes

  Scenario: Proceso de eliminación con doble firma
    Given el expediente de "Pedro Ramos" tiene fecha_vencimiento_retencion vencida
    When el jefe ARCH inicia el proceso "Eliminar expediente vencido"
    Then el sistema genera solicitud de eliminación en estado 'pendiente_dir'
    And el DIR recibe notificación con: paciente, regla de retención, fecha de vencimiento

    When el DIR revisa y aprueba con su firma PIN
    Then el sistema solicita también la firma PIN del jefe ARCH (doble firma)
    When ambas firmas son válidas
    Then el expediente se marca como estado_expediente = 'eliminado_supervisado'
    And se archivan los metadatos de retención en tabla permanente ece.registro_eliminacion
    And se registra en bitacora_auditoria con ambas firmas y timestamp

  Scenario: Eliminación rechazada por DIR
    Given el DIR considera que la retención debe extenderse (caso en litigio)
    When rechaza la solicitud con motivo "Expediente en proceso judicial"
    Then el vencimiento se extiende manualmente con nueva fecha y se registra motivo

  Scenario: El sistema NUNCA elimina sin doble firma
    Given cualquier proceso automatizado intenta eliminar un expediente
    Then el sistema bloquea la operación y alerta al SRE
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.30, US.F2.7.24 (flujo similar al de certificación), tabla `ece.registro_eliminacion`
**Trazabilidad normativa:** Art. 35 NTEC

---

### US.F2.7.32 — Reporte de expedientes próximos a vencer retención

**Como** personal de ESDOMED,
**quiero** recibir un reporte mensual de expedientes cuya retención vence en los próximos 90 días,
**para** gestionar proactivamente el archivo y la eliminación supervisada.

**Criterios de aceptación:**

```gherkin
Feature: Reporte de retención próxima a vencer

  Scenario: Reporte mensual generado automáticamente
    Given el job mensual se ejecuta el primer día de cada mes
    Then genera reporte con: paciente, NUI, último episodio, diagnóstico, regla aplicada, fecha vencimiento
    And clasifica por urgencia: "Vence en 30 días", "Vence en 31-60 días", "Vence en 61-90 días"
    And envía al ARCH y al DIR por email

  Scenario: ARCH descarta expediente de la lista
    Given el ARCH revisó el reporte y un expediente tiene nueva actividad reciente
    When actualiza el estado desde la interfaz
    Then el expediente sale del reporte en el siguiente ciclo
```

**SP:** 2 | **MoSCoW:** Should
**Dependencias:** US.F2.7.30, cron mensual
**Trazabilidad normativa:** Art. 35 NTEC

---

## Sección 8 — Codificación CIE-10 al Cierre

> Fundamento: Art. 16-17 NTEC
> Diagnóstico CIE-10 (4 dígitos) obligatorio al cierre de cada episodio.

---

### US.F2.7.33 — Catálogo CIE-10 maestro con búsqueda

**Como** codificador clínico (ARCH/ESDOMED),
**quiero** buscar diagnósticos en el catálogo CIE-10 por código o por texto libre,
**para** codificar correctamente cada episodio al cierre (Art. 16 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Catálogo CIE-10 con búsqueda

  Scenario: Búsqueda por código CIE-10 exacto
    Given el catálogo CIE-10 está importado en ece.catalogo_cie10
    When el codificador escribe "J06.9" en el campo de búsqueda
    Then el sistema retorna: código "J06.9", descripción "Infección aguda de las vías respiratorias superiores, no especificada"
    And permite seleccionarlo como diagnóstico

  Scenario: Búsqueda por texto libre
    Given el codificador escribe "diabetes tipo 2" en el campo de búsqueda
    Then el sistema retorna hasta 10 coincidencias relevantes del catálogo CIE-10
    And ordena por relevancia (código más específico primero)

  Scenario: Código inválido rechazado
    Given el codificador escribe "ZZZ99" (no existe en CIE-10)
    Then el sistema rechaza con "Código CIE-10 no encontrado en el catálogo."
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** tabla `ece.catalogo_cie10(codigo, descripcion, nivel, activo)` importada
**Trazabilidad normativa:** Art. 16 NTEC
**Notas técnicas:** Búsqueda texto con `pg_trgm` (trigramas) o `tsvector` sobre descripción. Catálogo CIE-10 versión 2019 (MINSAL SV).

---

### US.F2.7.34 — Diagnóstico CIE-10 obligatorio al cierre de episodio

**Como** codificador clínico,
**quiero** que el sistema no permita cerrar un episodio sin diagnóstico CIE-10 codificado,
**para** garantizar el cumplimiento del Art. 17 NTEC y la calidad estadística.

**Criterios de aceptación:**

```gherkin
Feature: CIE-10 obligatorio al cierre

  Scenario: Intento de cerrar episodio sin diagnóstico CIE-10
    Given el episodio "EP-001" está en estado 'en_atencion' sin diagnóstico codificado
    When el ARCH o el médico intenta marcarlo como 'cerrado'
    Then el sistema rechaza con "Debe asignar al menos un diagnóstico CIE-10 antes de cerrar el episodio."
    And resalta el campo de diagnóstico en rojo

  Scenario: Cierre exitoso con diagnóstico CIE-10
    Given el médico asignó diagnóstico "J06.9" al episodio "EP-001"
    When el ARCH cierra el episodio
    Then el estado cambia a 'cerrado' y el campo diagnostico_cie10_egreso queda poblado
    And el episodio aparece en los reportes estadísticos

  Scenario: Múltiples diagnósticos de egreso permitidos
    Given un episodio hospitalario con comorbilidades
    When el médico asigna: diagnóstico principal "I21.0" + secundarios "E11.9", "I10"
    Then el sistema acepta el array y marca el primero como diagnóstico principal de egreso
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.33, campo `diagnostico_cie10_egreso` en `ece.episodio_atencion`
**Trazabilidad normativa:** Art. 17 NTEC; §3.2 "diagnóstico codificado en CIE-10 obligatorio al cierre"

---

### US.F2.7.35 — Validación de combinaciones CIE-10 inválidas

**Como** codificador clínico,
**quiero** que el sistema alerte sobre combinaciones de diagnósticos CIE-10 inválidas (ej. diagnóstico pediátrico en adulto),
**para** mejorar la calidad de la codificación (Art. 16-17 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Validación de combinaciones CIE-10

  Scenario: Diagnóstico exclusivo de menores en paciente adulto
    Given el paciente tiene 45 años
    When el codificador asigna "P07.1" (trastorno de recién nacido prematuro)
    Then el sistema muestra advertencia "Este diagnóstico es exclusivo de recién nacidos. ¿Confirmar?"
    And requiere justificación si el codificador insiste

  Scenario: Diagnóstico exclusivo de mujeres en paciente masculino
    Given el paciente tiene sexo = 'masculino'
    When el codificador asigna "N80.0" (endometriosis)
    Then el sistema muestra advertencia "Este diagnóstico no corresponde al sexo registrado. Verifique."

  Scenario: Combinación mutuamente excluyente
    Given el catálogo de exclusiones está configurado
    When el codificador asigna dos códigos marcados como mutuamente excluyentes
    Then el sistema alerta y requiere confirmación con justificación
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.33, tabla `ece.regla_cie10(codigo, restriccion_tipo, valor, descripcion)`
**Trazabilidad normativa:** Art. 16-17 NTEC

---

## Sección 9 — Backup, Restore y DR

> Fundamento: Art. 48 NTEC
> Backup diario, ubicación distinta (off-site), cifrado si portable, pruebas trimestrales documentadas.

---

### US.F2.7.36 — Configuración y monitoreo de backup diario automático

**Como** administrador SRE,
**quiero** que el sistema cuente con backup diario automático almacenado en ubicación distinta,
**para** cumplir con Art. 48 NTEC y garantizar recuperación ante desastres.

**Criterios de aceptación:**

```gherkin
Feature: Backup diario automático

  Scenario: Backup diario ejecutado exitosamente
    Given el cron de backup está configurado para ejecutarse a las 01:00 diariamente
    When se ejecuta
    Then genera snapshot de la base de datos completa (pg_dump o Supabase Point-in-Time Recovery)
    And almacena en bucket S3 en región distinta al servidor principal (off-site)
    And cifra el archivo si es portable (AES-256)
    And registra en ece.log_backup: fecha, tamaño, ubicación, checksum, estado = 'exitoso'

  Scenario: Fallo en backup genera alerta crítica
    Given el cron de backup se ejecutó pero falló
    Then registra estado = 'fallido' en ece.log_backup
    And envía alerta P1 al SRE y al DIR inmediatamente
    And el sistema reintenta el backup una hora después

  Scenario: Monitoreo de backups desde Dashboard SRE
    Given el SRE accede a "Infraestructura > Backups"
    Then ve: historial de los últimos 30 días, estado de cada backup, tamaño, ubicación
    And alerta visual si el último backup exitoso tiene más de 25 horas
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** Supabase PITR habilitado, bucket S3 configurado en región secundaria
**Trazabilidad normativa:** Art. 48 NTEC
**Notas técnicas:** Supabase Pro incluye PITR (Point-in-Time Recovery). Para cumplimiento off-site, exportar adicionalmente a S3 us-east-1 (distinto a la región del proyecto).

---

### US.F2.7.37 — Pruebas de restore trimestrales documentadas

**Como** director del establecimiento,
**quiero** que el equipo realice y documente pruebas de restauración al menos una vez por trimestre,
**para** verificar que los backups son recuperables (Art. 48 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Pruebas de restore trimestrales

  Scenario: SRE ejecuta prueba de restore en ambiente de prueba
    Given el SRE selecciona un backup de la lista
    When ejecuta "Iniciar prueba de restore" en ambiente no productivo
    Then el sistema restaura el backup en un entorno aislado
    And verifica integridad: tablas presentes, conteo de registros, constraints válidos
    And genera reporte de la prueba con: fecha, backup utilizado, tiempo de restauración, resultado

  Scenario: Documentación de prueba aprobada por DIR
    Given el reporte de prueba de restore fue generado
    When el DIR lo revisa y aprueba
    Then queda registrado en ece.log_prueba_restore con firma digital del DIR
    And el reporte es accesible para auditorías externas

  Scenario: Alerta si no se realizó prueba en el trimestre
    Given el cron trimestral detecta que no hay log_prueba_restore exitoso en los últimos 90 días
    Then genera alerta al SRE y al DIR: "Prueba de restore pendiente — incumplimiento Art. 48 NTEC"
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.36, tabla `ece.log_prueba_restore`, ambiente de staging
**Trazabilidad normativa:** Art. 48 NTEC

---

### US.F2.7.38 — Plan de Recuperación ante Desastres (DR) documentado en sistema

**Como** director del establecimiento,
**quiero** que el sistema incluya un runbook de recuperación ante desastres accesible en línea,
**para** que el equipo pueda actuar con rapidez ante un incidente mayor (Art. 48 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Runbook de DR accesible en sistema

  Scenario: Acceso al runbook desde panel de administración
    Given el SRE accede a "Administración > Plan de DR"
    Then ve el runbook actualizado con: pasos de recuperación, contactos de emergencia, RTOs/RPOs
    And el runbook tiene fecha de última revisión y firma del DIR

  Scenario: RTO y RPO definidos y monitoreados
    Given el DR plan define: RTO = 4 horas, RPO = 24 horas
    When ocurre un incidente y se activa el DR
    Then el sistema registra el inicio del incidente y monitorea el tiempo de recuperación
    And alerta si el tiempo supera el RTO definido
```

**SP:** 2 | **MoSCoW:** Should
**Dependencias:** US.F2.7.36, US.F2.7.37
**Trazabilidad normativa:** Art. 48 NTEC

---

## Sección 10 — Identificación Única y Deduplicación

> Fundamento: Art. 11-12-14 NTEC
> NUI como clave natural; deduplicación obligatoria; merge irreversible con audit.

---

### US.F2.7.39 — NUI como clave natural y validación de unicidad

**Como** personal de admisión (ARCH),
**quiero** que el sistema use el NUI como clave natural del paciente y valide unicidad antes de crear expedientes,
**para** garantizar un expediente único por usuario (Art. 11-12 NTEC, Ley SNIS Art. 24).

**Criterios de aceptación:**

```gherkin
Feature: NUI como clave natural del expediente

  Scenario: Creación de nuevo paciente con NUI único
    Given el ARCH ingresa NUI "SLV-2006-001234" para un nuevo paciente
    When el sistema valida que no existe ningún paciente con ese NUI
    Then crea el expediente con el NUI como identificador principal
    And genera número de expediente según patrón del establecimiento

  Scenario: NUI duplicado detectado en tiempo real
    Given ya existe paciente con NUI "SLV-2006-001234" en el sistema
    When el ARCH intenta crear un nuevo expediente con el mismo NUI
    Then el sistema muestra alerta inmediata "Ya existe un expediente con este NUI. Expediente: [número]"
    And sugiere: "¿Desea abrir el expediente existente?"
    And NO permite crear duplicado

  Scenario: Paciente sin NUI registrado como excepción
    Given un paciente extranjero sin NUI salvadoreño
    When el ARCH registra pasaporte "A12345678"
    Then el sistema crea expediente con identificador alternativo y marca nui_ausente = true con justificación
    And el expediente queda en cola de completar NUI cuando se obtenga
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** `ece.paciente` con índice único en NUI, validadores SV del proyecto
**Trazabilidad normativa:** Art. 11-12 NTEC; Ley SNIS Art. 24-25

---

### US.F2.7.40 — Detección de posibles duplicados por similitud

**Como** personal de ARCH,
**quiero** que el sistema detecte posibles expedientes duplicados al registrar un nuevo paciente,
**para** evitar la fragmentación del historial clínico (Art. 14 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Detección de duplicados por similitud

  Scenario: Sistema detecta posible duplicado al crear paciente nuevo
    Given el ARCH ingresa "Juan Carlos Pérez Flores, 15/03/1985, DUI 012345678-9"
    When el sistema busca coincidencias con similitud > 85% en nombre + fecha de nacimiento
    Then muestra panel lateral "Posibles duplicados encontrados (2)" con los candidatos
    And el ARCH puede: seleccionar un candidato (usar expediente existente) o confirmar que es nuevo paciente

  Scenario: Algoritmo de similitud usa múltiples campos
    Given existen registros con variaciones de nombre ("Juan Pérez" vs "Juan C. Pérez Flores")
    When el sistema evalúa similitud
    Then considera: nombre fonético, fecha de nacimiento, DUI, número de teléfono
    And pondera: DUI exacto = alta coincidencia; nombre similar + DOB = coincidencia media

  Scenario: No hay duplicados — confirmación de creación
    Given el sistema buscó y no encontró duplicados
    Then muestra "No se encontraron duplicados" y permite continuar con la creación
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.39, extensión `pg_trgm` en Supabase, índice trigramas sobre nombre
**Trazabilidad normativa:** Art. 14 NTEC
**Notas técnicas:** `pg_trgm` ya mencionado en README como parte del índice de deduplicación. Fonética con `unaccent` + levenshtein.

---

### US.F2.7.41 — Merge de expedientes duplicados (irreversible con audit)

**Como** director del establecimiento,
**quiero** poder unificar dos expedientes duplicados en uno solo,
**para** mantener la integridad del historial clínico (Art. 14 NTEC). El merge es irreversible.

**Criterios de aceptación:**

```gherkin
Feature: Merge de expedientes duplicados

  Scenario: ARCH solicita merge de dos expedientes
    Given existen expedientes "EXP-001" (principal) y "EXP-999" (duplicado)
    When el ARCH inicia "Unificación de expedientes"
    And selecciona el expediente principal y el duplicado
    Then el sistema muestra resumen: episodios de cada uno, fechas, datos demográficos
    And requiere confirmación del DIR con firma PIN (operación irreversible)

  Scenario: Merge ejecutado exitosamente
    Given DIR y ARCH confirmaron el merge
    Then todos los episodios de EXP-999 se reasignan a EXP-001 (UPDATE expediente_id)
    And EXP-999 queda marcado como estado_expediente = 'fusionado_en_EXP-001'
    And se registra en ece.log_merge: expediente_origen, expediente_destino, ejecutado_por, ts, lista_episodios_migrados
    And el log_merge es inmutable (trigger bloquea UPDATE/DELETE)

  Scenario: EXP-999 fusionado no puede recibir nuevos episodios
    Given EXP-999 está marcado como 'fusionado'
    When el sistema intenta crear un nuevo episodio en EXP-999
    Then rechaza con "Expediente fusionado. Use EXP-001."
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** US.F2.7.40, tabla `ece.log_merge`, rol DIR, US.F2.7.2 (firma PIN)
**Trazabilidad normativa:** Art. 14 NTEC

---

### US.F2.7.42 — Estructura de número de expediente configurable por establecimiento

**Como** administrador del establecimiento,
**quiero** configurar el patrón de numeración de expedientes según las reglas de mi institución,
**para** cumplir con Art. 11 NTEC (estructura definida por cada establecimiento).

**Criterios de aceptación:**

```gherkin
Feature: Número de expediente configurable

  Scenario: ADM configura patrón de numeración
    Given el ADM accede a "Configuración > Numeración de expedientes"
    When define patrón: "{año}-{servicio}-{secuencial:6}" (ej. "2026-CE-000001")
    And lo guarda con firma PIN
    Then el sistema usa ese patrón para todos los nuevos expedientes del establecimiento
    And registra el cambio de configuración en bitacora_auditoria

  Scenario: Número de expediente único dentro del establecimiento
    Given el establecimiento tiene patrón configurado
    When se generan 100 expedientes simultáneamente
    Then todos tienen números únicos (sin colisión)
    And el sistema usa secuencia Postgres para garantizar unicidad bajo concurrencia
```

**SP:** 2 | **MoSCoW:** Should
**Dependencias:** `ece.establecimiento.patron_num_expediente` (ya en README), secuencia Postgres
**Trazabilidad normativa:** Art. 11 NTEC

---

## Sección 11 — ARCO Datos Personales y Portal Paciente

> Fundamento: Ley de Protección de Datos Personales Arts. 9, 18; Ley de Deberes y Derechos de los Pacientes
> Derechos: Acceso, Rectificación, Cancelación/Supresión, Oposición (ARCO).

---

### US.F2.7.43 — Acceso del paciente a su expediente vía Portal

**Como** paciente,
**quiero** poder acceder a mi expediente clínico a través del Portal del Paciente (Beta.20),
**para** ejercer mi derecho de acceso reconocido por la Ley de Protección de Datos Personales Art. 9.

**Criterios de aceptación:**

```gherkin
Feature: Acceso del paciente a su expediente

  Scenario: Paciente autenticado accede a su expediente
    Given "Juan Pérez" está autenticado en el Portal del Paciente
    When accede a "Mi expediente clínico"
    Then ve: episodios de atención, diagnósticos, resultados de laboratorio, recetas, indicaciones de alta
    And NO ve: notas internas (interna = true), notas de psiquiatría con restricción especial

  Scenario: Paciente descarga su expediente en PDF
    Given Juan Pérez está viendo su expediente
    When hace clic en "Descargar mi expediente"
    Then el sistema genera PDF con membrete, datos del paciente, episodios y diagnósticos
    And registra la descarga en bitacora_acceso con tipo_acceso = 'export' y auth_user_id del paciente

  Scenario: Paciente ve quién accedió a su expediente
    Given Juan Pérez accede a "Mi expediente > Registro de accesos"
    Then ve tabla con: nombre del profesional, rol, fecha/hora, tipo de acceso
    And NO ve la IP ni datos internos del sistema
```

**SP:** 5 | **MoSCoW:** Must
**Dependencias:** Beta.20 Portal del Paciente (existente), US.F2.7.22 (notas internas), US.F2.7.14
**Trazabilidad normativa:** Ley de Protección de Datos Personales Art. 9; Art. 56 NTEC

---

### US.F2.7.44 — Solicitud de rectificación por el paciente (derecho ARCO)

**Como** paciente,
**quiero** poder solicitar la corrección de datos incorrectos en mi expediente,
**para** ejercer mi derecho de rectificación (Ley de Protección de Datos Personales Art. 18).

**Criterios de aceptación:**

```gherkin
Feature: Solicitud de rectificación por paciente

  Scenario: Paciente solicita corrección de dato demográfico
    Given Juan Pérez detecta que su fecha de nacimiento está incorrecta
    When accede a "Mi expediente > Solicitar corrección"
    And describe el dato incorrecto, el valor correcto y adjunta documento de respaldo (DUI/partida)
    Then se crea solicitud en ece.solicitud_rectificacion_paciente en estado 'pendiente_arch'
    And el ARCH recibe notificación con los datos adjuntos

  Scenario: ARCH procesa la solicitud y ejecuta rectificación
    Given el ARCH revisó la solicitud y el documento adjunto es válido
    When ejecuta la rectificación mediante el flujo US.F2.7.8
    Then el paciente recibe notificación "Su solicitud de corrección fue procesada."
    And puede ver el cambio reflejado en su expediente

  Scenario: Solicitud rechazada con justificación
    Given el dato solicitado a corregir es un diagnóstico médico (no un error de registro)
    When el ARCH rechaza con motivo "El diagnóstico fue establecido por el médico tratante. Para impugnar un diagnóstico, consulte con el médico."
    Then el paciente recibe notificación del rechazo con el motivo
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.8, Beta.20 Portal, tabla `ece.solicitud_rectificacion_paciente`
**Trazabilidad normativa:** Ley de Protección de Datos Personales Art. 18; Art. 42 NTEC

---

### US.F2.7.45 — Solicitud de supresión por el paciente (derecho al olvido limitado)

**Como** paciente,
**quiero** poder solicitar la supresión de datos inadecuados o excesivos,
**para** ejercer mi derecho de supresión con el entendimiento de que la NTEC limita este derecho por razones de salud pública.

**Criterios de aceptación:**

```gherkin
Feature: Solicitud de supresión por paciente

  Scenario: Paciente solicita supresión de dato excesivo
    Given Juan Pérez considera que ciertos datos de contacto guardados son excesivos
    When solicita supresión desde el Portal del Paciente
    Then se crea solicitud en estado 'pendiente_dir' (requiere autorización DIR, Art. 43 NTEC)
    And el sistema informa: "Su solicitud será evaluada. La NTEC puede limitar la supresión de datos de salud."

  Scenario: DIR evalúa y aprueba supresión parcial
    Given el DIR revisó la solicitud y determina que el dato es efectivamente excesivo
    When aprueba, el sistema ejecuta US.F2.7.10 (supresión autorizada)
    Then el paciente recibe confirmación con descripción del dato suprimido

  Scenario: Solicitud de supresión de diagnóstico rechazada (límite NTEC)
    Given Juan Pérez solicita supresión de un diagnóstico de su expediente
    When el DIR evalúa
    Then rechaza con "Los diagnósticos clínicos no pueden suprimirse por mandato de la NTEC (Art. 34-35). Son necesarios para la continuidad de su atención."
```

**SP:** 3 | **MoSCoW:** Must
**Dependencias:** US.F2.7.10, Beta.20 Portal, tabla `ece.solicitud_supresion_paciente`
**Trazabilidad normativa:** Ley de Protección de Datos Personales Art. 18; Art. 43, 34-35 NTEC

---

## Sección 12 — Comité del Expediente Clínico y Calidad Documental

> Fundamento: Art. 32 NTEC
> Roles: DIR + jefes de servicio + ARCH + IT. Reuniones periódicas con minutas auditables.

---

### US.F2.7.46 — Registro de reuniones del Comité con minutas auditables

**Como** director del establecimiento,
**quiero** registrar las reuniones del Comité del Expediente Clínico con sus minutas en el sistema,
**para** cumplir con Art. 32 NTEC y tener trazabilidad de decisiones del comité.

**Criterios de aceptación:**

```gherkin
Feature: Minutas del Comité del Expediente Clínico

  Scenario: DIR registra reunión del comité
    Given el DIR accede a "Comité ECE > Nueva reunión"
    When registra: fecha, participantes (nombres y roles), agenda, acuerdos, próxima fecha
    And los participantes confirman con firma PIN
    Then se crea registro en ece.reunion_comite en estado 'firmada'
    And el registro es inmutable (trigger trg_inmutable)

  Scenario: Consulta histórica de minutas
    Given el ARCH accede a "Comité ECE > Historial"
    Then ve listado de todas las reuniones con: fecha, participantes, acuerdos
    And puede exportar en PDF para presentar ante auditorías externas

  Scenario: Alerta si no hay reunión en el período establecido
    Given la configuración indica reuniones mensuales
    When el cron detecta que no hay reunión en los últimos 35 días
    Then genera alerta al DIR: "Reunión del Comité ECE pendiente."
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** tabla `ece.reunion_comite`, tabla `ece.participante_comite`, US.F2.7.2 (firma PIN)
**Trazabilidad normativa:** Art. 32 NTEC

---

### US.F2.7.47 — Dashboard de calidad documental del expediente

**Como** comité del expediente clínico,
**quiero** un dashboard con indicadores de calidad documental,
**para** identificar deficiencias y tomar acciones correctivas (Art. 32 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Dashboard de calidad documental

  Scenario: Comité visualiza indicadores de calidad
    Given el ARCH accede a "Comité ECE > Calidad Documental"
    Then ve tarjetas con:
      % expedientes con CIE-10 completo al cierre
      % documentos firmados / total firmables
      % notas de evolución sin firma (por servicio)
      Tiempo promedio entre alta médica y cierre documental
      Número de rectificaciones del mes (por tipo)

  Scenario: Detección de expedientes incompletos
    Given el dashboard ejecuta análisis diario
    When detecta episodios cerrados sin epicrisis firmada
    Then los lista en "Alertas de calidad: Documentación incompleta"
    And envía reporte al jefe de servicio correspondiente

  Scenario: Reporte mensual para el Comité
    Given el primer día del mes
    Then el sistema genera reporte PDF automático de calidad documental del mes anterior
    And lo envía a todos los miembros del comité registrados
```

**SP:** 5 | **MoSCoW:** Should
**Dependencias:** US.F2.7.46, US.F2.7.34, US.F2.7.2
**Trazabilidad normativa:** Art. 32 NTEC

---

### US.F2.7.48 — Reporte de auditoría de calidad para MINSAL/ISSS

**Como** director del establecimiento,
**quiero** generar reportes de calidad documental en formato compatible con auditorías de MINSAL/ISSS,
**para** cumplir con las obligaciones de reporte institucional (Art. 32 NTEC).

**Criterios de aceptación:**

```gherkin
Feature: Reporte de auditoría institucional

  Scenario: DIR genera reporte anual para MINSAL
    Given el DIR accede a "Comité ECE > Reporte institucional"
    When selecciona período anual y tipo "MINSAL"
    Then el sistema genera reporte con: total de expedientes, % completos, incidencias documentadas, acciones correctivas del comité, firmas de integrantes
    And exporta en PDF con membrete del establecimiento y firma digital del DIR

  Scenario: Trazabilidad de incidencias y acciones correctivas
    Given el comité registró una incidencia en reunión (ej. falta de firmas en servicio X)
    And posteriormente registró la acción correctiva y su seguimiento
    When el reporte institucional se genera
    Then incluye la incidencia, la acción correctiva y el resultado del seguimiento
```

**SP:** 3 | **MoSCoW:** Should
**Dependencias:** US.F2.7.46, US.F2.7.47
**Trazabilidad normativa:** Art. 32 NTEC

---

## Decisiones de Diseño

| Decisión | Justificación |
|---|---|
| PIN 6 dígitos + argon2id (no clave privada PKI) | Art. 4.17 NTEC define "firma electrónica simple" — no exige PKI. argon2id es el estándar de hashing de credenciales del proyecto. |
| Cache de firma 15 minutos en memoria | Reduce fricción operativa sin comprometer seguridad. No persistido en localStorage. Se invalida al cerrar sesión. |
| Inmutabilidad vía trigger Postgres, no solo lógica de aplicación | Protección en capas: incluso bypass del ORM/tRPC no puede mutar documentos históricos. Patrón ya establecido en CLAUDE.md. |
| Supresión lógica, no física (flag, no DELETE) | Art. 43 NTEC exige autorización; el sistema de hash chain detectaría la ruptura si se eliminara físicamente. |
| Merge irreversible documentado en log inmutable | Art. 14 NTEC + seguridad jurídica. El log_merge tiene trigger inmutable. |
| RLS en schema ECE con `withTenantContext` | Consistente con el contrato RLS del proyecto (CLAUDE.md §Contrato RLS). |

---

## Capacidad Estimada

| Sección | US | SP Total |
|---|---|---|
| 1. Firma Electrónica Simple | 6 (US.F2.7.1–6) | 19 |
| 2. Inmutabilidad + Rectificación | 5 (US.F2.7.7–11) | 16 |
| 3. Bitácora de Accesos | 5 (US.F2.7.12–16) | 21 |
| 4. RBAC/RLS | 6 (US.F2.7.17–22) | 22 |
| 5. Certificación Restringida | 3 (US.F2.7.23–25) | 11 |
| 6. Contingencia | 3 (US.F2.7.26–28) | 11 |
| 7. Conservación Diferenciada | 4 (US.F2.7.29–32) | 15 |
| 8. CIE-10 | 3 (US.F2.7.33–35) | 9 |
| 9. Backup + DR | 3 (US.F2.7.36–38) | 10 |
| 10. Identificación Única | 4 (US.F2.7.39–42) | 15 |
| 11. ARCO + Portal Paciente | 3 (US.F2.7.43–45) | 11 |
| 12. Comité + Calidad | 3 (US.F2.7.46–48) | 11 |
| **TOTAL** | **48 US** | **171 SP** |

**Velocidad estimada por sprint:** 35-40 SP (2 semanas, equipo de 4 desarrolladores).
**Sprints estimados:** 5 sprints (Sprints 4-8, Fase 2).

---

## Riesgos

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Schema drift: columnas nuevas (intentos_fallidos, digitado_ts, etc.) no sincronizadas en schema.prisma | Alta | Alto | PR de schema diff (Stream 10) sincroniza antes de Sprint 4 |
| Performance de bitácora_acceso en producción (alto volumen INSERT) | Media | Alto | Particionar por mes + índice `idx_bacc_personal`. Evaluar escritura asíncrona. |
| Portal paciente (Beta.20) no expone endpoint de acceso a expediente ECE | Media | Alto | Coordinar con Dev en Sprint 4; las US.F2.7.43-45 dependen de esto. |
| Catálogo CIE-10 no importado a tiempo | Media | Medio | Importación es prerequisito de DoR; bloquea Sección 8 completa. |
| Resistencia del personal al modal de PIN en cada firma | Alta | Medio | Cache 15 minutos + UX de recuperación fácil. Comunicación de cambio. |

---

## Métricas de Éxito

| Métrica | Línea Base | Meta Sprint 8 |
|---|---|---|
| % documentos firmables con FES aplicada | 0% | 100% |
| % episodios cerrados con CIE-10 | 0% | ≥ 95% |
| Accesos sin registro en bitácora | N/A | 0 |
| Tiempo medio de recuperación PIN | N/A | < 5 minutos (P95) |
| Expedientes duplicados detectados y fusionados | N/A | ≥ 90% de los identificados |
| Backups exitosos en período | N/A | 100% (0 fallas sin recuperación) |
| Satisfacción del personal con proceso de firma | N/A | ≥ 4.0 / 5.0 (encuesta post-sprint) |

---

*Generado por @PO — Inversiones Avante HIS. Fase 2, Stream 9 de 10.*
*Trazabilidad: analisis_workflows_ece.md §0, §3, §5 + 02_seguridad_personal.sql + 07_auditoria_seguridad.sql + CLAUDE.md.*
