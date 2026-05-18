# 01 — Escenarios UAT Go-Live

**Proyecto:** HIS Multipaís — Inversiones Avante  
**Autor:** @QAF — Quality Analyst (BDD) con revisión @SRE  
**Versión:** 1.0 — 2026-05-18  
**Referencias:** `docs/05_backlog.md`, sprint reviews F2-S1 a F2-S7, `TDR_HIS_Multipais.md`

> 25 escenarios distribuidos en 5 roles. Cada escenario tiene criterio de aceptación binario (PASA/FALLA). El UAT se ejecuta en ambiente de staging con datos reales de prueba antes de promover a producción. Requiere firma del Clinical Lead y Director Médico para aprobar go-live.

---

## Instrucciones de ejecución

**Ambiente:** staging (branch `main` en Vercel Preview con BD de staging).  
**Usuarios de prueba:** ver `apps/web/e2e/_helpers/` y `packages/database/scripts/seed-test-users.mjs`.  
**Duración estimada:** 3-4 horas total (todos los roles en paralelo).  
**Ejecutores:** super-usuarios certificados de cada rol, acompañados por un miembro del equipo funcional.  
**Registro:** cada escenario debe completarse con firma del ejecutor y resultado en la columna "Resultado".

| Escenario | Ejecutor | Resultado | Firma | Fecha |
|---|---|---|---|---|
| MC-01 a MC-05 | | | | |
| ENF-01 a ENF-05 | | | | |
| FARM-01 a FARM-05 | | | | |
| DIR-01 a DIR-05 | | | | |
| ADMIN-01 a ADMIN-05 | | | | |

---

## Rol: Médico Clínico (MC)

**Usuario de prueba:** `qa.mc@his.test` / `TestPass123!`  
**Prerrequisitos:** paciente activo en BD, establecimiento configurado con gs1CompanyPrefix.

### MC-01 — Consulta externa: primer contacto con paciente

**Objetivo:** verificar que el médico puede buscar un paciente y ver su historia clínica.

**Pasos:**
1. Iniciar sesión como MC en `/login`.
2. Navegar a `/patients`.
3. Buscar paciente por nombre "MARIA GARCIA LOPEZ".
4. Seleccionar paciente → verificar que carga el expediente.
5. Verificar que se muestran: datos demográficos, alergias, últimos encuentros.

**Criterio de aceptación:**
- Búsqueda retorna resultado en < 3 segundos.
- Expediente carga sin errores 500.
- Datos demográficos visibles (nombre, DUI, fecha nacimiento).
- Si el paciente no tiene historia previa, se muestra estado vacío (no error).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### MC-02 — Ordenar estudios de laboratorio

**Objetivo:** verificar el flujo completo de orden de laboratorio desde la consulta.

**Pasos:**
1. Desde el expediente del paciente (MC-01), navegar a "Indicaciones".
2. Seleccionar "Nueva orden de laboratorio".
3. Buscar examen: "Hemograma completo".
4. Agregar diagnóstico provisional (CIE-10): "Z00.0 Examen médico general".
5. Guardar la orden.
6. Verificar que la orden aparece en el listado con estado "PENDIENTE".

**Criterio de aceptación:**
- Búsqueda de exámenes retorna resultados (catálogo cargado).
- Orden se guarda exitosamente.
- Estado inicial es PENDIENTE.
- Audit log registra la acción del médico.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### MC-03 — Evolución clínica SOAP

**Objetivo:** verificar que el médico puede registrar una nota de evolución.

**Pasos:**
1. Desde el expediente del paciente, navegar a "Evoluciones".
2. Crear nueva nota con estructura SOAP:
   - S: "Paciente refiere cefalea de 3 días de evolución."
   - O: "TA 120/80, FC 72, FR 16."
   - A: "Cefalea tensional."
   - P: "Analgésico, reposo."
3. Guardar la nota.
4. Verificar que la nota aparece con timestamp y nombre del médico.

