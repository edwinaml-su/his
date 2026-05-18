# Guía Rápida — Farmacia

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Soporte:** WhatsApp "HIS Hipercuidado" | oncall@avante.com

---

## 1. Acceso al sistema

URL: `https://his-avante.vercel.app/login`

**Credenciales:** email institucional + contraseña + código MFA.

**Módulos disponibles para tu rol:**

- `/pharmacy/dispensation` — Picking station y dispensación
- `/pharmacy/cart` — Carrito unidosis
- `/pharmacy/reception` — Recepción de medicamentos
- `/pharmacy/substitution` — Sustituciones autorizadas

---

## 2. Flujo de dispensación (picking station)

### Paso 1 — Revisar órdenes pendientes

`/pharmacy/dispensation` → Cola de dispensación

Las órdenes están ordenadas por:
- **Urgencia** (STAT primero, luego Urgente, luego Rutina)
- **Tiempo de espera** (más antiguas primero)

Seleccionar la orden a dispensar.

### Paso 2 — Verificar la prescripción

Antes de ir al estante, revisar:
- Medicamento prescrito (nombre genérico + dosis)
- Paciente (nombre + habitación)
- Médico prescriptor
- Diagnóstico

### Paso 3 — Scan en picking station

[SCREENSHOT PLACEHOLDER: Pantalla de picking station]

1. Con el lector GS1 en la mano, tomar el medicamento del estante.
2. Escanear el DataMatrix del medicamento.
3. El sistema verifica automáticamente:
   - GTIN coincide con el prescrito
   - Lote no está en recall
   - Medicamento no está vencido
   - Sin alertas de alergia del paciente

### Paso 4 — Resultado del scan

**VERDE — Dispensar:**

[SCREENSHOT PLACEHOLDER: Confirmación verde dispensación]

- Todo correcto. Proceder con la dispensación.
- Hacer clic en "Confirmar dispensación".
- Etiquetar el medicamento para el paciente.

**ROJO — Hard-stop:**

[SCREENSHOT PLACEHOLDER: Hard-stop farmacia]

Ver tabla de hard-stops en §3.

---

## 3. Hard-stops en dispensación: acciones

| Hard-stop | Mensaje | Acción |
|---|---|---|
| `MEDICAMENTO_VENCIDO` | "Lote vencido. Fecha: [fecha]." | Devolver al estante. Buscar lote con fecha vigente. Reportar lote vencido a jefe de farmacia para baja. |
| `LOTE_EN_RECALL` | "Lote bloqueado por alerta sanitaria [número]." | Devolver al área cuarentena. Buscar lote alternativo. Notificar a jefe de farmacia. |
| `GTIN_NO_COINCIDE_CON_RECETA` | "El medicamento escaneado no coincide con el prescrito." | Verificar que tomaste el medicamento correcto del estante. Si el médico prescribió otro nombre: iniciar sustitución (§4). |
| `ALERGIA_DETECTADA` | "Paciente alérgico a [sustancia]." | Contactar al médico. No dispensar hasta obtener autorización explícita. Si el médico aprueba: el sistema pedirá confirmación con documentación. |

---

## 4. Sustitución autorizada

Usar cuando el medicamento prescrito no está disponible en stock.

### Flujo

1. En la orden de dispensación → "Solicitar sustitución".
2. Ingresar:
   - Motivo de la sustitución (falta de stock / medicamento descontinuado / otro)
   - Medicamento alternativo propuesto (buscar en catálogo)
3. El sistema envía notificación al médico prescriptor.
4. **Esperar aprobación** (la pantalla de farmacia muestra polling automático cada 30 segundos).
5. Cuando el médico aprueba: la pantalla muestra el medicamento alternativo autorizado.
6. Proceder con la dispensación del medicamento sustituto.

[SCREENSHOT PLACEHOLDER: Pantalla de espera de aprobación de sustitución]

> Si el médico rechaza la sustitución: buscar otra alternativa o contactar al médico directamente para acordar el medicamento.

### Tiempos de respuesta esperados

