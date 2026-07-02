# ESP-MOCKUP-CALC-001 — Módulo de Calculadoras y Fórmulas Clínicas (ECE)

> Especificación de implementación para HIS Avante Multipaís (CC-0009).
> Fuentes: `REQ-ECE-CALC-001.xml` (requerimiento) + `calculadoras-clinicas.html` (mockup de referencia).
> Handoff único para @Dev / @DBA / @UIUX / @QA. **La fidelidad al mockup es un gate de aceptación.**

## 1. Resumen y decisiones de alcance

Módulo de calculadoras clínicas parametrizable con dos caras:

- **Vista médico** — un **widget de barra flotante** (arrastrable, `Ctrl+Shift+K`) disponible en toda pantalla clínica del expediente. Busca, autocompleta, abre un **modal de cálculo** con prellenado del paciente y resultado en vivo.
- **Vista administración** (Farmacia Clínica / Calidad) — catálogo tabular con versionado inmutable, activación por país (SV/GT/HN), visibilidad por pantalla, y gate de casos de prueba para publicar.

Biblioteca inicial: **205 calculadoras** portadas del mockup (174 fórmula, 29 score, 2 dosis, 17 alto riesgo, 21 categorías). Se siembran en estado **`borrador`** (no publicadas): la publicación exige casos de prueba en verde **y** validación clínica registrada.

### Decisiones tomadas (con Edwin, 2026-07-02)
- **Atajo de teclado:** widget = **`Ctrl+Shift+K`**. El Command Palette de navegación conserva `Ctrl+K` (evita colisión con `command-palette.tsx:82`).
- **Catálogo global vs tenant:** el catálogo de calculadoras + su config (país, pantalla) es **referencia global** (como CIE-11, Manchester): legible por `authenticated`, editable por rol admin. El **registro de cálculos** (`registro_calculo`) es **tenant-scoped** con RLS por `organizationId` + cadena de auditoría (contiene `pacienteId`/`usuarioId`).
- **Motor:** `expr-eval` **auto-hospedado** en `@his/infrastructure` (NO CDN, NO `eval`/`new Function`). El mockup usa CDN solo para prototipo.
- **País/pantalla como JSONB** en la fila de la calculadora (no tablas puente), fiel al mockup (`c.paises`, `c.paginas`). El catálogo de las 10 pantallas es una tabla semilla.

## 2. Modelo de datos (schema `ece`)

Convención Prisma: modelo PascalCase + `@@map("snake_case")`, columnas camelCase + `@map`, `@@schema("ece")`.

| Tabla (`ece.`) | Propósito | Ámbito RLS |
|---|---|---|
| `calculadora` | Fila de catálogo: `codigo` (UNIQUE, `CALC-{AREA}-NNN`), `nombre`, `tipo` (formula\|score\|dosis), `categoria`, `altoRiesgo` bool, `sub`, `ref`, `estado` (borrador\|publicada\|retirada), `paises` jsonb `{SV,GT,HN}`, `paginas` jsonb (`"*"`\|string[]), `versionActualId` FK. | Global (read `authenticated`, write admin) |
| `calculadora_version` | Versión **inmutable**: `calculadoraId` FK, `version` int, `definicion` jsonb (contrato §3), `publicadaEn`, `publicadaPor`, `inmutable` bool. UNIQUE(`calculadoraId`,`version`). | Global |
| `calculadora_caso_prueba` | `versionId` FK, `entradas` jsonb, `esperado` numeric, `tolerancia` numeric, `resultado` (pasa\|falla). Gate: no publicar si algún caso falla. | Global |
| `calculadora_pantalla` | Catálogo de 10 pantallas: `id` text PK (`evolucion`,…), `etiqueta`, `orden`, `activo`. | Global |
| `registro_calculo` | Auditoría inmutable por cálculo: `calculadoraId`, `versionId` (versión exacta usada), `pacienteId`, `entradas` jsonb, `resultado` numeric, `interpretacion` text, `pantalla` text, `usuarioId`, `organizationId`, `creadoEn`. | **Tenant** (RLS `organizationId` + audit hash-chain) |