**Criterio de aceptación:**
- Formulario SOAP disponible y funcional.
- Nota guardada con timestamp correcto (zona horaria America/El_Salvador).
- Nombre del médico vinculado a la nota (no un ID genérico).
- Nota es inmutable post-guardado (no se puede editar sin audit trail).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### MC-04 — Prescripción de medicamento

**Objetivo:** verificar el flujo de prescripción con validación de alergias.

**Pasos:**
1. Desde el expediente del paciente, navegar a "Prescripciones".
2. Nueva prescripción: buscar "Amoxicilina 500mg".
3. Indicar dosis: 1 cápsula cada 8 horas por 7 días.
4. Si el paciente tiene alergia a penicilinas → verificar que aparece alerta visible.
5. Si no hay alergia → guardar prescripción.
6. Verificar que la prescripción queda en estado "ACTIVA".

**Criterio de aceptación:**
- Búsqueda de medicamentos retorna resultados del catálogo.
- Si hay alergia cruzada: alerta visible (no bloqueo silencioso).
- Prescripción guardada con dosis, frecuencia y duración.
- Estado inicial ACTIVA.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### MC-05 — Firma electrónica de documento ECE

**Objetivo:** verificar que el médico puede firmar un documento con su PIN.

**Pasos:**
1. Navegar a un documento ECE pendiente de firma (ej: epicrisis o nota de alta).
2. Revisar el contenido del documento.
3. Seleccionar "Firmar con PIN".
4. Ingresar PIN de 6 dígitos.
5. Verificar que el documento queda con estado "FIRMADO" y el timestamp de firma visible.

**Criterio de aceptación:**
- PIN incorrecto: alerta clara, no bloquea la cuenta hasta 3 intentos.
- PIN correcto: documento firmado, estado cambia a FIRMADO.
- Firma es inmutable (no se puede deshacer desde la UI).
- Hash de firma visible en el documento.
- Audit log registra la firma con timestamp.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

## Rol: Enfermería (ENF)

**Usuario de prueba:** `qa.triagist@his.test` / `TestPass123!`  
**Prerrequisitos:** paciente activo, turno de enfermería configurado.

### ENF-01 — Triaje Manchester: clasificación de paciente

**Objetivo:** verificar el flujo completo de triaje Manchester con asignación de color.

**Pasos:**
1. Iniciar sesión como ENF en `/login`.
2. Navegar a `/triage`.
3. Seleccionar "Nuevo triaje".
4. Buscar paciente por nombre o crear walk-in.
5. Seleccionar discriminante: "Dolor torácico agudo".
6. Registrar signos vitales: FC 110, TA 90/60, FR 24, SpO2 92%.
7. El sistema asigna color (esperar resultado del algoritmo Manchester).
8. Confirmar y guardar.

**Criterio de aceptación:**
- Algoritmo Manchester asigna color basado en discriminante + vitales (para este caso: rojo o naranja).
- Tiempo de asignación de color < 3 segundos.
- Triaje queda registrado con timestamp, usuario ENF, y discriminante.
- Bridge ECE `eceBridgeTriage` sincroniza a `ece.hoja_triaje`.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ENF-02 — Registro de signos vitales

**Objetivo:** verificar el registro de signos vitales por enfermería.

**Pasos:**
1. Navegar al expediente del paciente → "Signos Vitales".
2. Nuevo registro: FC=80, TA=120/80, FR=16, Temp=36.5°C, SpO2=98%, Peso=70kg, Talla=170cm.
3. Guardar.
4. Verificar que aparece en la gráfica de tendencia.

**Criterio de aceptación:**
- Todos los campos capturados correctamente.
- Cálculo automático de IMC (70/1.70²= 24.2).
- Registro con timestamp y nombre de enfermería.
- Gráfica de tendencia visible (aunque sea 1 punto).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ENF-03 — Registro de enfermería (nota de cuidados)

