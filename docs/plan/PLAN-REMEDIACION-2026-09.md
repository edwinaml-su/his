# Plan de remediación de pendientes — 2026-09-19

**Solicitado por:** Edwin Martinez. **Elaborado por:** @Orq (consolidando las auditorías del 2026-09-15 —cobertura—, 2026-09-18 —cableado UI→BD y drift— y 2026-09-18 —multi-tenant/país/moneda/libro—).

## Principio rector: la data nunca bloquea

Restricción explícita del pedido: **la migración/carga de datos no puede ser obstáculo del avance**. El plan la honra con cuatro reglas de diseño, todas ya probadas en el repo:

1. **Fallback seguro en código**: toda funcionalidad opera con defaults sensatos cuando su parametrización no está cargada (precedentes: SLA por defecto en `lab-sla.ts`, cargo `PENDIENTE_TARIFA` en vez de $0, rol `RESP_THERAPIST` inerte).
2. **Sincronización automática en lugar de carga manual**: donde un circuito está bloqueado por una tabla vacía, la remediación escribe el *sync* que la puebla desde datos que ya existen — el bloqueo de datos se convierte en código (caso emblema: `ece.personal_salud`).
3. **Migraciones de schema autocontenidas**: todo SQL numerado incluye su propio backfill idempotente; ninguno depende de una carga externa previa.
4. **Track de datos paralelo y no bloqueante**: la carga (tasas, SLA, precios, catálogos) solo **enciende** features que ya mergearon inertes; nunca es prerrequisito de un merge.

## En vuelo ahora (no forman parte del plan, son contexto)

| Ítem | Estado |
|---|---|
| PR #691 CC-0042 terapia respiratoria (S1) | CI verde — espera UAT Edwin |
| PR #692 remediación P0 cableado (SV historial + IPSG-2 UI) | CI verde — espera review Edwin |
| PR #693 CC-B (7 routers ece sin BYPASSRLS + roles corporativos, SQL 256 aplicado) | CI en curso |
| CC-A multipaís/moneda (tasa real, DPI, IVA por país, formatCurrency) | correcciones de revisión en curso; SQL 255 pendiente de aplicar |

## Ola R1 — Seguridad y activación de circuitos (sin dependencia de datos)

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R1.1 | **Sync automático `ece.personal_salud` ← `User`+roles** (cierra R03). Trigger o job idempotente que materializa el perfil ECE de todo usuario clínico con `his_user_id` poblado. | Convierte el data-blocker en código: activa de una vez IPSG-2 (emisión LIS de valores críticos), re-migración RLS de `certificacion.listCola`, y el pareo firma/asignaciones ECE. | M |
| R1.2 | **~11 routers ece "mixtos" → `withEceContext`** (los 7 puros cerraron en CC-B). | Solo código; el patrón y las trampas (AuditLog, policies) ya están documentados por CC-B. | M |
| R1.3 | **Barrido `where:{id}` sin org en routers legacy** — patrón del gap confirmado en `patient.update` (se cierra en CC-A); auditar los demás procedures de patient y los routers hermanos de la misma época. | Solo código + tests. | M |
| R1.4 | **SSO-config real o retiro**: hoy guarda a localStorage y el login lee mocks de env. Decisión binaria: tabla parametrizable por org, o retirar la página y dejar la config en env documentada. | Solo código. **Decisión Edwin requerida.** | S–M |
| R1.5 | **Capa BI sql/48-49 a prod** (rol `bi_reader` no existe). | Son roles/grants — no toca datos. | S |

## Ola R2 — Multipaís restante (todo con fallback SV)

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R2.1 | **TZ/locale por organización**: helper central que resuelve `Country.defaultTzId`/`defaultLocale` de la org (ya modelados y sembrados) con fallback `America/El_Salvador`/`es-SV`. Barrido primero en trpc (`abac/atributos`, `turno` UTC-6, `audit-outlier`, `imaging-request`), luego web por módulos (294 ocurrencias — en olas, no big-bang). | Fallback = comportamiento actual exacto; ningún dato nuevo requerido. | L (por olas) |
| R2.2 | **`locale.currentLocale` lee `Country` real** (hoy retorna SV/USD estático). | Fallback SV si org sin país. | S |
| R2.3 | **`PatientAccountService.currencyId` explícito** (hoy implícito por lista): columna nullable + escritura en `capturarCargo` + backfill en el propio SQL desde la lista de precios. | Nullable + backfill autocontenido ⇒ cero dependencia de carga. | S |
| R2.4 | **Feed de tasas** (BCR stub / Banguat TODO): se mantiene **manual** vía `/admin/exchange-rates` — CC-A ya hace que el runtime exija tasa vigente (fail-closed). El feed automático es mejora, no bloqueo. | La UI manual ya existe. | Diferible |