- Urgente: médico responde en < 10 min.
- Rutina: médico responde en < 30 min.
- Si no responde en 30 min: llamar directamente por teléfono.

---

## 5. Carrito unidosis

El carrito unidosis agrupa medicamentos por turno y sala para distribuir a enfermería.

### Preparación del carrito

`/pharmacy/cart` → "Nuevo carrito"

1. Seleccionar turno (Mañana / Tarde / Noche).
2. Seleccionar sala o unidad.
3. El sistema carga automáticamente todas las indicaciones activas de los pacientes de esa sala para ese turno.
4. Por cada medicamento:
   - Escanear el medicamento con el lector GS1.
   - Confirmar la cantidad.
   - El sistema lo agrega al carrito.

### Estados del carrito

| Estado | Significado | Acción posible |
|---|---|---|
| ARMANDO | En preparación | Agregar medicamentos |
| LISTO | Preparado, pendiente de despacho | Despachar |
| DESPACHADO | Entregado a enfermería | Solo lectura |
| RECIBIDO | Confirmado por enfermería | Solo lectura |

### Despachar el carrito

1. Revisar que todos los medicamentos estén escaneados y confirmados.
2. Hacer clic en "Marcar como LISTO".
3. Llevar físicamente el carrito a la unidad.
4. Hacer clic en "Despachar" → el sistema registra hora de despacho y genera evento EPCIS.
5. La enfermería receptora confirma la recepción desde su pantalla.

---

## 6. Recepción de medicamentos

`/pharmacy/reception` → "Nueva recepción"

### Proceso

1. Al recibir un pedido del proveedor:
   - Escanear GTIN del medicamento.
   - Ingresar número de lote.
   - Ingresar fecha de vencimiento.
   - Ingresar cantidad recibida.
2. Si el GTIN no está en el catálogo: agregar manualmente (nombre, principio activo, concentración) + reportar a ADMIN para actualizar el catálogo GS1.
3. Verificar que la cantidad física coincide con la factura.
4. Confirmar recepción → stock se actualiza.

### Alertas automáticas en recepción

- **Fecha de vencimiento < 90 días:** alerta amarilla (aceptar con advertencia).
- **Lote en recall registrado:** alerta roja (rechazar lote, devolver al proveedor).

---

## 7. Manejo de alarmas: resumen rápido

**Alarma de vencimiento:**
- Aislar el medicamento vencido.
- Etiquetar con "NO USAR — VENCIDO".
- Informar a jefe de farmacia para baja contable.
- Actualizar registro en el sistema.

**Alarma de recall:**
- Aislar el medicamento afectado.
- Informar a jefe de farmacia y a Dirección Médica.
- Contactar al proveedor con el número de lote.
- En el sistema: el lote bloqueado ya no podrá ser dispensado.

**Alarma de alergia:**
- No dispensar hasta autorización médica.
- Documentar en el sistema si el médico aprueba (campo de justificación obligatorio).

---

## 8. Troubleshooting frecuente

| Problema | Solución |
|---|---|
| El GTIN no está en el catálogo | Reportar a ADMIN para agregar. Mientras tanto, dispensar manualmente con doble verificación. |
| La orden no aparece en la cola | Verificar con el médico que guardó la prescripción (no borrador). Recargar la página. |
| Carrito no avanza de ARMANDO | Verificar que todos los medicamentos tienen scan confirmado. |
| Sustitución no llega al médico | Llamar directamente al médico. Registrar la llamada en el sistema como alternativa. |
| El lector GS1 no funciona | Ingresar manualmente el número GS1 (campo de texto). Reportar el lector a ADMIN. |

---

## 9. Contactos de soporte

| Situación | Canal |
|---|---|
| Duda de uso | Super-usuario de farmacia |
| Lote en recall | Jefe de farmacia + WhatsApp "HIS Hipercuidado" |
| Error técnico | WhatsApp "HIS Hipercuidado" |
| Caída del sistema | Usar formularios FF-01 en papel (ver `contingencia.md`) |
