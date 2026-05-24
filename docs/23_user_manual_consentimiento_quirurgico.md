# Manual de Usuario — Consentimiento Quirúrgico (CONS_QX)

**Audiencia:** MC (Médico Cirujano principal), ESP (Anestesiólogo para anexo anestésico), MC (Médico tratante para explicación pre-quirúrgica), PACIENTE / representante legal (firma manuscrita digital), super-usuarios de admisión y quirófano.
**Versión:** 1.0
**Pre-requisito:** capacitación rol completada (`docs/16_capacitacion_plan.md`) + PIN de firma electrónica argon2id configurado + valoración preoperatoria (`PREOP`) cerrada (cirugía electiva).
**Referencia normativa:** `docs/flujos/CONS_QX.md` (Art. 39 y Art. 40 NTEC) y `docs/31_flujos_operativos_consolidado.md` §CONS_QX.

> **Nota sobre screenshots:** este manual usa anotaciones `[Screenshot: …]` describiendo qué muestra cada captura. Las imágenes finales se incrustarán durante la fase F3 de e-learning antes del Go-Live.

---

## 1. Introducción

El **Consentimiento Informado Quirúrgico (CONS_QX)** es el documento médico-legal que respalda que el paciente ha sido **informado** y **autoriza** una intervención quirúrgica específica. Exige **doble firma** — paciente/representante y médico cirujano informante (Art. 39 NTEC) — y queda **inmutable** una vez firmado por el médico (Art. 40 NTEC).

Sin CONS_QX firmado vinculado al episodio, el sistema **bloquea** la apertura del acto quirúrgico (`ACTO_QX`): no se puede registrar la lista de cirugía segura OMS, el registro anestésico ni la nota operatoria.

## 2. ¿Quién lo usa?

| Rol | Acción |
|---|---|
| **MC / ESP (Cirujano principal)** | Explica al paciente procedimiento, riesgos, alternativas; firma con PIN al cierre. |
| **ESP (Anestesiólogo)** | Explica riesgos anestésicos en el anexo; firma el anexo (mecanismo PIN equivalente). |
| **PACIENTE** (o representante legal) | Firma manuscrita digital (canvas) o sube imagen escaneada. |
| **TESTIGO** (opcional, recomendable en menores/representantes) | Firma como testigo cuando el paciente es menor de edad o tiene representante. |
| **ENF / ADM** (apoyo logístico) | Verifica identidad del paciente antes de firmar, prepara la tablet/canvas. |

## 3. ¿Cuándo se usa?

- **SIEMPRE** en toda cirugía mayor electiva o de urgencia con margen razonable.
- **SIEMPRE** en cirugía menor con sedación o anestesia regional/general.
- **SIEMPRE** en cirugía ambulatoria mayor (CMA).
- **Una reintervención no programada** en el mismo episodio = **nuevo CONS_QX**, no adendum.
- **Excepción documentada:** paciente inconsciente con riesgo vital inminente, sin representante localizable → acta médica firmada por dos médicos; CONS_QX se completa retrospectivamente con `firmanteRol='excepcion_riesgo_vital'`.

**Cirugía menor con anestesia local únicamente** (sutura simple, drenaje absceso): se puede usar `CONS_INF` simplificado en lugar de `CONS_QX`.

## 4. Paso a paso — Crear y firmar el consentimiento

### Paso 1 — Iniciar el documento

1. Desde el episodio del paciente, navega a `/ece/consentimiento`.
2. Pulsa **"Nuevo consentimiento"** → wizard de 3 pasos.
3. En el Paso 1, selecciona tipo **"Quirúrgico"** → el sistema carga la plantilla CONS_QX con sus secciones obligatorias.

`[Screenshot 4.1: Selector de tipo en el wizard con 4 opciones: Hospitalización, Quirúrgico, Anestésico, Transfusional. Quirúrgico seleccionado.]`

### Paso 2 — Datos del procedimiento

1. **Procedimiento programado** (texto NO abreviado — el sistema rechaza abreviaturas).
   - Ejemplo válido: "Colecistectomía laparoscópica electiva por colelitiasis sintomática".
   - Ejemplo inválido: "Colecistectomía lap." (será marcado).
