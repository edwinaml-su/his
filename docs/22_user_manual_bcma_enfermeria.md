# Manual de Usuario — BCMA Bedside (Enfermería)

**Audiencia:** ENF (Enfermería de hospitalización, UCI, hospital de día).
**Versión:** 1.0
**Pre-requisito:** capacitación rol completada (`docs/16_capacitacion_plan.md`) + lector GS1 funcional asignado a la unidad + PIN de firma electrónica de enfermería configurado.
**Referencia normativa:** `docs/flujos/IND_MED.md`, `docs/flujos/REG_ENF.md`, `docs/31_flujos_operativos_consolidado.md` §BCMA.

> **Nota sobre screenshots:** este manual usa anotaciones `[Screenshot: …]` describiendo qué muestra cada captura. Las imágenes finales se incrustarán durante la fase F3 de e-learning antes del Go-Live.

---

## 1. Introducción

**BCMA** (Bar Code Medication Administration — Administración de Medicamentos con Código de Barras) es la verificación electrónica en la cabecera del paciente, donde antes de administrar cualquier dosis se escanean **3 códigos** y el sistema valida los **5 correctos**:

1. **Paciente correcto** — escaneando la pulsera GSRN.
2. **Medicamento correcto** — escaneando el GTIN del producto.
3. **Dosis correcta** — validada contra la indicación firmada del MC.
4. **Vía correcta** — validada contra la prescripción.
5. **Hora correcta** — dentro de la ventana de tolerancia configurada (±30 min por defecto).

El estándar GS1 (GSRN para pacientes, GTIN para productos) hace que la cadena de trazabilidad sea auditada de extremo a extremo: del catálogo MINSAL al kardex, del kardex al brazalete y del brazalete al `audit.audit_log` con hash chain.

## 2. ¿Quién lo usa?

| Rol | Acción |
|---|---|
| **ENF** | Escanea, verifica los 5 correctos, administra y registra la administración con PIN. |
| **AUX** | NO administra medicamentos IV/SC/IM — solo apoyo logístico (acercar carro, retirar bandeja). |
| **ENF jefe de turno** | Audita administraciones del turno, valida overrides justificados. |
| **QFB** | Investiga dispensaciones devueltas o no administradas. |

## 3. ¿Cuándo se usa?

**Siempre que administres un medicamento prescrito en el kardex eMAR.** Cada slot (cada dosis programada) requiere su propio acto BCMA.

Aplica a:
- Medicamentos VO, IV directa, IV infusión, IM, SC, sublingual, rectal, inhalada, oftálmica, tópica con dosificación.
- Hemoderivados (transfusión) — flujo extendido con verificación de tipaje cruzado.
- Quimioterapia — flujo extendido con doble enfermera.

**No aplica** a curaciones simples sin medicamento, mediciones de signos vitales, ni a indicaciones de cuidados puros (cambio de posición, baño).

## 4. Paso a paso — Administración estándar

### Paso 1 — Preparar la administración

1. Abre `/emar` (kardex) en tu tablet o estación de enfermería.
2. Filtra por tu unidad y turno actual. Verás los slots agrupados por hora programada.
3. Selecciona el slot a administrar — el sistema bloquea ese slot para ti (otra enfermera lo verá en lectura).

`[Screenshot 4.1: Pantalla eMAR con tarjetas por paciente, cada slot con hora programada, color por estado (verde=hecho, amarillo=pendiente, rojo=atrasado), y botón "Administrar".]`

4. Prepara la dosis siguiendo técnica aséptica desde el carro de medicamentos.

### Paso 2 — Escanear la pulsera del paciente (GSRN)

1. En la cabecera del paciente, pulsa **"Iniciar administración"** o el atajo del lector.
2. Escanea la pulsera del paciente con el lector GS1.
3. El sistema reconoce el GSRN, valida que coincida con el paciente del slot y muestra **foto + nombre + número de cama + alergias**.