**Objetivo:** verificar que enfermería puede registrar notas de cuidados.

**Pasos:**
1. Navegar al expediente del paciente → "Notas de Enfermería".
2. Nueva nota: "Paciente con vía periférica en brazo derecho, permeable. Se administró SF 0.9% 500cc IV en 4h. Sin incidentes."
3. Guardar.
4. Verificar que aparece con timestamp y nombre de enfermería.

**Criterio de aceptación:**
- Nota guardada exitosamente.
- Timestamp correcto (zona horaria El Salvador).
- Nota visible en el expediente del paciente.
- Audit trail disponible.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ENF-04 — Bedside scan: verificación de los 5 correctos

**Objetivo:** verificar el hard-stop bedside cuando el medicamento no coincide con la prescripción.

**Pasos:**
1. Navegar a `/bedside` (o usar la PWA bedside en tablet).
2. Escanear (o simular scan) la pulsera GSRN del paciente.
3. Seleccionar la indicación de medicamento activa.
4. Escanear (o simular) el DataMatrix de un medicamento **diferente** al prescrito.
5. Verificar que el sistema muestra hard-stop `MEDICAMENTO_NO_COINCIDE`.
6. Escanear el medicamento correcto → verificar que el sistema permite continuar.

**Criterio de aceptación:**
- Hard-stop visible con mensaje claro: "MEDICAMENTO NO COINCIDE. Medicamento escaneado no corresponde a la prescripción activa."
- El hard-stop bloquea la administración (no se puede continuar sin resolver).
- Con medicamento correcto: flujo avanza a confirmación de dosis.
- Tiempo de respuesta del servidor 5 Correctos: < 200ms (SLO mandatorio).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ENF-05 — Kardex de medicamentos

**Objetivo:** verificar que el kardex muestra el estado actual de administraciones.

**Pasos:**
1. Navegar al kardex del paciente (desde expediente o bedside).
2. Verificar que se listan todas las prescripciones activas con su estado.
3. Verificar que las administraciones completadas muestran timestamp y porcentaje BCMA.
4. Verificar que las canceladas muestran motivo de cancelación.

**Criterio de aceptación:**
- Kardex carga sin errores.
- Columnas visibles: medicamento, dosis, frecuencia, próxima dosis, % BCMA administrado.
- Estado ADMINISTRADO con timestamp del scan.
- Estado CANCELADO con motivo documentado.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

## Rol: Farmacéutico (FARM)

**Usuario de prueba:** `qa.pharmacist@his.test` / `TestPass123!`  
**Prerrequisitos:** prescripciones activas, catálogo GS1 con GTINs configurados.

### FARM-01 — Picking station con hard-stop (lote vencido)

**Objetivo:** verificar que el picking station bloquea la dispensación de medicamento vencido.

**Pasos:**
1. Iniciar sesión como FARM, navegar a `/pharmacy/dispensation`.
2. Seleccionar orden de dispensación activa.
3. En el picking station, escanear (simular) DataMatrix de medicamento con fecha vencimiento = ayer.
4. Verificar hard-stop `MEDICAMENTO_VENCIDO`.
5. Escanear medicamento vigente → verificar que el sistema acepta.

**Criterio de aceptación:**
- Hard-stop `MEDICAMENTO_VENCIDO` bloquea con mensaje: "Lote vencido. Fecha de vencimiento: [fecha]. No dispensar."
- Sistema registra el intento de dispensación del lote vencido en audit log.
- Con lote vigente: dispensación continúa normalmente.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### FARM-02 — Sustitución autorizada (flujo médico → farmacia)

**Objetivo:** verificar el flujo de solicitud y aprobación de sustitución de medicamento.

**Pasos:**
1. FARM inicia solicitud de sustitución: medicamento prescrito no disponible en stock.
2. Sistema notifica al MC (polling 15s en interfaz del médico).
3. MC aprueba la sustitución con el medicamento alternativo.
4. FARM verifica que la sustitución aparece aprobada en su pantalla (polling 30s).
5. FARM procede con la dispensación del medicamento sustituto.

