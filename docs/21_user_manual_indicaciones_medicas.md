# Manual de Usuario — Indicaciones Médicas (IND_MED)

**Audiencia:** MC (Médico de Cabecera / Tratante), MT (Médico de Turno), RES (Residente bajo supervisión), ESP (Especialista interconsultante).
**Versión:** 1.0
**Pre-requisito:** capacitación rol completada (`docs/16_capacitacion_plan.md`) + PIN de firma electrónica configurado (Ajustes → Mi cuenta → Firma electrónica).
**Referencia normativa:** `docs/flujos/IND_MED.md` (Art. 36 NTEC) y `docs/31_flujos_operativos_consolidado.md` §IND_MED.

> **Nota sobre screenshots:** este manual usa anotaciones `[Screenshot: …]` describiendo qué muestra cada captura. Las imágenes finales se incrustarán durante la fase F3 de e-learning antes del Go-Live.

---

## 1. Introducción

Las **Indicaciones Médicas (IND_MED)** son la orden diaria firmada con la que el médico tratante define el plan terapéutico de las próximas 24 horas: medicamentos, líquidos endovenosos, dieta, cuidados de enfermería, monitorización y profilaxis. En hospitalización es **obligatorio firmar al menos una vez por jornada** (Art. 36 NTEC). En ambulatorio se reduce al subconjunto medicamentoso conocido como **receta**.

Sin firma electrónica del médico, la indicación queda en `borrador` y **enfermería no la ejecuta**: tampoco se generan los slots del kardex de administración (eMAR/BCMA).

## 2. ¿Quién lo usa?

| Rol | Acción |
|---|---|
| **MC** | Crea, firma y cierra el plan diario. Único responsable legal de la prescripción. |
| **MT** | Indicaciones intra-turno cuando el MC no está disponible (noche, fin de semana). |
| **RES** | Pre-llena bajo supervisión; la firma legal final la pone el MC. |
| **ESP** | Indicaciones específicas de interconsulta — el MC las incorpora al plan integral. |
| **QFB** (lector) | Valida farmacéuticamente antes de dispensar. No edita, solo aprueba/observa. |
| **ENF** (lector) | Lee, transcribe al kardex y administra con BCMA. No prescribe. |

## 3. ¿Cuándo se usa?

- **Hospitalización general:** una visita diaria firmada por jornada (al menos una).
- **UCI/UCIN/UCIP/UCO:** frecuencia configurable — cada cambio relevante (vasoactivos, sedación, parámetros ventilatorios) genera una **nueva** instancia firmada.
- **Hospital de Día (estancia < 24 h):** una instancia para todo el día.
- **Ambulatorio (Consulta Externa / Emergencia con alta):** solo si hay plan farmacológico → se materializa como **receta**.
- **Egreso hospitalario:** subset "indicaciones para la casa" + receta de egreso (queda incrustado en la Epicrisis).

## 4. Paso a paso — Crear y firmar indicaciones diarias

### Paso 1 — Abrir el episodio del paciente

1. Desde el dashboard, pulsa **"Mis pacientes hospitalizados"** o navega a `/ece/indicaciones`.
2. Localiza al paciente por número de cama, nombre o ID de episodio.
3. Pulsa la tarjeta del paciente — abre la vista de episodio.
4. En la barra superior verás la cinta NTEC con los documentos del día: `HIST_CLIN`, `VAL_INI_ENF`, **`IND_MED`** (estado: pendiente / firmado).

`[Screenshot 4.1: Lista de hospitalizados con columna "Indicaciones hoy" coloreada — verde firmado, amarillo borrador, rojo no creado.]`

### Paso 2 — Crear nueva indicación diaria

1. Pulsa el botón **"Nuevas indicaciones del día"** (esquina superior derecha) o atajo `Alt + I`.
2. El wizard se abre en 5 pestañas: **Dieta**, **Líquidos IV**, **Medicamentos**, **Cuidados de enfermería**, **Monitorización**.

`[Screenshot 4.2: Wizard de indicaciones con tabs horizontales y barra de progreso. A la izquierda, ficha resumen del paciente con alergias destacadas en rojo.]`

### Paso 3 — Dieta

1. Selector **"Tipo de dieta"** (NPO, líquida clara, blanda, completa, hipocalórica, diabética, hiposódica, hipoproteica, enteral por sonda).
2. Campo libre **"Restricciones / observaciones"** (ej. "sin lácteos por intolerancia").
3. Si NPO → motivo obligatorio (preoperatorio, vómito persistente, etc.).

### Paso 4 — Líquidos endovenosos

1. Pulsa **"Agregar línea de líquidos"**.
2. Llena: solución (DW5%, SSN 0.9%, Hartmann, mixto), volumen (mL), velocidad (mL/h o gotas/min), tiempo total estimado.
3. Aditivos opcionales (KCl, MgSO4, complejo B) con dosis y vía.
4. Repetir para cada línea (puede haber varias simultáneas: mantenimiento + reposición).

> **Tip:** el sistema calcula automáticamente el balance teórico de 24 h y advierte si la velocidad excede límites pediátricos (mL/kg/h).

### Paso 5 — Medicamentos (CPOE)

1. Pulsa **"Agregar medicamento"**.
2. Busca por **principio activo** (nombre genérico) — no por marca. Ej. "paracetamol", "enoxaparina", "omeprazol".
3. Selecciona del catálogo el producto correcto (concentración / presentación).
4. Completa:
   - **Dosis** (ej. 500 mg).
   - **Vía** (VO, IV directa, IV infusión, IM, SC, sublingual, rectal, tópica, inhalada, oftálmica).
   - **Frecuencia** (c/4 h, c/6 h, c/8 h, c/12 h, c/24 h, PRN con condición, dosis única "stat").
   - **Duración** (días o "hasta nueva orden").
   - **Observaciones** (premedicación, diluir en SSN 100 mL, infundir en 30 min, etc.).
