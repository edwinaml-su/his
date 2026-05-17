# ADR 0011 — ECE: Motor de Workflow Data-Driven

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @AE, @Dev, @DBA
- **Fase:** Fase 2 — Sprint F2-S2 (ECE Historia Clínica)
- **Dependencias:**
  - `docs/02_arquitectura_software.md` — blueprint hexagonal
  - TDR §4.15, §4.17, §4.23, §4.44, §4.45 — workflow de expediente clínico
  - ADR 0010 — Firma electrónica simple (patrón de uso downstream)
  - `packages/database/sql/60_ece_05_motor.sql` — implementación DDL
  - Acuerdo 1616 MINSAL 2024, Arts. 23, 42, 44, 45, 52, 55 NTEC

---

## Contexto

El ECE (Expediente Clínico Electrónico) de HIS Avante maneja **30 tipos de documento**
distintos (ficha de identificación, nota de evolución médica, epicrisis, consentimientos,
órdenes, resultados firmados, etc.) definidos en la NTEC. Cada tipo tiene:

- Un conjunto propio de **estados** (borrador → en revisión → firmado → validado → certificado).
- Un **grafo de transiciones** con invariantes de rol: quién puede avanzar cada transición
  y si se requiere firma electrónica.
- Una **matriz de roles funcionales**: quién llena el documento, quién es responsable,
  quién autoriza y quién firma.
- **Dependencias entre documentos**: la epicrisis no puede abrirse sin HC previa firmada.

La decisión de diseño es: ¿se implementa cada uno de estos flujos como código duro
(condicionales TypeScript por tipo de documento), o como datos (filas en tablas de catálogo)?

---

## Decision

**Motor de workflow data-driven: el flujo de cada documento se define como datos en
cuatro tablas relacionales, no como código.**

### Tablas del motor (`packages/database/sql/60_ece_05_motor.sql`)

```
ece.tipo_documento       — catálogo de documentos: tabla_datos, tipo_registro, inmutable
ece.flujo_estado         — estados por tipo_documento (grafo de nodos)
ece.flujo_transicion     — aristas del grafo: origen → destino, accion, rol_autoriza, requiere_firma
ece.documento_rol        — matriz LLENA | RESPONSABLE | AUTORIZA | FIRMA por tipo+rol
ece.documento_instancia  — instancia real en un episodio; apunta a la tabla de datos via registro_id
```

El motor tRPC (`packages/trpc/src/routers/workflow-instance.router.ts`) ejecuta una
**función genérica** que consulta estas tablas para determinar:

1. ¿Qué transiciones puede ejecutar el usuario actual desde el estado actual?
2. ¿La transición requiere firma electrónica?
3. ¿El usuario tiene el rol necesario en `ece.flujo_transicion.rol_autoriza_id`?

Si se necesita agregar un nuevo tipo de documento, se inserta filas — no se escribe código.

---

## Alternativas consideradas

### A1. Hard-coded por tipo de documento (descartada)

**Idea:** un router tRPC por tipo de documento (p. ej. `historiaClinicaRouter`,
`epicrisisRouter`). Cada router tiene sus propios condicionales de estado, rol y firma.

**Razón de rechazo:**

- La NTEC define 30 tipos de documento. Con 30 routers, cualquier cambio regulatorio
  (p. ej. agregar un estado de "revisión médica" exigido por circular MINSAL) requiere
  modificar código en 30 lugares y un PR.
- Imposible garantizar consistencia transversal (logs de bitácora, hash chain) sin
  abstracción: cada router lo implementaría de forma independiente.
- Violación del principio DRY a escala: el flujo de "verificar rol → verificar firma →
  avanzar estado → insertar bitácora" es idéntico en todos los tipos.
- El testing de combinatoria (30 tipos × N estados × M roles) es inmanejable si la
  lógica está distribuida.

### A2. State machine library (xstate / robot) en TypeScript (descartada)

**Idea:** modelar cada workflow como una máquina de estados XState; el estado de la
máquina se serializa en la BD.

**Razón de rechazo:**

- XState modela comportamiento en memoria, no persistencia transaccional. Serializar/
  deserializar el estado de la máquina en cada request añade complejidad sin beneficio
  frente a las tablas relacionales.
- Las máquinas XState son código TypeScript: agregar un tipo de documento requiere
  código, no datos — el mismo problema que A1.
- Las invariantes de rol y firma deben revalidarse en Postgres (RLS, triggers) de
  todos modos; duplicar la lógica en TypeScript crea dos fuentes de verdad.
- Dependencia de librería de terceros con surface de API no estable (XState v5 rompió
  compat con v4 en 2024).

### A3. BPMN engine externo (Camunda, Temporal) (descartada)

**Idea:** delegar la orquestación de workflows a un motor BPMN externo. Los documentos
ECE son actividades dentro de un proceso BPMN.

