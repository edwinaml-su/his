# Épica E.F2.1 — Motor de Workflow Configurable

> Propietario: @PO | Wave Fase 2 | Sprint TBD por @Orq
> Trazabilidad normativa: Norma técnica del expediente clínico, Acuerdo n.° 1616 MINSAL 2024; Ley SNIS Arts. 24-26.

---

## 1. Visión de producto

Los establecimientos del SNIS El Salvador manejan 18 tipos de documento clínico (Fase 3, analisis_workflows_ece.md), cada uno con estados de firma distintos, roles autorizadores distintos y dependencias entre documentos que varían según modalidad (ambulatoria u hospitalaria). Hoy ese conocimiento vive en papel o en lógica de negocio duplicada por sistema, lo que hace que cada cambio normativo exija una modificación de código.

El Motor de Workflow Configurable resuelve esto almacenando los flujos como datos: tablas `ece.tipo_documento`, `ece.flujo_estado`, `ece.flujo_transicion` y `ece.documento_rol` definen qué estados tiene cada documento, quién puede avanzarlo y qué roles son obligatorios. Cambiar un flujo equivale a un INSERT/UPDATE de datos, no a una migración de esquema ni a un despliegue de código.

El valor central para el negocio es triple. Primero, cumplimiento normativo verificable: el motor modela exactamente la firma electrónica simple (Art. 23 NTEC), la certificación restringida a Dirección (Art. 21 NTEC) y la inmutabilidad de documentos históricos (Art. 42 NTEC), con trazabilidad en `ece.documento_instancia_historial`. Segundo, agilidad operativa: cuando MINSAL emita una reforma a la norma (como ocurrió en marzo 2026), el equipo de archivo del establecimiento puede ajustar el flujo sin intervención del equipo de desarrollo. Tercero, auditoría regulatoria: cada transición queda registrada con marca temporal a nivel de segundo (clock_timestamp()), el rol que la ejecutó, la firma electrónica vinculada y la acción realizada.

El éxito se mide por la adopción de la capa de workflow por el 100% de los documentos del ECE en los establecimientos piloto antes del cierre de Fase 2, y por cero hallazgos de incumplimiento Art. 42/55 NTEC en la primera auditoría externa.

Los KPIs de producto complementarios son: tiempo promedio de ciclo borrador-firmado-validado por tipo de documento, porcentaje de transiciones rechazadas por rol incorrecto, y latencia p95 de la mutación `workflow.instance.advance` inferior a 400 ms bajo carga de 50 usuarios concurrentes por establecimiento.

---

## 2. Definition of Ready (DoR)

- `05_motor_workflow.sql` y `08_seed_workflows.sql` aplicados y verificados en el proyecto Supabase (schema `ece` activo con las 6 tablas del motor).
- Los catálogos de roles (`ece.rol`) y establecimientos (`ece.establecimiento`) sembrados y disponibles para referencia en FK.
- Blueprint de API tRPC documentado en `docs/02_arquitectura_software.md` con procedimientos `tenantProcedure` y `requireRole` como base para los routers de workflow.
- Diseño de la capa `withTenantContext` en `packages/trpc/src/rls-context.ts` validado para operar sobre el schema `ece` (RLS habilitado).
- Criterios de aceptación de esta épica revisados y aceptados por @QAF antes del primer sprint de Fase 2.
- Maquetas de las pantallas de configuración de workflow aprobadas por @UIUX (Stream 4 puede iniciar en paralelo; la API debe estabilizarse primero).
- Definición de la invariante de grafo: un tipo de documento no puede tener dependencias circulares — validación documentada y acordada con @DBA.

---

## 3. Definition of Done (DoD)

- Cada router tRPC del motor (`workflow.tipoDoc.*`, `workflow.estado.*`, `workflow.transicion.*`, `workflow.role.*`, `workflow.instance.*`) corre bajo `tenantProcedure` con `withTenantContext` activo — RLS por `establecimiento_id` aplicado.
- Cobertura de tests unitarios y de integración >= 80% por módulo (threshold global del proyecto).
- Escenarios Gherkin de @QAF automatizados en Playwright con resultado verde en CI antes del merge.
- Mutación `workflow.instance.advance` valida: (a) que la transición exista en `flujo_transicion` para el estado actual, (b) que el rol del usuario sea el `rol_autoriza_id` configurado, (c) que se provea firma si `requiere_firma = true`. Cualquier violación retorna error estructurado (código + mensaje es-SV).
- Invariante de integridad: no se puede desactivar un estado con instancias activas; no se puede borrar un tipo de documento con instancias no-anuladas. Validado por test de integración.
- Importación/exportación de definición de workflow produce bundle JSON/SQL idempotente: aplicar dos veces no duplica filas.
- Versionado de workflow: snapshot antes de cualquier modificación a `flujo_estado` o `flujo_transicion`; rollback probado a nivel de test.
- Entry en matriz de trazabilidad `docs/backlog/fase2/` con referencia a cada US, sprint, PR y resultado de CI.
- Typecheck y lint limpios (`npm run typecheck && npm run lint` sin errores).
- Revisión de seguridad @QA: confirmado que ningún router devuelve datos de otro establecimiento (prueba de tenant isolation).

---

## 4. User stories

---

### US.F2.1.1 — Consultar catálogo de tipos de documento del ECE

**Como** profesional de archivo (ARCH) **quiero** consultar la lista de tipos de documento configurados para mi establecimiento **para** saber qué documentos del ECE están activos y sus dependencias antes de abrir un episodio.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Consultar catálogo de tipos de documento del ECE
  Antecedentes:
    Dado que el usuario autenticado tiene rol ARCH en el establecimiento "HNSF-01"
    Y existen 18 tipos de documento sembrados para ese establecimiento

  Escenario: Listar todos los tipos de documento activos
    Cuando el usuario llama a workflow.tipoDoc.list con filtro activo=true
    Entonces recibe una lista de 18 registros con campos codigo, nombre, modalidad, tipo_registro, depende_de
    Y todos los registros tienen activo=true

  Escenario: Filtrar por modalidad ambulatoria
    Cuando el usuario llama a workflow.tipoDoc.list con filtro modalidad="ambulatorio"
    Entonces recibe solo los tipos de documento con modalidad="ambulatorio" o modalidad="ambos"
    Y el resultado incluye TRIAJE, ATN_EMERG, HIST_CLIN, SIG_VIT

  Escenario: Usuario de otro establecimiento no accede a la lista
    Dado que el token JWT pertenece al establecimiento "ISSS-02"
    Cuando llama a workflow.tipoDoc.list
    Entonces recibe solo los tipos configurados para "ISSS-02"
    Y no aparecen registros del establecimiento "HNSF-01"

  Escenario: Error — usuario sin rol autorizado
    Dado que el usuario tiene rol ENF (no autorizado para gestión de catálogos)
    Cuando llama a workflow.tipoDoc.list con includeInactive=true
    Entonces recibe error con código "FORBIDDEN" y mensaje "Rol insuficiente para ver tipos inactivos"
