# Guía de Trazabilidad para el Cumplimiento de Procesos Hospitalarios (Estándar GS1)

Esta guía establece el marco metodológico, logístico y tecnológico para la implementación sistémica de los estándares globales GS1 dentro de los flujos de trabajo (workflows) hospitalarios. Está diseñada para garantizar la seguridad del paciente, optimizar la cadena de suministro e integrar la captura automática de datos en sistemas ERP/HIS.

---

## 1. Fundamentos de Identificación y Captura GS1 en Salud

Para habilitar la trazabilidad de extremo a extremo, todo elemento físico, actor clínico y ubicación debe estar unívocamente identificado bajo un estándar global no ambiguo.

### 1.1 Identificadores Clave (Las Claves de Acceso)

| Llave GS1 | Nombre Completo | Aplicación Hospitalaria Cores | Ejemplo en el Flujo |
| :--- | :--- | :--- | :--- |
| **GTIN** | Global Trade Item Number | Identificación de medicamentos, insumos médicos y dispositivos implantables a nivel de empaque secundario y unidosis. | `(01)07501000001234` |
| **GLN** | Global Location Number | Identificación de localizaciones físicas y operativas (Almacén, Farmacia, Quirófano, Camas, Posiciones de Inventario). | `(414)7413000000018` |
| **GSRN** | Global Service Relation Number | Identificación de relaciones de servicio: Personal médico/enfermería (Proveedores) y Pacientes (Sujetos de atención). | `(8018)7413000000000123` |
| **SSCC** | Serial Shipping Container Code | Identificación única de unidades logísticas o agrupaciones de transporte (Pallets o bultos maestros de proveedores). | `(00)374130000000000011` |

### 1.2 La Captura de Datos: GS1 DataMatrix (2D)

El estándar mandatorio para el sector salud en el punto de atención es el **GS1 DataMatrix**. A diferencia del código de barras lineal, permite estructurar identificadores de aplicación (AI) dinámicos en un espacio milimétrico:

* **AI (01):** GTIN del producto.
* **AI (17):** Fecha de vencimiento (Formato: AAMMDD).
* **AI (10):** Número de lote de fabricación.
* **AI (21):** Número de serie único (esencial para control de dispositivos médicos e iniciativas de serialización/antifalsificación).

---

## 2. Matriz de Control de Trazabilidad por Procesos

A continuación se detallan los puntos críticos de control donde los cambios de estado (state transitions) del software deben exigir de forma obligatoria la captura GS1.

```text
[Proveedor/Inbound] ──(SSCC/GTIN)──> [Almacén Central] ──(GLN Origen/Destino)──> [Farmacia] ──(GSRN+GTIN)──> [Paciente/Bedside]
```

### 2.1 Proceso A: Recepción Logística (Inbound)
* **Cambio de Estado del Sistema:** De *Orden de Compra / Envío Pendiente* a *Recibido / En Stock de Almacén*.
* **Punto de Control:** Escaneo en el muelle de descarga.
* **Lógica de Negocio:** El sistema valida que el **SSCC** coincida con el aviso de expedición (DESADV) o exige el escaneo del **GTIN + Lote + Vencimiento**. Si el lote escaneado está registrado en alertas sanitarias globales, el sistema bloquea el ingreso de forma automatizada.

### 2.2 Proceso B: Transferencias Internas y Reabastecimiento
* **Cambio de Estado del Sistema:** De *En Tránsito / Despachado* a *Disponible en Farmacia Satélite / Piso*.
* **Punto de Control:** Escaneo bimodal al salir de almacén central y al ingresar a la farmacia periférica.
* **Lógica de Negocio:** Registro transaccional que vincula el movimiento de stock a un **GLN Origen** y un **GLN Destino**. Permite conocer con precisión quirúrgica dónde se encuentra físicamente cada unidad del medicamento antes de su uso.

### 2.3 Proceso C: Fraccionamiento y Acondicionamiento (Unidosis)
* **Cambio de Estado del Sistema:** De *Empaque Comercial* a *Unidad Fraccionada / Lista para Dispensación*.
* **Punto de Control:** Línea de reempaquetado en la farmacia central.
* **Lógica de Negocio (Evento de Transformación):** El sistema consume el **GTIN Padre** (caja comercial) y genera múltiples **GTIN Hijos** (unidosis). La base de datos debe heredar obligatoriamente los atributos de **Lote** y **Vencimiento** originales en el nuevo DataMatrix impreso para la unidosis.

### 2.4 Proceso D: Dispensación de Recetas y Surtido
* **Cambio de Estado del Sistema:** De *Receta Pendiente* a *Asignado / En Tránsito a Cama*.
* **Punto de Control:** Estación de picking en la farmacia.
* **Lógica de Negocio:** El sistema valida que el **GTIN** y la dosificación escaneada correspondan de forma exacta a la orden médica digital activa. Se realiza una reserva lógica del número de serie o lote específico para esa cuenta de paciente.

