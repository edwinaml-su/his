# Guía de Contingencia — Caída del Sistema HIS

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Aplica a:** Todo el personal clínico y administrativo

> Esta guía se activa cuando el sistema HIS no responde o está en mantenimiento. La atención al paciente NO debe interrumpirse. Los procesos en papel son el respaldo.

---

## 1. Cómo saber si el sistema está caído

**Indicadores:**
- La página no carga o muestra error.
- El sistema muestra el mensaje "En mantenimiento".
- El super-usuario de tu servicio anuncia por megafonía o WhatsApp.

**Qué NO hacer:**
- No esperar "a ver si se arregla solo" para registrar datos críticos.
- No usar dispositivos personales como sustituto del sistema.
- No tomar decisiones clínicas basadas en información desactualizada en pantalla.

**Qué hacer de inmediato:**
1. Notificar a tu super-usuario.
2. Activar el protocolo de papel de tu servicio.
3. Continuar la atención al paciente sin interrupciones.

---

## 2. Formularios en papel disponibles (ubicación)

| Formulario | Código | Ubicación física |
|---|---|---|
| Hoja de triaje Manchester | FT-01 | Estación de triaje — cajón superior izquierdo |
| Registro de signos vitales | FSV-01 | Estaciones de enfermería — archivero rojo |
| Prescripción médica manual | FP-01 | Puestos de médicos — sobre la mesa |
| Dispensación farmacia | FF-01 | Farmacia central — ventanilla de despacho |
| Nota de evolución médica | FE-01 | Puestos de médicos — sobre la mesa |
| Nota de enfermería | FEN-01 | Estaciones de enfermería — archivero rojo |
| Registro de administración | FRA-01 | Estaciones de enfermería — archivero rojo |
| Consentimiento informado | FCI-01 | Admisión — archivero azul |

**Si los formularios se agotan:** el Jefe de turno puede imprimir desde el PC de la jefatura (plantillas en carpeta "HIS Contingencia" en el escritorio).

---

## 3. Triaje en contingencia (ENF)

1. Usar el formulario **FT-01** (Hoja de triaje Manchester).
2. Completar: nombre completo del paciente, DUI, motivo de consulta, discriminante seleccionado, color de triaje asignado, signos vitales, hora y nombre de la triagista.
3. Adjuntar el formulario al expediente físico del paciente.
4. Informar al médico de guardia sobre el color asignado verbalmente.

---

## 4. Consulta médica en contingencia (MC)

1. Solicitar el expediente físico del paciente (si existe) en el archivo clínico.
2. Usar el formulario **FE-01** para la nota de evolución.
3. Usar el formulario **FP-01** para prescripciones.
4. Completar TODOS los campos: nombre del paciente, fecha y hora, diagnóstico, plan, firma del médico.
5. El original va al expediente físico; copia a farmacia si hay prescripción.

---

## 5. Dispensación en contingencia (FARM)

1. Recibir el formulario **FP-01** (prescripción en papel) del médico.
2. Verificar: nombre del paciente, medicamento, dosis, frecuencia, firma del médico.
3. Completar el formulario **FF-01** (registro de dispensación):
   - Número de lote del medicamento dispensado.
   - Fecha de vencimiento.
   - Cantidad dispensada.
   - Nombre del farmacéutico.
4. Guardar copia del FF-01 en farmacia para la entrada retroactiva.

**IMPORTANTE:** Los hard-stops GS1 (vencimiento, recall, alergia) NO aplican en modo papel. El farmacéutico debe verificar manualmente:
- Revisar visualmente la fecha de vencimiento del medicamento.
- Consultar la lista de recalls activos (pegada en la pared de farmacia).
- Consultar las alergias del paciente en su expediente físico.

---

## 6. Administración de medicamentos en contingencia (ENF)

Sin el sistema bedside para verificar los 5 correctos, la verificación es manual:

**Antes de administrar, verificar verbalmente:**
1. Paciente correcto — preguntar nombre completo al paciente (o verificar pulsera).
2. Medicamento correcto — comparar con la prescripción en papel (FP-01).
3. Dosis correcta — verificar con la prescripción.
4. Vía correcta — verificar con la prescripción.
5. Hora correcta — verificar con el horario de administración.

**Registrar en formulario FRA-01:**
- Nombre del paciente, medicamento, dosis, vía, hora de administración, nombre del enfermero/a.

---

## 7. Comunicación durante la contingencia

| A quién | Cómo | Mensaje |
|---|---|---|
| Super-usuario de tu servicio | En persona o llamada interna | "El sistema no responde. Activo protocolo papel." |
| Médico de guardia | En persona o llamada interna | "Sistema caído. Usando prescripción en papel. ¿Autoriza?" |
| Pacientes en espera | En persona (personal de admisión) | "Continuamos atendiendo. Registramos manualmente. No hay retraso." |
| Jefe de turno | Inmediato | Reportar número de pacientes afectados y servicios impactados. |

**No hacer declaraciones técnicas a los pacientes** (no decir "se cayó el sistema" o "hay un bug"). Decir simplemente: "Estamos haciendo mantenimiento del sistema. Los atendemos normalmente."

---

## 8. Entrada retroactiva al HIS (cuando el sistema vuelva)

Cuando el sistema se restaure, **toda la información registrada en papel debe ingresarse al HIS dentro de las 4 horas siguientes** a la restauración.

### Quién ingresa los datos

| Datos | Responsable de entrada retroactiva |
|---|---|
| Triajes | Triagista o super-usuario ENF |
| Signos vitales | Enfermería |
| Notas de evolución | El médico autor |
| Prescripciones | El médico autor |
| Registros de dispensación | Farmacéutico |
| Registros de administración | Enfermería |

### Cómo marcar los registros retroactivos

En el HIS, al ingresar los datos, **cambiar la fecha/hora al momento real de la atención** (no a la hora de entrada al sistema). El sistema permite ingresar timestamps históricos.

En el campo "Observaciones" o "Notas adicionales", escribir: `[ENTRADA RETROACTIVA — contingencia del DD/MM/YYYY HH:MM a HH:MM]`

### Conservar los formularios en papel

Los formularios en papel originales se conservan durante **7 días** después de la entrada retroactiva, en el archivero de contingencia por servicio. Luego se destruyen de forma segura (papel con PHI — no a la basura común).

---

## 9. Duración estimada de la contingencia

| Tipo de incidente | RTO estimado |
|---|---|
| Mantenimiento programado | < 30 min (anunciado con 24h de anticipación) |
| Falla de servidor (Vercel) | < 30 min (rollback automático o manual) |
| Incidente de BD sin pérdida de datos | < 2h |
| Restore completo de BD (PITR) | < 4h |

Si el SRE on-call no ha informado un tiempo de retorno en 30 minutos, pedir actualización al super-usuario o Jefe de turno.

---

## 10. Después de la contingencia

1. Verificar con tu super-usuario que el sistema está completamente operativo.
2. Ingresar todos los datos retroactivos antes de finalizar tu turno.
3. Hacer entrega de turno con mención explícita del período de contingencia y los datos pendientes de retroalimentar.
4. Entregar los formularios en papel al archivero de contingencia del servicio.
