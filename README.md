# HIS Multipaís — Inversiones Avante

**Sistema de Información Hospitalaria** multi-país, multi-organización, multi-moneda y multi-libro contable, tropicalizado para El Salvador.

> Estado: **MVP Fase 0 + Fase 1** en construcción. Documentación arquitectónica completa para los 30 módulos del TDR; código de los módulos restantes en fases posteriores.

---

## Stack tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | Next.js 14 (App Router, RSC), Tailwind CSS, Shadcn/ui, Lucide React |
| Backend | Next.js Server Actions + tRPC (type-safe RPC) |
| Validación | Zod |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL 15+ (Supabase managed) — **normalización 4NF** |
| Auth & Storage | Supabase Auth + Supabase Storage |
| Multi-tenancy | Row Level Security (RLS) por `organization_id` |
| Monorepo | Turborepo + npm workspaces |
| Testing | Vitest (unit), Playwright (E2E), axe-core (a11y) |
| CI/CD | GitHub Actions |

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
- ⏳ Hospitalización, emergencias, quirófanos → **Fase 3** (blueprint listo)
- ⏳ Farmacia/eMAR, LIS, RIS/PACS → **Fase 4** (blueprint listo)
- ⏳ Cuentas hospitalarias, DTE, contabilidad multi-libro → **Fase 5** (blueprint listo)

---

## Conformidad regulatoria (El Salvador)

- ✅ Estructura para Ley de Protección de Datos Personales
- ✅ Validación DUI/NIT con dígito verificador
- ✅ Auditoría inmutable (10 años, hash chain SHA-256)
- ⏳ Firma electrónica (DTE Hacienda) — Fase 5
- ⏳ Notificación obligatoria MINSAL (vigilancia epidemiológica) — Fase 6
- ⏳ Reportes ISSS — Fase 5
- ⏳ Acreditación habilitación CSSP — al cierre

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