### 2.5 Proceso E: Administración en el Punto de Atención (Bedside Scanning)
* **Cambio de Estado del Sistema:** De *Dispensado* a *Administrado / Consumido*.
* **Punto de Control:** Pie de cama del paciente antes del acto clínico.
* **Lógica de Negocio (Regla de Oro de los 5 Correctos):** El software requiere secuencialmente el escaneo de:
    1.  **GSRN del Profesional** (Validación de credenciales y turnos).
    2.  **GSRN del Paciente** (Pulsera de identificación institucional).
    3.  **GTIN de la Unidosis** (DataMatrix del medicamento).
    * *Condición de Bloqueo (Hard Stop):* El sistema interrumpe la confirmación de la dosis si el medicamento está vencido, no coincide con el paciente, o pertenece a un lote revocado, enviando una alerta sonora/visual y reportando el incidente al sistema de farmacovigilancia.

### 2.6 Proceso F: Logística Inversa y Cuarentena
* **Cambio de Estado del Sistema:** De *En Stock* a *Cuarentena / Merma / Retiro*.
* **Punto de Control:** Detección de desviaciones de temperatura, caducidad o alertas de recalls de fabricantes.
* **Lógica de Negocio:** Al marcar un lote como comprometido, el sistema realiza un barrido instantáneo a través de todos los **GLN** del hospital, bloqueando lógicamente cualquier intento de escaneo o dispensación de ese lote específico a nivel institucional.

---

## 3. Meta-Prompt System: Arquitectura de Workflows Hospitalarios GS1

Inyecta este prompt en tu entorno de desarrollo de Inteligencia Artificial (por ejemplo, agentes especializados o herramientas CLI de desarrollo) para auditar flujos técnicos, código fuente o historias de usuario bajo el estándar internacional.

```markdown
[INICIO DEL COMPONENT-PROMPT]

Eres un Arquitecto de Soluciones de Salud Nivel Experto y Consultor Maestro en Estándares GS1 Global, especializado en la integración de trazabilidad clínica y logística dentro de arquitecturas ERP de salud e interfaces HIS.

Tu objetivo es actuar como un motor de validación estricto. Cuando te proporcione la descripción de un proceso hospitalario, un modelo de datos, o una transición de estados, debes analizarlo bajo la óptica del estándar EPCIS de GS1.

Para cada flujo entregado, estructurarás tu análisis en base a las 5 dimensiones core de EPCIS:
1. WHAT (Qué): Identificadores exactos requeridos (GTIN, Lote, Vencimiento, Número de Serie, SSCC).
2. WHERE (Dónde): GLN de origen y GLN de destino involucrados en la transacción.
3. WHEN (Cuándo): Timestamp inmutable en formato ISO 8601.
4. WHY (Por qué): Definición del 'Business Step' y la 'Disposition'.
5. WHO (Quién): GSRN del operador clínico y GSRN del paciente vinculados a la acción.

Reglas de negocio obligatorias que debes prescribir según el escenario:
- En Bedside Scanning: Validar los '5 Correctos'. Emitir obligatoriamente una condición de Hard Stop si el GTIN escaneado no hace match con la receta o está vencido.
- En Unidosis: Tratar el proceso como un Evento de Transformación.
- En Logística Inversa: Cambiar la disposición del lote a 'quarantine'.

Responde siempre entregando una matriz técnica organizada con las columnas: [Paso del Workflow / Transición de Estado], [Evento EPCIS Asociado], [Identificadores GS1 Requeridos], [Punto de Control UI/Hardware] y [Regla de Validación del Sistema (Warning/Hard Stop/Trigger)].

[FIN DEL COMPONENT-PROMPT]
```

---

## 4. Guía de Implementación del Proyecto en Entornos Hospitalarios

### 4.1 Gobernanza de Datos Maestros (MDM)
* **Catálogo Único:** Eliminar los códigos internos propietarios como clave primaria de inventario. La base de datos debe utilizar el **GTIN** como el indexador global de productos de salud.
* **Estructura del GLN:** Diseñar un árbol jerárquico de ubicaciones.

### 4.2 Criterios de Aceptación para Historias de Usuario (Agile/Scrum)
Al documentar desarrollos para módulos de farmacia y enfermería, incluye los siguientes puntos de validación como definición de hecho (*Definition of Done*):
* *Criterio 1:* El formulario de administración clínica no debe permitir el ingreso manual de texto; los campos de medicamento y paciente solo se completan mediante el evento de lectura física del escáner 2D.
* *Criterio 2:* Cualquier intento de transferir stock vencido entre ubicaciones GLN debe disparar una excepción a nivel de base de datos (`ValidationError`) y cancelar el asiento contable de inventario asociado.

### 4.3 Pruebas de Integración (QA)
* **Caso de Prueba - Alerta de Recall:** Simular la llegada de un comunicado del ministerio de salud revocando el lote *X*.
* **Caso de Prueba - Decodificación GS1:** Validar que las expresiones regulares (Regex) de las interfaces móviles separen correctamente los prefijos invisibles de control del estándar (FNC1).