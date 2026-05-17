# E.F2.2 — Épica: Workflow Designer Visual

> **Stream 4 de 10 — Fase 2 HIS Multipaís**
> Generado por @PO · 2026-05-16
> Scope exclusivo: diagramación visual + edición + mantenimiento de workflows. Motor backend en E.F2.1 (Stream 3).

---

## 1. Vision Statement

El Workflow Designer Visual es la interfaz central que permite a los perfiles autorizados de cada institución (MINSAL/ISSS/privado) definir, editar, versionar y publicar los flujos de atención clínica de forma visual e intuitiva, sin necesidad de escribir SQL ni tocar tablas de configuración directamente. Los flujos diseñados aquí se traducen directamente al motor de datos del ECE (`tipo_documento`, `flujo_estado`, `flujo_transicion`, `documento_rol`) de acuerdo con la Norma Técnica del Expediente Clínico (Acuerdo n.° 1616, MINSAL).

### Objetivo de negocio

Reducir el tiempo de configuración de un nuevo flujo clínico de semanas (vía scripts SQL manuales) a menos de 2 horas en manos de un analista funcional no-técnico, con garantía de consistencia regulatoria.

---

## 2. Definition of Ready (DoR)

- [ ] Motor backend de workflows E.F2.1 (Stream 3) desplegado en ambiente de desarrollo con tablas `tipo_documento`, `flujo_estado`, `flujo_transicion`, `documento_rol`, `documento_instancia_historial` accesibles via tRPC.
- [ ] Catálogos de roles (`ROL`) sembrados en BD para los roles normalizados (ADM, AC, ARCH, ENF, MT, MC, ESP, IC, DIR).
- [ ] Diseño UX aprobado por @UIUX con layout del editor y paleta de elementos.
- [ ] Criterios WCAG 2.1 AA documentados por @UIUX.
- [ ] Librería React Flow (o alternativa aprobada) evaluada y seleccionada por @AS/@AT.
- [ ] Historias en estado "Ready" tienen AC Gherkin completos y SP acordados en refinement.

---

## 3. Definition of Done (DoD)

- [ ] Código mergeado en `main` con PR aprobado por al menos un peer.
- [ ] Tests unitarios y de integración: cobertura >= 80 % (lines/functions/branches/statements).
- [ ] Pruebas E2E Playwright green para los escenarios happy path de cada US.
- [ ] Auditoría axe-core: sin hallazgos críticos ni serios (WCAG 2.1 AA).
- [ ] Typecheck `tsc --noEmit` sin errores.
- [ ] Lint `next lint` sin warnings ni errores.
- [ ] Entrada en matriz de trazabilidad (objetivo negocio → épica → historia → tarea técnica).
- [ ] Review @QA firmado.
- [ ] KPIs de producto medibles desde el día del deploy (ver §11).

---

## 4. Backlog Priorizado

### Tabla resumen

| ID | Titulo | SP | MoSCoW | WSJF* |
|---|---|---|---|---|
| US.F2.2.01 | Lienzo drag-and-drop base | 8 | Must | Alto |
| US.F2.2.02 | Paleta de elementos del flujo | 5 | Must | Alto |
| US.F2.2.03 | Propiedades de nodo/arista en panel lateral | 5 | Must | Alto |
| US.F2.2.04 | Auto-layout dagre/elk | 3 | Must | Medio |
| US.F2.2.05 | Validacion visual en vivo | 8 | Must | Alto |
| US.F2.2.06 | Guardar borrador y publicar con audit trail | 8 | Must | Alto |
| US.F2.2.07 | Gestion de versiones y diff visual | 8 | Should | Medio |
| US.F2.2.08 | Simulacion paso a paso con datos de prueba | 8 | Should | Medio |
| US.F2.2.09 | Biblioteca de plantillas de workflow | 5 | Should | Medio |
| US.F2.2.10 | Busqueda y filtros en biblioteca | 3 | Should | Medio |
| US.F2.2.11 | Exportacion PNG/SVG/PDF | 3 | Should | Bajo |
| US.F2.2.12 | Documentacion inline en nodos (Markdown) | 3 | Should | Medio |
| US.F2.2.13 | Vinculacion workflow con modulos del HIS | 5 | Should | Medio |
| US.F2.2.14 | Control de acceso por rol (Workflow Designer / DIR) | 5 | Must | Alto |
| US.F2.2.15 | Vista de solo lectura para roles no editores | 3 | Must | Alto |
| US.F2.2.16 | Vista mobile-friendly (solo lectura) | 3 | Could | Bajo |
| US.F2.2.17 | Accesibilidad WCAG 2.1 AA en el editor | 5 | Must | Alto |
| US.F2.2.18 | Validacion de roles contra catalogo vigente | 3 | Must | Alto |
| US.F2.2.19 | Restaurar version publicada anterior (rollback) | 5 | Should | Medio |
| US.F2.2.20 | Historial de publicaciones auditable | 3 | Must | Alto |

**Total: 103 SP**

> *WSJF simplificado: impacto usuario x urgencia / esfuerzo relativo. Alto >= 2.0, Medio 1.0-1.9, Bajo < 1.0.

---

## 5. Historias de Usuario con Criterios de Aceptacion

---

### US.F2.2.01 — Lienzo drag-and-drop base

**Como** Workflow Designer,
**quiero** un lienzo interactivo donde pueda arrastrar, soltar, mover y conectar nodos,
**para** construir visualmente la estructura de un flujo clinico sin escribir codigo.

**Story Points:** 8 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Lienzo drag-and-drop de workflows

  Scenario: Crear un flujo nuevo con nodos vacios
    Given soy un usuario con rol "Workflow Designer"
    And navego a la seccion "Workflow Designer > Nuevo flujo"
    When hago clic en "Crear flujo"
    Then veo un lienzo en blanco con una zona de drop visible
    And el lienzo tiene un nodo inicial de tipo "INICIO" pre-posicionado

  Scenario: Arrastrar un elemento de la paleta al lienzo
    Given hay un lienzo con un nodo INICIO
    When arrastro el elemento "ESTADO" desde la paleta al lienzo
    Then aparece un nodo de tipo ESTADO en la posicion donde lo solte
    And el nodo queda seleccionado
    And el panel lateral muestra sus propiedades editables

  Scenario: Conectar dos nodos con una arista (transicion)
    Given hay dos nodos en el lienzo: "ESTADO_A" y "ESTADO_B"
    When arrastro desde el puerto de salida de ESTADO_A hasta ESTADO_B
    Then aparece una arista dirigida de ESTADO_A a ESTADO_B
    And la arista queda seleccionada
    And el panel lateral permite asignar la accion y el rol_autoriza

  Scenario: Mover un nodo existente
    Given hay un nodo en el lienzo en posicion (100, 200)
    When arrastro el nodo a la posicion (300, 400)
    Then el nodo aparece en (300, 400)
    And las aristas conectadas se reposicionan automaticamente

  Scenario: Intentar usar el editor sin rol autorizado
    Given soy un usuario con rol "ENF" (solo lectura)
    When navego a un flujo existente
    Then el lienzo muestra el flujo en modo solo lectura
    And no hay controles de arrastre ni botones de edicion activos
