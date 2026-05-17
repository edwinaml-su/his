# ADR 0015 — ECE: Rutas Clínicas Críticas — Tablas Separadas por Documento NTEC vs. `document_data jsonb`

- **Estado:** Aceptado
- **Fecha:** 2026-05-17
- **Decisores:** @AS (proponente), @Dev, @DBA
- **Fase:** Fase 2 — Sprint F2-S5 (ECE Quirúrgico + Obstétrico)
- **Dependencias:**
  - ADR 0011 — Motor de Workflow ECE data-driven
  - ADR 0012 — Estrategia RLS ECE
  - CLAUDE.md §"Schema drift Prisma vs SQL"
  - NTEC (Acuerdo 1616 MINSAL) — Art. 6, 10, 17, 23, 42

---

## Contexto

Las rutas quirúrgica y obstétrica del ECE Hospitalario requieren almacenar documentos clínicos
con estructura muy diferente entre sí:

- `ece.preop_checklist` — campos booleanos de verificación preoperatoria, firmante, hora.
- `ece.who_checklist` — tres fases (sign-in, time-out, sign-out) con firmantes múltiples.
- `ece.registro_anestesico` — series temporales por minuto (PA, FC, SpO2, agentes, eventos).
- `ece.urpa_recovery` — Aldrete score en intervalos + complicaciones + condicion al alta URPA.
- `ece.partograma_registro` — series temporales obstétricas (dilatación, descenso, FUR, LF).
- `ece.sala_expulsion_eventos` — eventos múltiples por parto (expulsión, alumbramiento, etc.).
- `ece.atencion_recien_nacido` — APGAR t1/t5/t10, somatometría, CUN/NUI, plan CRED inicial.
- `ece.reanimacion_neonatal` — pasos OMS de reanimación neonatal, condicional por APGAR.

La pregunta es: ¿se modela cada documento como tabla propia con columnas tipadas, o se usa
una tabla genérica `ece.documento_clinico (tipo text, document_data jsonb)` para todos?

---

## Decision

**Tabla separada por tipo de documento NTEC.** Cada documento clínico distinto definido en
la NTEC tiene su propia tabla con columnas explícitamente tipadas en Postgres.

```sql
-- Ejemplo: tabla para registro anestésico transanestésico
CREATE TABLE ece.registro_anestesico (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episodio_id     uuid NOT NULL REFERENCES ece.episodio_atencion(id),
  timestamp_utc   timestamptz NOT NULL,
  pa_sistolica    smallint,
  pa_diastolica   smallint,
  fc_lpm          smallint,
  spo2_pct        smallint CHECK (spo2_pct BETWEEN 0 AND 100),
  agente_inhalado text,
  evento          text,
  registrado_por  uuid NOT NULL REFERENCES ece.personal_salud(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episodio_id, timestamp_utc)   -- idempotencia append-only
);
```

El router correspondiente usa `prisma.$transaction` + `withEceContext` y los tipos Prisma
generados son fully-typed end-to-end (TypeScript → Postgres → tRPC → frontend).

---

## Alternativas consideradas

### A1. Tabla genérica `ece.documento_clinico (tipo, document_data jsonb)` — descartada

**Idea:** una tabla única para todos los documentos clínicos, con el tipo de documento como
discriminador y el payload como `jsonb`.

```sql
CREATE TABLE ece.documento_clinico (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episodio_id   uuid NOT NULL REFERENCES ece.episodio_atencion(id),
  tipo          text NOT NULL,           -- 'preop_checklist', 'registro_anestesico', etc.
  document_data jsonb NOT NULL,
  registrado_por uuid NOT NULL REFERENCES ece.personal_salud(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
```

**Razones de rechazo:**

1. **Sin validacion en BD.** Un `pa_sistolica` de `"abc"` o un `spo2_pct` de `150` se
   almacenan sin error. Las constraints `CHECK`, `NOT NULL` y `FOREIGN KEY` no aplican
   a campos dentro de `jsonb` sin funciones generadas persistidas — complejidad sin ganancia.

2. **RLS por tipo de documento imposible sin extensiones.** La política RLS
   `USING (tipo = 'registro_anestesico' AND registrado_por = current_user_id())`
   requiere que `tipo` sea columna de la tabla, no un campo del jsonb. Con jsonb se
   necesita un índice funcional generado y la policy se vuelve frágil.

3. **Typecheck perdido en la capa tRPC.** Prisma genera tipos por tabla. Con una tabla
   genérica, el campo `document_data` es `Prisma.JsonValue` — no hay auto-complete,
   ni detección de typos en el frontend, ni validación Zod automática por tipo de documento.

4. **Indexing deficiente para series temporales.** `ece.registro_anestesico` y
   `ece.partograma_registro` se consultan por `(episodio_id, timestamp_utc)` con alta
   frecuencia durante la cirugía o el parto. Un índice compuesto sobre columnas reales
   es 3-10x más eficiente que un índice GIN sobre `jsonb->>'timestamp_utc'`.

5. **Precedente Vernon DDD Cap. 8 ("Agregate Boundary"):** cada documento NTEC es un
   agregado distinto con invariantes propias. Un `partograma_registro` y un `preop_checklist`
   tienen ciclos de vida, firmantes y reglas de inmutabilidad distintas. Modelarlos en la
   misma tabla mezcla límites de agregado — antitético al diseño del motor de workflow
   (ADR 0011).