```

- **Story points:** 3
- **Prioridad MoSCoW:** Must
- **Dependencias:** Schema `ece.tipo_documento` aplicado; `tenantProcedure` disponible.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §Fase 3 sección 4; `_insumos/05_motor_workflow.sql` líneas 12-24
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Query sin RLS bypass — usar `withTenantContext`. Filtro `activo` y `modalidad` como parámetros opcionales Zod.

---

### US.F2.1.2 — Crear tipo de documento en el motor de workflow

**Como** administrador de sistema (DIR o delegado) **quiero** registrar un nuevo tipo de documento en el catálogo del ECE **para** incorporar formularios adicionales que exija la norma o el protocolo interno sin modificar código.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Crear tipo de documento en el motor de workflow
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"

  Escenario: Creación exitosa de tipo de documento
    Cuando llama a workflow.tipoDoc.create con:
      | campo         | valor                          |
      | codigo        | "NOTA_PROC"                    |
      | nombre        | "Nota de Procedimiento"        |
      | tabla_datos   | "nota_procedimiento"           |
      | tipo_registro | "transaccional"                |
      | modalidad     | "ambos"                        |
      | depende_de    | ["HIST_CLIN"]                  |
      | inmutable     | false                          |
    Entonces el sistema inserta el registro en ece.tipo_documento
    Y retorna el UUID asignado y el timestamp de creación
    Y el nuevo tipo aparece en workflow.tipoDoc.list

  Escenario: Error — codigo duplicado
    Dado que ya existe un tipo con codigo="HIST_CLIN"
    Cuando intenta crear otro tipo con el mismo codigo
    Entonces recibe error con código "CONFLICT" y mensaje "El código HIST_CLIN ya está registrado"
    Y no se inserta ningún registro

  Escenario: Error — dependencia inexistente
    Cuando intenta crear un tipo con depende_de=["TIPO_INEXISTENTE"]
    Entonces recibe error con código "UNPROCESSABLE_ENTITY" y mensaje "El tipo de documento dependiente no existe: TIPO_INEXISTENTE"

  Escenario: Error — tipo_registro inválido
    Cuando envía tipo_registro="operativo"
    Entonces recibe error de validación Zod antes de llegar al servidor
    Y el mensaje indica los valores permitidos: maestro, transaccional, historico
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.1; schema `ece.tipo_documento` con constraint unique en `codigo`.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 12-24; `analisis_workflows_ece.md` §Fase 3 sección 4
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Validar en Zod el enum `tipo_registro` y `modalidad`. La validación de `depende_de` requiere un check de existencia previo al INSERT dentro de `withTenantContext`.

---

### US.F2.1.3 — Actualizar y desactivar tipo de documento

**Como** administrador de sistema (DIR) **quiero** modificar los metadatos de un tipo de documento existente o desactivarlo **para** mantener el catálogo alineado a reformas normativas sin perder el historial de instancias previas.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Actualizar y desactivar tipo de documento
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"

  Escenario: Actualizar nombre y modalidad
    Dado que existe el tipo de documento con codigo="TRIAJE" sin instancias activas
    Cuando llama a workflow.tipoDoc.update con nombre="Hoja de Triaje Manchester"
    Entonces el sistema actualiza el registro
    Y el campo nombre refleja el nuevo valor en workflow.tipoDoc.list

  Escenario: Desactivar tipo de documento sin instancias activas
    Dado que "CERT_INC" no tiene instancias en estado distinto a "anulado"
    Cuando llama a workflow.tipoDoc.update con activo=false
    Entonces el sistema marca activo=false
    Y el tipo ya no aparece en workflow.tipoDoc.list con filtro activo=true

  Escenario: Error — desactivar tipo con instancias vigentes
    Dado que "HIST_CLIN" tiene 47 instancias con estado_registro="vigente"
    Cuando intenta desactivar ese tipo
    Entonces recibe error con código "CONFLICT"
    Y el mensaje indica "No se puede desactivar HIST_CLIN: existen 47 instancias vigentes"
    Y el registro permanece activo=true

  Escenario: Error — modificar campo inmutable
    Cuando intenta cambiar tabla_datos de un tipo con instancias existentes
    Entonces recibe error con código "FORBIDDEN" y mensaje "El campo tabla_datos no es modificable con instancias existentes"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.2.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 12-24; `analisis_workflows_ece.md` §5 (restricciones transversales)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El check de instancias vigentes es un COUNT sobre `documento_instancia` dentro del mismo `withTenantContext`. `tabla_datos` es de facto inmutable si hay instancias — enforced en capa de aplicación, no a nivel BD.

---

### US.F2.1.4 — Gestionar estados del flujo por tipo de documento

**Como** administrador de sistema (DIR) **quiero** crear, consultar y reordenar los estados de un tipo de documento **para** modelar el ciclo de vida exacto que requiere cada formulario del ECE.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Gestionar estados del flujo por tipo de documento
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"
    Y existe el tipo de documento "NOTA_PROC" creado en US.F2.1.2

  Escenario: Crear estado inicial borrador
    Cuando llama a workflow.estado.create con:
      | tipo_documento_codigo | "NOTA_PROC" |
      | codigo                | "borrador"  |
      | nombre                | "Borrador"  |
      | es_inicial            | true        |
      | es_final              | false       |
      | orden                 | 1           |
    Entonces el estado se inserta en ece.flujo_estado
    Y es el único estado marcado como es_inicial=true para ese tipo

  Escenario: Error — dos estados iniciales
    Dado que "NOTA_PROC" ya tiene el estado "borrador" con es_inicial=true
    Cuando intenta crear otro estado con es_inicial=true
    Entonces recibe error "CONFLICT" con mensaje "Solo puede existir un estado inicial por tipo de documento"

  Escenario: Listar estados con su orden
    Cuando llama a workflow.estado.list con tipo_documento_codigo="HIST_CLIN"
    Entonces recibe los estados ordenados por campo orden ascendente: borrador(1), firmado(2), validado(3), anulado(9)
    Y se indica cuáles son iniciales y cuáles finales

  Escenario: Error — eliminar estado con instancias activas
    Dado que el estado "firmado" de "HIST_CLIN" tiene instancias en ese estado
    Cuando intenta eliminar ese estado via workflow.estado.delete
    Entonces recibe error "CONFLICT" y mensaje "Estado en uso por N instancias activas"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.2; unique constraint `(tipo_documento_id, codigo)` en `ece.flujo_estado`.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 31-39; `_insumos/08_seed_workflows.sql` líneas 38-56
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** La invariante de un solo estado inicial requiere validación en capa de aplicación y/o unique partial index en BD. Coordinar con @DBA.

---

### US.F2.1.5 — Gestionar transiciones permitidas entre estados

**Como** administrador de sistema (DIR) **quiero** definir qué acciones permiten mover un documento de un estado a otro, quién las autoriza y si requieren firma **para** controlar exactamente los permisos de avance de cada formulario según la norma.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Gestionar transiciones permitidas entre estados
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"
    Y existen los estados borrador y firmado para el tipo "NOTA_PROC"

  Escenario: Crear transición de firma obligatoria
    Cuando llama a workflow.transicion.create con:
      | tipo_documento_codigo | "NOTA_PROC" |
      | estado_origen_codigo  | "borrador"  |
      | estado_destino_codigo | "firmado"   |
      | accion                | "firmar"    |
      | rol_autoriza_codigo   | "MC"        |
      | requiere_firma        | true        |
    Entonces la transición se inserta en ece.flujo_transicion
    Y aparece en workflow.transicion.list para ese tipo de documento

  Escenario: Error — transición duplicada
    Dado que ya existe la transición (NOTA_PROC, borrador, firmar)
    Cuando intenta crear otra transición con el mismo (tipo_documento, estado_origen, accion)
    Entonces recibe error "CONFLICT" con el mensaje "Ya existe una transición para esta acción desde el estado borrador"

  Escenario: Listar transiciones posibles desde un estado
    Cuando llama a workflow.transicion.list con tipo="HIST_CLIN" y estado_origen="borrador"
    Entonces recibe la acción "firmar" con rol_autoriza "MC" y requiere_firma=true

  Escenario: Error — rol autorizador inexistente
    Cuando envía rol_autoriza_codigo="ROL_FANTASMA"
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "El rol ROL_FANTASMA no existe en el catálogo"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.4.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 45-54; `_insumos/08_seed_workflows.sql` líneas 80-135
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Unique constraint `(tipo_documento_id, estado_origen_id, accion)` ya existe en el DDL. El router delega la FK de rol a la BD para el error de integridad.

---

### US.F2.1.6 — Gestionar matriz de roles funcionales por documento

**Como** administrador de sistema (DIR) **quiero** configurar qué roles tienen las funciones LLENA, RESPONSABLE, AUTORIZA y FIRMA para cada tipo de documento **para** cumplir exactamente la matriz de aprobaciones que exige el Art. 23 de la NTEC.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Gestionar matriz de roles funcionales por documento
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"

  Escenario: Asignar función LLENA a un rol
    Cuando llama a workflow.role.assign con:
      | tipo_documento_codigo | "NOTA_PROC" |
      | rol_codigo            | "MC"        |
      | funcion               | "LLENA"     |
      | obligatorio           | true        |
    Entonces el registro se inserta en ece.documento_rol
    Y aparece en workflow.role.listByDoc para ese tipo

  Escenario: Consultar matriz completa para Historia Clínica
    Cuando llama a workflow.role.listByDoc con tipo_documento_codigo="HIST_CLIN"
    Entonces recibe las funciones: MC-LLENA(obligatorio), MT-LLENA(opcional), MC-RESPONSABLE(obligatorio), MC-FIRMA(obligatorio), MC-AUTORIZA(obligatorio)

  Escenario: Error — función fuera del conjunto permitido
    Cuando envía funcion="EDITA"
    Entonces recibe error de validación Zod con mensaje "funcion debe ser uno de: LLENA, RESPONSABLE, AUTORIZA, FIRMA"

  Escenario: Error — rol-función duplicado
    Dado que ya existe la asignación MC-LLENA para "NOTA_PROC"
    Cuando intenta crear el mismo rol-función-documento
    Entonces recibe error "CONFLICT" con el mensaje "El rol MC ya tiene la función LLENA en este documento"

  Escenario: Revocar función de rol
    Cuando llama a workflow.role.revoke con tipo="NOTA_PROC", rol="MT", funcion="LLENA"
    Entonces el registro se elimina si no hay instancias activas
    Y el rol ya no aparece con esa función en workflow.role.listByDoc
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.5.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 62-69; `_insumos/08_seed_workflows.sql` líneas 140-202
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Unique `(tipo_documento_id, rol_id, funcion)` en BD. Coordinar enum de `funcion` en Zod con el check constraint de la BD.

---

### US.F2.1.7 — Crear instancia de documento clínico

**Como** profesional de salud autorizado (MC, MT, ENF, ARCH según tipo) **quiero** abrir un nuevo documento clínico para un episodio de atención **para** registrar el acto asistencial que me corresponde y que quede trazado al expediente del paciente.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Crear instancia de documento clínico
  Antecedentes:
    Dado que el usuario autenticado tiene rol MC en el establecimiento "HNSF-01"
    Y existe el episodio "EP-2026-001" para el paciente "P-0001" en ese establecimiento

  Escenario: Crear Historia Clínica para episodio sin dependencias pendientes
    Dado que "EP-2026-001" tiene la Ficha de Identificación en estado "validado"
    Cuando llama a workflow.instance.create con:
      | tipo_documento_codigo | "HIST_CLIN"    |
      | episodio_id           | "EP-2026-001"  |
      | paciente_id           | "P-0001"       |
    Entonces el sistema inserta un registro en ece.documento_instancia con estado_actual "borrador"
    Y inserta la primera fila en ece.documento_instancia_historial con accion="crear"
    Y retorna el UUID de la instancia creada

  Escenario: Error — dependencia no satisfecha
    Dado que "EP-2026-001" no tiene Ficha de Identificación en estado "validado"
    Cuando intenta crear una Historia Clínica
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "Dependencia no satisfecha: FICHA_ID debe estar en estado validado"

  Escenario: Error — rol sin función LLENA para ese documento
    Dado que el usuario tiene rol ARCH
    Cuando intenta crear una Historia Clínica
    Entonces recibe error "FORBIDDEN" con mensaje "El rol ARCH no tiene la función LLENA para HIST_CLIN"

  Escenario: Aislamiento de tenant
    Dado que el episodio "EP-2026-001" pertenece al establecimiento "ISSS-02"
    Cuando un usuario del establecimiento "HNSF-01" intenta crear la instancia
    Entonces recibe error "NOT_FOUND" (RLS filtra la fila del episodio)
```