```

**Dependencias:** US.F2.2.14 (control de acceso), React Flow o equivalente instalado.
**Notas tecnicas:** Usar React Flow v12+; el estado del grafo en memoria mientras se edita; persistir solo al guardar borrador. El lienzo debe soportar zoom (Ctrl+scroll) y pan (espacio+drag) por keyboard.
**Trazabilidad:** `analisis §4` grafo de dependencias (estructura de nodos del flujo); requerimiento funcional #1 (editor visual drag-and-drop).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.02 — Paleta de elementos del flujo

**Como** Workflow Designer,
**quiero** una paleta lateral con todos los tipos de elementos disponibles (estados, transiciones, decision, rol, documento),
**para** identificar rapidamente que puedo agregar al flujo y entender su semantica clinica.

**Story Points:** 5 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Paleta de elementos del Workflow Designer

  Scenario: Visualizar todos los tipos de elementos
    Given estoy en el editor de workflows
    When observo la paleta lateral izquierda
    Then veo las categorias: "Estados", "Control de flujo", "Roles", "Documentos"
    And bajo "Estados" aparecen: Estado Inicial, Estado Intermedio, Estado Final
    And bajo "Control de flujo" aparece: Decision (bifurcacion)
    And bajo "Roles" aparecen los roles del catalogo vigente
    And bajo "Documentos" aparecen los tipos_documento activos del sistema

  Scenario: Tooltip informativo al pasar el cursor sobre un elemento
    Given estoy viendo la paleta de elementos
    When paso el cursor sobre el elemento "Decision"
    Then aparece un tooltip que explica: "Bifurcacion condicional del flujo; requiere al menos dos aristas de salida con condicion"

  Scenario: Buscar un elemento en la paleta
    Given la paleta esta visible
    When escribo "ingreso" en el campo de busqueda de la paleta
    Then la paleta filtra y muestra solo los elementos cuyo nombre contiene "ingreso"
    And los elementos que no coinciden quedan ocultos

  Scenario: Estado Inicial puede existir solo una vez por flujo
    Given el flujo ya tiene un nodo de tipo "Estado Inicial"
    When intento arrastrar otro "Estado Inicial" al lienzo
    Then la operacion es bloqueada
    And aparece el mensaje "Un flujo solo puede tener un estado inicial"
```

**Dependencias:** US.F2.2.01 (lienzo base).
**Notas tecnicas:** Los roles y tipos de documento de la paleta se obtienen via tRPC desde `ROL` y `tipo_documento` del motor backend. La paleta es reactiva: si se agrega un nuevo tipo_documento en BD, aparece en la siguiente carga.
**Trazabilidad:** `analisis §4` (nodos: estado, transicion, decision); requerimiento funcional #2 (paleta de elementos).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.03 — Propiedades de nodo/arista en panel lateral

**Como** Workflow Designer,
**quiero** editar las propiedades de cada nodo y arista en un panel lateral contextual,
**para** configurar el nombre del estado, el rol autorizador de cada transicion y los documentos asociados sin abrir modales adicionales.

**Story Points:** 5 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Panel de propiedades contextual

  Scenario: Ver propiedades de un nodo Estado
    Given hay un nodo de tipo "Estado Intermedio" en el lienzo
    When hago clic sobre el nodo
    Then el panel lateral muestra:
      | Campo              | Tipo         |
      | Nombre del estado  | text input   |
      | Codigo interno     | text input   |
      | Es estado final    | checkbox     |
      | Descripcion        | textarea     |
      | Documentos requeridos | multi-select |

  Scenario: Ver propiedades de una arista (transicion)
    Given hay una arista entre dos nodos en el lienzo
    When hago clic sobre la arista
    Then el panel lateral muestra:
      | Campo              | Tipo         |
      | Accion             | text input   |
      | Rol autorizador    | select (catalogo ROL) |
      | Requiere firma     | checkbox     |
      | Condicion (texto)  | textarea (opcional) |

  Scenario: Editar el nombre de un estado y ver el cambio en el lienzo
    Given tengo abierto el panel de propiedades de un nodo
    When cambio el campo "Nombre del estado" a "En observacion"
    Then la etiqueta del nodo en el lienzo muestra "En observacion" en tiempo real

  Scenario: Intentar guardar una arista sin rol autorizador
    Given hay una arista seleccionada con campo "Rol autorizador" vacio
    When intento guardar el borrador
    Then el sistema muestra el error de validacion inline en el panel lateral
    And la arista queda marcada con indicador de error (rojo)
```

**Dependencias:** US.F2.2.01, US.F2.2.02.
**Notas tecnicas:** El panel lateral usa componentes Shadcn/Tailwind del design system. Los cambios en propiedades se aplican al estado local del grafo (React state); no hay autoguardado automatico.
**Trazabilidad:** Requerimiento funcional #2 (paleta y propiedades); `analisis §4` (campos de `FLUJO_TRANSICION`: `accion`, `rol_autoriza_id`, `requiere_firma`).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.04 — Auto-layout dagre/elk

**Como** Workflow Designer,
**quiero** aplicar un auto-layout con un clic para reorganizar el diagrama automaticamente,
**para** obtener una disposicion legible sin tener que mover nodos manualmente.

**Story Points:** 3 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Auto-layout de grafos

  Scenario: Aplicar auto-layout exitoso
    Given tengo un flujo con 6 nodos dispersos manualmente
    When hago clic en el boton "Auto-layout"
    Then los nodos se redistribuyen en disposicion jerarquica de izquierda a derecha
    And las aristas no se solapan con nodos
    And el lienzo hace pan/zoom automatico para mostrar el grafo completo

  Scenario: Preservar posiciones manuales post-layout con override
    Given aplique auto-layout y luego movi un nodo manualmente a otra posicion
    When hago clic en "Auto-layout" nuevamente
    Then aparece el dialogo: "Esta accion reemplazara las posiciones manuales. Continuar?"
    And si confirmo, el layout se recalcula incluyendo el nodo movido

  Scenario: Auto-layout en flujo vacio
    Given el lienzo tiene solo el nodo INICIO sin aristas
    When hago clic en "Auto-layout"
    Then no ocurre ningun cambio de posicion
    And no se muestra error
```

**Dependencias:** US.F2.2.01.
**Notas tecnicas:** Integrar `dagre` como primera opcion (mas liviano); `elk` como opcion avanzada configurable. El algoritmo corre en el cliente (no es llamada al servidor).
**Trazabilidad:** Requerimiento funcional #3 (auto-layout).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.05 — Validacion visual en vivo

**Como** Workflow Designer,
**quiero** ver indicadores visuales en tiempo real que marquen errores de diseno del flujo,
**para** detectar y corregir problemas antes de intentar publicar.