5. El sistema valida:
   - **Alergias del paciente** (cruza con `Patient.allergies`).
   - **Interacciones medicamentosas** (motor de alertas).
   - **Dosis pediátrica/geriátrica** (calcula mg/kg si aplica).
   - **Función renal/hepática** (ajuste sugerido si TFG < 60).
   - **LASA (Look-Alike Sound-Alike)** — si el nombre se parece a otro, pide confirmación adicional.

`[Screenshot 5.1: Modal de prescripción con alerta amarilla "Posible LASA: amiodarona vs amlodipino — confirma producto antes de continuar".]`

### Paso 6 — Cuidados de enfermería y monitorización

1. Selecciona cuidados de menú checklist: control de signos vitales c/X h, balance hídrico estricto, cambio de posición c/2 h, curación de herida, oxigenoterapia (FiO2, dispositivo), aspiración de secreciones, etc.
2. Monitorización: glucemia capilar c/X h, oximetría continua, telemetría cardíaca, peso diario, perímetro abdominal, drenajes (tipo + volumen máximo).
3. Profilaxis: HBPM tromboembólica, protector gástrico, antibiótico profiláctico.

### Paso 7 — Revisión y firma

1. Pulsa **"Revisar y firmar"**.
2. Verás un resumen consolidado de las 5 pestañas con totales (cantidad de medicamentos, volumen total IV, etc.).
3. Verifica visualmente que no haya errores — esta es tu última oportunidad antes de la inmutabilidad.
4. Pulsa el botón verde **"Firmar con PIN"**.
5. Ingresa tu **PIN de firma electrónica** (4–6 dígitos, no es la contraseña de Windows).
6. Si el PIN es correcto → se registra la firma en `ece.firma_electronica`, el estado pasa a `firmado` y se dispara el evento `ece.indicaciones.firmadas` que genera los slots de administración en el kardex.

`[Screenshot 7.1: Diálogo "Firmar con PIN" con teclado numérico en pantalla y contador de intentos restantes (3 de 5).]`

> **Importante:** después de firmar, el documento es **inmutable** (Art. 36 + Art. 42 NTEC). Para cambiar el plan, debes **suspender o cancelar** la indicación previa y crear una **nueva instancia firmada**. NO existe "editar".

## 5. Modificaciones post-firma

### 5.1 Suspender un medicamento

1. Abre la indicación firmada vigente.
2. En la línea del medicamento, pulsa **"Suspender"**.
3. Motivo obligatorio (efecto adverso, criterio terapéutico, alergia detectada, etc.).
4. La administración pendiente en el kardex queda bloqueada — enfermería ve la línea tachada y la alerta.

### 5.2 Agregar un medicamento nuevo intra-día (orden adicional)

1. Pulsa **"Nueva indicación adicional"** (no reemplaza la diaria, la complementa).
2. Captura solo los ítems nuevos.
3. Firma con PIN.
4. Quedan ambas instancias firmadas y vigentes en el episodio.

## 6. Errores comunes

| Síntoma / Mensaje | Causa probable | Acción |
|---|---|---|
| "PIN incorrecto — quedan 2 intentos" | PIN mal digitado | Reintentar; tras 5 fallidos → cuenta bloqueada, contactar admin. |
| "No tienes permiso para prescribir" | Rol distinto a MC/MT/ESP | Solicitar al jefe de servicio asignación del rol prescriptor. |
| "Paciente alérgico a penicilina" (alerta dura) | Cruce con `Patient.allergies` | Cambiar molécula o documentar override con justificación clínica. |
| "Indicación duplicada del día" | Ya existe una firmada hoy | Si necesitas modificar, usa "Nueva indicación adicional" o suspende la previa. |
| Botón "Firmar" deshabilitado | Falta completar campo obligatorio (dosis sin vía, líquidos sin velocidad) | Revisar pestañas, los faltantes aparecen marcados en rojo. |
| "El catálogo de medicamentos no carga" | Sync de catálogo MINSAL desactualizado | Reportar a L2; mientras tanto usar búsqueda local. |
| Wizard se cierra al cambiar de pestaña sin guardar | Edición sin auto-save (excepción muy rara) | Reportar a L3 con screenshot; los datos quedan en `borrador` automático cada 30 s. |

## 7. Buenas prácticas

- **Una visita médica = una IND_MED firmada.** No dejes el día abierto en `borrador` al salir del turno — firma o cancela explícitamente.
- **Lee las alergias en la ficha del paciente antes de prescribir.** El sistema avisa, pero la responsabilidad es del prescriptor.
- **Usa principio activo, no marca comercial.** El catálogo está organizado por DCI (Denominación Común Internacional).
- **Para condiciones PRN:** describe la condición clara ("PRN dolor EVA ≥ 4" en lugar de "PRN dolor"). Enfermería necesita criterio objetivo.
- **No firmes indicaciones de otros médicos.** Tu PIN es personal e intransferible — la trazabilidad médico-legal es individual (Art. 23 lit. a.4 NTEC).

## 8. Soporte

- L1 (super-usuario clínico de turno): extensión 5052.
- L2 (Clinical Lead): WhatsApp grupo "HIS Hipercuidado".
- L3 (técnico): Slack `#his-hipercuidado`.
- **Bloqueo de PIN:** contactar al admin del sistema (helpdesk → categoría "Firma electrónica").
- Documentación normativa completa: `docs/flujos/IND_MED.md` y `docs/31_flujos_operativos_consolidado.md`.