- **Story points:** 8
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.6; tablas `ece.episodio_atencion` y `ece.paciente` disponibles.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 76-95; `analisis_workflows_ece.md` §4 (grafo de dependencias)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** La validación de dependencias requiere consultar `tipo_documento.depende_de[]` y verificar que para el episodio exista una instancia de cada tipo padre en estado final o "validado". Lógica dentro de `withTenantContext`.

---

### US.F2.1.8 — Avanzar instancia de documento mediante acción de transición

**Como** profesional de salud autorizado según la configuración del flujo **quiero** ejecutar una acción (firmar, validar, certificar, anular) sobre un documento clínico **para** moverlo al siguiente estado del workflow y registrar mi firma electrónica simple cuando la transición lo exija.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Avanzar instancia de documento mediante acción de transición
  Antecedentes:
    Dado que existe la instancia "DOC-001" de tipo "HIST_CLIN" en estado "borrador"
    Y el usuario autenticado tiene rol MC en el mismo establecimiento del episodio

  Escenario: Firmar Historia Clínica con firma electrónica simple
    Dado que la transición (HIST_CLIN, borrador, firmar) tiene rol_autoriza=MC y requiere_firma=true
    Cuando llama a workflow.instance.advance con:
      | instanceId | "DOC-001"   |
      | accion     | "firmar"    |
      | firma_id   | "FE-MC-001" |
    Entonces el sistema cambia estado_actual_id al estado "firmado"
    Y inserta en ece.documento_instancia_historial con firma_id="FE-MC-001", ejecutado_en a nivel segundo
    Y retorna el nuevo estado y el timestamp registrado

  Escenario: Error — acción no permitida desde el estado actual
    Dado que "DOC-001" está en estado "borrador"
    Cuando intenta ejecutar la acción "certificar"
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "La acción certificar no está permitida desde el estado borrador para HIST_CLIN"

  Escenario: Error — rol incorrecto para la transición
    Dado que el usuario tiene rol ENF
    Cuando intenta firmar "DOC-001" (HIST_CLIN requiere rol MC para firmar)
    Entonces recibe error "FORBIDDEN" con mensaje "El rol ENF no está autorizado para ejecutar la acción firmar en HIST_CLIN"

  Escenario: Error — firma requerida pero no proporcionada
    Dado que requiere_firma=true para la transición firmar/HIST_CLIN
    Cuando llama a advance sin el campo firma_id
    Entonces recibe error de validación con mensaje "La acción firmar requiere firma_id para HIST_CLIN"

  Escenario: Error — documento en estado final
    Dado que "DOC-001" está en estado "validado" (es_final=true)
    Cuando intenta ejecutar cualquier acción
    Entonces recibe error "CONFLICT" con mensaje "El documento está en estado final y no admite más transiciones"