**Story Points:** 8 | **MoSCoW:** Must | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Validacion visual en tiempo real

  Scenario: Estado sin arista de salida (excepto estado final)
    Given tengo un nodo de tipo "Estado Intermedio" sin aristas de salida
    Then el nodo muestra un borde rojo y un icono de advertencia
    And el panel de errores inferior muestra: "El estado 'X' no tiene transicion de salida"

  Scenario: Estado sin arista de entrada (excepto estado inicial)
    Given tengo un nodo "Estado Intermedio" sin ninguna arista entrante
    Then el nodo muestra borde amarillo (advertencia)
    And el mensaje es: "El estado 'X' podria ser inalcanzable"

  Scenario: Ciclo prohibido detectado
    Given creo una arista de retorno que cierra un ciclo A -> B -> A
    Then ambas aristas del ciclo se resaltan en naranja
    And aparece el mensaje: "Ciclo detectado entre 'A' y 'B'. Los ciclos estan deshabilitados en este tipo de flujo"
    And el boton "Publicar" queda deshabilitado mientras el error persista

  Scenario: Rol asignado en una transicion no existe en el catalogo
    Given asigne el rol "FARMACIA" a una transicion
    And "FARMACIA" no existe en la tabla ROL activa
    Then la arista muestra borde rojo
    And el mensaje es: "El rol 'FARMACIA' no existe en el catalogo vigente"

  Scenario: Flujo sin errores habilita boton Publicar
    Given todas las validaciones pasan
    Then el panel de errores muestra "Sin errores de validacion"
    And el boton "Publicar" esta habilitado
```

**Dependencias:** US.F2.2.01, US.F2.2.02, US.F2.2.18 (validacion de roles).
**Notas tecnicas:** Las validaciones corren en el cliente sobre el estado del grafo React. La validacion de rol contra catalogo requiere una llamada tRPC `workflow.validateRoles` que devuelve los IDs invalidos. Frecuencia de validacion: en cada cambio de grafo con debounce de 300 ms.
**Trazabilidad:** Requerimiento funcional #4 (validacion visual); `analisis §4` grafo de restricciones (estado sin salida, ciclos).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.06 — Guardar borrador y publicar con audit trail

**Como** Workflow Designer,
**quiero** guardar el flujo como borrador mientras trabajo y publicarlo formalmente cuando este listo, con registro del autor, fecha y motivo,
**para** tener control sobre que version esta activa en produccion y poder justificar cambios ante auditorias.

**Story Points:** 8 | **MoSCoW:** Must | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Gestion de borradores y publicacion

  Scenario: Guardar borrador exitosamente
    Given estoy editando un flujo con cambios sin guardar
    When hago clic en "Guardar borrador"
    Then el sistema persiste el estado actual del grafo en BD con estado "BORRADOR"
    And la barra de titulo muestra "Guardado" con timestamp
    And no se afecta el flujo publicado actualmente activo

  Scenario: Publicar un flujo con motivo
    Given tengo un borrador sin errores de validacion
    When hago clic en "Publicar"
    Then aparece un dialogo solicitando: "Motivo del cambio" (textarea obligatorio)
    And al confirmar, el sistema crea una nueva version con estado "PUBLICADO"
    And registra en "documento_instancia_historial" o tabla equivalente: usuario, timestamp, version, motivo
    And el flujo anterior pasa a estado "HISTORICO"

  Scenario: Intento de publicar con errores de validacion
    Given el flujo tiene al menos un error de validacion activo
    When hago clic en "Publicar"
    Then el boton esta deshabilitado (no se puede hacer clic)
    And el tooltip del boton dice: "Resuelve X errores de validacion antes de publicar"

  Scenario: Intento de publicar por usuario sin permiso
    Given soy usuario con rol "MC" (sin permiso de publicacion)
    When intento acceder a la opcion "Publicar"
    Then la opcion no es visible
    And si accedo por URL directa, el servidor devuelve 403

  Scenario: Guardado automatico de borrador (auto-save)
    Given estoy editando un flujo y no he guardado en los ultimos 60 segundos
    When pasan 60 segundos de inactividad de guardado
    Then el sistema guarda automaticamente el borrador
    And muestra "Auto-guardado HH:MM" en la barra de estado sin interrumpir el trabajo
```

**Dependencias:** US.F2.2.01, US.F2.2.05, US.F2.2.14.
**Notas tecnicas:** La publicacion llama a `workflow.publish` (tRPC tenantProcedure + requireRole(["WORKFLOW_DESIGNER", "DIR"])). El borrador se almacena como `jsonb` del snapshot del grafo en una tabla `workflow_draft`. El motivo se persiste en la cadena de audit del motor backend (Stream 3).
**Trazabilidad:** Requerimiento funcional #7 (publicacion con audit trail); `analisis §5` restriccion "Bitácora de accesos Art. 55-56 NTEC".
**Trazabilidad GS1:** N/A.

---

### US.F2.2.07 — Gestion de versiones y diff visual

**Como** Workflow Designer o Director,
**quiero** ver el historial de versiones de un flujo y comparar dos versiones lado a lado con diferencias resaltadas,
**para** entender que cambio entre versiones y tomar decisiones informadas de rollback.

**Story Points:** 8 | **MoSCoW:** Should | **Sprint sugerido:** 3

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Historial de versiones y diff visual

  Scenario: Ver lista de versiones de un flujo
    Given accedo a un flujo que tiene 4 versiones publicadas
    When hago clic en "Versiones"
    Then veo una tabla con columnas: Version, Fecha, Autor, Motivo, Estado
    And la version activa esta marcada como "ACTIVA"

  Scenario: Comparar dos versiones (diff visual)
    Given estoy en la pantalla de versiones del flujo
    When selecciono la version 2 y la version 4 y hago clic en "Comparar"
    Then se abre una vista de dos paneles (split)
    And en el panel izquierdo se muestra el grafo de la version 2
    And en el panel derecho se muestra el grafo de la version 4
    And los nodos nuevos en v4 aparecen en verde
    And los nodos eliminados (presentes en v2 pero no en v4) aparecen en rojo tachado
    And los nodos modificados aparecen en amarillo

  Scenario: Diff de aristas
    Given comparo version 2 vs version 4
    When una arista cambio el rol autorizador de "ENF" a "MC"
    Then la arista modificada aparece en amarillo en ambos paneles
    And al pasar el cursor sobre la arista aparece un tooltip con el detalle del cambio

  Scenario: Exportar diff como PDF
    Given estoy viendo la comparacion entre dos versiones
    When hago clic en "Exportar diff PDF"
    Then se descarga un PDF con ambos paneles y la leyenda de colores
