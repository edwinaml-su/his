# Manual de Usuario — Módulo de Admisión

**Audiencia:** ADMISSION_CLERK (admisionista) — también útil para Ops Lead.
**Versión:** 1.1 (extendida con secciones Phase 2)
**Pre-requisito:** capacitación rol completada (`docs/16_capacitacion_plan.md`).
**Nota v1.1:** se añaden anexos B (verificación elegibilidad aseguradora §25), C (asignación de cama hospitalización §11) y D (flujo programado vs urgencia §10/§12). Screenshots placeholders pendientes de captura final en T-7d.

> **Nota sobre screenshots:** este manual usa anotaciones `[Screenshot: …]` describiendo qué muestra cada captura. Las imágenes finales se incrustarán durante la fase F3 de e-learning antes del Go-Live.

---

## 1. Conceptos clave

| Término | Definición |
|---|---|
| Admisión | Proceso de registrar la entrada de un paciente al hospital con un episodio clínico. |
| Episodio | Unidad de atención (urgencias, hospitalización, consulta externa). |
| NN | Paciente sin documentos al ingreso; se identifica posteriormente. |
| Acompañante | Persona responsable, registrada con datos de contacto. |
| Aseguradora / Plan | Cobertura financiera del episodio. |

## 2. Acceso

1. Ingresar a `https://his.avante.local`.
2. Login con correo institucional + contraseña + 2FA.
3. Verificar que el topbar muestre tu organización y el rol `ADMISSION_CLERK`.
4. Click en **"Nueva admisión"** desde el dashboard, o navegar a `/admission`.

`[Screenshot 2.1: Dashboard post-login mostrando atajo "Nueva admisión" destacado en la tarjeta Atajos.]`

## 3. Flujo: admisión de paciente conocido

### Paso 1 — Búsqueda

`[Screenshot 3.1: Campo de búsqueda con tipos de identificación (CC, TI, CE, Pasaporte) y placeholder "Documento o nombre".]`

1. Tipo de documento + número.
2. Pulsar **Enter** o lupa.
3. Si hay coincidencia única → se autocompleta el formulario.
4. Si hay múltiples → seleccionar de la lista mostrando: documento, nombres, fecha nacimiento, sexo.

> **Tip:** si el paciente no aparece, pulsa **"Crear paciente nuevo"** en lugar de admitir un homónimo.

### Paso 2 — Verificación de datos

`[Screenshot 3.2: Formulario en dos columnas: identificación y demografía a la izquierda, contacto y dirección a la derecha. Campos requeridos marcados con *.]`

- Confirmar con el paciente nombre completo, fecha de nacimiento y dos teléfonos.
- Actualizar dirección si cambió.
- Registrar acompañante (nombre + parentesco + teléfono).

### Paso 3 — Datos del episodio

`[Screenshot 3.3: Selector de tipo de episodio (Urgencias / Programado / Hospitalización), motivo de consulta (texto libre, máx 200 chars), servicio destino y aseguradora.]`

- **Tipo de episodio:** elegir según vía de ingreso.
- **Motivo:** descripción breve del paciente (no diagnóstico).
- **Aseguradora:** se sugiere la última usada; verificar vigencia.
- **Plan:** se filtra según aseguradora seleccionada.

### Paso 4 — Confirmación y pulsera

`[Screenshot 3.4: Pantalla de resumen con botón "Imprimir pulsera" y "Confirmar admisión".]`

1. Revisar resumen.
2. Pulsar **"Confirmar admisión"** → genera ID episodio.
3. Imprimir pulsera (impresora térmica de la estación).
4. Verificar que el código de barras escanea correctamente antes de entregar.

## 4. Flujo: admisión NN (sin documentos)

`[Screenshot 4.1: Modal "Crear NN" con campos opcionales: sexo aparente, edad estimada, foto del paciente (cámara o upload), seña particular.]`

1. Pulsar **"Admisión NN"** desde la pantalla de búsqueda.
2. Capturar foto (la cámara web se activa al pulsar el botón).
3. Indicar sexo aparente y rango de edad.
4. Continuar al paso 3 (episodio) — sistema asigna ID temporal `NN-YYYYMMDD-####`.
5. Cuando lleguen documentos → ver §5.

## 5. Flujo: re-identificación de paciente NN