### A2. JSONB con JSON Schema validation via `pg_jsonschema` — descartada

**Idea:** mantener `document_data jsonb` pero agregar validación con la extensión
`pg_jsonschema` (disponible en Supabase) para forzar estructura por tipo.

**Razon de rechazo:**

- `pg_jsonschema` no está listada como extensión activa en el proyecto (ver `list_extensions`
  Supabase). Activarla requiere DDL con permisos `superuser` en Supabase — fuera del flujo
  normal de `apply_migration`.
- Los JSON Schemas definidos en la BD no se sincronizan automáticamente con los Zod schemas
  del cliente — se introduce un tercer punto de verdad (BD + Zod + JSON Schema) que se
  desincroniza.
- No resuelve el problema de RLS por tipo ni el de indexing para series temporales.

---

## Trade-offs

### Type safety vs. flexibilidad

| Criterio | Tablas separadas | JSONB genérico |
|---|---|---|
| Validacion en BD | Completa (CHECK, NOT NULL, FK) | Ninguna (sin extension) o parcial (pg_jsonschema) |
| Typecheck TypeScript | Total (tipos Prisma por tabla) | Parcial (`Prisma.JsonValue`) |
| RLS granular | Nativo por tabla | Requiere funciones generadas frágiles |
| Indexing series temporales | Optimo (columnas reales) | Deficiente (GIN jsonb) |
| Migraciones ante nuevo documento | Nueva tabla + archivo SQL | Solo nuevo enum value en `tipo` |
| Flexibilidad campos opcionales por tipo | Media (columnas nullable) | Alta (cualquier campo jsonb) |

El trade-off de flexibilidad (agregar un campo opcional sin migración) existe, pero en el
contexto NTEC los campos de cada documento son fijos por norma — el regulador no cambia
el formato del partograma entre versiones de forma libre. La flexibilidad de `jsonb` no
es necesaria para campos regulados.

### Proliferación de tablas

Con 8 tablas nuevas en F2-S5 (sumadas a las ~12 anteriores de rutas ECE), el schema ECE
crece. El riesgo es:

- **Mitigación:** todas las tablas siguen el patrón `ece.<documento>` con RLS, trigger de
  inmutabilidad y FK a `ece.episodio_atencion` desde el primer commit (lección Wave 6).
  No hay deuda técnica de schema acumulada.
- **Referencia:** el schema ambulatorio (F2-S1/S2) tiene 9 tablas ECE activas sin problemas
  de proliferación. La escala final (~25 tablas ECE) es manejable para Postgres.

---

## Patron de series temporales (partograma + registro anestésico)

Ambas tablas de series temporales siguen el patrón append-only con idempotencia:

```sql
UNIQUE (episodio_id, timestamp_utc)
```

El router usa `upsert` con `skipDuplicates: true` (Prisma) o `ON CONFLICT DO NOTHING` (SQL)
para que un retry de red no duplique mediciones. Este patrón se establece como estándar para
cualquier documento de series temporales en el ECE.

---

## Consecuencias

### Positivas

- **Typecheck end-to-end.** Cada documento NTEC tiene tipos TypeScript automáticos desde
  Prisma, sin `any` ni `unknown` en el path crítico.
- **RLS nativo.** Las políticas RLS por tabla son simples y testeables con los fixtures
  existentes en `packages/test-utils`.
- **Performance en series temporales.** El índice `(episodio_id, timestamp_utc)` en
  `partograma_registro` y `registro_anestesico` soporta las queries de visualización en
  tiempo real sin GIN overhead.
- **Auditabilidad NTEC.** Cada tabla tiene trigger de inmutabilidad y audit hash chain
  independiente — facilita el reporting por tipo de documento requerido en Art. 42 NTEC.

### Negativas / trade-offs

- **Migraciones adicionales por documento nuevo.** Cada nuevo tipo de documento NTEC
  requiere un archivo SQL nuevo + actualización de `schema.prisma`. Con JSONB sería solo
  un enum value.
- **WHO Checklist multi-firma pendiente.** La implementación actual de `ece.who_checklist`
  registra un solo `registrado_por`. El modelo OMS requiere 3 firmantes (cirujano,
  anestesiólogo, enfermera circulante). Deuda técnica identificada para F2-S6: refactor
  a tabla de firmas relacionada `ece.who_checklist_firma (checklist_id, rol, personal_id,
  signed_at)`.
- **CUN/NUI sin integración RNPN.** `ece.atencion_recien_nacido` genera un `cun_interno`
  UUID. La integración con el Registro Nacional de Personas Naturales (RNPN) de El Salvador
  para obtener el NUI real queda como deuda de Fase 3 — requiere API externa + contrato
  de servicio no disponible en F2.

---

## Referencias

- ADR 0011 — Motor de workflow ECE data-driven (límites de agregado)
- ADR 0012 — Estrategia RLS ECE
- Vernon, V. (2013). *Implementing Domain-Driven Design*. Cap. 8 — Aggregate Design Rules.
- NTEC Art. 6 (expediente clínico), Art. 17 (documentos obligatorios), Art. 42 (trazabilidad)
- `packages/database/sql/67_*.sql` a `74_*.sql` — DDL de las 8 tablas F2-S5
- `packages/trpc/src/routers/quix-*.router.ts`, `obst-*.router.ts` — implementaciones