```

- **Story points:** 13
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.7; tabla `ece.firma_electronica` disponible; US.F2.1.5.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 101-117; `analisis_workflows_ece.md` §5 (firma electrónica simple Art. 23 NTEC)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Esta es la mutación core del motor. Toda la lógica debe ejecutarse en una sola transacción DB: (1) lookup transición, (2) verificar rol, (3) verificar firma, (4) UPDATE estado, (5) INSERT historial. Si cualquier paso falla, rollback completo. Usar `withTenantContext` con la tx misma.

---

### US.F2.1.9 — Consultar instancias de documento de un episodio

**Como** profesional de salud de cualquier rol **quiero** ver todos los documentos clínicos de un episodio de atención con su estado actual **para** conocer el avance del expediente y detectar documentos pendientes de firma.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Consultar instancias de documento de un episodio
  Antecedentes:
    Dado que el usuario autenticado tiene acceso al episodio "EP-2026-001"
    Y el episodio tiene 5 documentos en distintos estados

  Escenario: Listar documentos del episodio con su estado
    Cuando llama a workflow.instance.listByEpisode con episodio_id="EP-2026-001"
    Entonces recibe una lista con tipo_documento.nombre, estado_actual.nombre, creado_por.nombre, creado_en
    Y los documentos en estado "borrador" aparecen marcados como pendientes

  Escenario: Filtrar documentos pendientes de acción propia
    Cuando llama con filtro pendiente_mi_rol=true
    Entonces recibe solo los documentos donde la siguiente transición requiere su rol
    Y se incluye la acción disponible para cada uno

  Escenario: Aislamiento de tenant
    Dado que "EP-2026-002" pertenece a otro establecimiento
    Cuando intenta listar instancias de ese episodio
    Entonces recibe lista vacía (RLS filtra)

  Escenario: Episodio sin documentos
    Dado que "EP-2026-003" es nuevo y no tiene instancias
    Cuando llama a listByEpisode
    Entonces recibe lista vacía y código HTTP 200
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.7.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 93-95 (índices); `analisis_workflows_ece.md` §Fase 2
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Query con JOIN a `flujo_estado` y `personal_salud`. Índice `idx_docinst_episodio` disponible. Filtro `pendiente_mi_rol` requiere sub-query sobre `flujo_transicion` — evaluar si se procesa en SQL o en capa de aplicación.

---

### US.F2.1.10 — Consultar bitácora de transiciones de una instancia

**Como** profesional de archivo (ARCH) o auditor (DIR) **quiero** ver el historial completo de transiciones de un documento clínico **para** verificar el cumplimiento del Art. 55 NTEC (trazabilidad con marca temporal a nivel de segundo).

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Consultar bitácora de transiciones de una instancia
  Antecedentes:
    Dado que el usuario autenticado tiene rol ARCH o DIR
    Y la instancia "DOC-001" ha pasado por borrador -> firmado -> validado

  Escenario: Consultar historial completo
    Cuando llama a workflow.instance.history con instanceId="DOC-001"
    Entonces recibe 3 registros en orden cronológico ascendente
    Y cada registro contiene: accion, estado_anterior, estado_nuevo, ejecutado_por, rol_ejecutor, firma_id, ejecutado_en
    Y el campo ejecutado_en muestra precisión a nivel de segundo

  Escenario: Verificar firma en transición que lo requería
    Dado que la transición "firmar" requería firma
    Entonces el registro correspondiente tiene firma_id no nulo
    Y se puede resolver el hash de firma desde ece.firma_electronica

  Escenario: Error — usuario sin acceso al historial
    Dado que el usuario tiene rol ENF y el historial es del documento "EPICRISIS"
    Cuando intenta acceder al historial
    Entonces recibe error "FORBIDDEN" según el perfil de acceso configurado

  Escenario: Historial de instancia en otro establecimiento
    Dado que "DOC-999" pertenece al establecimiento "ISSS-02"
    Cuando un usuario de "HNSF-01" consulta su historial
    Entonces recibe error "NOT_FOUND" (RLS activo)
```

- **Story points:** 3
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.8.
- **Trazabilidad fuente:** `_insumos/05_motor_workflow.sql` líneas 101-117; `analisis_workflows_ece.md` §5 Art. 55-56 NTEC
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** La tabla `documento_instancia_historial` es append-only (solo INSERT). El router es de lectura pura — no mutaciones. Ordenar por `ejecutado_en ASC`.

---

### US.F2.1.11 — Anulación de instancia de documento por Dirección

