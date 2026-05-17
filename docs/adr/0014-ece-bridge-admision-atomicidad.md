# ADR 0014 — ECE: Bridge Admisión — Atomicidad via Transacción Única

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @Dev, @DBA
- **Fase:** Fase 2 — Sprint F2-S4 (ECE Hospitalario)
- **Dependencias:**
  - CLAUDE.md §"Contrato RLS" — patrón `withTenantContext` con `prisma.$transaction`
  - ADR 0012 — Estrategia RLS ECE (`withEceContext` dentro de transacción)
  - `packages/database/sql/66_valoracion_inicial_enfermeria.sql` — tabla nueva creada en F2-S4
  - `packages/trpc/src/routers/bridge-admision.router.ts` — implementación

---

## Contexto

El proceso de admisión hospitalaria en HIS requiere crear o actualizar 6 registros en 5
tablas al mismo tiempo:

1. `ece.orden_ingreso` — actualizar `estado` de `vigente` a `procesada` (UPDATE).
2. `ece.episodio_atencion` — crear el episodio con modalidad `hospitalario` (INSERT).
3. `ece.hoja_ingreso` — vincular episodio + fecha/hora de ingreso + ADM firmante (INSERT).
4. `ece.asignacion_cama` — asignar la cama al episodio (INSERT).
5. `ece.cama` — actualizar `estado` de `disponible` a `ocupada` (UPDATE implícito via trigger).
6. `public."Encounter"` — crear el encuentro HIS vinculado al episodio ECE (INSERT).

Estas operaciones deben suceder como unidad atómica: si cualquiera falla, el estado
previo debe restaurarse por completo. En sprints anteriores (F2-S3) se detectaron bugs
de estado parcial cuando el cliente orquestaba estas llamadas secuencialmente.

La pregunta es: ¿dónde vive la lógica de coordinación de estas 6 operaciones?

---

## Decision

**Endpoint único `admitirDesdeOrden` que ejecuta las 6 operaciones dentro de `prisma.$transaction`.**

```ts
// packages/trpc/src/routers/bridge-admision.router.ts
export const bridgeAdmisionRouter = createTRPCRouter({
  admitirDesdeOrden: tenantProcedure
    .input(admitirDesdeOrdenSchema)
    .mutation(async ({ ctx, input }) => {
      return withEceContext(prisma, ctx.ecePersonalId, ctx.eceEstablecimientoId, async (tx) => {
        // 1. Validar orden vigente y cama disponible (lecturas dentro de tx para serializable)
        const orden = await tx.ordenIngreso.findUniqueOrThrow({ where: { id: input.ordenId } });
        if (orden.estado !== 'vigente') throw new TRPCError({ code: 'CONFLICT', ... });

        const cama = await tx.cama.findUniqueOrThrow({ where: { id: input.camaId } });
        if (cama.estado !== 'disponible') throw new TRPCError({ code: 'CONFLICT', ... });

        // 2. Mutaciones atómicas
        const episodio = await tx.episodioAtencion.create({ data: { ... } });
        const hojaIngreso = await tx.hojaIngreso.create({ data: { episodioId: episodio.id, ... } });
        await tx.asignacionCama.create({ data: { episodioId: episodio.id, camaId: input.camaId, ... } });
        await tx.ordenIngreso.update({ where: { id: input.ordenId }, data: { estado: 'procesada' } });
        const encounter = await tx.encounter.create({ data: { eceEpisodioId: episodio.id, ... } });

        return { episodioId: episodio.id, hojaIngresoId: hojaIngreso.id, encounterId: encounter.id };
      });
    }),
});
```

El isolation level por defecto de Prisma (`READ COMMITTED`) es suficiente dado que
las validaciones de disponibilidad (orden vigente, cama disponible) ocurren dentro de
la misma transacción que las mutaciones — la ventana de race condition es la latencia
intra-transacción de Postgres, no entre requests.