```

**Dependencias:** US.F2.2.06, US.F2.2.11 (exportacion).
**Notas tecnicas:** El diff compara dos snapshots `jsonb`. La logica de diff (nodos/aristas agregados, eliminados, modificados) corre en cliente. Para flujos grandes (> 50 nodos), mostrar advertencia de rendimiento.
**Trazabilidad:** Requerimiento funcional #6 (comparacion de versiones).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.08 — Simulacion paso a paso con datos de prueba

**Como** Workflow Designer,
**quiero** ejecutar una simulacion del flujo con datos de prueba seleccionables,
**para** verificar que el camino clinico modelado sigue la logica esperada antes de publicarlo.

**Story Points:** 8 | **MoSCoW:** Should | **Sprint sugerido:** 3

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Simulacion de flujo paso a paso

  Scenario: Iniciar simulacion desde estado inicial
    Given tengo un flujo valido con 5 estados
    When hago clic en "Simular"
    Then se abre el panel de simulacion
    And el nodo de Estado Inicial queda resaltado en azul (estado activo)
    And el panel muestra las transiciones disponibles desde el estado inicial

  Scenario: Avanzar en la simulacion eligiendo una transicion
    Given la simulacion esta activa en el estado "En triaje"
    When hago clic en la transicion "Clasificar nivel 2"
    Then el nodo "Clasificado nivel 2" pasa a resaltarse en azul
    And el nodo "En triaje" queda marcado como visitado (gris)
    And el panel muestra: rol requerido para esta transicion = "ENF"

  Scenario: Llegar a un estado final en la simulacion
    Given avanzo en la simulacion hasta un nodo de tipo Estado Final
    Then el panel muestra "Flujo completado: Alta ambulatoria"
    And el boton "Reiniciar simulacion" esta disponible

  Scenario: Seleccionar un escenario de datos de prueba
    Given el flujo esta en modo simulacion
    When selecciono el escenario "HC ambulatoria de primera vez"
    Then el panel precarga el contexto: tipo_episodio=ambulatorio, modalidad=presencial
    And las transiciones disponibles se filtran segun este contexto

  Scenario: Simulacion no persiste cambios en BD
    Given ejecuto una simulacion completa
    Then ningun registro es creado ni modificado en la base de datos
    And al salir del modo simulacion el flujo queda en su estado previo
```

**Dependencias:** US.F2.2.01, US.F2.2.05, US.F2.2.09 (plantillas/escenarios).
**Notas tecnicas:** La simulacion es puramente en memoria (no llama al motor de workflow de produccion). Los escenarios de prueba son datos `json` estaticos versionados en la UI. No genera `documento_instancia` real.
**Trazabilidad:** Requerimiento funcional #5 (simulacion/preview).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.09 — Biblioteca de plantillas de workflow

**Como** Workflow Designer,
**quiero** acceder a una biblioteca de plantillas preconstruidas de workflows clinicos comunes,
**para** iniciar el diseno de un flujo nuevo a partir de una base probada en lugar de desde cero.

**Story Points:** 5 | **MoSCoW:** Should | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Biblioteca de plantillas

  Scenario: Ver plantillas disponibles
    Given navego a "Workflow Designer > Biblioteca de plantillas"
    Then veo las plantillas base:
      | Nombre                     | Modalidad    |
      | HC ambulatoria de primera vez | Ambulatorio |
      | HC ambulatoria subsecuente    | Ambulatorio |
      | Episodio hospitalario basico  | Hospitalario |
      | Ruta quirurgica electiva      | Hospitalario |
      | Episodio de emergencia        | Emergencia   |
      | Atencion obstetricia          | Hospitalario |

  Scenario: Crear flujo desde plantilla
    Given selecciono la plantilla "Ruta quirurgica electiva"
    When hago clic en "Usar como base"
    Then se abre el editor con el grafo de la plantilla cargado como nuevo borrador
    And el titulo del flujo es "Copia de: Ruta quirurgica electiva" (editable)
    And el borrador tiene estado BORRADOR (no publicado)

  Scenario: Previsualizar una plantilla antes de usarla
    Given estoy en la biblioteca de plantillas
    When hago clic en "Ver preview" de "Episodio hospitalario basico"
    Then se abre un modal con el grafo de la plantilla en modo solo lectura
    And puedo hacer zoom y pan pero no editar

  Scenario: Plantillas del sistema no son editables
    Given soy Workflow Designer
    When accedo a una plantilla del sistema
    Then no veo el boton "Editar plantilla"
    And solo veo "Usar como base" y "Ver preview"
```

**Dependencias:** US.F2.2.01, US.F2.2.06.
**Notas tecnicas:** Las plantillas base se siembran en BD en una tabla `workflow_template` con `es_sistema = true`. Solo rol DIR puede crear/editar plantillas institucionales. Los grafos de plantilla reflejan el grafo del `08_seed_workflows.sql`.
**Trazabilidad:** Requerimiento funcional #8 (plantillas/library); `analisis §A` proceso ambulatorio y `§B` proceso hospitalario como fuente de los flujos.
**Trazabilidad GS1:** N/A.

---

### US.F2.2.10 — Busqueda y filtros en biblioteca

**Como** Workflow Designer,
**quiero** buscar y filtrar workflows y plantillas por nombre, modalidad, estado y fecha,
**para** localizar rapidamente el flujo que necesito en una institucion con muchos workflows configurados.

**Story Points:** 3 | **MoSCoW:** Should | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Busqueda y filtros en la biblioteca de workflows

  Scenario: Busqueda por nombre
    Given estoy en la biblioteca con 15 workflows
    When escribo "quirur" en el campo de busqueda
    Then la lista muestra solo los workflows cuyo nombre contiene "quirur" (case-insensitive)

  Scenario: Filtrar por modalidad
    Given la biblioteca muestra todos los workflows
    When selecciono el filtro "Modalidad: Hospitalario"
    Then solo aparecen workflows con modalidad hospitalaria
    And el contador muestra "X resultados"

  Scenario: Filtrar por estado
    Given hay workflows en estado BORRADOR, PUBLICADO e HISTORICO
    When selecciono "Estado: Publicado"
    Then solo aparecen workflows con estado PUBLICADO

  Scenario: Busqueda sin resultados
    Given escribo "zzz_inexistente" en el campo de busqueda
    Then aparece el mensaje "Sin resultados para 'zzz_inexistente'"
    And hay un boton "Limpiar busqueda"

  Scenario: Limpiar filtros
    Given aplique filtros de modalidad y estado
    When hago clic en "Limpiar filtros"
    Then todos los workflows vuelven a aparecer
```

**Dependencias:** US.F2.2.09.
**Notas tecnicas:** Busqueda client-side si < 200 workflows; paginada via tRPC si > 200. Filtros se persisten en URL query params para compartir enlace filtrado.
**Trazabilidad:** Requerimiento funcional #11 (busqueda y filtros).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.11 — Exportacion PNG/SVG/PDF

**Como** Workflow Designer o miembro del equipo clinico,
**quiero** exportar el diagrama del flujo como imagen o PDF,
**para** incluirlo en manuales de procedimientos, presentaciones o documentacion de cumplimiento normativo.

