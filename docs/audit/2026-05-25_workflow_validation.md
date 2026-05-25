# Auditoría Workflow ECE — 2026-05-25

> Validación de estados, transiciones y roles del motor de workflow ECE contra
> los 30 tipos de documento sembrados en `ece.tipo_documento`. Verificado vía
> MCP contra Supabase prod.

## Resumen ejecutivo

| Dimensión | Estado |
|---|---|
| Tipos en catálogo | 30 ✓ |
| Estados (`ece.flujo_estado`) | 142, todos los tipos con 1 inicial + ≥1 final ✓ |
| Transiciones (`ece.flujo_transicion`) | 113, todas con `rol_autoriza_id` ≠ NULL ✓ |
| Documento × Rol (`ece.documento_rol`) | **127 (antes 91)** — 12 tipos sin matriz cerrados ✓ |
| Estados huérfanos (no-final sin salida) | 0 (los 30 `anulado` son por diseño, ver §Notas) ✓ |
| Funciones completas (LLENA+FIRMA+AUT+RESP) por tipo | 30/30 ✓ |

## Hallazgos y correcciones aplicadas

### Hallazgo #1 — 12 tipos sin matriz `documento_rol` (P1)

Los siguientes 12 tipos no tenían **ninguna** fila en `ece.documento_rol`. El
motor lee esta tabla para resolver "qué rol institucional ejecuta esta acción".
Sin filas → el motor no puede asignar responsabilidades y el dashboard de
hallazgos abiertos queda ciego.

| Código | Causa |
|---|---|
| `ATN_RN`, `NRP` | Seed Phase 2 omitió documentos neonatales |
| `PARTOGRAMA`, `SALA_EXPULSION` | Seed Phase 2 omitió documentos obstétricos |
| `PREOP_CHECK`, `WHO_CHK`, `PROG_QX`, `CONS_QX`, `REG_ANEST` | Seed Phase 2 omitió flujo quirúrgico completo |
| `VAL_INI_ENF` | Seed Phase 2 omitió documento enfermería hospitalaria |
| `URPA` | Seed Phase 2 omitió (modelo de 3 estados, edge case) |
| `RES_EST` | Seed Phase 2 omitió documento diagnóstico |

**Corrección:** [`packages/database/sql/127_documento_rol_seed_12_tipos.sql`](../../packages/database/sql/127_documento_rol_seed_12_tipos.sql).

48 filas insertadas (12 tipos × 4 funciones). Idempotente vía
`ON CONFLICT (tipo_documento_id, rol_id, funcion) DO NOTHING`.

### Hallazgo #2 — 36 transiciones con rol incoherente con la matriz (P1)

Los mismos 12 tipos tenían sus transiciones `firmar` / `enviar_revision` /
`validar` con `rol_autoriza_id = MC` (Médico de Cabecera) genérico — el seed
inicial usó un patrón cookie-cutter sin diferenciar por documento. Pero el
motor **bloquea la firma** si el rol del usuario no coincide con
`rol_autoriza_id`.

Ejemplos del bug:
- Un anestesiólogo (`ESP`) no podía firmar `REG_ANEST` porque el motor exigía `MC`.
- Una enfermera (`ENF`) no podía firmar `VAL_INI_ENF` porque el motor exigía `MC`.
- Un cirujano (`ESP`) no podía firmar `CONS_QX` porque el motor exigía `MC`.

**Corrección:** [`packages/database/sql/128_align_transition_roles_with_doc_rol.sql`](../../packages/database/sql/128_align_transition_roles_with_doc_rol.sql).

Regla aplicada (UPDATE solo a los 12 tipos target):
- `firmar` → rol con función FIRMA en `documento_rol`
- `enviar_revision` → rol con función LLENA
- `validar` → rol con función AUTORIZA
- `anular` → DIR (siempre, política universal — no se toca)
- `dar_alta` (URPA) → ESP (anestesiólogo otorga alta post-anestésica — no se toca)

Resultado: 36 transiciones actualizadas, 0 mismatch post-fix.

### Falso positivo descartado — Estado `anulado` con `es_final=false`

Inicialmente flaggeado como bug: los 30 estados `anulado` (uno por tipo) están
marcados `es_final=false` y no tienen transiciones de salida — parece deadlock.

**No es bug, es por diseño** ([`packages/trpc/src/ece/dependencias-enforcement.ts:9-15`](../../packages/trpc/src/ece/dependencias-enforcement.ts)):

