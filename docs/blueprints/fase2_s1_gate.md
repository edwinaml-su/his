# Blueprint Sprint F2-S1 — Gate de Entrada Fase 2

**Proyecto:** HIS Multipaís — Inversiones Avante  
**Autor:** @PO — Chief Product Officer  
**Version:** 1.0.0  
**Fecha:** 2026-05-16  
**Branch origen:** `docs/fase2-workflows-ece-gs1`  
**Referencias:**
- `docs/backlog/fase2/00_index.md` — resumen ejecutivo backlog Fase 2
- `docs/backlog/fase2/02_as_arquitectura.md` — blueprint tecnico @AS
- `docs/backlog/fase2/03_epic_workflow_engine.md` — E.F2.1 Motor Workflow
- `docs/backlog/fase2/09_epic_cumplimiento.md` — E.F2.7 Firma Electronica
- `docs/backlog/fase2/10_dba_schema_integracion.md` — schema diff @DBA
- `docs/backlog/fase2/_insumos/README.md` — orden de aplicacion SQL
- ADR-F2-01 a ADR-F2-07 (en `02_as_arquitectura.md`)

---

## 1. Objetivo del Sprint

Dejar operacionales los tres cimientos sin los cuales **ningun documento ECE puede crearse, firmarse ni fluir** en Fase 2:

| Entregable | Por que es bloqueante |
|---|---|
| **Schema `ece` en Supabase staging** | Todas las tablas de documentos, workflow y firma dependen de el; sin el schema no hay dato persistible |
| **Firma electronica simple** | Art. 23 NTEC: todo acto clinico requiere firma con valor legal; sin ella los documentos no tienen validez |
| **Motor de workflow base** | Los routers ECE no pueden avanzar ni validar estados sin `withWorkflowContext` + tablas `flujo_*` sembradas |

Sprint F2-S1 es un **gate**: F2-S2 (Motor workflow completo + ECE Ficha Identificacion) no puede arrancar si cualquiera de estos tres entregables no pasa la DoD.

---

## 2. Scope

### Dentro del sprint

| # | Entregable | Peso SP | Responsable |
|---|---|---|---|
| S1.1 | SQL 55-63 aplicados en Supabase staging + `prisma generate` OK | 21 SP | @DBA + @Dev |
| S1.2 | Firma electronica simple — setup, validacion PIN, cache 15 min | 34 SP | @Dev + @AS |
| S1.3 | Motor workflow base — 4 routers + helpers `withWorkflowContext` + `canTransition` | 35 SP | @Dev |
| | **Total sprint** | **90 SP** | |

### Fuera del scope (explicitamente)

| Item | Sprint destino | Razon |
|---|---|---|
| Workflow Designer visual (React Flow, drag/drop, simulador) | F2-S16 | Alta complejidad UI; no bloquea el motor de datos |
| Documentos ECE clinicos (historia clinica, signos vitales, triaje ECE, etc.) | F2-S3+ | Dependen de que el motor base este estable |
| GS1 catalogos GTIN/GLN/GSRN | F2-S10 | No bloquea la firma ni el motor; tiene su propia pista |
| EPCIS event sourcing | F2-S10+ | Depende de catalogos GS1 |
| ECE Ficha de Identificacion NTEC (US.F2.3.1-6) | F2-S2 | Siguiente sprint; requiere motor base de este sprint |
| Script migracion `public.Patient` -> `ece.paciente` (ADR-F2-07) | F2-S2 | Requiere tablas del sprint actual aplicadas primero |
| Portal bedside scanning | F2-S13 | Depende de catalogos GS1 y dispensacion |

---

## 3. Archivos producidos — inventario de los 30 streams

Los streams 1-30 del PR `docs/fase2-workflows-ece-gs1` generaron los siguientes artefactos:

### 3.1 SQL (aplicar en orden a Supabase staging)