**Como** director del establecimiento (DIR) **quiero** anular un documento clínico en cualquier estado (excepto estados finales no anulables) **para** corregir errores graves cumpliendo el Art. 42 NTEC sin borrado físico.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Anulación de instancia de documento por Dirección
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"

  Escenario: Anular documento en borrador con observación
    Dado que la instancia "DOC-002" de tipo "IND_MED" está en estado "borrador"
    Cuando llama a workflow.instance.advance con accion="anular" y observacion="Documento creado por error de episodio"
    Entonces el estado_actual cambia a "anulado"
    Y el estado_registro de ece.documento_instancia cambia a "suprimido"
    Y el historial registra la observación y la firma DIR
    Y el documento sigue existiendo en BD (no borrado físico)

  Escenario: Error — intentar anular documento inmutable ya validado
    Dado que "DOC-003" es de tipo "EPICRISIS" con inmutable=true y estado "certificado"
    Cuando DIR intenta anularlo
    Entonces recibe error "FORBIDDEN" con mensaje "Los documentos certificados de tipo EPICRISIS no pueden anularse — use el proceso de rectificación"

  Escenario: Error — anulación por rol no DIR
    Dado que el usuario tiene rol MC
    Cuando intenta ejecutar la acción "anular"
    Entonces recibe error "FORBIDDEN" con mensaje "Solo el rol DIR puede anular documentos"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.8; transición universal de anulación sembrada en `08_seed_workflows.sql` líneas 128-134.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 (inmutabilidad Art. 42 NTEC); `_insumos/08_seed_workflows.sql` líneas 128-134
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El campo `estado_registro` en `documento_instancia` pasa a "suprimido". La lógica de inmutabilidad para documentos con `inmutable=true` y en estado final "certificado" debe bloquearse en la mutación advance antes de consultar la transición.

---

### US.F2.1.12 — Validar invariante: no romper grafo de dependencias

**Como** sistema **quiero** rechazar operaciones que dejen tipos de documento sin sus dependencias resueltas **para** garantizar que el grafo de dependencias del ECE permanezca íntegro en todo momento.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Validar invariante de grafo de dependencias
  Antecedentes:
    Dado que el motor de workflow está inicializado con los 18 tipos de documento sembrados

  Escenario: Detectar dependencia circular al crear tipo
    Cuando DIR intenta crear un tipo "DOC_A" con depende_de=["DOC_A"] (auto-referencia)
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "Dependencia circular detectada: DOC_A -> DOC_A"

  Escenario: Detectar ciclo indirecto
    Dado que existe DOC_B con depende_de=["DOC_C"] y DOC_C con depende_de=[]
    Cuando intenta actualizar DOC_C para que depende_de=["DOC_B"]
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "Dependencia circular detectada: DOC_C -> DOC_B -> DOC_C"

  Escenario: Operación válida sin ciclo
    Cuando crea DOC_D con depende_de=["HIST_CLIN"] donde HIST_CLIN no depende de DOC_D
    Entonces el registro se inserta sin error

  Escenario: Bloquear desactivación de tipo del que dependen otros tipos activos
    Dado que "HIST_CLIN" es dependencia de "IND_MED", "EVOL_MED", "RRI" (activos)
    Cuando intenta desactivar "HIST_CLIN"
    Entonces recibe error "CONFLICT" con mensaje "HIST_CLIN es dependencia de 3 tipos activos: IND_MED, EVOL_MED, RRI"
```

- **Story points:** 8
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.3.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §4 (grafo de dependencias); `_insumos/05_motor_workflow.sql` líneas 17-20
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Implementar detección de ciclo con DFS sobre el array `depende_de`. La complejidad es O(V+E) sobre el grafo de tipos — viable dado que el número de tipos es pequeño (< 50). Lógica en capa de aplicación (TypeScript), no en BD.

---

### US.F2.1.13 — Exportar definición de workflow como bundle JSON

**Como** administrador de sistema (DIR) **quiero** exportar la configuración completa de workflows de mi establecimiento (tipos de documento, estados, transiciones y roles funcionales) como un archivo JSON **para** respaldarlo, auditarlo o importarlo en otro establecimiento.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Exportar definición de workflow como bundle JSON
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"
    Y el establecimiento tiene los 18 tipos sembrados con sus estados y transiciones

  Escenario: Exportar bundle completo
    Cuando llama a workflow.export con establecimiento_id="HNSF-01"
    Entonces recibe un objeto JSON con estructura:
      {
        "version": "1.0",
        "establecimiento": "HNSF-01",
        "exportado_en": "<timestamp ISO>",
        "tipos_documento": [...],
        "estados": [...],
        "transiciones": [...],
        "roles_funcionales": [...]
      }
    Y el bundle no contiene UUIDs internos sino códigos (codigo, rol_codigo) para portabilidad

  Escenario: Bundle es idempotente al importar
    Dado que se importa el bundle en otro establecimiento "ISSS-02" (ver US.F2.1.14)
    Cuando se importa dos veces seguidas
    Entonces la segunda importación no duplica ningún registro
    Y ambas terminan en estado consistente

  Escenario: Error — exportar establecimiento sin acceso
    Dado que el usuario pertenece a "HNSF-01"
    Cuando intenta exportar el establecimiento "ISSS-02"
    Entonces recibe error "FORBIDDEN"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Should
- **Dependencias:** US.F2.1.6.
- **Trazabilidad fuente:** `_insumos/README.md` §Cómo se definen los workflows; `_insumos/08_seed_workflows.sql` (estructura referencial)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El bundle usa códigos de texto en lugar de UUIDs para ser portable entre instancias. La serialización debe excluir `registro_id` e IDs de instancias.

---

### US.F2.1.14 — Importar definición de workflow desde bundle JSON

**Como** administrador de sistema (DIR) **quiero** importar un bundle JSON de definición de workflow en mi establecimiento **para** adoptar configuraciones validadas de otros establecimientos del SNIS sin configurar manualmente cada elemento.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Importar definición de workflow desde bundle JSON
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "ISSS-02"
    Y dispone de un bundle JSON válido exportado de "HNSF-01"

  Escenario: Importación limpia en establecimiento vacío
    Dado que "ISSS-02" no tiene tipos de documento configurados
    Cuando llama a workflow.import con el bundle JSON
    Entonces el sistema inserta los 18 tipos, sus estados, transiciones y roles
    Y retorna un resumen: {insertados: 18, actualizados: 0, errores: 0}

  Escenario: Importación incremental (upsert)
    Dado que "ISSS-02" ya tiene "HIST_CLIN" configurado con estado "borrador"
    Cuando importa un bundle que incluye "HIST_CLIN" con un nuevo estado "en_revision"
    Entonces el sistema agrega el nuevo estado sin borrar el existente
    Y retorna {insertados: 1, actualizados: 0, errores: 0}

  Escenario: Error — bundle con versión no soportada
    Cuando importa un bundle con "version": "2.0"
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "Versión de bundle no soportada: 2.0. Versiones soportadas: 1.0"

  Escenario: Error — bundle con dependencia circular
    Cuando importa un bundle con un ciclo en depende_de
    Entonces recibe error "UNPROCESSABLE_ENTITY" antes de cualquier INSERT
    Y no se inserta ningún registro (transacción completa)
```

- **Story points:** 8
- **Prioridad MoSCoW:** Should
- **Dependencias:** US.F2.1.13; US.F2.1.12.
- **Trazabilidad fuente:** `_insumos/README.md` §Cómo se definen los workflows
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** La importación corre en una sola transacción DB. Si cualquier validación falla, rollback completo. El upsert usa `ON CONFLICT (tipo_documento_id, codigo) DO UPDATE` o equivalente con códigos como clave natural.