1. Buscar episodio por ID temporal `NN-...` o por código de pulsera.
2. Pulsar **"Identificar paciente"**.
3. Ingresar documentos.
4. Sistema busca duplicados (homónimos, mismo documento) y solicita confirmación.
5. Confirmar fusión → todos los registros (signos, notas, órdenes) quedan vinculados al paciente real.
6. Auditoría queda con trazabilidad de la operación.

`[Screenshot 5.1: Diálogo "Posibles coincidencias" mostrando 2 candidatos con porcentaje de similitud y botón "Es la misma persona" / "Crear nuevo".]`

## 6. Casos de uso comunes

### 6.1 Cambio de aseguradora durante el episodio
- Ir al episodio → pestaña **Cobertura** → **"Agregar nueva cobertura"**.
- Especificar fecha desde / hasta.
- La facturación se segmenta automáticamente.

### 6.2 Reversa de admisión (error)
- Solo dentro de la primera hora y sin actividad clínica.
- Episodio → menú ⋯ → **"Reversar admisión"** → motivo obligatorio.
- Genera evento en audit log.

### 6.3 Admisión programada (cita previa)
- Buscar la cita en agenda.
- Pulsar **"Admitir paciente"** desde la cita → datos pre-cargados.
- Verificar y confirmar.

## 7. FAQ

**¿Por qué no me deja admitir?**
Verifica: (1) tienes rol `ADMISSION_CLERK`, (2) seleccionaste organización en el switcher, (3) la sede tiene servicio activo para ese tipo de episodio.

**¿Qué hago si la pulsera no escanea?**
Reimprimir desde el episodio (botón "Reimprimir pulsera"). No editar manualmente el código.

**¿Puedo admitir el mismo paciente dos veces simultáneamente?**
No para el mismo tipo de episodio. El sistema bloqueará y mostrará el episodio activo.

**¿Cómo registro a un menor sin acompañante presente?**
Marca "Sin acompañante al ingreso" + nota libre + escala a Trabajo Social automáticamente.

## 8. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| "No tienes permiso para esta acción" | Rol no asignado a la sede | Solicitar a ADMIN asignación |
| Campo aseguradora vacío | Catálogo de aseguradoras desincronizado | Reportar a L2 |
| Lentitud al guardar (> 5 s) | Conectividad o pico de carga | Reintentar; si persiste, escalar a L3 |
| "Documento ya registrado" pero el paciente niega | Posible homónimo o duplicado | Buscar por nombre + verificar fecha de nacimiento; nunca crear duplicado |
| Pulsera sin imprimir | Driver impresora caído | Reiniciar spooler local; pulsar reimprimir |

## 9. Atajos de teclado

| Acción | Atajo |
|---|---|
| Buscar paciente | `Ctrl + K` |
| Nueva admisión | `Alt + N` |
| Confirmar formulario | `Ctrl + Enter` |
| Cancelar / cerrar modal | `Esc` |

## 10. Soporte

- L1 (super-usuario de turno): extensión interna 5050.
- L2 (Ops Lead): WhatsApp grupo "HIS Hipercuidado".
- L3 (técnico): canal Slack `#his-hipercuidado` o ticket en helpdesk.

---

## Anexo B — Verificación de elegibilidad de aseguradora (§25 Insurance)

`[Screenshot B.1: Modal "Verificar elegibilidad" mostrando aseguradora, número de afiliado, fecha consulta. Botón "Consultar" dispara llamada a servicio externo (mock Wave 1).]`

### B.1 Flujo durante la admisión

1. Tras seleccionar aseguradora en Paso 3, pulsar **"Verificar elegibilidad"**.
2. El sistema consulta el servicio (mock Wave 1; real Wave 2 ISSS/aseguradoras).
3. Resultado:
   - **Elegible:** se muestra plan, coberturas activas, copago. Continuar admisión.
   - **No elegible:** mostrar motivo (suspendido, cancelado, no cubre el servicio). El admisionista debe registrar episodio como **PARTICULAR** o solicitar autorización (Anexo B.2).
4. El resultado se guarda en `EligibilityCheck` ligado al episodio (auditado).

`[Screenshot B.2: Resultado positivo con detalle de plan, copago $5, cobertura activa hasta DD/MM/AAAA, lista de servicios cubiertos.]`

### B.2 Solicitud de autorización previa

