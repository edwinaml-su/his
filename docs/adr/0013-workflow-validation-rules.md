# ADR 0013 — ECE: Validador server-side de integridad de workflow

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @QA, @Dev
- **Fase:** Fase 2 — Sprint F2-S3 (Cierre ECE Ambulatorio)
- **Dependencias:**
  - ADR 0011 — Motor workflow data-driven (`ece.flujo_transicion`, `ece.flujo_estado`)
  - ADR 0010 — Firma electronica simple (requisito `requiere_firma`)
  - ADR 0012 — RLS ECE (contexto de rol para verificación ABAC)
  - `packages/trpc/src/services/workflow-validator.ts` — implementación

---

## Contexto

El motor de workflow data-driven (ADR 0011) define grafos de estado para 30 tipos de documento ECE.
Una transición de estado (p. ej. `borrador → revision`, `revision → firmado`, `firmado → certificado`)
requiere verificar tres condiciones antes de ejecutarse:

1. **Integridad del grafo:** la transición `(estado_actual, evento)` existe en `ece.flujo_transicion`
   para el tipo de documento dado.
2. **Autorización por rol (ABAC):** el rol del personal en sesión está en la lista de roles permitidos
   para esa transición en `ece.documento_rol`.
3. **Completitud del payload:** los campos marcados como `requeridos_en_transicion` están presentes
   y no vacíos en el documento antes de la transición.
4. **Firma electronica activa (condicional):** si `flujo_transicion.requiere_firma = true`, existe
   una sesion de firma activa (`ece.firma_session_cache.expires_at > now()`) para el personal.

La pregunta es: ¿dónde y cómo se ejecutan estas validaciones?

---

## Decision

**Validador centralizado server-side como servicio independiente en `packages/trpc/`.**

```ts
// packages/trpc/src/services/workflow-validator.ts
export interface WorkflowTransitionInput {
  tipoDocumentoId: string;
  estadoActual: string;
  evento: string;
  ecePersonalId: string;
  eceEstablecimientoId: string;
  payload: Record<string, unknown>;
}

export interface WorkflowValidationResult {
  valid: boolean;
  errors: WorkflowValidationError[];
}

export async function validateWorkflowTransition(
  tx: Prisma.TransactionClient,
  input: WorkflowTransitionInput,
): Promise<WorkflowValidationResult>
```

El servicio se invoca dentro del `withEceContext` de cada router antes de ejecutar el UPDATE de estado:

```ts
// En cualquier router que permita transiciones de workflow
const validation = await validateWorkflowTransition(tx, { ... });
if (!validation.valid) {
  throw new TRPCError({ code: "BAD_REQUEST", message: validation.errors[0].message });
}
```

El mismo servicio es consumido por el `<WorkflowDesigner>` via un endpoint `workflowRouter.validateTransition`
— permitiendo validación visual sin duplicar reglas.

---

## Alternativas consideradas

### A1. Biblioteca `bpmn-js` / validacion BPMN externa — descartada

**Idea:** exportar los grafos de workflow a formato BPMN 2.0 y usar una biblioteca de validación
BPMN standard (`bpmn-js-bpmnlint`, `camunda-bpmn-model`) para verificar integridad de transiciones.

**Razon de rechazo:**

- **Overkill para el modelo actual.** El motor ECE maneja grafos simples (< 10 estados, < 15
  transiciones por tipo de documento). BPMN 2.0 tiene soporte para gateways paralelos, eventos
  de borde, subprocesos — ninguno necesario en el scope actual. La curva de aprendizaje de la
  especificación BPMN supera el valor añadido.
- **Dependencia de formato externo.** Los grafos viven en BD como datos relacionales (ADR 0011).
  Exportar a BPMN requiere una capa de transformación adicional, creando dos fuentes de verdad:
  la BD y el XML BPMN. La divergencia entre ambas sería un riesgo de integridad.
- **Sin soporte para lógica de negocio custom.** Las condiciones de ABAC (rol por tipo de
  documento) y la verificación de sesion de firma no son modelables en BPMN estándar sin
  extensiones — que equivalen a escribir el validador custom de todas formas.
- **Tamaño del bundle:** `bpmn-js` agrega ~500 KB minificado al bundle del Workflow Designer.
  Un componente react-flow custom con la misma funcionalidad visual pesa < 50 KB.

### A2. Validacion solo client-side (en el formulario React / Workflow Designer) — descartada

**Idea:** las validaciones de transición se ejecutan únicamente en el cliente (React), bloqueando
la UI antes de que el usuario envíe la request al servidor. El router confía en que el cliente
ya validó.

**Razon de rechazo:**

- **Bypasseable por diseño.** Un usuario con acceso a DevTools puede invocar el endpoint tRPC
  directamente omitiendo el formulario. En un sistema clínico donde las transiciones de estado
  tienen efectos legales (firma electronica, certificación de dirección), confiar solo en el
  cliente es inaceptable.
- **Prueba de seguridad fallida en sprint anterior.** En F2-S2, el test E2E `ece-rls-enforcement`
  ya demostró que la capa de RLS es la segunda línea de defensa — pero el RLS no verifica
  integridad del grafo de workflow. Sin validacion server-side, un request malformado puede
  dejar un documento en estado inconsistente (p. ej. `certificado` sin firma registrada).