| Archivo SQL | Numero de migracion | Tablas clave | Stream origen |
|---|---|---|---|
| `_insumos/00_extensions.sql` | SQL-55 | `CREATE SCHEMA ece`, extensiones `pgcrypto`, `pg_trgm`, `uuid-ossp` | Stream 21 |
| `_insumos/01_catalogos.sql` | SQL-56 | `ece.institucion`, `ece.establecimiento`, `ece.servicio`, `ece.cama`, `ece.rol`, `ece.catalogo_valor` | Stream 22 |
| `_insumos/02_seguridad_personal.sql` | SQL-57 | `ece.personal_salud`, `ece.asignacion_rol`, `ece.firma_electronica`, `ece.perfil_acceso` | Stream 23 |
| `_insumos/03_paciente_maestro.sql` | SQL-58 | `ece.paciente`, `ece.identificador_paciente`, `ece.responsable_paciente`, `ece.afiliacion_isss` | Stream 24 |
| `_insumos/04_episodios.sql` | SQL-59 | `ece.episodio_atencion`, `ece.episodio_hospitalario`, `ece.asignacion_cama` | Stream 25 |
| `_insumos/05_motor_workflow.sql` | SQL-60 | `ece.tipo_documento`, `ece.flujo_estado`, `ece.flujo_transicion`, `ece.documento_rol`, `ece.documento_instancia`, `ece.documento_instancia_historial` | Stream 26 |
| `_insumos/06_documentos_clinicos.sql` | SQL-61 | 18 tablas de formularios ECE (`ece.historia_clinica`, `ece.signos_vitales`, `ece.triaje`, etc.) | Stream 27 |
| `_insumos/07_auditoria_seguridad.sql` | SQL-62 | `ece.bitacora_acceso`, `ece.bitacora_auditoria`, `ece.rectificacion`, `ece.supresion` + triggers inmutabilidad + RLS policies | Stream 28 |
| `_insumos/08_seed_workflows.sql` | SQL-63 | Seed de 18 tipos de documento + ~90 estados + ~120 transiciones + ~80 roles por documento | Stream 29 |

### 3.2 Modelos Prisma (nuevos o extendidos)

| Archivo | Modelos | Notas |
|---|---|---|
| `packages/database/prisma/schema.prisma` | Extender con modelos `EcePersonalSalud`, `EceFirmaElectronica`, `EceTipoDocumento`, `EceFlujoEstado`, `EceFlujoTransicion`, `EceDocumentoInstancia`, `EceDocumentoInstanciaHistorial` | Usar `@@schema("ece")` en cada modelo; requiere `multiSchema` preview feature |

### 3.3 Helpers TypeScript (nuevos)

| Archivo | Funcion exportada | Responsabilidad |
|---|---|---|
| `packages/trpc/src/ece/workflow-context.ts` | `withWorkflowContext(prisma, establecimientoId, input, callback)` | Analogo a `withTenantContext`; demota a `authenticated`; valida transicion; escribe historial y outbox |
| `packages/trpc/src/ece/workflow-engine.ts` | `canTransition(tx, tipoDocumentoId, estadoOrigenId, accion, rolId)` | Consulta `ece.flujo_transicion`; retorna `{ allowed, requiereFirma, transicionId }` |
| `packages/trpc/src/ece/firma-electronica.ts` | `validateFirma(tx, personalId, pinIngresado)` | SHA-256(PIN + salt) vs hash almacenado; retorna `firma_electronica.id` o lanza `TRPCError FORBIDDEN` |
| `packages/trpc/src/ece/ece-context.ts` | `withEceContext(prisma, establecimientoId, callback)` | RLS scope para `ece.*` usando `app.current_establecimiento_id` (separado de `app.current_org_id`) |

### 3.4 Routers tRPC (nuevos)

| Router | Procedures principales | Procedure base |
|---|---|---|
| `packages/trpc/src/ece/workflow-tipo-doc.router.ts` | `list`, `get`, `create`, `update`, `toggleActivo` | `tenantProcedure` + `requireRole(["ADMIN_ECE"])` para mutaciones |
| `packages/trpc/src/ece/workflow-estado.router.ts` | `list`, `upsert`, `delete` (solo si sin instancias activas) | `tenantProcedure` + `requireRole(["ADMIN_ECE"])` |
| `packages/trpc/src/ece/workflow-instance.router.ts` | `create`, `advance`, `get`, `listByEpisodio` | `tenantProcedure` (lectura abierta a roles clinicos); `advance` requiere validacion firma si `requiere_firma` |
| `packages/trpc/src/ece/firma-electronica.router.ts` | `setup` (configurar PIN inicial), `validate` (verificar antes de firmar), `reset` (admin solamente) | `protectedProcedure` para `setup`; `tenantProcedure` para `validate`; `requireRole(["ADMIN_ECE"])` para `reset` |

