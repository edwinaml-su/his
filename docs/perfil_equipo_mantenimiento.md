# Perfil del equipo de mantenimiento y seguimiento — HIS Avante

> Insumo para la propuesta. El perfil NO se deriva de un wishlist genérico sino de
> lo que el sistema **realmente exigió** en la remediación del drift schema↔SQL
> (2026-06-10/11): 28 routers rotos contra el DDL vivo, invisibles para typecheck y
> tests mockeados. Ver `docs/uat/e2e-2026-06-10/inventario_drift_ece.md`,
> `estimacion_y_harness.md` y `bloqueantes_remediacion.md`.

## Por qué importa el perfil (lección pagada)
El bug raíz de toda la remediación fue **SQL crudo escrito contra un esquema que
cambió**, que el `typecheck` no ve (el SQL vive en template strings) y los tests
**no atrapan** (mockean `$queryRaw`/`$executeRaw`). Un perfil sin profundidad de
PostgreSQL + testing de integración real **reintroduce exactamente esa clase de
bug** — y aquí "bug" puede significar un certificado de defunción que no se emite o
una pulsera de paciente que no valida. **Esa es la competencia que separa
"mantenerlo" de "romperlo lentamente".**

## Perfil núcleo (el lead — 1 persona)
**Senior Full-Stack TypeScript con profundidad REAL en PostgreSQL y dominio salud.**
No es un codebase para semi-senior: el drift, el RLS multi-tenant y el peso
regulatorio (NTEC/JCI/ISSS) exigen criterio, no solo ejecución.

## Competencias críticas (con el porqué concreto)
| Competencia | Por qué — evidencia de la remediación |
|---|---|
| **PostgreSQL crudo**: CHECK, FK, triggers, enums, RLS, GUCs (`SET LOCAL`), transacciones/savepoints, `information_schema`/`pg_constraint` | El bug raíz. Los CHECK contradictorios, los triggers IPSG.1/estado-log, `app.current_user_id` como FK — todo vive en SQL, **no** en Prisma. |
| **Next.js 14 App Router + tRPC v11** (RSC, layouts, error boundaries) | El P0 de agotamiento del pool y los error boundaries fueron exactamente esto. |
| **Prisma 5 + disciplina schema.prisma ↔ SQL** | El drift schema/SQL es el gotcha permanente; los archivos `sql/` numerados son fuente de verdad. |
| **Supabase ops**: pooler (transaction vs session mode), RLS, Vault, MCP, migraciones por SQL numerado | El P0 de conexiones + las migraciones 165–168 aplicadas a prod. |
| **Testing de INTEGRACIÓN contra BD real** (no solo mocks) | El harness (`packages/trpc/src/__tests__/integration/`) atrapó **4 bugs de runtime** que los dry-runs + tests mockeados no veían. Quien mantenga **debe** entenderlo y extenderlo, o el drift vuelve. |
| **Dominio clínico + regulatorio SV**: NTEC, JCI/IPSG, ISSS, GS1 healthcare | Certificado de defunción, GSRN de pulsera, hash chain de auditoría: código mal = riesgo de paciente + legal. |
| **Multi-tenancy RLS**: `withTenantContext` / `withWorkflowContext`, BYPASSRLS, demote a `authenticated` | Seguridad crítica; bypassearlo es un hallazgo de seguridad, no un detalle. |
| **Git/CI disciplina**: trunk-based, SSH (nunca PAT), resolver conflictos, gates Turborepo, Vercel, coverage ≥80% | El conflicto del PR #470 (`eh.id` vs `eh.episodio_id`) lo confirmó: un merge mal resuelto reintroduce drift. |
| **Español (es-SV)** | Todo el proyecto: docs, commits, identificadores de dominio. |

## Forma realista del equipo (un perfil no cubre todo)
30 módulos / ~145 routers / regulado → el mínimo sostenible para **mantenimiento +
seguimiento**:

| Rol | Foco | Por qué |
|---|---|---|
| **1 Lead full-stack senior** | Arquitectura + los casos difíciles | El perfil núcleo de arriba. |
| **1 con sesgo Backend/DBA** | SQL crudo, RLS, triggers, performance, migraciones | Es el frente de mayor riesgo y donde estuvieron **todos** los bugs de drift. |
| **1 QA/SDET** que domine **integración contra BD real** | Extender el harness, E2E, no solo unit mockeado | Si solo hace unit mockeado, el drift **no se atrapa**. Es el cuello de botella. |
| **Dominio clínico/regulatorio** (part-time / consultor) | NTEC / JCI / ISSS / GS1 | Valida que el código cumpla la norma y sea seguro para el paciente. |

## El no-negociable
Si el perfil **no domina (a) PostgreSQL crudo y (b) testing de integración contra
BD real**, el sistema se degrada en silencio: cada cambio puede escribir SQL contra
un esquema que ya no coincide, pasar CI verde, y reventar al primer uso real
(latente, como pasó con quirófano). El harness de integración es la red de
seguridad que hace mantenible este codebase — mantenerlo y extenderlo es parte del
rol, no un extra.

## Señales de que el perfil es insuficiente
- "Arreglé el router y los tests pasan" sin haberlo corrido contra la BD real.
- Modelar solo con Prisma sin leer el DDL vivo (`information_schema` / `pg_constraint`).
- Relajar/duplicar un `CHECK` o tocar RLS sin entender el contrato `withTenantContext`.
- Resolver un conflicto de merge en un router clínico sin verificar contra el esquema.
