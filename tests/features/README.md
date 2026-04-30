# Features BDD — HIS Multipaís

> Owner: **@QAF — Quality Analyst (BDD)**
> Idioma: **es-SV** (`# language: es` al inicio de cada `.feature`)
> Convención: Gherkin estándar — Característica / Antecedentes / Escenario / Esquema del escenario / Ejemplos.

---

## 1. Estructura

```
tests/features/
├── 01-multi-entidad/
│   ├── seleccion-organizacion.feature
│   └── moneda-funcional.feature
├── 02-seguridad/
│   ├── autenticacion.feature
│   ├── autorizacion-rbac.feature
│   ├── auditoria.feature
│   └── break-the-glass.feature
├── 03-catalogos/
│   ├── crud-catalogo.feature
│   └── i18n-catalogo.feature
├── 04-mpi/
│   ├── registro-paciente-sv.feature
│   ├── busqueda-paciente.feature
│   ├── deduplicacion.feature
│   ├── alergias-criticas.feature
│   └── consentimiento.feature
├── 05-adt/
│   ├── admision-emergencia.feature
│   ├── admision-programada.feature
│   ├── traslado-interno.feature
│   ├── alta-medica.feature
│   ├── defuncion.feature
│   └── censo-camas.feature
├── 06-triage-manchester/
│   ├── triage-adulto.feature
│   ├── triage-pediatrico.feature
│   ├── re-triage.feature
│   ├── tiempos-maximos.feature
│   └── codigos-rojos.feature
└── 07-localizacion-sv/
    ├── validacion-dui.feature
    ├── validacion-nit.feature
    └── feriados-sv.feature
```

---

## 2. Cómo ejecutar los `.feature`

Los archivos están escritos como **documentación viva** y como **casos de prueba ejecutables**. Hay tres modos de uso:

### 2.1 Manual (QA exploratorio)

Cada `Scenario` se puede ejecutar manualmente en el ambiente de testing siguiendo paso a paso los `Dado / Cuando / Entonces`. Ideal para **smoke testing** previo a Sprint Review y para entrenamiento de super-usuarios.

### 2.2 Cucumber.js + step definitions (recomendado a futuro)

```bash
pnpm add -D @cucumber/cucumber ts-node typescript
# Estructura sugerida:
# tests/
# ├── features/        ← este directorio (no se toca)
# ├── steps/           ← step definitions en TypeScript
# └── support/         ← world, hooks, fixtures
```

Comando:

```bash
pnpm cucumber-js tests/features --require tests/steps --require tests/support --tags "@critical and not @wip"
```

### 2.3 playwright-bdd (E2E con Playwright)

Si el equipo decide ejecutar los escenarios contra la app desplegada:

```bash
pnpm add -D playwright-bdd
npx bddgen --features ./tests/features --steps ./tests/steps
pnpm playwright test
```

> Decisión final del runner pertenece a **@QA** (automatización técnica). @QAF mantiene los `.feature` como contrato funcional.

---

## 3. Convenciones

### 3.1 Idioma y terminología
- **es-SV** obligatorio. Los keywords usan español: `Característica`, `Antecedentes`, `Escenario`, `Esquema del escenario`, `Ejemplos`, `Dado`, `Cuando`, `Entonces`, `Y`, `Pero`.
- Terminología clínica alineada al TDR (§8 ADT, §9 Manchester) y al backlog (`docs/05_backlog.md`).
- Códigos de niveles Manchester en español: `Rojo, Naranja, Amarillo, Verde, Azul`.

### 3.2 Estilo Gherkin
- **Lenguaje declarativo, no imperativo.** Los pasos describen **qué** ocurre desde la perspectiva del usuario, no **cómo** lo hace la UI.
  - Mal: `Cuando hago clic en el botón con id "btn-save"`.
  - Bien: `Cuando guardo el registro`.
- **Antecedentes** solo con preconditions verdaderamente comunes a todos los escenarios.
- **Esquema del escenario + Ejemplos** para matrices (DUI, NIT, transiciones de cama, niveles Manchester).

### 3.3 Tags

| Tag           | Uso                                                                 |
|---------------|----------------------------------------------------------------------|
| `@critical`   | Crítico para go-live MVP. Bloquea release si falla.                  |
| `@regression` | Suite completa antes de cada release.                                |
| `@smoke`      | Subset rápido (~5 min) para CI de cada PR.                           |
| `@a11y`       | Validación de accesibilidad WCAG AA.                                 |
| `@wip`        | Escenario en construcción, excluido del CI por defecto.              |
| `@audit`      | Verifica registro en `audit_log` con cadena de hash.                 |
| `@validation` | Reglas de negocio / validaciones de input.                           |
| `@a11y`       | Accesibilidad.                                                       |