**Story Points:** 3 | **MoSCoW:** Should | **Sprint sugerido:** 3

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Exportacion del diagrama

  Scenario: Exportar como PNG
    Given estoy visualizando un flujo publicado
    When hago clic en "Exportar > PNG"
    Then se descarga un archivo "nombre-flujo-vX.png" con resolucion minima 1920px de ancho
    And el fondo es blanco (no transparente)
    And el nombre del flujo, version y fecha aparecen en el pie de imagen

  Scenario: Exportar como SVG
    Given estoy visualizando un flujo publicado
    When hago clic en "Exportar > SVG"
    Then se descarga un archivo "nombre-flujo-vX.svg" vectorial
    And el SVG es valido y renderiza correctamente en navegadores modernos

  Scenario: Exportar como PDF
    Given estoy visualizando un flujo publicado
    When hago clic en "Exportar > PDF"
    Then se descarga un PDF en formato A3 (landscape) con el diagrama completo
    And incluye: nombre del flujo, version, autor de la ultima publicacion, fecha, sello de la institucion (si configurado)

  Scenario: Exportar flujo en borrador
    Given el flujo tiene estado BORRADOR
    When accedo a "Exportar"
    Then las opciones de exportacion estan disponibles
    And el documento exportado incluye la marca de agua "BORRADOR — No publicado"
```

**Dependencias:** US.F2.2.06.
**Notas tecnicas:** PNG/SVG via `html-to-image` o la API nativa de React Flow. PDF via `jsPDF` + render del canvas. El procesamiento es en cliente para evitar carga de servidor.
**Trazabilidad:** Requerimiento funcional #9 (exportacion).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.12 — Documentacion inline en nodos (Markdown)

**Como** Workflow Designer,
**quiero** agregar una descripcion en formato Markdown a cada nodo del flujo,
**para** documentar el proposito clinico, los requisitos regulatorios y las notas de implementacion directamente en el diagrama.

**Story Points:** 3 | **MoSCoW:** Should | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Documentacion inline en nodos

  Scenario: Agregar descripcion Markdown a un nodo
    Given selecciono un nodo "Triaje de emergencia"
    When escribo en el campo "Descripcion" del panel lateral:
      "**Fundamento:** Art. 4, NTEC. Clasifica por nivel Manchester."
    Then al hacer clic fuera del campo, el texto se renderiza como HTML formateado en el panel

  Scenario: Ver la descripcion en modo hover sobre el nodo
    Given un nodo tiene descripcion Markdown configurada
    When paso el cursor sobre el nodo en el lienzo
    Then aparece un tooltip renderizado con el contenido Markdown formateado

  Scenario: Descripcion visible en modo solo lectura
    Given soy usuario con rol solo lectura
    When paso el cursor sobre un nodo con descripcion
    Then el tooltip Markdown es visible (solo lectura, no editable)

  Scenario: Descripcion incluida en exportacion PDF
    Given un flujo tiene nodos con descripcion
    When exporto como PDF
    Then el PDF incluye una seccion "Notas de nodos" al final con el listado de descripciones por nodo
```

**Dependencias:** US.F2.2.01, US.F2.2.11.
**Notas tecnicas:** Renderizado Markdown con `react-markdown` + `remark-gfm`. La descripcion se persiste como campo `descripcion_md text` en el snapshot JSON del nodo. Sanitizar HTML del output para prevenir XSS.
**Trazabilidad:** Requerimiento funcional #12 (documentacion inline).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.13 — Vinculacion workflow con modulos del HIS

**Como** Workflow Designer,
**quiero** asociar un workflow publicado con uno o mas modulos del HIS (por ejemplo, `surgery.router`, `emergency.router`),
**para** que el motor de workflow sepa que flujo aplicar cuando se crea un episodio de ese tipo.

**Story Points:** 5 | **MoSCoW:** Should | **Sprint sugerido:** 3

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Vinculacion workflow con modulos del HIS

  Scenario: Vincular un workflow a un modulo
    Given tengo el workflow "Ruta quirurgica electiva" en estado PUBLICADO
    When en la pantalla de detalles del workflow hago clic en "Vincular modulo"
    Then se despliega un selector con los modulos disponibles del HIS
    And selecciono "Cirugia (surgery.router)"
    Then el workflow queda asociado al modulo en la tabla "workflow_modulo"
    And el sistema muestra la confirmacion: "Workflow vinculado a Cirugia"

  Scenario: Un modulo solo puede tener un workflow activo por modalidad
    Given "Cirugia (surgery.router)" ya tiene un workflow activo vinculado
    When intento vincular un segundo workflow diferente al mismo modulo
    Then el sistema muestra: "Ya existe un workflow activo para Cirugia. Desvincula el actual primero."

  Scenario: Ver modulos vinculados al workflow
    Given el workflow "Episodio hospitalario" esta vinculado a 2 modulos
    When accedo a los detalles del workflow
    Then veo la seccion "Modulos vinculados" con la lista de modulos asociados

  Scenario: Desvincular un modulo
    Given un workflow esta vinculado a "Emergencia (emergency.router)"
    When hago clic en "Desvincular" junto al modulo
    Then el sistema solicita confirmacion
    And al confirmar, la vinculacion se elimina y el modulo queda sin workflow activo
    And se registra en el audit trail: usuario, timestamp, accion "DESVINCULADO"
```

**Dependencias:** US.F2.2.06 (publicacion), motor backend E.F2.1 (Stream 3).
**Notas tecnicas:** La tabla `workflow_modulo` tiene (`workflow_version_id`, `modulo_codigo`, `activo`). El router de cada modulo consulta esta tabla al crear un nuevo `documento_instancia`. La vinculacion require `requireRole(["WORKFLOW_DESIGNER", "DIR"])`.
**Trazabilidad:** Requerimiento funcional #13 (integracion con modulos); `analisis §B` proceso hospitalario (multiples rutas quirurgica, obstetrica).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.14 — Control de acceso por rol (Workflow Designer / DIR)

**Como** Administrador del sistema,
**quiero** que solo los usuarios con rol "Workflow Designer" o "Director" puedan crear, editar y publicar workflows,
**para** garantizar que solo personal autorizado modifica los flujos clinicos en produccion.

**Story Points:** 5 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Control de acceso al Workflow Designer

  Scenario: Acceso denegado a usuario sin rol editor
    Given soy un usuario autenticado con rol "MC" (Medico de Cabecera)
    When navego a "/workflow-designer"
    Then veo la pagina en modo solo lectura
    And los controles de edicion (arrastrar, guardar, publicar) no son visibles

  Scenario: Acceso de edicion para Workflow Designer
    Given soy usuario con rol "WORKFLOW_DESIGNER"
    When navego a "/workflow-designer"
    Then veo el editor completo con paleta, lienzo y controles de guardar/publicar

  Scenario: Acceso de edicion para Director
    Given soy usuario con rol "DIR"
    When navego a "/workflow-designer"
    Then veo el editor completo incluyendo el panel de gestion de plantillas institucionales

  Scenario: Intento de publicacion via API sin rol autorizado
    Given soy usuario con rol "ENF"
    When realizo una llamada POST a la mutacion "workflow.publish" via tRPC
    Then el servidor devuelve error 403 FORBIDDEN
    And se registra el intento en la bitacora de accesos

  Scenario: Asignacion de rol Workflow Designer por Admin
    Given soy Admin del sistema
    When asigno el rol "WORKFLOW_DESIGNER" a un usuario
    Then ese usuario puede acceder al editor en modo edicion en su siguiente sesion
```