2. **Lateralidad / sitio anatómico** (cuando aplica): izquierdo, derecho, bilateral, no aplica.
3. **Tipo de anestesia planeada:** general, regional (subaracnoidea, epidural, plexual), local + sedación, local sola.
4. **Cirujano principal** (autocompleta con tu usuario; puedes cambiar si firmas en nombre de un colega bajo justificación).
5. **Anestesiólogo asignado** (selector del personal del servicio).

`[Screenshot 4.2: Formulario con campos del procedimiento, lateralidad como radio buttons obligatorio, y validación en vivo de abreviaturas.]`

### Paso 3 — Riesgos, alternativas y complicaciones

El sistema presenta una plantilla editable con 5 secciones:

1. **Riesgos quirúrgicos específicos** (precargados según procedimiento del catálogo CIE-9-CM/CPT, editables: sangrado, infección, lesión a estructuras vecinas, conversión a abierta).
2. **Riesgos anestésicos** (sección que firma el anestesiólogo; precargada según tipo de anestesia).
3. **Alternativas terapéuticas** (incluye **explícitamente** la opción "NO OPERAR" y su impacto pronóstico).
4. **Complicaciones frecuentes y severas** (lista por procedimiento; agregar específicas).
5. **Autorizaciones específicas** (checkboxes independientes, cada uno con explicación al paciente):
   - Autoriza **transfusión** de hemoderivados si fuese necesario.
   - Autoriza **ampliación quirúrgica** si los hallazgos intraoperatorios lo justifican.
   - Autoriza **fotografía / grabación** del procedimiento (docente o diagnóstico).

> **Importante:** explica al paciente cada autorización **separadamente** antes de marcarla. NO marques todas por defecto — el paciente debe consentir cada una en forma individual.

`[Screenshot 4.3: Tres secciones con texto editable y 3 checkboxes de autorizaciones independientes con explicación detallada al lado.]`

### Paso 4 — Firma del paciente

1. Pulsa **"Recoger firma del paciente"**.
2. Aparece un canvas digital (firma con dedo o stylus en tablet, o con mouse en escritorio).
3. **Verifica identidad** del paciente con DUI / NIT / NIE / pasaporte y compara con la pulsera GS1.
4. El paciente firma en el canvas.
5. Si el paciente NO puede firmar:
   - Menor de edad / interdicto → firma el representante legal (registra DUI/parentesco).
   - Analfabeto → huella dactilar digitalizada + firma de testigo presencial.
   - Inconsciente con riesgo vital → ver §3 excepción documentada.
6. Pulsa **"Guardar firma"** → se almacena como dataURL en `evidencia_firma_ref` y queda enlazada a `firmante_rol='paciente'` (o `'representante_legal'`).

`[Screenshot 4.4: Canvas de firma en pantalla completa con botones "Limpiar" y "Guardar firma". Arriba, datos del firmante (nombre, documento, parentesco si representante).]`

### Paso 5 — Firma del cirujano principal (con PIN)

1. Verifica que **toda** la información sea correcta (lateralidad, procedimiento, autorizaciones).
2. Pulsa el botón verde **"Firmar como médico cirujano"**.
3. Ingresa tu **PIN de firma electrónica** (4–6 dígitos, argon2id).
4. El sistema valida contra `ece.firma_electronica` con lockout a 5 intentos.
5. Al firmar exitosamente:
   - Estado pasa a `firmado`.
   - El trigger `ece.fn_bloquea_mutacion_consentimiento` activa la inmutabilidad — ya **NO** se puede editar (Art. 40 NTEC).
   - Se libera el bloqueo de `ACTO_QX`: el equipo quirúrgico puede iniciar lista OMS, registro anestésico y nota operatoria.
   - Se dispara evento `ece.consentimiento.firmado` al motor de workflow.

`[Screenshot 5.1: Diálogo "Firmar con PIN" con teclado numérico en pantalla y contador de intentos restantes.]`