> **Si la foto / nombre NO coinciden con el paciente físico frente a ti → DETÉN INMEDIATAMENTE.** Verifica brazalete, verifica cama, llama al jefe de turno. Nunca administres con duda de identidad.

`[Screenshot 4.2: Pantalla post-escaneo de pulsera con foto del paciente grande, alergias en banda roja arriba, signos vitales más recientes y resumen del slot a administrar.]`

### Paso 3 — Escanear el medicamento (GTIN)

1. Toma la unidosis preparada (vial, ampolla, tableta, jeringa preparada).
2. Escanea el código GS1 del producto.
3. El sistema valida que el GTIN coincide con el medicamento prescrito en la indicación firmada.

### Paso 4 — Verificación de los 5 correctos

El sistema muestra una pantalla de verificación con 5 casillas (todas deben estar verdes para habilitar el botón **"Administrar"**):

| Correcto | Verificación automática |
|---|---|
| Paciente | GSRN pulsera = paciente del slot. |
| Medicamento | GTIN escaneado = principio activo + concentración prescritos. |
| Dosis | Cantidad de unidades × concentración = dosis prescrita. |
| Vía | Vía registrada en pre-administración = vía prescrita. |
| Hora | Hora actual dentro de ventana (slot ± 30 min por defecto). |

`[Screenshot 4.3: Pantalla "5 correctos" con 5 chips verdes "OK" si todo coincide; cualquier mismatch aparece en rojo con explicación.]`

### Paso 5 — Confirmar administración y firmar

1. Pulsa el botón verde grande **"Administrar"** (solo se habilita con 5 verdes).
2. Ingresa tu **PIN de enfermería**.
3. El sistema registra `MedicationAdministration` con timestamp, lote (si está en el GTIN), dosis efectivamente administrada, ruta, sitio (opcional para inyectables IM/SC), y firma argon2id.
4. El slot pasa a estado **"Administrado"** y desaparece de tu pendiente.
5. Se replica al expediente ECE (`ece.administracion_medicamento`) y al `audit.audit_log` con hash chain.

`[Screenshot 5.1: Confirmación "Administración registrada" con resumen: medicamento + dosis + hora exacta + tu nombre como administrador. Botón "Siguiente slot del paciente" sugerido.]`

## 5. ¿Qué hacer si...?

### 5.1 Alerta LASA (Look-Alike Sound-Alike)

El sistema detectó que el medicamento escaneado **se parece** a otro de la prescripción (ej. amlodipino vs amiodarona, hidralazina vs hidroxizina).

1. **NO administres todavía.**
2. Lee la alerta con calma — el sistema te muestra ambos productos lado a lado.
3. Verifica con el principio activo escrito en la etiqueta del producto físico.
4. Si es el correcto → pulsa **"Confirmar LASA verificado"** y continúa.
5. Si NO es el correcto → pulsa **"Devolver al carro"**, vuelve a farmacia y solicita el correcto.

`[Screenshot 5.1.A: Alerta LASA con dos columnas comparativas (nombre, presentación, foto del empaque) y dos botones: "Confirmo, es el correcto" / "Devolver al carro".]`

### 5.2 Paciente en aislamiento

El sistema detecta que el paciente tiene aislamiento activo (de contacto, gotas, aéreo, protector).

1. Antes de entrar, ponte el EPP indicado en la alerta (bata, mascarilla N95, guantes, careta, según tipo).
2. Lleva al cuarto SOLO los insumos estrictamente necesarios para la administración.
3. Tras administrar, el sistema te recordará la secuencia correcta de retiro de EPP.
4. NO saques de la habitación el lector GS1 sin desinfectar.

`[Screenshot 5.2.A: Banda morada en parte superior de la pantalla "AISLAMIENTO DE CONTACTO — EPP: bata + guantes" con icono de EPP y enlace a procedimiento de retiro.]`

### 5.3 Alergia detectada en el momento

Si el paciente reporta una alergia que NO está documentada y coincide con lo que vas a administrar:

1. Pulsa **"Cancelar administración"** y elige motivo "Alergia reportada por paciente".
2. Documenta la alergia en la ficha del paciente (botón "Agregar alergia").
3. Notifica al MC tratante (botón "Notificar médico" → envía push y queda en bitácora).
4. NO administres; espera nueva indicación.

### 5.4 Brazalete ilegible o roto

1. NO improvises identificación verbal.
2. Solicita reimpresión de pulsera a admisión (botón "Reimprimir pulsera" en la ficha del paciente).
3. Mientras tanto, identifica por dos verificadores (nombre + fecha de nacimiento confirmados por el paciente o acompañante).
4. Documenta la administración con flag "Identificación verbal por brazalete dañado" (excepción auditada — requiere justificación).

### 5.5 Slot atrasado (fuera de ventana)

Si pasaste de la ventana de ±30 min:

1. El sistema marca el slot en rojo.
2. Puedes registrar la administración tardía con motivo (paciente en estudio fuera de la unidad, vómito que retrasó la VO, etc.).
3. Si la dosis se omitió completamente → marca **"Dosis omitida"** + motivo + acción tomada (notificación al MC, ajuste posterior).

### 5.6 PRN (según necesidad)

Para medicamentos PRN:

1. El slot aparece solo si la condición se cumple (ej. "PRN dolor EVA ≥ 4" → aparece cuando registras EVA ≥ 4 en signos vitales).
2. El flujo BCMA es idéntico, pero al final el sistema te pregunta efectividad a los 30–60 min (escala dolor post o respuesta clínica).

## 6. Errores comunes

| Síntoma / Mensaje | Causa probable | Acción |
|---|---|---|
| "GSRN no reconocido" | Pulsera dañada o paciente sin pulsera | Reimprimir desde admisión. |
| "GTIN no corresponde al prescrito" | Producto incorrecto o catálogo desactualizado | Devolver al carro, verificar con farmacia. |
| "Slot ya administrado" | Otra enfermera lo registró antes | Verificar con compañera; el sistema bloquea doble dosis. |
| "PIN bloqueado" | 5 intentos fallidos | Contactar admin para desbloqueo. |
| Lector GS1 no responde | Cable USB / batería | Reiniciar lector, verificar conexión; respaldo en estación. |
| Pantalla "5 correctos" con uno en rojo | Discrepancia entre escaneado y prescrito | NO administrar; revisar con jefe de turno. |
| "Función renal fuera de rango — ajuste necesario" | TFG cayó desde la prescripción | Notificar MC; suspender administración hasta nueva orden. |

## 7. Buenas prácticas

- **Escanea siempre — nunca de memoria.** El BCMA existe para detectar el error humano que cualquiera comete bajo fatiga o presión.
- **Una administración a la vez.** No prepares el carro de varios pacientes en paralelo y escanees después; el flujo es: preparar UNA dosis → ir al cuarto → escanear → administrar → registrar.
- **Mantén el lector GS1 cargado y desinfectado** entre pacientes.
- **Documenta la sospecha de reacción adversa** aunque sea leve — el flujo `ARM` (Aviso de Reacción Medicamentosa) está integrado al kardex.
- **Tu PIN es personal e intransferible.** No lo compartas con la auxiliar ni con otra enfermera "para acelerar".

## 8. Soporte

- L1 (super-usuario de enfermería de turno): extensión 5053.
- L2 (Jefatura de Enfermería): WhatsApp grupo "HIS Hipercuidado".
- L3 (técnico): Slack `#his-hipercuidado`.
- **Falla total del sistema:** activar registro en papel del kardex de contingencia y notificar inmediatamente a jefatura del servicio. Las administraciones se transcribirán al sistema en cuanto restablezca, con flag "registro retrospectivo contingencia".
- Documentación normativa: `docs/flujos/IND_MED.md`, `docs/flujos/REG_ENF.md` y `docs/31_flujos_operativos_consolidado.md`.