## Ola R3 — Drift de páginas y deuda de producto

| # | Ítem | Nota | Esfuerzo |
|---|---|---|---|
| R3.1 | Consolidar `/ece/rectificacion` → `/ece/rectificaciones` (redirect, precedente /ece/triaje). | Solo código. | S |
| R3.2 | `/historia-clinica-ambulatoria`: sidebar + quitar casts `(trpc as any)` stale (router ya mergeado). | Solo código. | S |
| R3.3 | Huérfanas cableadas sin entrada (`/pathology`, `/audit-dashboard`, `/ece/comite`, `/ece/calidad-documental`, `/ece/registro-retroactivo`): dar entrada en sidebar o retirar. | **Decisión @PO/Edwin por página.** | S |
| R3.4 | Portal paciente: dashboard real (las secciones citas/recetas/resultados ya existen). | Solo código. | M |
| R3.5 | `Drug.srs*` al schema.prisma (declarar 20 columnas que YA existen en prod — es sincronizar el modelo, no migrar data). | Cero DDL. | S |
| R3.6 | Enum/SQL de reconstrucción: barrido de scripts sql/ legacy cuya definición difiere de prod (patrón sql/89 CONFIRMED) — solo cabeceras/notas, sin tocar prod. | Documental. | S |

## Ola R4 — Calidad e infraestructura

| # | Ítem | Diseño anti-bloqueo | Esfuerzo |
|---|---|---|---|
| R4.1 | **k6 contra stack efímero** (el mismo docker-compose de E2E con seed sintético determinista) — NO exige clonar datos de prod. Objetivo: validar el techo estimado de 40–80 usuarios concurrentes y medir la contención del audit hash chain bajo escritura concurrente. | Seed sintético ⇒ sin dependencia de data real. | M |
| R4.2 | Fijar región de Vercel junto a Supabase us-west-2 (1 línea en vercel.json). | Config. | XS |
| R4.3 | `packages/ui`: script `test` + verificación de que sus tests corren en CI; revisar `include` estrechos de vitest. | Solo config. | S |
| R4.4 | Triage de la suite E2E nightly (fallos conocidos acumulados) — por lotes, aprovechando el stack GoTrue ya verde en @smoke. | Sin data real: usa el seeder determinista. | M |
| R4.5 | MFA staff: **encender la política** (mecanismo ya cableado en layouts). | Config + UAT. **Decisión Edwin.** | S |

## Track D — Datos (paralelo permanente, solo "enciende")

Ninguno de estos ítems es prerrequisito de ninguna ola; cada uno activa una feature que ya mergeó con fallback:

- Tasas de cambio (activa multimoneda real — hasta entonces todo es USD funcional y nada se rompe).
- SLA de lab/imágenes/TR (hasta entonces gobiernan los defaults de código).
- `ece.personal_salud` — **se elimina como carga manual si R1.1 se aprueba** (pasa a sync).
- GLN/precios pendientes de Code Castle; listas de precios de países futuros; países/geo/feriados adicionales (CRUD `/admin/countries` ya existe; GT queda sembrado por SQL 255).
- Membresías de los roles nuevos (CONTRALOR_CORP, DIR_PAIS, SUPER_ADMIN cross-org, 12+ roles de CC-0036) — asignación manual de Edwin.

## Fuera de alcance deliberado (decisiones ya tomadas — no re-abrir sin CC)

- **Multi-libro operativo** (asientos en HIS): la contabilidad real va al ERP vía hub de eventos; el modelo Ledger queda como está.
- **Consumidor del hub de eventos → Odoo**: fase de integración propia (decisión 2026-09-16).
- **DTE (§23)** y **HL7/FHIR/DICOM (§28)**: diferidos del MVP.
- **Workflow designer publish/rollback** al motor vivo: decisión Edwin 2026-08-28.
- **TR S2–S4**: fases del REQ-HIS-TR-001, se planifican como CC propio, no como remediación.

## Decisiones que solo Edwin puede destrabar

1. UAT de #691/#692/#693 (+ CC-A cuando abra).
2. R1.1 sync `personal_salud` — aprobar el diseño (es la llave de IPSG-2).
3. R1.4 SSO-config: tabla real vs retiro.
4. R3.3 destino de las 5 páginas huérfanas.
5. R4.5 encender MFA staff.
6. §15 honorarios (parámetros de convenios) — bloquea afinamiento de CC-0036, no este plan.

## Secuencia propuesta

**R1 → R2 → R3 → R4**, con Track D corriendo en paralelo desde el día 1. R1.1 primero de todo: es el único ítem que convierte un bloqueo de datos en código y desbloquea un circuito de seguridad del paciente (IPSG-2) ya construido de punta a punta.
