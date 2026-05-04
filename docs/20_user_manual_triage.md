# Manual de Usuario — Módulo de Triage

**Audiencia:** TRIAGE_NURSE (enfermería de triage de urgencias).
**Versión:** 1.0 (MVP)
**Pre-requisito:** capacitación rol completada (`docs/16_capacitacion_plan.md`) + certificación ESI vigente.

> **Nota sobre screenshots:** este manual usa anotaciones `[Screenshot: …]` describiendo qué muestra cada captura. Imágenes finales se incrustan en e-learning F3.

---

## 1. Conceptos clave

| Término | Definición |
|---|---|
| ESI | Emergency Severity Index, escala de 5 niveles (1 = inmediato, 5 = no urgente). |
| Triage rojo | ESI 1 — atención inmediata, riesgo vital. |
| Cola de triage | Lista priorizada de pacientes pendientes de evaluación. |
| Reasignación | Cambio de prioridad si cambia el cuadro clínico. |
| Identificación NN | Triage de paciente sin documentos, con foto. |

## 2. Niveles ESI (referencia rápida)

| Nivel | Color | Descripción | Tiempo objetivo |
|---|---|---|---|
| ESI 1 | Rojo | Riesgo vital inmediato (paro, shock, vía aérea comprometida) | 0 min |
| ESI 2 | Naranja | Alto riesgo, alteración de conciencia, dolor severo | < 10 min |
| ESI 3 | Amarillo | Múltiples recursos requeridos, estable | < 60 min |
| ESI 4 | Verde | Un recurso requerido | < 2 h |
| ESI 5 | Azul | Sin recursos / consulta menor | < 4 h |

## 3. Cola de triage — Vista principal

`[Screenshot 3.1: Cola con tarjetas ordenadas por prioridad ESI (rojo arriba), reloj de espera, edad, motivo de consulta, indicador de foto NN. Botón flotante "Nuevo triage" abajo a la derecha.]`

- Las tarjetas se actualizan en tiempo real (WebSocket).
- El reloj de cada paciente cuenta desde el ingreso a la cola.
- Los que están en zona de alarma (excedido tiempo objetivo) parpadean.

## 4. Flujo: triage estándar

### Paso 1 — Iniciar triage
1. Pulsar **"Nuevo triage"** o `Alt + T`.
2. Buscar paciente: documento → si existe, datos pre-cargados.
3. Si no existe → continuar como NN (§5) o crear.

### Paso 2 — Motivo de consulta y vitales
`[Screenshot 4.1: Formulario en una columna: motivo (texto libre), TA, FC, FR, SatO2, T°, EVA dolor, Glasgow, glucemia. Cada campo con rango normal indicado en gris.]`

- Motivo en palabras del paciente o acompañante (no interpretar).
- Vitales: el sistema marca en rojo los fuera de rango.
- Si no se puede medir (paciente agitado), marcar **"No medible"** + razón.

### Paso 3 — Asignación ESI

`[Screenshot 4.2: Asistente ESI con preguntas decisivas: "¿Compromiso vital?" → "¿Riesgo alto?" → "¿Cuántos recursos?". El sistema sugiere nivel pero la enfermera puede sobrescribir.]`

1. Responder árbol decisivo ESI.
2. El sistema sugiere un nivel y muestra la justificación.
3. Confirmar o sobrescribir (sobrescritura requiere comentario).
4. Asignar consultorio o zona (rojo / amarillo / verde).

### Paso 4 — Cierre del triage
- Pulsar **"Confirmar triage"**.
- Imprimir hoja de triage para historia clínica física (si aplica).
- Paciente pasa a la cola del médico de urgencias.

## 5. Flujo: triage rojo (ESI 1) — < 60 segundos

`[Screenshot 5.1: Botón rojo grande "TRIAGE ROJO" en esquina superior derecha de la cola, siempre visible.]`

1. Pulsar **"TRIAGE ROJO"** (o `F1`).
2. Si paciente NN → tomar foto inmediata (cámara se activa).
3. Capturar solo: motivo (3 palabras) + sexo + edad estimada.
4. Sistema notifica al médico de turno y reanimador.
5. Datos completos se llenan después, en paralelo a la atención.

