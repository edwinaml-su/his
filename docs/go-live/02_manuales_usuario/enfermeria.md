# Guía Rápida — Enfermería

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Soporte:** WhatsApp "HIS Hipercuidado" | oncall@avante.com

---

## 1. Acceso al sistema

URL: `https://his-avante.vercel.app/login`

**Credenciales:** email institucional + contraseña + código MFA (autenticador en tu teléfono).

Si es tu primer acceso, sigue el proceso de activación que llegó a tu correo institucional. Si no recibiste el correo: contactar al Administrador del sistema.

---

## 2. Flujo bedside paso a paso

El flujo bedside es el proceso de administración de medicamentos verificado con código GS1. Se ejecuta en tablet o estación bedside al pie de la cama.

### Paso 1 — Identificar al paciente

[SCREENSHOT PLACEHOLDER: Pantalla de identificación de paciente en bedside]

1. Navegar a `/bedside` desde el menú lateral.
2. Hacer clic en "Iniciar administración".
3. Escanear la pulsera del paciente con el lector GS1:
   - El lector emite un **bip corto** si el scan es exitoso.
   - La pantalla muestra el nombre del paciente y su habitación.
4. Si el scan falla: ingresar manualmente el número de pulsera (campo de texto).

> **NO continuar si el nombre en pantalla no coincide con el paciente frente a ti.**

### Paso 2 — Seleccionar la indicación

[SCREENSHOT PLACEHOLDER: Listado de indicaciones del paciente]

1. El sistema muestra las indicaciones de medicamento activas para este paciente.
2. Seleccionar la indicación que vas a administrar ahora.
3. Verificar: medicamento, dosis, vía, hora programada.

### Paso 3 — Escanear el medicamento

[SCREENSHOT PLACEHOLDER: Pantalla de scan de medicamento con GS1]

1. Escanear el DataMatrix del medicamento (caja, blister o ampolla).
2. El sistema ejecuta los **5 Correctos** automáticamente:
   - Paciente correcto (pulsera)
   - Medicamento correcto (GTIN)
   - Dosis correcta
   - Vía correcta
   - Hora correcta (ventana terapéutica)

### Paso 4 — Leer el resultado del scan

**VERDE — TODO OK:**

[SCREENSHOT PLACEHOLDER: Pantalla verde "Proceder con administración"]

- El sistema muestra confirmación verde.
- Proceder con la administración.
- Al terminar, hacer clic en "Confirmar administración".

**ROJO — HARD STOP:**

[SCREENSHOT PLACEHOLDER: Pantalla roja de hard-stop]

- **DETENER.** No administrar el medicamento.
- Leer el motivo del hard-stop en la pantalla.
- Ver tabla de hard-stops en §3.

### Paso 5 — Confirmar administración

1. Hacer clic en "Administración completada".
2. El sistema registra: hora real, usuario ENF, medicamento, dosis.
3. El kardex del paciente se actualiza automáticamente.

---

## 3. Hard-stops bedside: qué hacer en cada caso

| Hard-stop | Mensaje en pantalla | Acción |
|---|---|---|
| `MEDICAMENTO_NO_COINCIDE` | "Medicamento escaneado no corresponde a la prescripción activa" | Verificar que tomaste el medicamento correcto. Si persiste: llamar al médico. |
| `PROFESIONAL_NO_HABILITADO` | "Tu GSRN no está habilitado para este turno" | Contactar al Administrador para verificar tu registro de turno. |
| `PACIENTE_NO_COINCIDE` | "Código de pulsera no corresponde al paciente de la indicación" | Verificar que escaneaste la pulsera correcta. |
| `MEDICAMENTO_VENCIDO` | "Lote vencido. No dispensar." | Devolver el medicamento a farmacia. Solicitar lote vigente. |
| `LOTE_EN_RECALL` | "Lote bloqueado por alerta sanitaria" | Devolver el medicamento a farmacia. Solicitar alternativa. |
| `DOSIS_FUERA_VENTANA` | "Fuera de ventana terapéutica configurada" | Verificar si la administración es apropiada. Consultar al médico antes de proceder. |
| `ALERGIA_DETECTADA` | "Paciente con alergia documentada a [sustancia]" | **NUNCA proceder sin autorización explícita del médico.** Llamar al médico de inmediato. |
| `GS1_PARSE_ERROR` | "El código escaneado no es un código GS1 válido" | Intentar escanear nuevamente. Si persiste: reportar el código a farmacia. |