Para procedimientos programados que requieren autorización:

1. En la pantalla del episodio, sección Aseguradora, pulsar **"Solicitar autorización"**.
2. Llenar formulario: procedimiento (CUPS), diagnóstico (CIE-10), justificación clínica, fecha programada.
3. Adjuntar documentos solicitados (imágenes, resultados previos).
4. El sistema genera `AuthorizationRequest` y la envía al canal de la aseguradora.
5. Estado se actualiza vía webhook (Pending → Approved/Denied).

`[Screenshot B.3: Lista de autorizaciones en seguimiento con estado, fecha solicitud, fecha respuesta esperada.]`

### B.3 Errores comunes Anexo B

| Mensaje | Causa | Acción |
|---|---|---|
| "Servicio aseguradora no responde" | Outage del servicio externo | Reintentar 3 veces; si persiste registrar manualmente "verificación papel" |
| "Afiliado no encontrado" | Número erróneo o aseguradora errónea | Validar con paciente; revisar carné físico |
| "Procedimiento no cubierto" | Plan no incluye el CUPS | Informar al paciente; ofrecer registro como particular |

---

## Anexo C — Admisión con asignación de cama (§11 Inpatient)

`[Screenshot C.1: Paso 4 ampliado mostrando selector de unidad (Med Interna, UCI, Pediatría, Ginecobs, Cirugía) y mapa de camas disponibles.]`

### C.1 Cuando aplica

- Episodio tipo **Hospitalización**.
- Requiere asignación de cama antes de generar pulsera.

### C.2 Flujo

1. En Paso 3, seleccionar tipo episodio **Hospitalización**.
2. El Paso 4 se amplía con sección "Asignación de cama":
   - Unidad / servicio de hospitalización (desplegable).
   - Mapa visual de camas disponibles, con código y estado (Libre, Ocupada, Limpieza, Mantenimiento).
   - Restricciones por aislamiento (paciente con MRSA → camas individuales).
3. Confirmar selección → `BedAssignment` creado, cama pasa a `Ocupada`.
4. Pulsera se imprime con código de cama incluido.
5. El sistema notifica a Enfermería de la unidad la nueva admisión.

`[Screenshot C.2: Mapa de camas con colores: verde=libre, rojo=ocupada, amarillo=limpieza, gris=mantenimiento. Camas con icono de aislamiento marcadas.]`

### C.3 Manejo de "no hay cama disponible"

- Si la unidad solicitada está full, sistema sugiere unidades alternas según afinidad clínica.
- Coordinar con Jefatura de Hospitalización antes de admitir.
- En contingencia, registrar como **"Pendiente de cama"** (LWB = Lying Without Bed) y dejar paciente en sala de observación.

---

## Anexo D — Diferencias programado vs urgencia (§10/§12)

| Atributo | Programado (§10) | Urgencia (§12) |
|---|---|---|
| Pre-requisito | Cita previa en Schedule | Llegada espontánea |
| Verificación elegibilidad | Anticipada (T-1d a T-3d) | En el momento, opcional |
| Autorización previa | Obligatoria si aplica | No bloqueante (post-atención) |
| Asignación servicio | Pre-asignado en la cita | Definido por Triage |
| Flujo post-admisión | Check-in → In-Consult | Triage → Box atención |

### D.1 Admisión de paciente con cita programada (§10 Outpatient)

1. Buscar paciente.
2. En vez de "Nueva admisión", buscar **"Check-in cita"**.
3. Sistema muestra citas del día para ese paciente.
4. Confirmar cita, validar identificación, marcar **CheckedIn**.
5. Paciente queda visible en cola del médico (`OutpatientEncounter`).

`[Screenshot D.1: Pantalla de check-in mostrando cita 10:30 con Dr. González, motivo "Control DM2", aseguradora ISSS, estado "Booked → CheckedIn".]`

### D.2 Admisión de urgencias (§12)

1. Admisión rápida (datos mínimos obligatorios: identificación + motivo).
2. Sistema genera episodio Urgencias.
3. Paciente pasa automáticamente a la cola de Triage.
4. Datos demográficos y aseguradora se completan en paralelo o al alta.

`[Screenshot D.2: Pantalla admisión rápida con 4 campos: tipo doc + número + motivo en palabras del paciente + acompañante. Tiempo objetivo < 90s.]`