> **Importante:** la velocidad prima. Toda la información secundaria (documentos, contacto, aseguradora) se completa por admisión cuando el paciente está estable.

## 6. Flujo: paciente NN

1. Iniciar nuevo triage → no hay documento.
2. Pulsar **"Sin documentos / NN"**.
3. Tomar foto del paciente (la cámara web se activa al pulsar el icono).
4. Capturar señas particulares (texto libre): cicatrices, tatuajes, ropa.
5. ID temporal `NN-YYYYMMDD-####` generado automáticamente.
6. Continuar con vitales y ESI normal.
7. Cuando lleguen documentos o acompañante → admisión re-identifica (ver `docs/19_user_manual_admision.md` §5).

## 7. Flujo: reasignación de prioridad

Casos: deterioro o mejoría clínica antes de ser visto por médico.

1. En la cola, abrir tarjeta del paciente.
2. Pulsar **"Reevaluar"**.
3. Re-tomar vitales clave.
4. Cambiar nivel ESI con justificación obligatoria.
5. El sistema reordena la cola y notifica al médico.

`[Screenshot 7.1: Diálogo "Reevaluar" con vitales actuales vs. previos lado a lado, dropdown de nuevo nivel y campo "Razón del cambio".]`

## 8. Casos de uso comunes

### 8.1 Llegada masiva (varios pacientes simultáneos)
- Activar **"Modo masivo"** desde menú superior (cambia layout a tarjetas mini).
- Hacer triage rápido a todos: rojo / naranja / resto.
- Profundizar después que rojos y naranjas estén atendidos.

### 8.2 Paciente que se va sin atención
- Tarjeta paciente → **"Salida sin atención"** + motivo + firma del paciente o testigo (puede ser el acompañante o el guardia).
- Queda registrado para reporte epidemiológico.

### 8.3 Paciente pediátrico
- El asistente ESI ajusta umbrales de vitales según edad automáticamente.
- Acompañante obligatorio.

## 9. FAQ

**¿Puedo cerrar un triage sin asignar ESI?**
No. ESI es obligatorio. Si no se puede determinar, asignar ESI 2 por defecto y reevaluar al ingreso a consulta.

**¿La cola se sincroniza con admisión?**
Sí, en tiempo real. El admisionista ve los triages confirmados y puede continuar con admisión administrativa en paralelo.

**¿Qué pasa si me equivoco al elegir el nivel ESI?**
Pulsar **"Reevaluar"** en la tarjeta. Queda registrado el cambio con quién y cuándo.

**¿Cómo se imprime la pulsera?**
La pulsera la imprime admisión al confirmar episodio. Triage solo imprime hoja de triage opcional.

## 10. Troubleshooting

| Síntoma | Causa probable | Acción |
|---|---|---|
| Cámara web no activa | Permiso de navegador denegado | Click en icono candado de URL → permitir cámara |
| Vitales no guardan | Validación de rango (ej. FC = 0) | Revisar valor; usar "No medible" si aplica |
| Cola no actualiza | WebSocket caído | Refrescar (F5); si persiste, escalar a L3 |
| ESI sugerido distinto al esperado | Respuestas del árbol no fueron exactas | Reabrir asistente y revisar |
| "Bloqueado por otro usuario" | Otra enfermera abrió el mismo triage | Coordinar; el segundo en abrir queda en solo lectura |

## 11. Atajos de teclado

| Acción | Atajo |
|---|---|
| Nuevo triage | `Alt + T` |
| Triage rojo | `F1` |
| Modo masivo | `Alt + M` |
| Reevaluar paciente seleccionado | `R` |
| Buscar en cola | `Ctrl + F` |

## 12. Soporte

- L1 (super-usuario de urgencias): extensión 5051.
- L2 (Clinical Lead): WhatsApp grupo "HIS Hipercuidado".
- L3 (técnico): Slack `#his-hipercuidado`.
- **Emergencia clínica del sistema (caída total):** activar formularios en papel y notificar inmediatamente al jefe de urgencias.