---

## Alternativas consideradas

### A1. Cliente orquesta 6 llamadas secuenciales — descartada

**Idea:** el frontend llama a 6 endpoints separados (`updateOrden`, `createEpisodio`,
`createHojaIngreso`, `assignCama`, `updateCama`, `createEncounter`) en orden.

**Razon de rechazo:**

- **Race conditions observadas en F2-S3:** cuando dos usuarios de admisión asignan la
  misma cama simultáneamente, ambas requests pasan la validación "cama disponible" antes
  de que alguna confirme el INSERT. El resultado es dos `ece.asignacion_cama` activas para
  la misma cama.
- **Estado parcial en fallo de red:** si la red falla entre el paso 3 y 4, el episodio
  existe sin hoja de ingreso. El paciente aparece "ingresado" en el sistema pero sin
  asignación de servicio. Recovery manual requerido.
- **Sin transaccionalidad de negocio:** la orden de ingreso permanece en estado `vigente`
  si falla cualquier paso posterior — puede ser procesada nuevamente por otro operador.
- **Complejidad en el cliente:** el frontend debe manejar rollback parcial (llamar a DELETE
  de los registros ya creados si algo falla), lógica que no pertenece a la capa de presentación.

### A2. Saga pattern con compensating transactions — descartada

**Idea:** modelar la admisión como una saga de 6 pasos con transactions de compensación
(e.g. si el paso 4 falla, ejecutar DELETE de episodio + hoja_ingreso creados en pasos 2-3).

**Razon de rechazo:**

- **Overkill para un flujo síncrono de < 500 ms.** El pattern Saga es apropiado para
  microservicios distribuidos donde los pasos cruzan fronteras de servicio y red.
  Aquí los 6 pasos ocurren en la misma base de datos Postgres a través del mismo
  `PrismaClient` — una transacción Postgres es exactamente la herramienta correcta.
- **Complejidad operacional sin beneficio:** implementar una saga local requiere una tabla
  de estado de saga, lógica de retry, idempotency keys y manejo de compensaciones.
  La transacción Postgres provee todas estas garantías (atomicidad, rollback automático)
  sin código adicional.
- **Evento de negocio no existe (aún):** si en Fase 3 se introduce un servicio externo
  (e.g. notificación al sistema de ISSS) que debe ejecutarse durante la admisión,
  la saga tendría sentido. Por ahora es deuda técnica postergada intencionalmente.
- **Latencia:** una saga con pasos asíncronos introduce latencia de al menos un RTT
  adicional por paso. Para una operación que el ADM ejecuta en ventanilla con el paciente
  presente, los 5-50 ms adicionales son perceptibles.

### A3. Procedimiento almacenado `ece.fn_admitir_desde_orden` — descartada

**Idea:** encapsular la lógica en una función SQL `SECURITY DEFINER` que el router
llama con `prisma.$queryRaw`.

**Razon de rechazo:**

- **Lógica de negocio en BD dificulta el testing.** Los tests de integración con Vitest
  y Prisma en test DB pueden mockear routers; testear una función SQL requiere una BD
  real o un mock más complejo.
- **Typecheck perdido.** El `$queryRaw` retorna `unknown`; perder los tipos TypeScript
  en el boundary más crítico (creación de múltiples registros relacionados) no compensa
  el beneficio.
- **Precedente de arquitectura:** la decisión del proyecto es "lógica de negocio en
  routers tRPC, no en SQL". Las funciones SQL se usan para RLS, triggers de inmutabilidad
  y helpers de contexto (ADR 0012). La regla de negocio "una admisión requiere estos 6
  pasos" es dominio de aplicación, no de base de datos.

---

## Trade-offs

### Latencia vs. Consistencia

La transacción única añade ~5-20 ms de overhead frente a 6 llamadas independientes
(lock acquisition, serialization overhead en Postgres). Para el flujo de admisión:

- **Aceptable:** la admisión ocurre una vez por episodio hospitalario. El ADM está en
  ventanilla con el paciente; 5-20 ms son imperceptibles.
- **No aceptable si:** el endpoint se usara en bulk (e.g. migración de 10,000 episodios).
  Para ese caso existe un endpoint separado `migrarEpisodiosBulk` fuera de scope de F2-S4.

### Isolation Level

Se usa `READ COMMITTED` (default Postgres/Prisma). Una alternativa más estricta sería
`SERIALIZABLE`, que prevendría incluso el phantom read en la validación de cama disponible.

Se eligió `READ COMMITTED` porque:
- La validación de cama disponible (`cama.estado = 'disponible'`) ocurre dentro de la
  misma transacción que el INSERT en `asignacion_cama`. Con `READ COMMITTED`, otro
  transaction concurrente puede haber actualizado `cama.estado` entre nuestra lectura y
  nuestro INSERT — pero el trigger `fn_check_cama_disponible` en el INSERT de `asignacion_cama`
  re-valida el estado dentro de la transacción, bloqueando la race condition.
- `SERIALIZABLE` en el path de admisión incrementaría la tasa de errores por serialization
  failure en alta concurrencia (múltiples admisiones simultáneas). El trigger es la segunda
  línea de defensa más eficiente.

---

## Consecuencias

### Positivas

- **Atomicidad garantizada por Postgres.** Fallo en cualquier paso = rollback completo.
  No hay estado parcial posible a nivel de BD.
- **Eliminación de race conditions de cama.** El trigger `fn_check_cama_disponible` +
  la transacción única hacen que la asignación de cama sea serializada implícitamente.
- **Un solo punto de auditoria.** El audit hash chain registra una única entrada por
  admisión en lugar de 6 entradas desconectadas. Facilita el audit trail para la NTEC.
- **Testing directo.** Un solo test de integración cubre el happy path completo y los
  scenarios de fallo parcial (mock de error en paso 3, 4, 5).

### Negativas / trade-offs

- **Endpoint no reutilizable para admisiones parciales.** Si en Fase 3 se requiere una
  admisión en dos fases (reserva de cama + confirmación posterior), se necesitará un
  endpoint separado. El endpoint actual no soporta flujo de dos pasos.
- **Acoplamiento funcional en un router.** El `bridgeAdmisionRouter` tiene dependencias
  en 5 tablas/modelos. Cambios en el schema de cualquiera de esas tablas requieren
  actualizar este router. Documentado en el contrato de interface del router.
- **Sin soporte para admisión asíncrona.** Si un servicio externo (ISSS, MINSAL) necesita
  ser notificado de forma asíncrona como parte del flujo, el patrón outbox (ADR 0008)
  debe agregarse sin romper la atomicidad del INSERT principal. Deuda técnica para Fase 3.

---

## Diseño de verificacion en CI

`packages/trpc/src/routers/__tests__/bridge-admision.integration.test.ts` cubre:

1. Happy path: 5 tablas tienen registros consistentes post-call.
2. Cama ocupada: `CONFLICT` + ningún registro creado.
3. Orden ya procesada: `CONFLICT` + ningún registro creado.
4. Error en paso 4 (mock): rollback completo, tablas 1-3 sin datos.
5. Concurrencia: dos calls simultáneas para la misma cama, solo una tiene éxito.

---

## Referencias

- CLAUDE.md §"Contrato RLS" — `withTenantContext` y `prisma.$transaction`
- ADR 0012 — `withEceContext` scoped a transacción
- `packages/trpc/src/routers/bridge-admision.router.ts` — implementación completa
- `packages/database/sql/65_ece_bridge_admision.sql` — triggers de validación
- NTEC Art. 17 (apertura del expediente hospitalario), Art. 42 (trazabilidad)
- Saga Pattern, Chris Richardson — motivación para NO usar saga en flujos síncronos