**Razón de rechazo:**

- Agrega un servicio de infraestructura nuevo (Camunda CE o Temporal.io) que no está
  en el stack actual ni en el presupuesto de Fase 2.
- La latencia de red hacia un motor externo es inaceptable en el hot path de firma
  clínica (target: < 200 ms en guardia).
- La complejidad operacional (SLA del motor, versioning de procesos BPMN, compensaciones)
  excede el problema: los flujos ECE son grafos dirigidos simples, no procesos de larga
  duración con compensaciones distribuidas.
- El motor data-driven en Postgres tiene transaccionalidad ACID por defecto; Temporal
  requiere saga/compensación explícita para garantías equivalentes.

---

## Consecuencias

### Positivas

- **Cambios sin código:** un cambio de workflow requerido por circular MINSAL se aplica
  con un UPDATE/INSERT en las tablas de catálogo + apply SQL — sin PR de código.
- **Un solo router genérico:** `workflowInstanceRouter` resuelve todos los tipos de
  documento. Testing exhaustivo en un único punto.
- **Consistencia transversal garantizada:** bitácora, hash chain, firma electrónica y
  GUC ECE se aplican en el router genérico para todos los documentos.
- **Trazabilidad completa:** `ece.documento_instancia_historial` registra cada transición
  con actor, timestamp y referencia a firma; auditable vía `auditIntegrityRouter`.
- **Testing de combinatoria simplificado:** para verificar que "PHYSICIAN no puede
  certificar", basta verificar que no hay fila en `ece.flujo_transicion` con
  `accion='certificar'` y `rol_autoriza_id` = rol PHYSICIAN — un test unitario de BD.

### Negativas / trade-offs

- **Depuración indirecta:** cuando un usuario recibe "transición no permitida", el error
  apunta al motor genérico, no a un router específico. Requiere consultar las tablas de
  catálogo para entender por qué. Mitigado con mensajes de error ricos en contexto
  (`tipo_documento.codigo + flujo_estado.codigo + accion`).
- **Curva de incorporación:** un desarrollador nuevo debe entender el modelo de cuatro
  tablas antes de poder agregar un workflow. Documentado en `docs/04_modelo_datos.md`
  y en los comentarios del DDL.
- **Migraciones de datos son cambios de comportamiento:** una fila incorrecta en
  `ece.flujo_transicion` es un bug de producción, no de compilación. Requiere tests
  de BD (Vitest + Prisma en test DB) para las tablas de catálogo.
- **FK lógica en `documento_instancia.registro_id`:** no se puede declarar FK referencial
  porque la tabla objetivo varía por tipo de documento. La integridad es responsabilidad
  del motor en tRPC + test unitario.

---

## Diseño de implementacion

### Flujo de una transición (pseudocódigo del router genérico)

```ts
// workflowInstanceRouter.transicion
const transicion = await prisma.flujoTransicion.findFirst({
  where: {
    tipoDocumentoId: instancia.tipoDocumentoId,
    estadoOrigenId:  instancia.estadoActualId,
    accion:          input.accion,
  },
});

if (!transicion) throw new TRPCError({ code: "BAD_REQUEST", message: "Transición no permitida" });

const tieneRol = await verificarRolEce(ctx, transicion.rolAutorizaId);
if (!tieneRol) throw new TRPCError({ code: "FORBIDDEN" });

if (transicion.requiereFirma) {
  await validarFirmaSession(ctx, input.firmaSessionToken);
}

await prisma.$transaction(async (tx) => {
  await tx.documentoInstancia.update({ where: { id }, data: { estadoActualId: transicion.estadoDestinoId } });
  await tx.documentoInstanciaHistorial.create({ ... });
  await tx.bitacoraAcceso.create({ accion: input.accion, autorizado: true, ... });
});
```

### Seed de catálogo (30 documentos NTEC)

`packages/database/sql/63_ece_08_seed.sql` inserta los 30 tipos de documento con sus
estados y transiciones. El seed es idempotente (`ON CONFLICT DO NOTHING`).

---

## Referencias

- Acuerdo 1616 MINSAL 2024, Arts. 23, 42, 44, 45, 52, 55 NTEC — definición de tipos de documento y sus flujos
- ADR 0010 — Firma electrónica simple (patrón de uso en `requiere_firma=true`)
- ADR 0004 — Inmutabilidad post-firma (complemento para `tipo_documento.inmutable=true`)
- `packages/database/sql/60_ece_05_motor.sql` — DDL completo del motor
- `packages/database/sql/63_ece_08_seed.sql` — seed de 30 tipos de documento
- `packages/trpc/src/routers/workflow-instance.router.ts` — router genérico
- Fowler, *Patterns of Enterprise Application Architecture*, cap. 8 — "State Machine"
- Vernon, *Implementing Domain-Driven Design*, cap. 7 — "Domain Events" (analogía con transiciones)
