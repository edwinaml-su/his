# Guía Rápida — Médico Clínico

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Soporte:** WhatsApp "HIS Hipercuidado" | oncall@avante.com

---

## 1. Primer acceso — onboarding

### 1.1 Activar tu cuenta

El Administrador del sistema te enviará un correo a tu email institucional con el asunto:
**"Activación de cuenta HIS Avante"**

1. Abrir el enlace de activación (válido 48 horas).
2. Crear contraseña: mínimo 12 caracteres, incluir mayúsculas, números y símbolo.
3. Configurar MFA (autenticación de dos factores):
   - Descargar **Google Authenticator** o **Authy** en tu teléfono.
   - Escanear el código QR que aparece en pantalla.
   - Ingresar el código de 6 dígitos para confirmar.
4. Configurar tu PIN de firma electrónica: 6 dígitos numéricos.
   - **Este PIN es tu firma legal. No lo compartas.**

### 1.2 Login diario

URL: `https://his-avante.vercel.app/login`

1. Ingresar email institucional + contraseña.
2. Ingresar código MFA del autenticador (6 dígitos, cambia cada 30s).
3. Seleccionar establecimiento al que perteneces (si tienes acceso a más de uno).

> Si el código MFA no funciona: verificar que la hora de tu teléfono es correcta (ajuste automático activado).

---

## 2. Flujo básico: primer paciente del turno

### Paso 1 — Buscar paciente

`/patients` → Campo de búsqueda → Ingresa nombre o DUI

- Búsqueda por nombre: mínimo 3 caracteres.
- Búsqueda por DUI: formato exacto con guión (ej. `01234567-8`).
- Si el paciente viene de urgencias y ya fue triado: aparecerá con color de triaje.

### Paso 2 — Revisar historia clínica

Al seleccionar el paciente, verás:

| Sección | Qué contiene |
|---|---|
| Datos demográficos | Nombre, DUI, fecha nacimiento, contacto |
| Alergias | Lista de alergias documentadas (si hay) |
| Antecedentes | Patologías crónicas, cirugías previas |
| Últimas consultas | Últimas 5 consultas con diagnóstico |
| Medicamentos activos | Prescripciones vigentes |

### Paso 3 — Registrar consulta

Navegar a "Encuentros" → "Nueva consulta":

1. **Motivo de consulta:** texto libre (obligatorio).
2. **Signos vitales:** ingresar o verificar los registrados por enfermería.
3. **Nota SOAP:** Subjetivo / Objetivo / Análisis / Plan.
4. **Diagnóstico CIE-10:** búsqueda por código o descripción.
5. **Plan:**
   - Indicaciones (laboratorios, imágenes, procedimientos)
   - Prescripciones (medicamentos)
   - Interconsultas

### Paso 4 — Guardar y firmar

- **Guardar borrador:** los datos se salvan sin firma. Puedes retomar más tarde.
- **Firmar y cerrar:** requiere PIN de firma electrónica. La nota queda inmutable.

---

## 3. Prescripción de medicamentos

1. En el expediente del paciente → "Prescripciones" → "Nueva prescripción".
2. Buscar medicamento (nombre genérico o comercial).
3. Completar:
   - Dosis (ej. 500mg)
   - Vía (oral, IV, IM, tópica, etc.)
   - Frecuencia (cada X horas / X veces al día)
   - Duración (X días)
4. Si el medicamento cruza con una alergia del paciente → alerta automática.
5. Guardar con PIN de firma.

> La prescripción llega automáticamente a farmacia para dispensación.

---

## 4. Órdenes de laboratorio e imagen

`Indicaciones` → `Nueva orden` → Seleccionar tipo (laboratorio / imagen / procedimiento):

1. Buscar el estudio por nombre.
2. Agregar diagnóstico provisional (CIE-10).
3. Indicar urgencia (Rutina / Urgente / STAT).
4. Guardar (no requiere PIN, solo guardado).

El estado de la orden se actualiza automáticamente cuando el laboratorio procesa el resultado.

---

## 5. Firma electrónica

### Tipos de documentos que requieren firma

| Documento | Cuándo firmar |
|---|---|
| Nota de evolución | Al cerrar cada consulta |
| Prescripción | Al guardar cada prescripción |
| Epicrisis | Al dar de alta |
| Nota de alta | Al dar de alta |
| Documentos ECE formales | Según flujo ECE |

### Cómo firmar

1. Al hacer clic en "Firmar" → aparece cuadro de PIN.
2. Ingresar 6 dígitos.
3. Si el PIN es correcto: el documento queda con estado FIRMADO y tu nombre + timestamp visible.

### Si olvidas tu PIN

Contactar al Administrador del sistema. El PIN no se puede recuperar — se genera uno nuevo.  
Número ADMIN: ver cartel en estación de trabajo o WhatsApp "HIS Hipercuidado".

---

## 6. Documentos ECE (Expediente Clínico Electrónico NTEC)

Los documentos ECE son los documentos formales requeridos por la normativa NTEC:

- **FICHA_IDENT:** identificación del paciente al ingreso.
- **Nota de ingreso hospitalario:** cuando se hospitaliza.
- **Notas de evolución diarias:** durante hospitalización.
- **Epicrisis:** resumen de hospitalización al alta.
- **Nota de alta:** instrucciones al paciente.

Acceso: `Expediente del paciente` → pestaña `ECE` (si el paciente está hospitalizado).

---

## 7. Troubleshooting frecuente

| Problema | Causa probable | Solución |
|---|---|---|
| No puedo iniciar sesión | Contraseña incorrecta o MFA expirado | Esperar 30s para nuevo código MFA. Si persiste: ADMIN. |
| No veo al paciente en búsqueda | Paciente registrado en otro establecimiento | Cambiar establecimiento seleccionado. |
| El PIN no funciona | PIN olvidado o bloqueado | Contactar ADMIN para reset. |
| La página no carga | Conexión a internet | Verificar red. Si persiste > 2 min: WhatsApp HIS. |
| Error 500 al guardar | Error del servidor | Capturar pantalla + reportar a WhatsApp HIS con hora exacta. |
| Alergia no aparece en paciente | No ha sido documentada | Agregar manualmente en "Alergias" del expediente. |
| La firma demora | Carga del servidor | Esperar hasta 10s. Si no responde: recargar y volver a intentar. |

---

## 8. Contactos de soporte

| Situación | Canal | Tiempo respuesta |
|---|---|---|
| Duda de uso / funcionalidad | Super-usuario de tu servicio | Inmediato |
| Error técnico sin impacto clínico | WhatsApp "HIS Hipercuidado" | < 4h |
| Error que impide atención clínica | WhatsApp "HIS Hipercuidado" (URGENTE) | < 1h |
| Caída total del sistema | WhatsApp "HIS Hipercuidado" + usar formularios en papel | < 15 min |

**Si el sistema cae:** ver `docs/go-live/02_manuales_usuario/contingencia.md`.
