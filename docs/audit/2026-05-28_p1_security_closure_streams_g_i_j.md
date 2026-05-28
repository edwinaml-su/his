# Cierre verificado — 8 P1 ALTO (Streams G, I, J)

**Fecha verificación:** 2026-05-28
**Verificado por:** @Dev
**Estado:** TODOS CERRADOS en `main`

---

## Resumen de estado

| Código | Stream | Descripción | Estado | Commit/PR |
|---|---|---|---|---|
| HG-22 | G | `firma.status` falsos positivos / procedure inexistente | CERRADO | `firma-electronica.router.ts` line 940 (incluido en PR #226) |
| HI-06 | I | Inbound UUID libre — `establecimiento_id`/`registrado_por` sin `.uuid()` | CERRADO | PR #290 (`efb8678`) |
| HI-12 | I | MedicationForm `loteVencimiento` falla Zod `datetime({offset:true})` | CERRADO | PR #290 (`efb8678`) |
| HI-20 | I | Staff GSRN `Math.random()` — no criptográfico | CERRADO | PR #290 (`efb8678`) |
| HI-27 | I | Inventory `alert()` nativo browser | CERRADO | PR #290 (`efb8678`) |
| HJ-20 | J | TOTP replay sin contador (RFC 6238 §5.2) | CERRADO | PR #226 (`33b7910`) |
| HJ-30 | J | PIN merge-queue enviado texto plano | CERRADO | PR #226 (`33b7910`) |
| HJ-31 | J | `confirmEceMerge` sin quorum de roles distintos | CERRADO | PR #287 (`a6b2239`) |

---

## Detalle por hallazgo

### HG-22 — `firma.status` procedure inexistente

**Fix:** `packages/trpc/src/routers/firma-electronica.router.ts:940`

Procedure `status: protectedProcedure.query(...)` implementado. Consulta
`ece.personal_salud` + `ece.firma_electronica` y retorna:
```ts
{ hasPin: boolean, revoked: boolean, locked: boolean }
```
- `hasPin: true` solo cuando `revoked_at IS NULL` — elimina el falso positivo
  del audit donde el wizard siempre mostraba "sin firma activa".
- `@ts-expect-error` en `setup/page.tsx` eliminado.

**SQL pendiente apply:** ninguno (tablas ya existentes en prod).

---

### HI-06 — GS1 Inbound UUID libre

**Fix:** `packages/contracts/src/schemas/gs1-inbound.ts:63-64`

```ts
establecimiento_id: z.string().uuid().optional(),
registrado_por: z.string().uuid().optional(),
```
Server: helpers `resolveEstablecimientoId(ctx, override?)` +
`resolvePersonalSaludId(prisma, userId)` derivan ambos del tenant context.
UI: bloque "Contexto ECE" eliminado de `gs1/inbound/page.tsx`.

---

### HI-12 — MedicationForm `loteVencimiento` TZ shift

**Fix:** `apps/web/src/app/(admin)/gs1/medicamentos/_components/medication-form.tsx`

- Form envía `"YYYY-MM-DD"` puro (sin `toISOString()`).
- Router: `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` + SQL `::date`.
- Elimina shift de -1 día en UTC-6.

---

### HI-20 — Staff GSRN `Math.random()`

**Fix:** `packages/trpc/src/routers/staff-gsrn.router.ts:17,34`

```ts
import { randomInt } from "node:crypto";
// ...
const random5 = randomInt(0, 100000).toString().padStart(5, "0");
```

---

### HI-27 — Inventory `alert()` nativo

**Fix:** `apps/web/src/app/(admin)/inventory/alertas/page.tsx:68-73`

`alert()` reemplazado por Toast del design system (`@his/ui`).

---

### HJ-20 — TOTP replay sin contador

**Fix:** `packages/trpc/src/routers/mfa.router.ts:334-338`
**Schema:** `packages/database/prisma/schema.prisma` — `UserCredential.lastUsedTotpStep BigInt?`
**SQL aplicado:** `packages/database/sql/110_mfa_replay_prevention.sql`

El router rechaza tokens con `step === cred.lastUsedTotpStep`.
`verifyTotp()` retorna `{ matched: true; step: bigint }` para persistencia.

---

### HJ-30 — PIN merge-queue texto plano

**Fix:** `packages/trpc/src/routers/patient-dedup.router.ts`

El PIN nunca se almacena ni viaja en texto plano. `confirmEceMerge` recibe
`{ firmante1: { userId, pin }, firmante2: { userId, pin } }` y verifica
cada PIN contra `ece.firma_electronica.pin_hash` vía `argon2.verify()`.

---

### HJ-31 — Quorum de roles

**Fix:** `packages/trpc/src/routers/patient-dedup.router.ts:119-171`

Helper `assertQuorumOrThrow` — 3 reglas: personal distinto, rol ECE activo,
roles distintos. Ver `docs/audit/2026-05-26_hj31_closure.md` para detalle.

---

## SQLs pendientes de apply

Ninguno nuevo. El único SQL de este conjunto (`110_mfa_replay_prevention.sql`)
ya fue aplicado en el sprint de Ola 4.

---

## Tests unitarios relevantes

- `packages/trpc/src/routers/__tests__/patient-dedup.router.test.ts` — 21/21 verde (HJ-30/31)
- `packages/trpc/src/routers/__tests__/mfa.router.test.ts` — cubre HJ-20
- `packages/contracts/src/schemas/__tests__/gs1-inbound.test.ts` — cubre HI-06