---

### US.F2.1.15 — Tomar snapshot de versión de workflow

**Como** administrador de sistema (DIR) **quiero** guardar un snapshot nombrado de la configuración actual de workflow antes de realizar cambios **para** poder hacer rollback a esa versión si los cambios generan problemas operativos.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Tomar snapshot de versión de workflow
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"

  Escenario: Crear snapshot nombrado
    Cuando llama a workflow.version.snapshot con nombre="v1.0-norma-1616" y descripcion="Configuración inicial NTEC 2024"
    Entonces el sistema genera un bundle JSON del estado actual y lo guarda como snapshot
    Y retorna un snapshot_id y el timestamp

  Escenario: Listar snapshots disponibles
    Cuando llama a workflow.version.list
    Entonces recibe la lista de snapshots con nombre, descripcion, creado_en y creado_por
    Ordenada de más reciente a más antigua

  Escenario: Error — nombre de snapshot duplicado en el mismo establecimiento
    Dado que ya existe un snapshot con nombre="v1.0-norma-1616"
    Cuando intenta crear otro con el mismo nombre
    Entonces recibe error "CONFLICT" con mensaje "Ya existe un snapshot con ese nombre para este establecimiento"

  Escenario: Aislamiento de tenant en snapshots
    Dado que "ISSS-02" tiene sus propios snapshots
    Cuando DIR de "HNSF-01" lista sus snapshots
    Entonces solo ve los snapshots de "HNSF-01"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Should
- **Dependencias:** US.F2.1.13; requiere tabla `ece.workflow_snapshot` (nueva, coordinar con @DBA).
- **Trazabilidad fuente:** Sub-tema 7 del scope (versionado de workflows)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El snapshot es un bundle JSON idéntico al de exportación, almacenado en una columna `jsonb` de la nueva tabla `ece.workflow_snapshot`. Coordinar DDL con @DBA antes de implementar.

---

### US.F2.1.16 — Restaurar workflow desde snapshot (rollback)

**Como** administrador de sistema (DIR) **quiero** restaurar la configuración de workflow a un snapshot previo **para** revertir cambios que afectaron negativamente los flujos clínicos en operación.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Restaurar workflow desde snapshot
  Antecedentes:
    Dado que existe el snapshot "v1.0-norma-1616" para el establecimiento "HNSF-01"
    Y el establecimiento tiene modificaciones posteriores a ese snapshot

  Escenario: Rollback exitoso sin instancias activas incompatibles
    Dado que todas las instancias activas son compatibles con el snapshot previo
    Cuando llama a workflow.version.restore con snapshot_id="SNAP-001"
    Entonces el sistema reemplaza los estados y transiciones con los del snapshot
    Y crea automáticamente un snapshot del estado actual antes del rollback (snapshot de seguridad)
    Y retorna confirmación con el resumen de cambios aplicados

  Escenario: Error — rollback bloquea instancias incompatibles
    Dado que hay instancias en el estado "en_revision" que no existe en el snapshot destino
    Cuando intenta el rollback
    Entonces recibe error "CONFLICT" con mensaje "Existen N instancias en el estado en_revision que no existe en el snapshot destino. Resuelva las instancias antes de restaurar."

  Escenario: Snapshot de seguridad previo al rollback
    Cuando el rollback se ejecuta exitosamente
    Entonces existe un nuevo snapshot automático con nombre="pre-rollback-<timestamp>"
    Y ese snapshot está accesible en workflow.version.list
```

- **Story points:** 8
- **Prioridad MoSCoW:** Should
- **Dependencias:** US.F2.1.15.
- **Trazabilidad fuente:** Sub-tema 7 del scope (rollback de workflows)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El rollback es destructivo para la configuración pero no para las instancias. El check de compatibilidad consiste en verificar que todos los estados actuales de instancias vigentes existan en el snapshot destino. Toda la operación en una transacción.

---

### US.F2.1.17 — Comparar dos versiones de workflow

**Como** administrador de sistema (DIR) **quiero** comparar un snapshot con la configuración actual o con otro snapshot **para** entender exactamente qué cambió entre versiones antes de hacer un rollback.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Comparar dos versiones de workflow
  Antecedentes:
    Dado que existen los snapshots "v1.0-norma-1616" y "v1.1-reforma-mar2026" para "HNSF-01"

  Escenario: Comparar snapshot con configuración actual
    Cuando llama a workflow.version.diff con snapshot_a_id="SNAP-001" y snapshot_b_id="current"
    Entonces recibe un objeto diff con:
      | sección         | added | removed | modified |
      | tipos_documento | 2     | 0       | 1        |
      | estados         | 3     | 1       | 0        |
      | transiciones    | 2     | 0       | 2        |
      | roles_funcionales | 0   | 1       | 0        |
    Y cada ítem del diff incluye el código del elemento y los campos que cambiaron

  Escenario: Comparar dos snapshots históricos
    Cuando llama con snapshot_a_id="SNAP-001" y snapshot_b_id="SNAP-002"
    Entonces recibe el diff entre ambos
    Y no se modifica ningún dato de la BD

  Escenario: Diff de snapshots idénticos
    Cuando compara un snapshot con sí mismo
    Entonces recibe diff vacío: {added:0, removed:0, modified:0} en todas las secciones
```

- **Story points:** 5
- **Prioridad MoSCoW:** Should
- **Dependencias:** US.F2.1.15.
- **Trazabilidad fuente:** Sub-tema 7 del scope (comparación entre versiones)
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** El diff opera sobre los bundles JSON en memoria — sin queries adicionales a la BD más allá de cargar los dos snapshots. Algoritmo de diff de objetos JSON por `codigo` como clave.

---

### US.F2.1.18 — Certificación de documento por Dirección del establecimiento

**Como** director del establecimiento (DIR) **quiero** certificar los documentos que lo requieren (EPICRISIS, CERT_DEF, FICHA_ID) **para** cumplir el Art. 21 NTEC que reserva esta acción exclusivamente al director o su delegado.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Certificación de documento por Dirección del establecimiento
  Antecedentes:
    Dado que el usuario autenticado tiene rol DIR en el establecimiento "HNSF-01"
    Y la instancia "DOC-EPIC-001" de tipo "EPICRISIS" está en estado "validado"

  Escenario: Certificar epicrisis exitosamente
    Cuando llama a workflow.instance.advance con accion="certificar" y firma_id="FE-DIR-001"
    Entonces el estado_actual cambia a "certificado" (es_final=true)
    Y el historial registra la acción con la firma DIR y timestamp completo
    Y el documento ya no admite más transiciones

  Escenario: Error — certificar desde estado no validado
    Dado que "DOC-EPIC-002" está en estado "firmado" (no validado)
    Cuando DIR intenta certificarlo
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "La acción certificar requiere estado validado para EPICRISIS"

  Escenario: Error — rol no DIR intenta certificar
    Dado que el usuario tiene rol MC
    Cuando intenta certificar cualquier documento
    Entonces recibe error "FORBIDDEN" con mensaje "Solo el rol DIR puede ejecutar la acción certificar"

  Escenario: Solo tipos que requieren certificación la permiten
    Dado que el tipo "HIST_CLIN" no tiene la transición "certificar" sembrada
    Cuando DIR intenta certificar una Historia Clínica
    Entonces recibe error "UNPROCESSABLE_ENTITY" con mensaje "La acción certificar no está permitida para el tipo HIST_CLIN"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.8; transición `certificar` sembrada en `08_seed_workflows.sql` líneas 119-125.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §Fase 2 nota de gobierno documental Art. 21 NTEC; `_insumos/08_seed_workflows.sql` líneas 119-125
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Esta US reutiliza la mutación `workflow.instance.advance` — el motor ya valida rol y transición. No se requiere endpoint adicional. El test específico debe verificar que el rol DIR es el único que puede ejecutar "certificar" en cualquier tipo.