**Dependencias:** `requireRole` procedure de `packages/trpc/src/trpc.ts`, tabla ROL con valor `WORKFLOW_DESIGNER`.
**Notas tecnicas:** Agregar `WORKFLOW_DESIGNER` al enum de roles en `schema.prisma` y en la tabla `ROL` de `01_catalogos.sql`. La ruta `/workflow-designer` usa `tenantProcedure` con `requireRole(["WORKFLOW_DESIGNER", "DIR"])`. El cliente lee el rol desde el contexto de sesion para condicionar el rendering.
**Trazabilidad:** `analisis §2` roles normalizados; requerimiento funcional #10 (permisos).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.15 — Vista de solo lectura para roles no editores

**Como** miembro del equipo clinico (ENF, MC, MT, etc.),
**quiero** poder ver y navegar cualquier workflow publicado en modo solo lectura,
**para** entender los pasos del flujo clinico sin riesgo de modificarlo accidentalmente.

**Story Points:** 3 | **MoSCoW:** Must | **Sprint sugerido:** 1

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Vista de solo lectura

  Scenario: Visualizar workflow publicado en modo lectura
    Given soy usuario con rol "ENF"
    When navego a "/workflow-designer/workflows/{id}"
    Then veo el diagrama completo del workflow
    And puedo hacer zoom y pan con el mouse
    And no hay paleta de elementos ni controles de edicion visibles

  Scenario: Navegar por los nodos en modo lectura
    Given estoy viendo un workflow en modo solo lectura
    When hago clic sobre un nodo
    Then el panel lateral muestra las propiedades del nodo en modo lectura (sin campos editables)

  Scenario: Ver descripcion Markdown de nodos
    Given el workflow tiene nodos con documentacion inline
    When hago clic en un nodo o paso el cursor
    Then veo la descripcion Markdown renderizada en el panel lateral

  Scenario: Solo lectura no muestra borradores de otros usuarios
    Given existe un borrador no publicado del flujo "Triaje"
    When usuario ENF accede al workflow "Triaje"
    Then solo ve la version publicada (PUBLICADO)
    And no ve el borrador
```

**Dependencias:** US.F2.2.14, US.F2.2.01.
**Notas tecnicas:** La ruta `/workflow-designer/workflows/[id]` con GET solo devuelve la version `PUBLICADO` para roles no-editores. El componente del editor recibe `readOnly={true}` y React Flow deshabilita el drag/drop de nodos y la creacion de aristas.
**Trazabilidad:** Requerimiento funcional #10 (permisos); requerimiento funcional #15 (mobile-friendly parcialmente cubierto aqui).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.16 — Vista mobile-friendly (solo lectura)

**Como** profesional de salud que accede desde un dispositivo movil,
**quiero** poder ver el diagrama del workflow en pantallas pequenas con navegacion adaptada,
**para** consultar el flujo clinico desde cualquier dispositivo sin depender de un computador.

**Story Points:** 3 | **MoSCoW:** Could | **Sprint sugerido:** 4

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Vista mobile-friendly del workflow

  Scenario: Renderizar diagrama en pantalla movil (360px ancho)
    Given accedo al workflow desde un dispositivo movil con 360px de ancho
    Then el diagrama se renderiza con zoom ajustado para ver al menos el nodo inicial y sus vecinos inmediatos
    And hay controles de zoom con botones (+/-) visibles y tactiles (minimo 44x44px)

  Scenario: Navegar el diagrama en movil con touch
    Given estoy viendo el workflow en movil
    When uso el gesto de pinch-to-zoom
    Then el diagrama hace zoom in/out correctamente
    When arrastro con un dedo
    Then el diagrama hace pan

  Scenario: Panel de propiedades en movil
    Given toco un nodo en la vista movil
    Then aparece una hoja inferior (bottom sheet) con las propiedades del nodo
    And la hoja cubre el 50% inferior de la pantalla y es desplazable

  Scenario: Edicion deshabilitada en movil
    Given soy Workflow Designer accediendo desde movil
    When veo el workflow en movil
    Then el modo de edicion no esta disponible
    And aparece un mensaje: "Edicion disponible solo en pantalla de escritorio"
```

**Dependencias:** US.F2.2.15.
**Notas tecnicas:** Breakpoint movil < 768px. En movil, el editor siempre es `readOnly`. El panel lateral se reemplaza por un bottom sheet (componente Shadcn Sheet). El editor queda en desktop-only para evitar errores de drag en touch.
**Trazabilidad:** Requerimiento funcional #15 (mobile-friendly).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.17 — Accesibilidad WCAG 2.1 AA en el editor

**Como** usuario con discapacidad visual o motora,
**quiero** poder navegar y operar el editor de workflows usando solo el teclado y lectores de pantalla,
**para** no quedar excluido del uso de esta herramienta critica.

**Story Points:** 5 | **MoSCoW:** Must | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Accesibilidad WCAG 2.1 AA en el Workflow Designer

  Scenario: Navegacion del lienzo por teclado
    Given estoy en el editor con foco en el lienzo
    When uso las teclas de flecha
    Then el foco se mueve entre nodos en el orden del grafo (izquierda a derecha, arriba a abajo)
    And el nodo enfocado tiene un contorno de foco visible (outline 3px)

  Scenario: Activar acciones de nodo por teclado
    Given un nodo esta enfocado con teclado
    When presiono Enter o Espacio
    Then el panel lateral se enfoca y muestra las propiedades del nodo

  Scenario: Anuncio de lectores de pantalla para estado del nodo
    Given uso un lector de pantalla
    When el foco llega a un nodo
    Then el lector anuncia: "Nodo: [Nombre del estado], Tipo: [Estado Intermedio], [N] aristas de entrada, [M] aristas de salida"

  Scenario: Contraste de color suficiente
    Given el lienzo esta activo
    Then todos los textos de etiquetas de nodos tienen relacion de contraste >= 4.5:1 con su fondo
    And los indicadores de error (rojo) tienen relacion de contraste >= 3:1 con el fondo

  Scenario: axe-core sin hallazgos criticos
    Given accedo a la pagina del editor
    When ejecuto el analisis axe-core
    Then el reporte no contiene hallazgos con impacto "critical" ni "serious"