Todos los routers registrados en `packages/trpc/src/root.ts` (`_app.ts`) bajo namespace `ece.*`.

### 3.5 UI — Componentes y paginas (nuevas)

| Ruta Next.js | Componente principal | Funcion |
|---|---|---|
| `apps/web/src/app/(clinical)/configuracion/firma/page.tsx` | `FirmaSetupPage` | Flujo one-time de configuracion de PIN 6 digitos; validacion de fortaleza; confirmacion doble; instruccion Art. 23 NTEC |
| `apps/web/src/app/(clinical)/configuracion/workflows/page.tsx` | `WorkflowsListPage` | Lista de tipos de documento del establecimiento; estado activo/inactivo; acceso a detalle |
| `apps/web/src/app/(clinical)/configuracion/workflows/[tipoDocCode]/page.tsx` | `WorkflowDetailPage` | Vista de estados y transiciones de un tipo de documento; tabla con acciones, roles autorizadores y si requiere firma; modo lectura en S1, edicion en S16 |

### 3.6 Tests (nuevos)

| Archivo | Tipo | Cobertura minima |
|---|---|---|
| `packages/trpc/src/__tests__/workflow-engine.test.ts` | Unitario | `canTransition` todos los casos — transicion valida, rol incorrecto, accion inexistente, estado origen inexistente |
| `packages/trpc/src/__tests__/firma-electronica.test.ts` | Unitario | `validateFirma` — PIN correcto, PIN incorrecto, sin firma activa, salt mismatch |
| `packages/trpc/src/__tests__/workflow-tipo-doc.router.test.ts` | Integracion | `list` con filtros, aislamiento tenant (otro establecimiento no ve datos) |
| `packages/trpc/src/__tests__/workflow-instance.router.test.ts` | Integracion | `advance` valido, `advance` con rol incorrecto, `advance` sin firma cuando `requiere_firma=true` |
| `packages/trpc/src/__tests__/firma-electronica.router.test.ts` | Integracion | `setup` (PIN nuevo), `validate` correcto e incorrecto, `reset` solo por ADMIN_ECE |
| `apps/web/e2e/firma-setup.spec.ts` | E2E Playwright | Flujo completo configuracion PIN + validacion exitosa + error PIN incorrecto |

### 3.7 Documentos (este sprint)

| Archivo | Contenido |
|---|---|
| `docs/blueprints/fase2_s1_gate.md` | Este documento |
| `docs/adr/0010-ece-schema-separation.md` | ADR-0010 formalizando ADR-F2-01: schema `ece` separado de `public.*`, ACL via `public_patient_id` |
| `docs/15_production_runbook.md` | Seccion nueva: "ECE Staging: aplicar SQL 55-63 + verificacion post-deploy" |

---

## 4. Definition of Done del Sprint F2-S1

### 4.1 Criterios tecnicos (verificables en CI)

| # | Criterio | Como verificar |
|---|---|---|
| DoD-01 | SQL 55-63 (schema `ece`) aplicados en Supabase **staging** sin errores | `mcp__supabase__list_tables` muestra todas las tablas `ece.*`; `prisma generate` retorna 0 |
| DoD-02 | `npm run typecheck` pasa en verde (0 errores) | Log de CI workflow `ci.yml` |
| DoD-03 | `npm run lint` pasa en verde | Log de CI |
| DoD-04 | `npm run test` con coverage >= 80% en `packages/trpc` (modulos ECE nuevos) | Reporte vitest coverage |
| DoD-05 | E2E `firma-setup.spec.ts` verde en CI | Log Playwright (nightly o manual trigger) |
| DoD-06 | 4 routers nuevos (`workflow-tipo-doc`, `workflow-estado`, `workflow-instance`, `firma-electronica`) registrados en `root.ts` | `grep -r "ece\." packages/trpc/src/root.ts` muestra los 4 namespaces |
| DoD-07 | 3 UIs operativas en staging (firma setup, workflows listado, workflow detalle) | Screenshot manual o Playwright snapshot |
| DoD-08 | `withWorkflowContext` rechaza transicion de rol incorrecto con `TRPCError FORBIDDEN` | Test de integracion `workflow-instance.router.test.ts` caso negativo |
| DoD-09 | Aislamiento tenant: usuario de otro establecimiento no ve workflows ni firmas del primero | Test de integracion con 2 tenants distintos |
| DoD-10 | Runbook ECE staging publicado en `docs/15_production_runbook.md` | Seccion visible en el doc |
| DoD-11 | ADR-0010 aprobado (review @AE + @DBA, merge a main) | PR cerrado con reviews aprobadas |