**Criterio de aceptación:**
- Notificación llega al MC en < 30 segundos (polling).
- Aprobación del MC actualiza el estado en FARM en < 30 segundos.
- Audit log registra: solicitante, aprobador, medicamento original, medicamento sustituto.
- Sustitución queda en estado AUTORIZADA e inmutable.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### FARM-03 — Carrito unidosis: preparación y despacho

**Objetivo:** verificar el flujo completo del carrito unidosis por turno.

**Pasos:**
1. Navegar a `/pharmacy/cart`.
2. Crear nuevo carrito para turno "Mañana" + sala configurada.
3. Agregar medicamentos al carrito (al menos 3 pacientes, 2 medicamentos c/u).
4. Cambiar estado a LISTO.
5. Despachar carrito → cambiar a DESPACHADO.
6. Desde enfermería, confirmar recepción con firma.

**Criterio de aceptación:**
- State machine respeta: ARMANDO → LISTO → DESPACHADO → RECIBIDO.
- EPCIS event generado al despachar.
- Recepción requiere firma de enfermería (no puede confirmarla el mismo farmacéutico).
- Kardex actualizado post-recepción.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### FARM-04 — Recepción de medicamentos en farmacia

**Objetivo:** verificar el proceso de ingreso de medicamentos al stock.

**Pasos:**
1. Navegar a recepción de farmacia.
2. Registrar ingreso de lote: GTIN + número de lote + fecha vencimiento + cantidad.
3. Verificar que el lote aparece en el inventario.
4. Verificar que el GTIN coincide con el catálogo de medicamentos GS1.

**Criterio de aceptación:**
- GTIN validado contra catálogo (GS1 AI 01).
- Lote registrado con toda la información requerida.
- Stock actualizado en inventario.
- Si el GTIN no existe en catálogo: alerta (no bloqueo — puede ser medicamento nuevo).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### FARM-05 — Manejo de alarma de alergia en dispensación

**Objetivo:** verificar el hard-stop de alergia durante la dispensación.

**Pasos:**
1. Configurar paciente de prueba con alergia a "Penicilina" en su perfil.
2. Desde picking station, intentar dispensar Amoxicilina al paciente alérgico.
3. Verificar hard-stop full-screen `ALERGIA_DETECTADA`.
4. Verificar que el FARM no puede omitir el hard-stop sin confirmación explícita con doble click.
5. Si el FARM confirma (paciente acepta el riesgo): dispensación procede con documentación obligatoria.

**Criterio de aceptación:**
- Hard-stop full-screen rojo visible.
- Mensaje: "ALERGIA DETECTADA. Paciente con alergia documentada a [principio activo]."
- Requiere doble confirmación para continuar.
- Si se confirma: audit log registra la excepción con usuario, timestamp y motivo.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

## Rol: Director Médico (DIR)

**Usuario de prueba:** `qa.director@his.test` / `TestPass123!`  
**Prerrequisitos:** expedientes con documentos pendientes de certificación, cola ARCO con solicitudes.

### DIR-01 — Certificación de expediente clínico

**Objetivo:** verificar que el Director puede certificar un expediente para efectos legales.

**Pasos:**
1. Iniciar sesión como DIR, navegar a "Cola de Certificaciones".
2. Seleccionar expediente con estado "PENDIENTE CERTIFICACIÓN".
3. Revisar el expediente completo (historia clínica, evoluciones, diagnósticos).
4. Certificar con PIN.
5. Verificar que el expediente cambia a estado "CERTIFICADO" con sello del director.

**Criterio de aceptación:**
- Cola de certificaciones muestra expedientes correctamente.
- Certificación requiere PIN del director (mismo mecanismo que firma médica).
- Expediente certificado es inmutable (bloqueado para ediciones).
- Audit log registra la certificación.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### DIR-02 — Cola de rectificaciones ECE