Tags por dominio: `@mpi`, `@adt`, `@triage`, `@security`, `@catalog`, `@localization`, `@es-SV`.

### 3.4 Cabecera obligatoria por feature

Cada `.feature` comienza con un comentario que indica:
- Épica del backlog (E0–E9).
- Historias cubiertas (US-x.y).
- Sección TDR.
- Persona principal.
- Valor de negocio.

### 3.5 Manejo de ambigüedades

Donde el comportamiento exacto requiere validación con super-usuario clínico/fiscal/operativo, se incluye comentario:

```gherkin
# TODO refinar con super-usuario clínico:
# (descripción específica del punto a refinar)
```

**No se inventan reglas no documentadas** (careful-coding). Estos TODO se rastrean para refinamiento en Sprint Planning.

---

## 4. Mapa de cobertura: Backlog ↔ Feature ↔ Scenario

| Historia (US) | Épica | Feature                                                     | Scenarios principales |
|---------------|-------|-------------------------------------------------------------|------------------------|
| US-0.x        | E0    | (cubiertos por @QA con tests técnicos: lint, build, CI)     | n/a                   |
| US-1.1        | E1    | `01-multi-entidad/moneda-funcional.feature`                 | Moneda funcional, validación país activo |
| US-1.2        | E1    | `01-multi-entidad/seleccion-organizacion.feature`           | Jerarquía y selector |
| US-1.3        | E1    | `01-multi-entidad/moneda-funcional.feature`                 | Tipos de tasa, histórico |
| US-1.5        | E1    | `01-multi-entidad/seleccion-organizacion.feature`           | Selector contexto, persistencia |
| US-1.6        | E1    | `01-multi-entidad/moneda-funcional.feature`                 | Funcional vs presentación |
| US-1.7        | E1    | `01-multi-entidad/seleccion-organizacion.feature`           | RLS bloqueo cross-org |
| US-2.1        | E2    | `02-seguridad/autenticacion.feature`                        | Login básico, política |
| US-2.2        | E2    | `02-seguridad/autenticacion.feature`                        | MFA TOTP, enrolamiento, códigos respaldo |
| US-2.3        | E2    | `02-seguridad/autorizacion-rbac.feature`                    | Roles base, UI esconde acciones |
| US-2.4        | E2    | `02-seguridad/autorizacion-rbac.feature`                    | ABAC servicio/turno |
| US-2.5        | E2    | (pendiente — SSO en Should, post-S2) — TODO                 | TODO @wip |
| US-2.6        | E2    | `02-seguridad/autenticacion.feature`                        | Sesión idle, cierre forzado |
| US-2.7        | E2    | `02-seguridad/break-the-glass.feature`                      | Activación, justificación, expiración, abuso |
| US-2.8        | E2    | `02-seguridad/auditoria.feature`                            | Captura, búsqueda, inmutabilidad, hash chain |
| US-2.9        | E2    | `04-mpi/consentimiento.feature`                             | Captura, versionado, revocación |
| US-2.10       | E2    | `02-seguridad/autenticacion.feature`                        | Política contraseñas |
| US-2.11       | E2    | (cubierto por @QA: TLS/cifrado en infra)                    | n/a |
| US-3.1        | E3    | (geo: cubierto en `04-mpi/registro-paciente-sv.feature`)    | dept/munic en alta paciente |
| US-3.2        | E3    | `07-localizacion-sv/validacion-dui.feature` y `validacion-nit.feature` | Tipos doc-id |
| US-3.3        | E3    | (cubierto en `05-adt/alta-medica.feature` y `defuncion.feature`) | Búsqueda CIE-10 implícita |
| US-3.4        | E3    | `03-catalogos/crud-catalogo.feature`                        | Especialidades CRUD |
| US-3.5        | E3    | `03-catalogos/crud-catalogo.feature`                        | Servicios y sedes |
| US-3.6        | E3    | (parcial — TODO refinar)                                    | TODO |
| US-3.7        | E3    | `03-catalogos/crud-catalogo.feature` + `i18n-catalogo.feature` | Editor sin código + i18n |
| US-3.8        | E3    | `03-catalogos/crud-catalogo.feature`                        | Versionado e historial |
| US-3.9        | E3    | `03-catalogos/crud-catalogo.feature`                        | Importación masiva |
| US-3.10       | E3    | (Could — fuera del MVP)                                     | n/a |
| US-4.1        | E4    | `04-mpi/registro-paciente-sv.feature`                       | Datos demográficos completos |
| US-4.2        | E4    | `04-mpi/registro-paciente-sv.feature` + `07-localizacion-sv/validacion-dui.feature` | Matriz exhaustiva DUI |
| US-4.3        | E4    | `04-mpi/busqueda-paciente.feature`                          | Multi-criterio, performance |
| US-4.4        | E4    | `04-mpi/deduplicacion.feature`                              | Determinista + probabilística |
| US-4.5        | E4    | `04-mpi/deduplicacion.feature`                              | Merge + reversibilidad 30 días |
| US-4.6        | E4    | `04-mpi/registro-paciente-sv.feature`                       | NN |
| US-4.7        | E4    | `04-mpi/registro-paciente-sv.feature`                       | Vínculo madre-RN |
| US-4.8        | E4    | `04-mpi/alergias-criticas.feature`                          | Severidades, banner |
| US-5.1        | E5    | `05-adt/admision-programada.feature`                        | Pre-admisión, conversión, cancelación |
| US-5.2        | E5    | `05-adt/admision-emergencia.feature` + `admision-programada.feature` | Tipos de admisión |
| US-5.3        | E5    | `05-adt/censo-camas.feature` + `admision-emergencia.feature` | Asignación + aislamiento |
| US-5.4        | E5    | `05-adt/traslado-interno.feature`                           | Validación + notificación |
| US-5.5        | E5    | `05-adt/alta-medica.feature`                                | Tipos alta + epicrisis |
| US-5.6        | E5    | `05-adt/censo-camas.feature`                                | Realtime + KPIs |
| US-5.7        | E5    | `05-adt/defuncion.feature`                                  | Certificado + causas CIE-10 |
| US-5.8        | E5    | `05-adt/admision-emergencia.feature`                        | Pulsera con barcode/QR |
| US-5.9        | E5    | (Should — biometría) — TODO                                 | TODO @wip |
| US-5.10       | E5    | `05-adt/censo-camas.feature`                                | Listas operativas |
| US-6.1        | E6    | `05-adt/admision-emergencia.feature`                        | Recepción rápida |
| US-6.2        | E6    | `06-triage-manchester/triage-adulto.feature`                | Signos vitales + escalas |
| US-6.3        | E6    | `06-triage-manchester/triage-adulto.feature`                | 52 flujogramas |
| US-6.4        | E6    | `06-triage-manchester/triage-adulto.feature` + `codigos-rojos.feature` | Discriminadores + protocolos |
| US-6.5        | E6    | `06-triage-manchester/triage-adulto.feature`                | Sobreescritura + justificación |
| US-6.6        | E6    | `06-triage-manchester/triage-adulto.feature` + `tiempos-maximos.feature` | Cronómetro + alertas 80% |
| US-6.7        | E6    | `06-triage-manchester/tiempos-maximos.feature`              | Tablero realtime, asignación box |
| US-6.8        | E6    | `06-triage-manchester/re-triage.feature`                    | Auto + manual + historial |
| US-6.9        | E6    | `06-triage-manchester/triage-pediatrico.feature`            | TEP, FLACC, Wong-Baker |
| US-6.10       | E6    | `06-triage-manchester/tiempos-maximos.feature`              | LWBS, KPIs |
| US-7.1        | E7    | (config feature, sin escenario explícito MVP)               | TODO |
| US-7.2        | E7    | `07-localizacion-sv/validacion-dui.feature` + `validacion-nit.feature` | Matrices |
| US-7.3        | E7    | `07-localizacion-sv/feriados-sv.feature`                    | Catálogo + locales |
| US-7.4        | E7    | (parcial — TODO refinar con MINSAL)                         | TODO |
| US-7.5        | E7    | `05-adt/alta-medica.feature` (validación JVPM)              | Implícito en firma |
| US-7.6        | E7    | `03-catalogos/i18n-catalogo.feature`                        | i18n base |
| US-8.x        | E8    | (cubierto por @SRE + @QA: SLOs, dashboards, backups)        | n/a |
| US-9.x        | E9    | (cubierto por @PO + @Orq: capacitación, hipercuidado)       | n/a |

**Nota:** historias marcadas como `(cubierto por @QA / @SRE)` son verificadas por tests técnicos automatizados o procesos no funcionales que no se expresan naturalmente como BDD funcional.

---

## 5. Mantenimiento

- Cada PR que añade/modifica una user story debe actualizar el feature correspondiente.
- Los TODOs `# TODO refinar con super-usuario` se revisan en cada Sprint Refinement.
- @QAF mantiene este README sincronizado con el backlog (`docs/05_backlog.md`).

---

**Versión:** 1.0 — 2026-04-30
**Autor:** @QAF — Quality Analyst (BDD)
