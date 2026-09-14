---
name: pre-pr-review
description: Revisión con contexto fresco ANTES de abrir un PR del HIS — lanza un agente revisor independiente sobre el diff contra origin/main y verifica la checklist de lecciones pagadas del repo (RLS, @map en raw SQL, payloads.ts, SQLs aplicados, tests que corren de verdad). Invocar al terminar cualquier cambio de código y antes de `gh pr create`.
---

# Revisión pre-PR con contexto fresco

Quien escribió el código no lo revisa: lanza un agente independiente (subagente
`Explore` o `general-purpose`, contexto limpio) con el diff completo
(`git diff origin/main...HEAD`) y este brief. El revisor NO conoce la intención
— solo el diff, esta checklist y el derecho a leer el repo. Reporta hallazgos
con file:line; el autor decide y corrige antes de abrir el PR.

## Checklist (cada punto viene de un incidente real del repo)

1. **RLS**: toda lectura/escritura tenant-scoped nueva usa `withTenantContext`
   (tablas Prisma) o `withEceContext` (tablas ece.* — GUC distinto, no los
   mezcles). Un `prisma.<tabla>.findMany` directo en un router es hallazgo.
2. **Raw SQL respeta `@map`**: si el diff tiene `$queryRawUnsafe`/`$executeRaw`
   o seeds .mjs con INSERT/UPDATE, verificar cada columna contra schema.prisma
   — columnas `@map`eadas van en snake_case (`gtin_fisico`, no `"gtinFisico"`).
   Verificar también tipos reales antes de castear (`::uuid` sobre columnas
   TEXT ha roto prod).
3. **`@updatedAt` sin default en BD**: INSERTs crudos a tablas Prisma deben
   incluir `"updatedAt"` explícito (la BD efímera de CI nace de `prisma db
   push` y esa columna no tiene default).
4. **payloads.ts**: si el diff toca `packages/contracts/src/events/payloads.ts`,
   marcar el PR como "merge secuencial" y correr
   `npm -w @his/contracts run typecheck` como verificación puntual.
5. **SQLs numerados**: número libre (no colisiona), marcado
   "APLICADO a prod — NO re-aplicar" solo si de verdad se aplicó,
   `ALTER TYPE ... ADD VALUE` en archivo separado sin transacción,
   `SET search_path` en toda función nueva, condicionales `to_regclass` si el
   objeto puede no existir en la BD efímera de CI.
6. **schema.prisma sincronizado**: si el SQL agrega tablas/columnas que el
   código TS usa vía Prisma, el modelo debe venir en el mismo diff (+ nota de
   `prisma generate`).
7. **Enums Zod espejados**: un vocabulario ampliado en BD/router debe ampliarse
   también en los z.enum de formularios cliente (incidente tipoGlnEnum).
8. **Tests que corren de verdad**: los tests nuevos aparecen en la salida de
   vitest (no víctimas de un `include` estrecho); si el reporte dice "verde"
   sobre algo que no se ejecutó (E2E sin stack), debe decirlo explícitamente.
9. **Roles/gates**: todo procedure nuevo con efecto de escritura lleva
   `requireRole`/`abacGuard` coherente con sus hermanos de dominio (incidente
   scanItem: extender alcance financiero sin revisar el candado es hallazgo).
10. **Adecuar legacy, no duplicar**: páginas o routers nuevos que dupliquen un
    dominio existente (`/ece/X` vs `/X`) son hallazgo salvo justificación.

## Salida esperada del revisor

Lista de hallazgos `[severidad] file:line — qué y por qué`, o "sin hallazgos".
El autor corrige lo que acepta, documenta lo que rechaza, y recién entonces
abre el PR (con `gh pr create`), citando en el cuerpo si hubo hallazgos y cómo
se resolvieron.