```ts
// Una instancia se considera "firmada" si su estado_actual:
//   a) tiene `codigo = 'firmado'`, O
//   b) tiene `codigo = 'validado'`, O
//   c) tiene `es_final = true` (estado terminal del workflow, eg. 'certificado')
// El check NO acepta instancias en estado 'anulado', 'borrador' o 'en_revision'.
```

Si `anulado` se marcara `es_final=true`, satisfaría dependencias — un documento
**anulado** no debe satisfacer la dependencia que pedía otro documento firmado.
La constraint partial `uix_flujo_estado_final` además solo permite un estado
final por tipo (decisión arquitectónica).

El estado terminal se identifica por **ausencia de transiciones de salida**, no
por `es_final`. El motor maneja esto correctamente.

## Matriz final documento × rol (post-fix)

`LLENA` quién registra · `FIRMA` quién firma electrónicamente · `AUT` quién autoriza acciones especiales · `RESP` responsable institucional.

| Código | Modalidad | LLENA | FIRMA | AUT | RESP |
|---|---|---|---|---|---|
| ACTO_QX | hospitalario | ESP | ESP | ESP | ESP |
| ATN_EMERG | ambulatorio | MT | MT | MT | MT |
| **ATN_RN** | hospitalario | ENF | ESP | MC | MC |
| CERT_DEF | hospitalario | MC | MC | DIR | MC |
| CERT_INC | ambos | MC | MC | MC | MC |
| CONS_INF | ambos | MC | MC | DIR | MC |
| **CONS_QX** | hospitalario | ESP | ESP | DIR | MC |
| DOC_ASOC | ambos | ADM | ARCH | ARCH | ARCH |
| EPICRISIS | hospitalario | MC | MC | DIR | MC |
| EVOL_MED | ambos | MT | MC | MC | MC |
| FICHA_ID | ambos | ARCH | ARCH | DIR | ARCH |
| HIST_CLIN | ambos | MT | MC | MC | MC |
| HOJA_ING | hospitalario | ADM | ADM | ARCH | ADM |
| IND_MED | ambos | MT | MC | ENF | MC |
| **NRP** | hospitalario | ENF | ESP | MC | MC |
| ORD_ING | hospitalario | MT | MT | MC | MT |
| **PARTOGRAMA** | hospitalario | ENF | ESP | MC | MC |
| **PREOP_CHECK** | hospitalario | ENF | ESP | MC | MC |
| **PROG_QX** | hospitalario | ESP | ESP | DIR | MC |
| **REG_ANEST** | hospitalario | ESP | ESP | MC | MC |
| REG_ENF | ambos | ENF | ENF | ENF | ENF |
| **RES_EST** | ambos | ESP | ESP | MC | MC |
| RRI | ambos | MT | MC | IC | MC |
| **SALA_EXPULSION** | hospitalario | ENF | ESP | MC | MC |
| SIG_VIT | ambos | ENF | ENF | ENF | ENF |
| SOL_EST | ambos | MT | MC | MC | MC |
| TRIAJE | ambulatorio | MT | ENF | MT | ENF |
| **URPA** | hospitalario | ENF | ESP | MC | MC |
| **VAL_INI_ENF** | hospitalario | ENF | ENF | MC | MC |
| **WHO_CHK** | hospitalario | ENF | ESP | DIR | MC |

**Filas en negrita = nuevas (sembradas por la auditoría 2026-05-25).**

## Catálogo de roles (`ece.rol`)

| Código | Nombre |
|---|---|
| AC | Atención al Cliente |
| ADM | Administrativo |
| ARCH | Archivo / ESDOMED |
| DIR | Dirección |
| ENF | Enfermería |
| ESP | Especialista |
| IC | Interconsultante |
| MC | Médico de Cabecera |
| MT | Médico de Turno |

## Verificación post-fix

```sql
-- Tipos con menos de 4 funciones en doc_rol → 0
SELECT count(*) FROM (
  SELECT td.codigo
  FROM ece.tipo_documento td
  WHERE (SELECT count(*) FROM ece.documento_rol WHERE tipo_documento_id = td.id) < 4
) x;  -- → 0

-- Transiciones MISMATCH entre rol_autoriza y doc_rol (12 tipos target) → 0
-- (ver query completa en sección "Verificación" de la auditoría)
```

## Próximos pasos sugeridos

- Cuando se siembre un nuevo `tipo_documento`, **obligatoriamente** poblar las
  4 funciones en `documento_rol` en la misma migración (no asumir un default).
- Considerar un trigger `BEFORE INSERT/DELETE` en `documento_rol` que valide
  que toda transición existente tenga rol coherente.
- Considerar índice/CHECK que valide al menos 1 fila por función en
  `documento_rol` por cada tipo activo.