### Paso 6 — Firma del anexo anestésico (anestesiólogo)

1. El anestesiólogo abre el consentimiento desde su lista de tareas pendientes.
2. Pulsa **"Firmar anexo anestésico"**.
3. Revisa/edita los riesgos anestésicos específicos (vía aérea difícil, hipersensibilidad a fármacos, riesgo de náusea y vómito, etc.).
4. Firma con su propio PIN.
5. El anexo queda registrado dentro del mismo `CONS_QX` (campo `evidencia_firma_anestesiologo_ref`).

> **Nota técnica:** el modelo de datos actual concentra la firma del cirujano y del anestesiólogo en campos del mismo documento; en futuras versiones podrán desagregarse a tabla separada (drift documentado en `docs/flujos/CONS_QX.md` §Drift conocido).

## 5. Revocación pre-procedimiento

El paciente **puede retirar** el consentimiento antes de que comience el procedimiento (antes del Sign In de la lista OMS):

1. En el detalle del consentimiento firmado, pulsa **"Revocar"**.
2. Motivo obligatorio (decisión del paciente, falta de información, segunda opinión, etc.).
3. Estado pasa a `revocado`.
4. El sistema **cancela automáticamente** la programación quirúrgica (`PROG_QX`) — libera quirófano, equipo y personal.
5. El documento permanece como evidencia (no se elimina) y queda firmado por el paciente en el acto de revocación.

> Una vez iniciado el procedimiento (`Sign In` registrado), el consentimiento queda como evidencia permanente y **no admite revocación retroactiva**.

## 6. Errores comunes

| Síntoma / Mensaje | Causa probable | Acción |
|---|---|---|
| "Tipo de documento CONS_QX no configurado en el catálogo ECE" | Seed pendiente en el ambiente | Reportar a L3 — DBA debe ejecutar `apply_migration` con seed `CONS_QX`. |
| "El procedimiento contiene abreviaturas" | "colecistectomía lap." | Escribir nombre completo. |
| "Falta consentimiento informado para ACTO_QX" | Intento de iniciar acto quirúrgico sin CONS_QX firmado | Firmar consentimiento antes. |
| "PIN bloqueado tras 5 intentos" | PIN mal digitado 5 veces | Contactar admin para desbloqueo. |
| Canvas de firma no responde al stylus | Permisos navegador / driver pantalla táctil | Verificar permisos; alternativa: upload de imagen escaneada. |
| Botón "Firmar" deshabilitado | Faltan checkboxes obligatorios o el paciente aún no firmó | Revisar la cinta de progreso a la izquierda. |
| "El paciente ya tiene consentimiento firmado para esta cirugía" | Doble emisión | Validar; si es reintervención, crear nuevo (no adendum). |

## 7. Buenas prácticas

- **Explica con el paciente delante, no al firmar.** El consentimiento es un acto de información, no un trámite. Dedica el tiempo necesario.
- **Lateralidad SIEMPRE explícita** — esto evita el "wrong-site surgery", uno de los nunca-eventos JCI.
- **Documenta la opción NO OPERAR** y su pronóstico — es parte esencial del consentimiento informado.
- **Firma el paciente PRIMERO, luego el cirujano.** Si el orden se invierte, registra el motivo (urgencia, etc.).
- **Para urgencias con margen razonable:** intenta firmar antes de la inducción anestésica.
- **Tu PIN es personal e intransferible** — la firma electrónica argon2id es la base médico-legal de la inmutabilidad.

## 8. Soporte

- L1 (super-usuario de quirófano): extensión 5054.
- L2 (Jefatura de Cirugía / Anestesia): WhatsApp grupo "HIS Hipercuidado".
- L3 (técnico): Slack `#his-hipercuidado`.
- **Falla de impresora para copia física:** la firma electrónica es legalmente suficiente. La copia impresa es entrega al paciente, no requisito de validez. Imprimir cuando se restablezca.
- Documentación normativa: `docs/flujos/CONS_QX.md`, `docs/flujos/CONS_INF.md` y `docs/31_flujos_operativos_consolidado.md`.