- **Dificulta los tests unitarios.** Si la lógica está solo en el cliente (componentes React),
  no es testeable con Vitest sin montar el DOM completo. Un servicio server-side puro es
  testeable con 18 casos unitarios sin jsdom ni Playwright.

### A3. Validacion inline en cada router (sin servicio compartido) — descartada

**Idea:** cada router que permite transiciones (hcRouter, atencionEmergenciaRouter, rriRouter,
estudiosRouter, etc.) implementa sus propias validaciones de workflow directamente.

**Razon de rechazo:**

- **Duplicacion inaceptable.** Con 9 routers de documento y un grafo de workflow compartido, la
  misma lógica de verificación de transición se repetiría en 9 lugares. Un cambio en las reglas
  del motor (p. ej. agregar un nuevo rol a una transición) requeriría actualizar los 9 routers.
- **Sin punto de extensión para el Workflow Designer.** El designer necesita un endpoint para
  previsualizar si una transición propuesta es válida. Sin servicio compartido, el designer
  tendría que reimplementar las mismas reglas en el cliente — contradiciendo la alternativa A2
  descartada.
- **Inconsistencia entre routers.** La experiencia del sprint anterior (Wave 6, F1) mostró que
  cuando múltiples desarrolladores implementan la misma validación en paralelo, los criterios
  divergen sutilmente. Un servicio centralizado fuerza consistencia.

---

## Consecuencias

### Positivas

- **Un único lugar de verdad para las reglas de transición.** Cambiar una regla en el grafo
  de workflow (BD) + el servicio cubre todos los routers automáticamente.
- **Testeable en aislamiento.** El servicio es una función pura (recibe `tx` + input, devuelve
  resultado). 18 casos unitarios Vitest sin dependencia de red ni DOM — ejecucion < 100ms.
- **Reutilizable en el Workflow Designer.** El endpoint `workflowRouter.validateTransition`
  permite al designer visualizar en tiempo real si una transición propuesta es valida antes de
  persistir el cambio en el grafo.
- **Errores accionables.** El servicio devuelve `WorkflowValidationError[]` con `code` +
  `message` + `field` (cuando aplica) — el router los traduce a `TRPCError` con mensaje
  visible en la UI.

### Negativas / trade-offs

- **Latencia adicional en cada transicion.** El servicio ejecuta 3-4 queries al grafo de
  workflow por cada transición. Con los datos cacheados en `ece.flujo_transicion` (< 500 filas
  para 30 tipos de documento), el overhead esperado es < 5ms por transicion — aceptable.
- **Acoplamiento al schema del motor.** Si las tablas del motor cambian (ADR 0011), el servicio
  necesita actualizacion. Mitigado: el servicio accede al motor solo via Prisma (tipos generados),
  por lo que un cambio de schema rompe la compilacion antes de llegar a runtime.
- **Sin cache de grafos en memoria.** La implementación inicial hace queries a BD en cada
  transicion. Si en Fase 3 el volumen de transiciones por minuto supera ~500/min, se evaluará
  cache LRU en memoria del proceso Node. Postergado intencionalmente — premature optimization.

---

## Diseño de implementacion

### Estructura del servicio

```
packages/trpc/src/
  services/
    workflow-validator.ts          # servicio principal
    __tests__/
      workflow-validator.test.ts   # 18 casos unitarios
```

### Casos de test cubiertos

| # | Descripcion | Resultado esperado |
|---|-------------|-------------------|
| 1-6 | Transiciones validas para 6 tipos de documento | `{ valid: true, errors: [] }` |
| 7 | Transicion con estado_actual incorrecto | `{ valid: false, errors: [{ code: "INVALID_TRANSITION" }] }` |
| 8 | Rol sin permiso para la transicion | `{ valid: false, errors: [{ code: "UNAUTHORIZED_ROLE" }] }` |
| 9 | Campo obligatorio faltante en payload | `{ valid: false, errors: [{ code: "MISSING_FIELD", field: "diagnostico_cie10" }] }` |
| 10 | `requiere_firma = true` sin sesion activa | `{ valid: false, errors: [{ code: "FIRMA_REQUIRED" }] }` |
| 11 | `requiere_firma = true` con sesion expirada | `{ valid: false, errors: [{ code: "FIRMA_EXPIRED" }] }` |
| 12 | Multiples errores en un solo request | `{ valid: false, errors: [{ code: "UNAUTHORIZED_ROLE" }, { code: "MISSING_FIELD" }] }` |

---

## Referencias

- ADR 0011 — Motor workflow data-driven (tablas `ece.flujo_transicion`, `ece.documento_rol`)
- ADR 0010 — Firma electronica simple (verificacion sesion `ece.firma_session_cache`)
- ADR 0012 — RLS ECE (contexto ABAC via `withEceContext`)
- `packages/trpc/src/services/workflow-validator.ts` — implementacion
- `packages/trpc/src/services/__tests__/workflow-validator.test.ts` — 18 casos unitarios
- OWASP Top 10 2021, A04 Insecure Design — validacion server-side como control obligatorio
- Arts. 42, 43 NTEC — integridad e inmutabilidad de documentos clinicos; controles de acceso en BD