---

### US.F2.1.19 — Validación de integridad antes de firma: dependencias en estado válido

**Como** sistema **quiero** bloquear la firma de un documento si sus dependencias no están en estado válido o superior **para** garantizar el orden del grafo documental del ECE en tiempo de ejecución.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Validación de integridad de dependencias antes de firma
  Antecedentes:
    Dado que existe la instancia "DOC-IND-001" de tipo "IND_MED"
    Y "IND_MED" tiene depende_de=["HIST_CLIN"]

  Escenario: Firma bloqueada porque la Historia Clínica está en borrador
    Dado que la Historia Clínica del episodio está en estado "borrador"
    Cuando el médico intenta firmar "DOC-IND-001"
    Entonces recibe error "UNPROCESSABLE_ENTITY"
    Y el mensaje indica "Dependencia IND_MED <- HIST_CLIN no satisfecha: HIST_CLIN debe estar en estado firmado o superior"

  Escenario: Firma permitida con dependencia firmada
    Dado que la Historia Clínica del mismo episodio está en estado "firmado"
    Cuando el médico intenta firmar "DOC-IND-001" con su firma
    Entonces la transición se ejecuta y el documento pasa a "firmado"

  Escenario: Documentos raíz (sin dependencias) se firman sin restricción
    Dado que "FICHA_ID" no tiene depende_de
    Cuando ARCH intenta firmarlo
    Entonces no se realiza ningún check de dependencias y la firma procede

  Escenario: Multiples dependencias — todas deben estar satisfechas
    Dado que "ACTO_QX" depende de "CONS_INF" y "CONS_INF" está en borrador
    Cuando ESP intenta firmar el acto quirúrgico
    Entonces recibe error indicando "CONS_INF debe estar en estado validado o superior"
```

- **Story points:** 5
- **Prioridad MoSCoW:** Must
- **Dependencias:** US.F2.1.8; US.F2.1.12.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §4 (grafo de dependencias); `_insumos/08_seed_workflows.sql` líneas 14-31
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Esta validación se ejecuta dentro de `workflow.instance.advance` antes del UPDATE de estado. Consulta `tipo_documento.depende_de[]` y verifica que para el episodio exista una instancia de cada tipo padre en estado `orden >= 2` (firmado o superior).

---

### US.F2.1.20 — Aplicar migración SQL del motor de workflow al proyecto Supabase

**Como** equipo de desarrollo **quiero** aplicar los archivos `05_motor_workflow.sql` y `08_seed_workflows.sql` al proyecto Supabase del HIS **para** tener el schema `ece` con el motor de workflow disponible como base para el desarrollo de los routers tRPC.

**Criterios de aceptación (Gherkin es-SV):**

```gherkin
Funcionalidad: Aplicar migración SQL del motor de workflow
  Antecedentes:
    Dado que los archivos 00_extensions.sql al 04_episodios.sql ya fueron aplicados al proyecto Supabase
    Y el schema ece existe con las tablas de paciente y episodio_atencion

  Escenario: Aplicación exitosa de 05_motor_workflow.sql
    Cuando @DBA aplica 05_motor_workflow.sql via mcp__supabase__apply_migration
    Entonces existen las tablas: ece.tipo_documento, ece.flujo_estado, ece.flujo_transicion, ece.documento_rol, ece.documento_instancia, ece.documento_instancia_historial
    Y los índices idx_docinst_episodio, idx_docinst_paciente, idx_docinst_tipo existen

  Escenario: Siembra exitosa con 08_seed_workflows.sql
    Cuando @DBA aplica 08_seed_workflows.sql
    Entonces existen 18 filas en ece.tipo_documento con activo=true
    Y cada tipo tiene al menos los estados borrador, firmado, validado, anulado
    Y los tipos EPICRISIS, CERT_DEF, FICHA_ID tienen además el estado certificado
    Y existen las transiciones de firma, validar y certificar donde corresponde

  Escenario: Error — intento de aplicación sin prerequisitos
    Dado que 04_episodios.sql no ha sido aplicado (ece.episodio_atencion no existe)
    Cuando se intenta aplicar 05_motor_workflow.sql
    Entonces la migración falla con error de FK "relation ece.episodio_atencion does not exist"
    Y no se aplica ninguna tabla parcialmente

  Escenario: Idempotencia de siembra
    Dado que 08_seed_workflows.sql ya fue aplicado
    Cuando se vuelve a ejecutar el mismo archivo
    Entonces no se duplican filas (los INSERT usan la semilla base sin conflicto)