**Objetivo:** verificar que el Director gestiona las solicitudes de rectificación.

**Pasos:**
1. Navegar a "Cola de Rectificaciones" (documentos ECE que requieren corrección post-firma).
2. Revisar una solicitud de rectificación pendiente.
3. Aprobar o rechazar la rectificación con justificación.
4. Verificar que el documento refleja la decisión.

**Criterio de aceptación:**
- Cola de rectificaciones visible y ordenada por fecha.
- Aprobación/rechazo requiere justificación escrita (campo obligatorio).
- Decisión queda registrada en audit log.
- Médico solicitante notificado (si hay sistema de notificaciones).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### DIR-03 — Cola ARCO (Acceso, Rectificación, Cancelación, Oposición)

**Objetivo:** verificar el flujo de gestión de derechos ARCO de pacientes.

**Pasos:**
1. Navegar a "Cola ARCO".
2. Seleccionar solicitud tipo "Acceso a expediente" de paciente.
3. Verificar la identidad del solicitante (datos en la solicitud).
4. Aprobar la solicitud y generar el expediente para entrega.
5. Registrar la entrega con firma del paciente o representante.

**Criterio de aceptación:**
- Cola ARCO visible con tipo de solicitud (Acceso/Rectificación/Cancelación/Oposición).
- Plazo de respuesta visible (SLA legal: 30 días hábiles).
- Aprobación genera registro inmutable de la entrega.
- Audit log completo del proceso ARCO.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### DIR-04 — Comité ECE: minuta y acuerdos

**Objetivo:** verificar que el Director puede registrar la minuta del comité de expediente clínico electrónico.

**Pasos:**
1. Navegar a "Comité ECE" → "Nueva Sesión".
2. Registrar fecha, asistentes y agenda.
3. Agregar puntos de minuta con acuerdos.
4. Firmar la minuta con PIN.
5. Publicar la minuta para todos los asistentes.

**Criterio de aceptación:**
- Formulario de minuta disponible y funcional.
- Firma digital del director vinculada a la minuta.
- Minuta publicada visible para los asistentes listados.
- Inmutable post-firma.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### DIR-05 — Dashboard de calidad documental

**Objetivo:** verificar que el Director visualiza métricas de calidad del expediente.

**Pasos:**
1. Navegar a "Dashboard Calidad Documental" (o equivalente en `/dashboard`).
2. Verificar que se muestran: expedientes completos %, documentos pendientes firma, tiempo promedio de llenado.
3. Verificar filtros por unidad/servicio/periodo.
4. Exportar reporte en al menos un formato.

**Criterio de aceptación:**
- Dashboard carga en < 3 segundos.
- Métricas relevantes visibles (no páginas en blanco).
- Filtros funcionales.
- Al menos un formato de exportación disponible (PDF o Excel).

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

## Rol: Administrador del sistema (ADMIN)

**Usuario de prueba:** `qa.admin@his.test` / `TestPass123!`  
**Prerrequisitos:** organización configurada.

### ADMIN-01 — Configurar gs1CompanyPrefix por organización

**Objetivo:** verificar que el ADMIN puede configurar el prefijo GS1 de la organización.

**Pasos:**
1. Iniciar sesión como ADMIN, navegar a "Administración → Organizaciones".
2. Seleccionar "Avante Complejo Hospitalario".
3. Editar: gs1CompanyPrefix = "7503000" (7 dígitos para El Salvador).
4. Guardar.
5. Verificar que los GTINs generados usan el prefijo correcto.

**Criterio de aceptación:**
- Campo gs1CompanyPrefix editable en el formulario de organización.
- Validación: debe ser 7-9 dígitos numéricos.
- Cambio guardado exitosamente.
- GTINs generados post-cambio reflejan el nuevo prefijo.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ADMIN-02 — Gestión de roles y usuarios

**Objetivo:** verificar que el ADMIN puede crear un usuario y asignarle roles.