```

**Dependencias:** US.F2.2.01; componentes Shadcn (accesibles por defecto para el panel lateral).
**Notas tecnicas:** React Flow tiene soporte keyboard navigation experimental; activarlo y extenderlo segun los escenarios. Los colores de estados de error se validan con un plugin de color contrast en CI. Agregar `aria-label` y `role="region"` al contenedor del lienzo.
**Trazabilidad:** Requerimiento funcional #14 (accesibilidad WCAG 2.1 AA).
**Trazabilidad GS1:** N/A.

---

### US.F2.2.18 — Validacion de roles contra catalogo vigente

**Como** Workflow Designer,
**quiero** que el sistema valide en tiempo real que los roles asignados en el flujo existen en el catalogo activo,
**para** evitar publicar un workflow con roles fantasma que bloqueen la atencion clinica.

**Story Points:** 3 | **MoSCoW:** Must | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Validacion de roles en tiempo real

  Scenario: Rol valido asignado a transicion
    Given asigno el rol "ENF" a una transicion
    And "ENF" existe en la tabla ROL con estado activo
    Then la arista no muestra error de rol
    And el estado global de validacion no registra error por este concepto

  Scenario: Rol invalido o inactivo asignado a transicion
    Given asigno el rol "LAB_TECNICO" a una transicion
    And "LAB_TECNICO" no existe en la tabla ROL activa
    Then la arista muestra borde rojo
    And el panel de errores muestra: "Transicion 'X': el rol 'LAB_TECNICO' no existe en el catalogo"
    And el boton Publicar queda bloqueado

  Scenario: Validacion refrescada al cambiar catalogo
    Given el catalogo de roles se actualiza (se agrega "LAB_TECNICO")
    When el Workflow Designer recarga la pagina del editor
    Then "LAB_TECNICO" aparece disponible en la paleta y el error anterior desaparece

  Scenario: Validacion en servidor al intentar publicar
    Given el cliente no detecto el error (caso edge)
    When el servidor recibe la mutacion "workflow.publish"
    Then el servidor re-valida todos los roles referenciados contra BD
    And si detecta un rol invalido, devuelve error 422 con detalle del campo afectado
```

**Dependencias:** US.F2.2.05 (validacion visual), motor backend E.F2.1 (Stream 3), catalogo ROL.
**Notas tecnicas:** El query `workflow.validateRoles` devuelve `{ rol_codigo: string, existe: boolean }[]`. Se ejecuta con debounce 500ms al modificar aristas. El servidor siempre re-valida antes de persistir (defense in depth).
**Trazabilidad:** `analisis §4` (nodo rol en el grafo); `analisis §5` restriccion RBAC Art. 33 NTEC.
**Trazabilidad GS1:** N/A.

---

### US.F2.2.19 — Restaurar version publicada anterior (rollback)

**Como** Director o Workflow Designer,
**quiero** restaurar una version publicada anterior como la version activa,
**para** revertir rapidamente un cambio que esta causando problemas en la operacion clinica.

**Story Points:** 5 | **MoSCoW:** Should | **Sprint sugerido:** 4

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Rollback de version de workflow

  Scenario: Rollback exitoso a version anterior
    Given el workflow "Episodio hospitalario" tiene versiones 1, 2 (activa) y 3
    And estoy autenticado como Director
    When en la pantalla de versiones selecciono la version 1 y hago clic en "Restaurar esta version"
    Then aparece confirmacion: "Esto marcara la version 3 como HISTORICO y activara la v1. Motivo obligatorio."
    And ingreso el motivo "Reverso por error en transicion de egreso"
    And confirmo
    Then la version 1 pasa a estado PUBLICADO (activa)
    And la version 3 pasa a HISTORICO
    And el audit trail registra: usuario, timestamp, version_restaurada=1, version_reemplazada=3, motivo

  Scenario: Solo versiones en estado HISTORICO son candidatas a rollback
    Given la version 2 esta en estado PUBLICADO
    When veo la lista de versiones
    Then la version 2 (activa) no tiene boton "Restaurar"
    And las versiones HISTORICO si lo tienen

  Scenario: Rollback bloqueado si el workflow tiene vinculaciones activas con dependencias
    Given la version 1 referencia tipos_documento que ya no existen en BD
    When intento restaurar la version 1
    Then el sistema muestra: "No se puede restaurar: los siguientes tipos de documento de la v1 ya no existen: [lista]"

  Scenario: Notificacion a usuarios activos tras rollback
    Given un rollback se realiza exitosamente
    Then el sistema emite un evento que puede notificar a los usuarios que tenian el flujo abierto
    And al recargar, ven la version restaurada
```

**Dependencias:** US.F2.2.07 (gestion de versiones), US.F2.2.06, US.F2.2.14.
**Notas tecnicas:** El rollback es una mutacion `workflow.rollback({ workflowId, targetVersionId, motivo })` con `requireRole(["DIR"])`. No copia el grafo: solo cambia el estado de las filas de version. Si hay `documento_instancia` activo apuntando a la version que se va a historificar, se debe analizar el impacto (documentado como decision pendiente §9).
**Trazabilidad:** Requerimiento funcional #6 (comparacion y rollback implicito); `analisis §5` restriccion inmutabilidad Art. 42 NTEC.
**Trazabilidad GS1:** N/A.

---

### US.F2.2.20 — Historial de publicaciones auditable

**Como** Director o Auditor,
**quiero** ver un historial completo de todas las publicaciones, rollbacks y cambios de estado de cada workflow,
**para** cumplir con los requisitos de auditabilidad de la NTEC y poder responder ante una revision regulatoria.

**Story Points:** 3 | **MoSCoW:** Must | **Sprint sugerido:** 2

**Criterios de aceptacion (Gherkin):**

```gherkin
Feature: Historial de publicaciones auditable

  Scenario: Ver historial de publicaciones
    Given accedo a los detalles de un workflow como Director
    When hago clic en "Historial de publicaciones"
    Then veo una tabla con columnas:
      | Columna         | Descripcion                           |
      | Version         | Numero de version                     |
      | Accion          | PUBLICADO / HISTORICO / ROLLBACK / BORRADOR_GUARDADO |
      | Usuario         | Nombre completo del responsable       |
      | Timestamp       | Fecha y hora exacta (con segundos)    |
      | Motivo          | Texto ingresado por el usuario        |

  Scenario: Historial no es editable ni eliminable
    Given estoy viendo el historial de publicaciones
    Then no hay opciones de edicion, eliminacion ni modificacion de ningun registro
    And cualquier intento de DELETE via API devuelve 403

  Scenario: Filtrar historial por rango de fechas
    Given el historial tiene 50 entradas en el ultimo ano
    When filtro por rango "01/01/2026 - 28/02/2026"
    Then solo aparecen las entradas en ese rango
    And el contador muestra "X eventos en el periodo"

  Scenario: Exportar historial como CSV
    Given estoy viendo el historial de publicaciones
    When hago clic en "Exportar CSV"
    Then se descarga un archivo CSV con todas las columnas del historial
    And el nombre del archivo incluye el nombre del workflow y la fecha de exportacion