```

- **Story points:** 3
- **Prioridad MoSCoW:** Must
- **Dependencias:** Archivos SQL 00-04 aplicados; acceso MCP a Supabase en modo write disponible.
- **Trazabilidad fuente:** `_insumos/README.md` §Orden de aplicación; `_insumos/05_motor_workflow.sql`; `_insumos/08_seed_workflows.sql`
- **Trazabilidad GS1:** N/A
- **Notas técnicas:** Esta US es el gate de infraestructura para toda la épica. Sin el schema aplicado, ningún router tRPC puede desarrollarse. Debe completarse en el primer sprint de Fase 2 antes de cualquier otra US de la épica.

---

## 5. Decisiones pendientes a stakeholder

**D1 — Tabla `ece.workflow_snapshot`:** Las US.F2.1.15-17 requieren una tabla nueva no contemplada en los SQL actuales. Decisión: ¿se incluye en `05_motor_workflow.sql` (requiere re-aplicación) o en un nuevo archivo `09_workflow_versioning.sql`? Impacto en sprint planning si se requiere re-aplicar.

**D2 — Granularidad de RLS por tipo de documento:** ¿Debe el perfil de acceso limitar la visibilidad de instancias por tipo de documento (ej. un ENF no puede ver EPICRISIS), o el filtro es solo por establecimiento? La decisión afecta el diseño de policies en `07_auditoria_seguridad.sql` y la complejidad de los routers de consulta.

**D3 — Idempotencia de `08_seed_workflows.sql`:** El archivo actual usa `INSERT` sin ON CONFLICT. Si se aplica dos veces, los tipos se duplican. Definir antes del primer sprint si el archivo se envuelve en DO $$ ... IF NOT EXISTS $$, o si se confía en que solo se aplica una vez vía MCP. Afecta US.F2.1.20 y US.F2.1.14.

**D4 — Firma electrónica simple:** Las US de advance exigen `firma_id` referenciando `ece.firma_electronica`. ¿La firma ya existe en BD antes de la llamada (el cliente la crea primero) o se crea inline en la mutación advance? El flujo de creación de firma impacta el contrato de la API y el diseño de pantallas (Stream 4).

**D5 — Nivel de autorización para snapshot/restore:** ¿El rol DIR de un establecimiento puede hacer rollback autónomo, o requiere aprobación adicional de un administrador central? Si se requiere aprobación doble, se necesita una transición adicional en el motor para los snapshots mismos.

---

## 6. Capacidad / estimación total

| US | Título resumido | SP | MoSCoW |
|---|---|---|---|
| US.F2.1.1 | Consultar catálogo tipos de documento | 3 | Must |
| US.F2.1.2 | Crear tipo de documento | 5 | Must |
| US.F2.1.3 | Actualizar y desactivar tipo de documento | 5 | Must |
| US.F2.1.4 | Gestionar estados del flujo | 5 | Must |
| US.F2.1.5 | Gestionar transiciones permitidas | 5 | Must |
| US.F2.1.6 | Gestionar matriz de roles funcionales | 5 | Must |
| US.F2.1.7 | Crear instancia de documento clínico | 8 | Must |
| US.F2.1.8 | Avanzar instancia (advance) | 13 | Must |
| US.F2.1.9 | Consultar instancias de episodio | 5 | Must |
| US.F2.1.10 | Consultar bitácora de transiciones | 3 | Must |
| US.F2.1.11 | Anulación de instancia por Dirección | 5 | Must |
| US.F2.1.12 | Validar invariante de grafo de dependencias | 8 | Must |
| US.F2.1.13 | Exportar bundle JSON de workflow | 5 | Should |
| US.F2.1.14 | Importar bundle JSON de workflow | 8 | Should |
| US.F2.1.15 | Tomar snapshot de versión | 5 | Should |
| US.F2.1.16 | Restaurar desde snapshot (rollback) | 8 | Should |
| US.F2.1.17 | Comparar dos versiones (diff) | 5 | Should |
| US.F2.1.18 | Certificación por Dirección | 5 | Must |
| US.F2.1.19 | Validación de dependencias antes de firma | 5 | Must |
| US.F2.1.20 | Aplicar migración SQL a Supabase | 3 | Must |
| **Total** | | **122** | |

- **Total story points: 122**
- **Sprints estimados (20-25 SP/sprint): 5-6 sprints**
- **Must-haves: 90 SP** (12 US) — equivalen a 4 sprints.
- **Should-haves: 32 SP** (5 US de versionado + export/import) — equivalen a 1-2 sprints adicionales.

Recomendación de secuencia por sprint:

| Sprint | US incluidas | SP |
|---|---|---|
| Sprint F2-1 | US.F2.1.20, US.F2.1.1, US.F2.1.2, US.F2.1.4 | 16 |
| Sprint F2-2 | US.F2.1.3, US.F2.1.5, US.F2.1.6, US.F2.1.12 | 23 |
| Sprint F2-3 | US.F2.1.7, US.F2.1.8 | 21 |
| Sprint F2-4 | US.F2.1.9, US.F2.1.10, US.F2.1.11, US.F2.1.18, US.F2.1.19 | 23 |
| Sprint F2-5 | US.F2.1.13, US.F2.1.14, US.F2.1.15 | 18 |
| Sprint F2-6 | US.F2.1.16, US.F2.1.17 | 13 |

---

## 7. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| **R1 — Dependencias circulares en datos de siembra** migradas de `08_seed_workflows.sql` que el motor no detecta en tiempo de siembra | Media | Alto — instancias quedarían en estado no avanzable | Implementar US.F2.1.12 en Sprint F2-2 antes de crear cualquier instancia de prueba; validar el grafo de los 18 tipos sembrados con test de integración |
| **R2 — RLS incompleto en schema `ece`** genera fuga de datos entre establecimientos | Media | Muy alto — incumplimiento normativo Art. 45 NTEC | Ejecutar prueba de tenant isolation (US.F2.1.9 escenario "aislamiento") en cada PR antes de merge; bloquear CI si falla |
| **R3 — Latencia de `workflow.instance.advance`** supera 400 ms p95 por validaciones en cadena (dependencias + transición + firma) | Media | Medio — impacto en UX de flujos de firma | Diseñar la mutación con una sola query de lookup que combine transición + validación en SQL; medir con Playwright performance test antes de Sprint F2-4 |
| **R4 — Reforma normativa MINSAL en curso** (reforma D.O. n.°55, T.450, 19/03/2026) puede alterar estados o roles requeridos antes del go-live | Alta | Medio — requiere ajuste de datos de siembra | Diseño data-driven del motor absorbe el cambio como UPDATE de filas sin deploy de código; impacto acotado a US.F2.1.15 (snapshot previo a cambio) |
| **R5 — Tabla `ece.workflow_snapshot` no está en los SQL actuales** y requiere coordinación con @DBA fuera del backlog actual | Baja | Medio — bloquea Sprints F2-5 y F2-6 | Escalar D1 a @Orq en Sprint F2-1 para incluir DDL en Sprint F2-2 como dependencia técnica de US.F2.1.15 |

---

## 8. Métricas post-release

| KPI | Definición | Objetivo | Fuente de datos |
|---|---|---|---|
| **Cobertura documental** | % de documentos del ECE gestionados a través del motor de workflow vs. registros en papel | 100% en establecimientos piloto al cierre de Fase 2 | `ece.documento_instancia` count vs. registros físicos de archivo |
| **Tiempo de ciclo firma-validación** | Mediana de tiempo entre estado "borrador" y estado "validado" por tipo de documento | Inferior al tiempo actual en papel (línea base a medir en Sprint F2-1) | `ece.documento_instancia_historial` diff de timestamps |
| **Tasa de rechazo de transiciones** | % de llamadas a `workflow.instance.advance` rechazadas por rol incorrecto o firma ausente | < 5% en operación estable (indica correcta capacitación de usuarios) | Logs de errores tRPC en Supabase |
| **Latencia p95 de advance** | Percentil 95 de tiempo de respuesta de la mutación `workflow.instance.advance` bajo carga de 50 usuarios concurrentes por establecimiento | < 400 ms | Playwright performance test + Prometheus (si SRE configura scraping) |
| **Incumplimientos Art. 42/55 NTEC** | Número de documentos sin firma en historial donde la transición la requería | 0 en auditoría externa | `ece.documento_instancia_historial` where requiere_firma=true and firma_id is null |
