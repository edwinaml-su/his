# HIS Multipaís — Inversiones Avante

**Sistema de Información Hospitalaria** multi-país, multi-organización, multi-moneda y multi-libro contable, tropicalizado para El Salvador.

> Estado (2026-08-18): **el alcance del MVP está implementado**, junto con la mayor parte de los módulos originalmente diferidos a fases posteriores — 152 routers tRPC (102 raíz + 50 ECE) y ~50 áreas funcionales en la UI. Quedan fuera, por decisión de arquitectura, DTE Hacienda (ADR 0006) y HL7/FHIR/DICOM (TDR §28); y sigue pendiente la notificación epidemiológica obligatoria a MINSAL. Ver [Alcance MVP](#alcance-mvp-fase-0--fase-1) y [Conformidad regulatoria](#conformidad-regulatoria-el-salvador) para el detalle verificado.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Runtime | Node.js 24.x (fijo en `engines`), npm 11.9 |
| Frontend | Next.js 16.3 (App Router, RSC) + React 19.2, Tailwind 3.4, Shadcn/ui, Lucide React |
| Backend | Next.js Server Actions + tRPC 11 (type-safe RPC) |
| Validación | Zod 3.25 |
| ORM | Prisma 5.22 |
| Base de datos | PostgreSQL 15 (Supabase managed) — **normalización 4NF** |
| Auth & Storage | Supabase Auth + Supabase Storage |
| Multi-tenancy | Row Level Security (RLS) por `organization_id` |
| Monorepo | Turborepo 2.9 + npm workspaces (9 workspaces) |
| Testing | Vitest 2.1 (unit), Playwright 1.60 (E2E), axe-core (a11y) |
| Observabilidad | Sentry 10 |
| CI/CD | GitHub Actions (12 workflows) · Vercel · imagen OCI en GHCR |

---

## Estructura del monorepo

```
his-multipais/
├── apps/
│   └── web/                 # Aplicación Next.js (App Router)
├── packages/
│   ├── database/            # Schema Prisma, migraciones, seeds
│   ├── domain/              # Entidades, agregados, eventos (DDD)
│   ├── application/         # Casos de uso, servicios de aplicación
│   ├── infrastructure/      # Adaptadores (Supabase, Prisma, gateways)
│   ├── contracts/           # DTOs, schemas Zod compartidos
│   ├── trpc/                # Routers tRPC
│   ├── ui/                  # Design system (Tailwind + Shadcn)
│   └── config/              # ESLint, TS, Tailwind preset compartidos
├── docs/                    # Arquitectura, blueprints, backlog, design system
├── .github/workflows/       # CI/CD
└── scripts/                 # Utilidades de desarrollo
```

---

## Arranque rápido

### Prerrequisitos
- Node.js ≥ 20
- npm ≥ 10
- Cuenta en [Supabase](https://supabase.com) (gratuita para desarrollo)

### Instalación

```bash
git clone <url>
cd HIS
npm install
cp .env.example .env.local
# completa las variables en .env.local con tus credenciales de Supabase
```

### Base de datos

```bash
npm run db:generate          # Genera el cliente Prisma
npm run db:migrate           # Aplica migraciones a Supabase
npm run db:seed              # Carga catálogos base (SLV, monedas, Triage Manchester)
```

### Desarrollo

```bash
npm run dev                  # Inicia todos los apps/packages en modo watch
```

La app estará disponible en `http://localhost:3000`.

---

## Documentación

| Documento | Contenido |
|---|---|
| [TDR](TDR_HIS_Multipais.md) | Términos de referencia (1923 líneas, 30 módulos) |
| [01_arquitectura_empresarial.md](docs/01_arquitectura_empresarial.md) | Análisis estratégico, RACI, KPIs, riesgos (@AE) |
| [02_arquitectura_software.md](docs/02_arquitectura_software.md) | Blueprint técnico, multi-tenancy, ADRs (@AS+@AT) |
| [03_blueprints_modulos.md](docs/03_blueprints_modulos.md) | Blueprints de los 30 módulos con BCs y agregados |
| [04_modelo_datos.md](docs/04_modelo_datos.md) | Modelo 4NF, ER conceptual, diccionario de datos (@DBA) |
| [05_backlog.md](docs/05_backlog.md) | 10 épicas, 74 user stories, 390 SP (@PO) |
| [06_roadmap.md](docs/06_roadmap.md) | Roadmap Fase 0 → Fase 7 con gates |
| [07_design_system.md](docs/07_design_system.md) | Tokens, componentes, accesibilidad WCAG 2.1 AA (@UIUX) |

---

## Alcance MVP (Fase 0 + Fase 1)

- ✅ Núcleo multi-entidad (país / organización / establecimiento / moneda / libro)
- ✅ Seguridad: Auth + RBAC + ABAC + auditoría inmutable + RLS
- ✅ Catálogos maestros parametrizables desde UI
- ✅ MPI (Master Patient Index) con dedupe y validación DUI/NIT/NIE
- ✅ ADT: admisión, traslados, altas, censo
- ✅ Triage Manchester (5 niveles, 52 flujogramas parametrizables)
- ✅ Hospitalización, emergencias, quirófanos (`/inpatient`, `/beds`, `/census`, `/emergency`, `/surgery`)
- ✅ Farmacia/eMAR y LIS (`/pharmacy`, `/emar`, `/bedside` BCMA, `/lis`)
- ✅ RIS — solicitud y modalidades de imagen (`/imaging`)
- ✅ Cuentas hospitalarias y contabilidad multi-libro (`/admin/finance`, `/admin/ledgers`, 6 reportes incl. consolidado MINSAL)
- ⏳ **PACS/DICOM** — solo está el RIS. `imaging-request.router.ts` cubre la *solicitud*; el almacenamiento DICOM y la reportería del radiólogo quedan fuera. Ligado al diferimiento de HL7/FHIR/DICOM (TDR §28)
- ⏳ **DTE Hacienda** — fuera del monolito **por decisión de arquitectura**, no por falta de tiempo: ADR 0006 lo define como servicio satélite separado (ver cabecera de `accounting.router.ts`)

---

## Conformidad regulatoria (El Salvador)

- ✅ Estructura para Ley de Protección de Datos Personales
- ✅ Validación DUI/NIT con dígito verificador
- ✅ Auditoría inmutable (10 años, hash chain SHA-256)
- ✅ Firma electrónica **de documentos clínicos** (`firma-electronica.router.ts`, PIN + recuperación con rate limit)
- ✅ Reportes ISSS — certificado de incapacidad (NTEC §22, Reglamento de Evaluación de Incapacidades)
- ✅ Reportería MINSAL — consolidado en `/admin/finance/reportes`
- ⏳ **Firma electrónica tributaria (DTE Hacienda)** — servicio satélite por ADR 0006 (ver §Alcance MVP). No confundir con la firma de documentos clínicos, que sí está
- ❌ **Notificación obligatoria MINSAL (vigilancia epidemiológica)** — **hueco real, sin decisión documentada.** Lo único parecido es `farmacovigilancia.router.ts`, que es otra cosa: reacciones adversas a medicamentos, no enfermedades de notificación obligatoria. No hay VIGEPES ni catálogo de notificables
- 🏛 Acreditación habilitación CSSP — trámite organizacional ante el Consejo Superior de Salud Pública, no una funcionalidad de software

> **Alcance de esta verificación (2026-08-18):** se comprobó la **existencia y el alcance declarado** de cada módulo (routers, páginas, cabeceras de código), no el cumplimiento normativo completo de cada NTEC. "Hay router y página" no equivale a "certificable". La profundidad funcional de los reportes no fue auditada.

---

## Equipo y gobernanza

Proyecto desarrollado bajo el modelo **SDLC Autónomo** de la Unidad de Transformación Digital de Inversiones Avante. Roles asignados según RACI documentado en [docs/01_arquitectura_empresarial.md](docs/01_arquitectura_empresarial.md):

- **Estrategia:** @Orq (orquestación), @AE (empresarial)
- **Arquitectura:** @AS (software), @AT (cloud), @DA (datos)
- **Producto:** @PO
- **Ejecución:** @Dev, @DBA, @UIUX
- **Calidad:** @QA, @QAF
- **Operaciones:** @SRE
- **BI:** @BIA, @BID, @DE

---

## Licencia

UNLICENSED — Software propietario de Inversiones Avante.