### 4.2 Gates de salida (validacion humana — CTO + CMO Avante)

Antes de que @Orq declare F2-S1 cerrado y autorice el arranque de F2-S2, se requiere validacion presencial o virtual con:

| Rol | Validacion requerida |
|---|---|
| **CTO Avante** | Confirmar que ADR-0010 (schema `ece` separado) es aceptable para la arquitectura de largo plazo; revisar contrato RLS del schema `ece` con `withEceContext` |
| **CMO Avante** | Confirmar flujo de firma electronica simple (PIN 6 digitos, cache 15 min, hash SHA-256) cumple Art. 23 NTEC para fines de auditoria MINSAL; autorizar avance a documentos clinicos en F2-S2 |

**Criterio de bloqueo:** Si CTO o CMO no aprueban, F2-S2 no inicia. El equipo puede continuar en ramas de feature pero no mergea a `main` ni aplica DDL adicional en staging.

---

## 5. Riesgos del Sprint — Top 5

| # | Riesgo | Probabilidad | Impacto | Score | Mitigacion |
|---|---|---|---|---|---|
| **R-S1.1** | `multiSchema` Prisma preview + schema `ece` genera tipos en conflicto con `public.*` (naming collision en PascalCase) | Media (40%) | Alto — bloquea `prisma generate` y typecheck | 12/25 | Prefixar todos los modelos Prisma ECE con `Ece` (`EcePaciente`, `EceTipoDocumento`, etc.); validar antes del primer commit con `prisma db pull` en sandbox |
| **R-S1.2** | `SET LOCAL app.current_establecimiento_id` en `withEceContext` no aplica RLS si la query corre fuera del callback de transaccion (mismo bug que `withTenantContext`) | Alta (60%) | Alto — data leak cross-establecimiento | 15/25 | Test de integracion con 2 establecimientos ejecutado ANTES de merge a main; peer review @DBA obligatorio en `ece-context.ts` |
| **R-S1.3** | PIN hash SHA-256 sin pepper puede ser vulnerable a ataques de diccionario si se exfiltra la tabla `firma_electronica` | Media (30%) | Alto — compromiso de credenciales clinicas | 12/25 | Agregar `pepper` de entorno (`FIRMA_PEPPER` env var en Vercel) a la concatenacion `SHA-256(PIN + salt + pepper)`; documentar en ADR-0010 y runbook |
| **R-S1.4** | SQL-63 (`08_seed_workflows.sql`) con 18 tipos + ~310 filas seed falla si FK de roles o establecimientos no existe aun (orden de aplicacion incorrecta) | Media (35%) | Medio — bloquea seed pero no el schema | 9/25 | Aplicar estrictamente en orden 55→63; script de verificacion pre-seed que valida FKs con `SELECT count(*)` de cada tabla maestra antes del insert |
| **R-S1.5** | Cache de PIN 15 min en cookie HttpOnly server-side choca con el modelo stateless de Vercel Edge Functions si se despliega en ese runtime | Baja (20%) | Alto — firma no funciona en produccion | 8/25 | Usar `next/headers` cookies API (compatible con Node.js runtime, no Edge); confirmar `runtime = "nodejs"` en el route handler de firma antes de merge |

---

## 6. Cronograma sugerido — 2 semanas, 4 squads paralelos

### Semana 1 (dias 1-5)

