# Guía de Migraciones de Datos Legacy

Registro de scripts one-shot para mover datos de esquemas legacy a los esquemas ECE post-refactor.

---

## migrate-deaths-to-ece

**Script:** `packages/database/scripts/migrate-deaths-to-ece.mjs`
**PR origen:** `/deaths` (refactor DeathCertificate → ece.certificado_defuncion)
**Norma:** NTEC §3.16, Ley del Registro del Estado Familiar

### Qué hace

Migra todos los registros de `public."DeathCertificate"` (modelo Prisma legacy) a
`ece.certificado_defuncion` (schema ECE NTEC).

Mapeo de campos:

| Campo legacy | Campo destino | Transformación |
|---|---|---|
| `id` | `id` | Preservado; también en `_source_legacy_id` |
| `patientId` | (derivado) | Busca `ece.paciente` via `public_patient_id`; crea si no existe |
| `encounterId` | (derivado) | Busca `ece.episodio_atencion` via `public_encounter_id`; crea si no existe |
| `occurredAt` | `fecha_hora_defuncion` | Directo |
| `basicCauseCode` | `causa_basica_cie10` | Directo |
| `intermediateCauseCode` + `directCauseCode` | `causas_intermedias` | Array JSONB ordenado |
| `contributingCauses` | `causas_contribuyentes` | Texto libre encapsulado en JSONB |
| `manner` | `clasificacion` | Ver tabla de mapeo abajo |
| `certifyingPhysicianId` | `medico_certificante_id` | Lookup via `ece.personal_salud.his_user_id` |
| `createdAt` | `registrado_en` | Directo |

Mapeo `manner` → `clasificacion`:

| Valor legacy | Clasificacion ECE |
|---|---|
| `natural` | `natural` |
| `accident`, `accidente`, `suicide`, `suicidio`, `homicide`, `homicidio`, `violenta` | `violenta` |
| `accidente_transito` | `accidente_transito` |
| `undetermined`, `indeterminado`, `en_investigacion` | `en_investigacion` |
| (null o desconocido) | `en_investigacion` |

**Idempotencia:** antes de insertar cada fila comprueba si ya existe un registro con
`_source_legacy_id = dc.id`. Si existe, lo salta (`skipped`). Si la fila ya tiene el mismo
`id` (ON CONFLICT), también se salta.

**Nota sobre `instancia_id` y `epicrisis_id`:** `ece.certificado_defuncion` requiere
`instancia_id` (FK a `ece.documento_instancia`) y `epicrisis_id` (FK a `ece.epicrisis_egreso`).
Los registros migrados usan un `instancia_id` determinista (UUID hash del id origen) como
placeholder. `epicrisis_id` se inserta como `NULL` — la epicrisis ECE puede no existir para
episodios históricos. El constraint `NOT NULL` en `epicrisis_id` debe relajarse o la FK
debe ser nullable; revisar el schema antes de ejecutar en producción.

### Prerrequisitos

1. Las tablas `ece.paciente`, `ece.episodio_atencion`, `ece.personal_salud` y
   `ece.certificado_defuncion` deben existir en la BD destino (SQLs 57–61 aplicados).
2. Al menos un registro en `ece.personal_salud` con `his_user_id` que corresponda a cada
   `certifyingPhysicianId` en el legacy. Si no existe, el registro fallará con error
   (se reporta en el resumen, no aborta).
3. `DIRECT_URL` en el archivo `.env` de `packages/database/` apuntando a la BD correcta.

### Ejecución

```bash
# 1. Preview sin cambios (obligatorio antes de ejecutar real)
node --env-file=.env scripts/migrate-deaths-to-ece.mjs --dry-run

# 2. Migración real
node --env-file=.env scripts/migrate-deaths-to-ece.mjs
```

Salida esperada:

```
Conectado a <host>/<db>
Total registros fuente: N

========== Resumen de migración ==========
  Total fuente  : N
  Migrados      : M
  Skipped       : S  (ya existían)
  Errores       : E
```

### Verificación post-migración

```sql
-- Contar fuente vs destino (deben ser iguales si errores = 0)
SELECT COUNT(*) FROM public."DeathCertificate";
SELECT COUNT(*) FROM ece.certificado_defuncion WHERE _source_legacy_id IS NOT NULL;

-- Ver registros con error (no migrados)
SELECT dc.id, dc."patientId", dc."certifyingPhysicianId"
FROM public."DeathCertificate" dc
WHERE NOT EXISTS (
  SELECT 1 FROM ece.certificado_defuncion cd WHERE cd._source_legacy_id = dc.id
);
```

### Rollback

Si necesitas deshacer la migración (solo los registros migrados, no los que existían antes):

```sql
-- Elimina solo los registros que provienen de la migración legacy
DELETE FROM ece.certificado_defuncion WHERE _source_legacy_id IS NOT NULL;

-- Opcionalmente eliminar los ece.paciente y ece.episodio_atencion creados por la migración
-- (identificables porque numero_expediente empieza con 'MIGRADO-')
DELETE FROM ece.episodio_atencion
WHERE paciente_id IN (
  SELECT id FROM ece.paciente WHERE numero_expediente LIKE 'MIGRADO-%'
);
DELETE FROM ece.paciente WHERE numero_expediente LIKE 'MIGRADO-%';
```

### NO ejecutar contra producción sin

- [ ] Dry-run revisado y conteos validados con DBA
- [ ] Backup de la BD tomado
- [ ] Ventana de mantenimiento acordada con @SRE
- [ ] `epicrisis_id` nullable confirmado en el schema ECE de producción

---

*Registros creados por esta guía:*
- `packages/database/scripts/migrate-deaths-to-ece.mjs`
- `packages/database/src/migrations/deaths-to-ece-helpers.ts` (lógica pura + tests)
- `packages/database/src/migrations/__tests__/deaths-to-ece-helpers.test.ts` (30 tests)