SQL: `packages/database/sql/185_calculadoras_clinicas.sql` — CREATE TABLEs idempotentes, índices (codigo, calculadoraId, estado, `registro_calculo.organizationId`), `ENABLE ROW LEVEL SECURITY`, policies (global read `authenticated`; `registro_calculo` tenant policy sobre `app.current_org_id`), GRANTs, y trigger de auditoría en `registro_calculo` (patrón `02_audit_triggers.sql`). Toda función SQL nueva: `SET search_path = ece, public, pg_catalog`.

## 3. Contrato JSON canónico de `definicion` (INVARIANTE — todos los agentes alinean aquí)

Cabecera de calculadora (fila + version): `codigo, nombre, tipo, cat, ver, hr, paises, paginas, sub, ref, def`.

```jsonc
// def para tipo "formula" | "dosis"
{
  "inputs": [
    { "id": "crea", "label": "Creatinina", "u": "mg/dL", "min": 0.1, "max": 25, "val": 1.2, "srcLabel": "Laboratorio · hace 3 d" },
    { "id": "sexo", "type": "select", "label": "Sexo",
      "opts": [ {"v":"Masculino","f":1}, {"v":"Femenino","f":0.85} ], "sel": 1, "srcLabel": "Expediente" }
  ],
  "expr": "((140 - edad) * peso / (72 * crea)) * sexoF",
  "out": { "label": "Depuración de creatinina", "u": "mL/min", "dec": 1 },
  "interp": [ {"max":30,"n":"critico","t":"…"}, {"max":60,"n":"alerta","t":"…"}, {"n":"normal","t":"…"} ]
}
// def para tipo "score"
{
  "items": [ {"id":"icc","label":"Insuficiencia cardíaca","p":1}, {"id":"edad75","label":"Edad ≥ 75","p":2} ],
  "out": { "label":"Puntaje","u":"puntos","dec":0 },
  "interp": [ {"max":0,"n":"normal","t":"…"}, {"n":"critico","t":"…"} ]
}
```

Tipos: `Input = { id, label, u?, min?, max?, val?, type?:"select", opts?:Opt[], sel?, srcLabel? }`; `Opt = { v:string, [propNumérica]:number }` (p.ej. `f,k,a,mult,base,pts,g`); `Item = { id, label, p:number }`; `Out = { label, u, dec:number }`; `Interp = { min?, max?, n:"normal"|"alerta"|"critico", t:string }`.

## 4. Motor de evaluación (`@his/infrastructure/formula`) — reglas MOTOR-1..8

- **formula/dosis:** `parser.parse(def.expr).evaluate(scope)`. Construcción de `scope`:
  - input numérico → `scope[id] = parseFloat(valor)`.
  - input `select` (opción `opts[values[id]]`): por cada propiedad **numérica** `k` de la opción → `scope[id+"_"+k]` (p.ej. `sexo_k`, `ocular_pts`); además si `opt.f!==undefined` → `scope[id+"F"] = opt.f`. La etiqueta `v` (string) **no** se inyecta.
- **score:** `Σ items[i].p` de los ítems marcados.
- **classify(interp, val):** primera regla con `val>=min` (si hay `min`) y `val<=max` (si hay `max`); la última regla es abierta (sin `max`). Bandas ordenadas ascendente por `max` (cuidado escalas negativas p.ej. RASS).
- `log` = natural; `log10(x)=log(x)/log(10)`. Disponibles: `min,max,sqrt,abs,floor,round,exp`, potencia `^`. Ternario `?:`, `and`, `or`, comparaciones `> >= == < <=`; comparación que deba dar número se envuelve `(cond)?1:0`.
- **Validación al guardar:** ids reservados prohibidos (`and,or,not,in`); ningún id colisiona con nombre de función (`min,max,log,exp,sqrt,abs,floor,round`). Precedente mockup: CIWA renombró `in/or`→`ori/inq`.
- **Seguridad:** prohibido `eval`/`new Function`; expr-eval en el bundle.
- API: `evalFormula(def, values) → number`, `evalScore(def, checked) → number`, `classify(interp, val) → Interp`, `evaluar(calc, entradas) → { resultado, interp }`. Tests validan el **motor**, no la corrección clínica (GOB-1).