**Pasos:**
1. Navegar a "Administración → Usuarios".
2. Crear nuevo usuario: nombre, email, rol NURSE, establecimiento "Urgencias".
3. Verificar que el usuario recibe invitación por email (o que se puede generar contraseña temporal).
4. Verificar que el usuario creado aparece en el listado con rol correcto.

**Criterio de aceptación:**
- Formulario de creación de usuario funcional.
- Rol asignado correctamente (no rol por defecto incorrecto).
- Usuario visible en listado con estado "Invitado" o "Activo".
- Audit log registra la creación con el ADMIN como actor.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ADMIN-03 — Audit dashboard: integridad de cadena hash

**Objetivo:** verificar que el ADMIN puede revisar la integridad del audit log.

**Pasos:**
1. Navegar a "Administración → Audit Log" o ejecutar el verificador de cadena hash.
2. Filtrar por las últimas 24 horas.
3. Verificar que la columna "chain_hash" tiene valores para todos los registros.
4. Verificar que el verificador de cadena retorna "ÍNTEGRA".

**Criterio de aceptación:**
- Audit log accesible desde la interfaz de administración.
- 0 registros con chain_hash NULL en las últimas 24h.
- Verificador de integridad retorna estado "ÍNTEGRA" (o equivalente verde).
- Si hay ruptura: alerta visible con el registro donde ocurrió.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ADMIN-04 — Depuración de usuarios inactivos

**Objetivo:** verificar que el ADMIN puede desactivar usuarios que ya no deben tener acceso.

**Pasos:**
1. Navegar a "Administración → Usuarios".
2. Filtrar por "Último acceso: hace más de 90 días".
3. Seleccionar un usuario inactivo de prueba.
4. Desactivar cuenta.
5. Verificar que el usuario desactivado ya no puede iniciar sesión.

**Criterio de aceptación:**
- Filtro de inactividad funcional.
- Desactivación inmediata (no requiere redeploy).
- Usuario desactivado recibe error de autenticación al intentar login (no mensaje de "contraseña incorrecta").
- Audit log registra la desactivación.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

### ADMIN-05 — Workflow designer: configuración de flujo

**Objetivo:** verificar que el ADMIN puede consultar y configurar workflows del sistema.

**Pasos:**
1. Navegar a `/workflow-designer`.
2. Visualizar el listado de workflows activos (ej: "Triaje Manchester", "Dispensación GS1").
3. Seleccionar un workflow y ver su configuración.
4. Verificar que se pueden ver los pasos, roles asignados y hard-stops.
5. (Si habilitado) Modificar un parámetro de configuración y guardar.

**Criterio de aceptación:**
- Workflow designer carga sin errores.
- Listado de workflows visibles (mínimo 2).
- Detalle del workflow muestra pasos y roles.
- Modificaciones (si aplica) se guardan y reflejan en el sistema.

**Resultado:** [ ] PASA / [ ] FALLA  
**Notas:** `_______________________`

---

## Resumen de firmas UAT

| Rol | Ejecutor | Escenarios PASA | Escenarios FALLA | Firma | Fecha |
|---|---|---|---|---|---|
| Médico Clínico | | /5 | /5 | | |
| Enfermería | | /5 | /5 | | |
| Farmacéutico | | /5 | /5 | | |
| Director Médico | | /5 | /5 | | |
| Administrador | | /5 | /5 | | |
| **TOTAL** | | **/25** | **/25** | | |

**Criterio de aprobación go-live:** ≥ 23/25 PASA, los 2 fallos (si los hay) no son en MC-05 (firma electrónica), ENF-04 (5 correctos), o FARM-01 (medicamento vencido) — estos son hard-stops de seguridad clínica que deben pasar al 100%.

**Firma Clinical Lead:** `_______________________` Fecha: `___`  
**Firma Director Médico:** `_______________________` Fecha: `___`  
**Firma PO:** `_______________________` Fecha: `___`