```

**Dependencias:** US.F2.2.06, US.F2.2.19.
**Notas tecnicas:** El historial se lee de `documento_instancia_historial` o de la tabla especifica del motor de versiones de workflows (definida en E.F2.1). Es de solo lectura: el tRPC query usa `protectedProcedure` con verificacion de rol DIR. El trigger de inmutabilidad de la NTEC aplica a esta tabla.
**Trazabilidad:** `analisis §5` restriccion "Bitácora de accesos Art. 55-56 NTEC"; `analisis §2.2` columna "Aprobaciones/Firmas"; requerimiento funcional #7 (audit trail).
**Trazabilidad GS1:** N/A.

---

## 6. Decisiones Pendientes

| ID | Decision | Opciones | Responsable | Fecha limite |
|---|---|---|---|---|
| DP-01 | Libreria de grafos: React Flow v12 vs Xyflow vs alternativa | React Flow (MIT, 6k stars, API documentada); evaluar performance con > 100 nodos | @AS/@AT | Sprint 1 |
| DP-02 | Layout engine: dagre vs elk | dagre mas liviano; elk mas preciso para flujos complejos; puede ofrecerse como opcion al usuario | @Dev | Sprint 1 |
| DP-03 | Alcance de ciclos: ciclos prohibidos absolutamente vs ciclos permitidos con flag | Los flujos clinicos de NTEC tipicamente no tienen retrocesos; definir si "retorno al paso anterior" es valido | @PO/@AE | Sprint 2 |
| DP-04 | Impacto rollback sobre documento_instancia activo | Si hay instancias activas apuntando a una version que se va a historificar, blockkear el rollback o migrar las instancias | @DBA/@AS | Sprint 3 |
| DP-05 | Renderizado PDF server-side vs client-side | Client-side (jsPDF): mas simple, sin infra adicional; server-side (Puppeteer): mas fiel al renderizado CSS | @Dev | Sprint 3 |
| DP-06 | Modo offline/contingencia del designer | El editor debe funcionar offline? La NTEC Art. 6 pide plan de contingencia para captura en papel; el designer es herramienta de configuracion, no de captura | @AE | Sprint 2 |

---

## 7. Dependencias Tecnicas Criticas

| Dependencia | Tipo | Impacto si falta | Dueño |
|---|---|---|---|
| Motor backend E.F2.1 (Stream 3): tablas `tipo_documento`, `flujo_estado`, `flujo_transicion`, `documento_rol` | Bloqueante | US.F2.2.06, .13, .18, .19, .20 no pueden integrarse | @DBA/@AS |
| Rol `WORKFLOW_DESIGNER` en tabla ROL y enum Prisma | Bloqueante | US.F2.2.14 y todo el RBAC | @DBA |
| Tabla `workflow_draft` para borradores (jsonb snapshot) | Bloqueante | US.F2.2.06 (guardar borrador) | @DBA |
| Tabla `workflow_template` para plantillas del sistema | Should | US.F2.2.09 | @DBA |
| Tabla `workflow_modulo` para vinculaciones | Should | US.F2.2.13 | @DBA |
| Libreria React Flow (o equivalente) aprobada por @AS | Bloqueante | Toda la epicica US.F2.2.01+ | @AS/@Dev |
| Componentes Shadcn del design system (@UIUX) | Bloqueante | Panel lateral, bottom sheet, tooltips | @UIUX |

---

## 8. Riesgos

| ID | Riesgo | Probabilidad | Impacto | Mitigacion |
|---|---|---|---|---|
| R-01 | Performance del lienzo con flujos de > 80 nodos (ej. flujo hospitalario complejo) | Media | Alto | Limitar a 100 nodos max por flujo v1; virtualizar con React Flow; test de carga con 100 nodos en Sprint 2 |
| R-02 | Complejidad de accesibilidad WCAG en el lienzo SVG/canvas (React Flow usa SVG) | Alta | Medio | Iniciar con US.F2.2.17 en Sprint 2; identificar gaps temprano; no acumular deuda de a11y |
| R-03 | Dependencia critica en motor backend (Stream 3) — retraso bloquea 6+ US | Media | Alto | Mockear tRPC calls para US.F2.2.01-.05 en Sprint 1; integracion real en Sprint 2 |
| R-04 | Usuarios con rol DIR editan plantillas del sistema sin entender impacto | Baja | Alto | Agregar confirmacion de doble paso + mensaje de impacto al editar plantilla de sistema |
| R-05 | Exportacion PDF con diagramas grandes produce archivos > 10 MB | Media | Bajo | Compresion de imagen en PNG antes de incrustar en PDF; limitar a 50 nodos en exportacion |

---

## 9. Estimacion y Capacidad

| Sprint | US incluidas | SP | Notas |
|---|---|---|---|
| Sprint 1 | US.F2.2.01, .02, .03, .04, .14, .15 | 29 | Infraestructura base del editor + RBAC |
| Sprint 2 | US.F2.2.05, .06, .09, .10, .12, .17, .18, .20 | 39 | Validacion, publicacion y features de soporte |
| Sprint 3 | US.F2.2.07, .08, .11, .13 | 24 | Features avanzados: diff, simulacion, exportacion, vinculacion |
| Sprint 4 | US.F2.2.16, .19 | 8 | Mobile + rollback |
| **Total** | **20 US** | **100 SP*** | *Diferencia de 3 SP por redondeo de sesion de planning |

> Velocidad estimada del equipo @Dev: 25-35 SP/sprint. La epicica cubre ~3.5 sprints a velocidad minima.

---

## 10. KPIs de Producto

| KPI | Metrica | Linea base | Meta 30 dias post-deploy |
|---|---|---|---|
| Tiempo para configurar un flujo nuevo | minutos desde apertura hasta publicacion | No disponible (proceso manual SQL) | < 90 minutos para flujo de 10 nodos |
| Tasa de error en publicacion | publicaciones rechazadas por validacion / total intentos | No disponible | < 5% (errores detectados en vivo antes de llegar al boton) |
| Cobertura de flujos migrados | workflows clinicos activos modelados en el designer / total workflows institucionales identificados | 0% | 6 flujos plantilla base publicados |
| Adopcion de plantillas | nuevos flujos creados desde plantilla / total flujos nuevos | 0% | > 60% |
| Hallazgos axe-core criticos/serios | count | No medido | 0 |
| Tiempo de carga del editor | LCP en produccion | No medido | < 2 segundos en P95 |

---

## 11. Trazabilidad Epica → Objetivo de Negocio

```
Objetivo estrategico: Cumplimiento NTEC + eficiencia operativa en configuracion de flujos
  └─> Epica E.F2.2: Workflow Designer Visual
        ├─> Must (Core): US.F2.2.01, .02, .03, .04, .05, .06, .14, .15, .17, .18, .20
        ├─> Should (Value-add): US.F2.2.07, .08, .09, .10, .11, .12, .13, .19
        └─> Could (Deseables): US.F2.2.16
```

**Normativa cubierta por esta epica:**
- Art. 55-56 NTEC (bitacora de accesos) → US.F2.2.20
- Art. 42 NTEC (inmutabilidad + rectificacion trazable) → US.F2.2.06, .07, .19, .20
- Art. 21 NTEC (certificacion restringida / RBAC) → US.F2.2.14
- Art. 33, 45, 52 NTEC (confidencialidad y control de acceso) → US.F2.2.14, .15
- WCAG 2.1 AA → US.F2.2.17

---

*Documento producido por @PO para el backlog de Fase 2 — HIS Multipaís Inversiones Avante.*
*Version 1.0 | 2026-05-16 | Para revision en Sprint Planning Sprint 1.*