## 5. Widget (vista médico) — RF-01..05, 13, 15

- **Barra flotante** (`float-wrap`, fija bottom-center por defecto), **arrastrable por el asa** (`grip`, pointer events) con **persistencia de posición por usuario** (localStorage `his.calc.pos`). Solo visible en el grupo `(clinical)`.
- **Búsqueda** por nombre/código/categoría/sub, con **autocompletado ghost** (texto fantasma) aceptado con `Tab`/`→`.
- **Atajos:** `Ctrl+Shift+K` enfoca; `Esc` cierra; `↑/↓` navega; `Enter` abre; resultados agrupados por categoría + "Recientes".
- **Selector de pantalla** (`CUR_PAGINA`): filtra la barra a las calculadoras habilitadas para esa pantalla (`pagVisible`).
- **Modal de cálculo:** entradas (number/select o checkboxes de score), resultado + interpretación en vivo con banda de color (`r-normal/r-alerta/r-critico`), **prellenado del paciente** (sexo/edad/peso/talla/creatinina) con chip de fuente, chip **Alto riesgo → aviso IPSG.3** de verificación independiente, botón "Insertar en nota" (→ `registro_calculo`), disclaimer de apoyo a la decisión.

## 6. Administración — RF-06..14

Página `/(admin)/calculadoras`: tabla con `codigo`, nombre/categoría, tipo + chip ALTO RIESGO, versión (`v{n}`), estado, banderas país, switch activación SV, **columna Pantallas** (pill Todas/N/Ninguna → abre editor), acciones (editar→nueva versión, duplicar, historial). Panel de **visibilidad por pantalla** siempre visible (interruptor "Todas las pantallas" + grid de 10 pantallas). Importación desde plantilla. Versionado inmutable + gate de casos de prueba antes de publicar.

## 7. Fidelidad al mockup (gate visual)

Traducir el mockup a componentes del design system, respetando: tokens Avante DS v2 (`--navy #0B3D5C`, `--teal #00A8B5`, Inter, bandas ok/warn/crit), tipografía `mono` tabular en cifras, glifos de tipo (`ƒ` formula, `Σ` score, `mL` dosis), sombras flotantes, layout de la barra y del modal, chips de fuente de datos, aviso HR. Usar componentes `@his/ui` (Shadcn) donde exista equivalente; portar CSS del mockup a Tailwind manteniendo el aspecto. **@UIUX revisa fidelidad 1:1 contra `calculadoras-clinicas.html` antes del cierre.**

## 8. Plan de archivos
- `packages/contracts/src/schemas/clinical-calculators.ts` (+ re-export en `index.ts`)
- `packages/infrastructure/src/formula/{index.ts,engine.ts,*.test.ts}` (+ export en su `package.json`; `expr-eval` dep)
- `packages/database/prisma/schema.prisma` (5 modelos `ece`) + `packages/database/sql/185_calculadoras_clinicas.sql`
- `packages/database/scripts/seed-calculadoras-clinicas.mjs` + `packages/contracts/src/data/calculadoras-seed.ts` (205 defs canónicas)
- `packages/trpc/src/routers/calculadoras.router.ts` (+ registro en `_app.ts`)
- `apps/web/src/app/(admin)/calculadoras/{page.tsx,*-client.tsx}` (+ item en `nav-sections.ts`)
- `apps/web/src/components/calculadoras/{calc-widget.tsx,calc-modal.tsx,...}` (montado en `app-shell.tsx` solo para `(clinical)`)

## 9. Definition of Done (@QA)
typecheck 7/7 verde · lint · vitest verde (motor + router + contratos) · las 205 cargan y evalúan a número finito con sus defaults (CA-1) · gate de publicación bloquea con casos en falla (CA-2) · widget operable por teclado (CA-3) · país + pantalla configurables reflejan en la barra (CA-4) · cada cálculo registra su versión exacta (CA-5) · ninguna se habilita sin validación clínica (CA-6) · review de fidelidad visual @UIUX.