| Dia | Squad A (@DBA + @Dev-1) | Squad B (@Dev-2) | Squad C (@Dev-3) | Squad D (@UIUX + @Dev-4) |
|---|---|---|---|---|
| **D1** | Aplicar SQL-55 a SQL-59 en staging; verificar `list_tables`; sync `schema.prisma` con modelos Ece* | Scaffolding `ece-context.ts` + `withEceContext`; test de aislamiento tenant (2 establecimientos) | Scaffolding `workflow-engine.ts` + `canTransition`; tests unitarios casos negativos | Maqueta `FirmaSetupPage` en Figma; validar con CMO |
| **D2** | Aplicar SQL-60 (motor workflow) + SQL-61 (docs clinicos); verificar FK integridad | `withWorkflowContext`: integracion con outbox Beta.15 (`DomainEvent.create` dentro de tx) | `workflow-tipo-doc.router.ts`: procedures `list` y `get` con RLS | Implementar `FirmaSetupPage` (formulario PIN + doble confirmacion) |
| **D3** | Aplicar SQL-62 (auditoria + RLS policies); revisar policies con `get_advisors` | `firma-electronica.ts`: `validateFirma` con pepper + tests unitarios; implementar cache PIN 15 min | `workflow-estado.router.ts`: `list` + `upsert` + guardas integridad | Implementar `WorkflowsListPage` (tabla tipo de documento + estado activo) |
| **D4** | Aplicar SQL-63 (seed 18 workflows); validar ~310 filas insertadas | `firma-electronica.router.ts`: `setup`, `validate`, `reset`; tests de integracion | `workflow-instance.router.ts`: `create` + `advance`; tests de integracion rol incorrecto | Implementar `WorkflowDetailPage` (tabla estados/transiciones); wirear a `workflow-estado.router` |
| **D5** | `prisma generate` final; typecheck verde; review @DBA de todos los archivos SQL | Registro de los 4 routers en `root.ts`; typecheck `packages/trpc` | E2E `firma-setup.spec.ts` Playwright; test aislamiento tenant cross-establecimiento | Review UI en staging con @CMO; iteraciones UX |

### Semana 2 (dias 6-10)

| Dia | Foco |
|---|---|
| **D6-7** | Integracion: correr `npm run test --coverage` y cerrar gaps hasta >= 80% en todos los modulos ECE nuevos |
| **D8** | Redactar `docs/adr/0010-ece-schema-separation.md`; actualizar seccion ECE en `docs/15_production_runbook.md`; actualizar `docs/26_trazabilidad_matrix.md` |
| **D9** | Demo interno: @Orq + Squad Leads ejecutan DoD-01 a DoD-09; firmar checklist |
| **D10** | **Gate review** con CTO + CMO: presentacion de 30 min; aprobacion o lista de blockers; si aprobado, merge a `main` y cierre formal F2-S1 |

---

## 7. Metricas a reportar al cierre del Sprint

| Metrica | Meta | Fuente |
|---|---|---|
| SQL 55-63 aplicados sin rollback | 9/9 | `mcp__supabase__list_migrations` |
| Tablas `ece.*` creadas en staging | 45 tablas | `mcp__supabase__list_tables` |
| `prisma generate` 0 errores | Si | Log CI |
| Cobertura de tests — `packages/trpc` (modulos ECE) | >= 80% lines | `npm run test:coverage` |
| Tests unitarios nuevos | >= 40 casos | Reporte vitest |
| Tests de integracion nuevos | >= 20 casos | Reporte vitest |
| E2E nuevos (`firma-setup.spec.ts`) | >= 6 escenarios | Reporte Playwright |
| Routers registrados en `root.ts` | 4 namespaces `ece.*` | Code review |
| Latencia p95 `workflow.instance.advance` bajo carga 50 usuarios | < 400 ms | Test de carga k6 (5 min, 50 VU) |
| Latencia p95 `firmaElectronica.validate` | < 300 ms | Test de carga k6 |
| Hallazgos de seguridad criticos (data leak cross-tenant) | 0 | Test de aislamiento tenant |
| ADR-0010 aprobado y mergeado | Si | PR GitHub |
| Aprobacion CTO + CMO documentada | 2/2 firmas | Acta en PR de cierre |

---

## 8. Trazabilidad — User Stories cubiertos en F2-S1