> **Regla de oro:** ante cualquier hard-stop, **detener y consultar**. Nunca intentar forzar el sistema.

---

## 4. Registro de signos vitales

`Expediente del paciente` → `Signos Vitales` → `Nuevo registro`

| Campo | Unidad | Rango de alerta (automático) |
|---|---|---|
| Frecuencia cardíaca | lpm | < 40 o > 150: alerta |
| Presión arterial | mmHg | PAS < 80 o > 200: alerta |
| Frecuencia respiratoria | rpm | < 8 o > 30: alerta |
| Temperatura | °C | < 35 o > 39.5: alerta |
| SpO2 | % | < 88%: alerta |
| Peso | kg | Solo si hay variación > 5% en 24h: alerta |

> Al guardar, si algún valor está fuera de rango, el sistema muestra una alerta naranja. No bloquea el guardado — es aviso para el médico.

---

## 5. Notas de enfermería

`Expediente del paciente` → `Notas de Enfermería` → `Nueva nota`

**Tipos de notas disponibles:**

- Nota de cuidados generales
- Registro de procedimiento
- Entrega de turno
- Nota de incidente

**Campos obligatorios:**
- Tipo de nota
- Texto descriptivo (mínimo 20 caracteres)
- Las notas se guardan con tu nombre y el timestamp automáticamente.

---

## 6. Kardex de medicamentos

El kardex muestra el estado de todas las administraciones del turno:

[SCREENSHOT PLACEHOLDER: Kardex completo con estados]

| Color | Significado |
|---|---|
| Gris | Pendiente (no ha llegado la hora) |
| Naranja | Próxima administración (< 30 min) |
| Verde | Administrado (con scan GS1) |
| Rojo | Vencida sin administrar |
| Gris oscuro | Cancelada por médico |

Para ver detalles de una administración: hacer clic sobre ella.

---

## 7. Triaje Manchester (si tienes rol de triagista)

`/triage` → `Nuevo triaje`

**Flujo:**
1. Registrar paciente (búsqueda o walk-in).
2. Seleccionar el discriminante principal (motivo de consulta prioritario).
3. El sistema sugiere el color de triaje basado en el discriminante.
4. Registrar signos vitales (opcionales pero recomendados para ajuste de color).
5. Confirmar color y guardar.

**Colores Manchester:**

| Color | Prioridad | Tiempo de atención |
|---|---|---|
| Rojo | Inmediata | 0 min |
| Naranja | Muy urgente | 10 min |
| Amarillo | Urgente | 60 min |
| Verde | Menos urgente | 120 min |
| Azul | No urgente | 240 min |

---

## 8. Hard-stops esperados: no son errores del sistema

Los hard-stops son **protecciones de seguridad clínica**. Cuando aparecen:

1. Leer el mensaje completo.
2. Detener la acción que intentabas realizar.
3. Consultar al médico o a farmacia según corresponda.
4. Documentar el incidente si el hard-stop fue inesperado.

**Nunca intentes "saltar" un hard-stop** sin autorización del médico responsable.

---

## 9. Troubleshooting frecuente

| Problema | Solución |
|---|---|
| Pulsera no escanea | Limpiar con paño húmedo. Ingresar número manualmente. Reportar a ADMIN si persiste. |
| La indicación no aparece en bedside | Verificar que el médico la guardó (puede ser borrador). Contactar al médico. |
| Pantalla se congela | Recargar el navegador (F5 o botón reload). Los datos no se pierden. |
| No puedo iniciar sesión | Ver §1. Contactar ADMIN si persiste. |
| Kardex muestra administraciones incorrectas | Reportar a super-usuario de inmediato (puede ser error de sincronización). |

---

## 10. Contactos de soporte

| Situación | Canal |
|---|---|
| Duda de uso | Super-usuario de tu unidad |
| Error técnico | WhatsApp "HIS Hipercuidado" |
| Caída del sistema | Usar formularios en papel (ver `contingencia.md`) |