| US | Descripcion | Router / Archivo | DoD vinculado |
|---|---|---|---|
| US.F2.1.1 | Consultar catalogo tipos de documento del ECE | `workflow-tipo-doc.router.ts#list` | DoD-06 |
| US.F2.1.2 | Crear tipo de documento del ECE (admin) | `workflow-tipo-doc.router.ts#create` | DoD-06 |
| US.F2.1.3 | Configurar estados y transiciones de un documento | `workflow-estado.router.ts#upsert` | DoD-06 |
| US.F2.1.4 | Avanzar instancia de documento entre estados | `workflow-instance.router.ts#advance` | DoD-08 |
| US.F2.1.5 | Crear instancia de documento en estado borrador | `workflow-instance.router.ts#create` | DoD-06 |
| US.F2.7.1 | Configurar PIN de firma electronica | `firma-electronica.router.ts#setup` + `FirmaSetupPage` | DoD-05 |
| US.F2.7.2 | Validar PIN antes de firmar un documento | `firma-electronica.router.ts#validate` + `validateFirma` | DoD-08 |
| US.F2.7.3 | Reset de firma por administrador (ADMIN_ECE) | `firma-electronica.router.ts#reset` | DoD-09 |

**US cubiertos en F2-S1:** 8 de 277 totales de Fase 2 (3%)  
**SP entregados:** 90 de 1,532+ totales (5.9%)  
**SP de E.F2.1 completos en S1:** 35 de 122 (29%)  
**SP de E.F2.7 §1 completos en S1:** 21 de 171 (12%)

---

## 9. KPIs de Producto que este Sprint habilita

Estos KPIs no son medibles hasta que F2-S2+ completen los documentos clinicos, pero la instrumentacion base se instala en F2-S1:

| KPI | Instrumento instalado en S1 | Meta Fase 2 completa |
|---|---|---|
| % actos clinicos con firma electronica vinculada | Campo `firma_id` en `documento_instancia_historial` | 100% de documentos firmables |
| Tiempo ciclo borrador -> firmado por tipo de documento | `clock_timestamp()` en transiciones del historial | P95 < 4 horas (ambulatorio), P95 < 24 horas (hospitalario) |
| Transiciones rechazadas por rol incorrecto | Contador en `TRPCError FORBIDDEN` logueado en `bitacora_acceso` | < 2% del total de intentos |
| Latencia p95 mutacion `workflow.instance.advance` | Test k6 instalado en CI | < 400 ms bajo 50 usuarios concurrentes |
| Integridad bitacora de accesos | 0 gaps detectados en ventana 1 hora | Alerta SRE si gap > 0 |

---

## Apendice A — Orden de Aplicacion SQL en Supabase Staging

```
1. SQL-55  _insumos/00_extensions.sql      -- CREATE SCHEMA ece + extensiones
2. SQL-56  _insumos/01_catalogos.sql       -- maestros: institucion, establecimiento, rol
3. SQL-57  _insumos/02_seguridad_personal.sql -- personal_salud, firma_electronica, RBAC
4. SQL-58  _insumos/03_paciente_maestro.sql   -- paciente raiz NTEC
5. SQL-59  _insumos/04_episodios.sql          -- episodio_atencion, episodio_hospitalario
6. SQL-60  _insumos/05_motor_workflow.sql     -- motor de workflow: tipo_documento, flujo_*
7. SQL-61  _insumos/06_documentos_clinicos.sql -- 18 formularios ECE
8. SQL-62  _insumos/07_auditoria_seguridad.sql -- bitacoras + triggers inmutabilidad + RLS
9. SQL-63  _insumos/08_seed_workflows.sql     -- seed 18 tipos + estados + transiciones
```

Usar `mcp__supabase__apply_migration` para cada archivo. Verificar con `mcp__supabase__list_tables` despues de SQL-62 antes de aplicar SQL-63.

---

## Apendice B — Decisiones pendientes a resolver antes de D1

| Decision | Opciones | Quien decide | Impacto en S1 |
|---|---|---|---|
| PIN longitud y rotacion | 6 digitos sin rotacion vs 8 alfanumerico con 90 dias | CMO Avante | Afecta `FirmaSetupPage` y validador Zod |
| Pepper para SHA-256 | Env var `FIRMA_PEPPER` en Vercel | CTO Avante | Afecta `validateFirma` y mitigacion R-S1.3 |
| Schema integracion Opcion A vs B | Opcion A (@AS) vs Opcion B (@DBA) | CTO + @AS + @DBA | Define si `schema.prisma` tiene modelos `EcePaciente` separados o reusa `Patient` |

**Recomendacion @PO:** resolver estas tres decisiones en la primera sesion del sprint (D1 manana) para no bloquear a Squad A y Squad D.

---

— **@PO** | Chief Product Officer | Inversiones Avante | 2026-05-16
