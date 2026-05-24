# Manual de usuario — Overrides de workflow por establecimiento

**Rol requerido**: `DIR` (Dirección Médica del establecimiento)
**Ruta**: `/admin/workflow-overrides`
**Versión**: 2026-05-24

## Quién lo usa

El **Director Médico (DIR)** de cada establecimiento. Solo el DIR puede configurar overrides; otros roles tienen acceso de lectura para auditoría.

## Cuándo se usa

Para ajustar la obligatoriedad y dependencias de los documentos NTEC al contexto operativo específico de tu establecimiento, SIN alterar el catálogo central. Casos típicos:

- **Hospital ambulatorio puro sin emergencia**: marcar `ATN_EMERG` como opcional
- **Centro de salud sin quirófano**: marcar `CONS_QX`, `PROG_QX`, `ACT_QX`, etc. como opcionales
- **Hospital materno-infantil sin cardiología**: ajustar dependencias específicas
- **Establecimiento de día sin hospitalización**: marcar `HOJA_ING`, `VAL_INI_ENF`, etc. como opcionales

**IMPORTANTE**: el override solo afecta a TU establecimiento. Otros establecimientos siguen viendo el comportamiento global del catálogo.

## Paso a paso — Configurar un override

1. Entra a `/admin/workflow-overrides` desde el menú lateral (Admin → Overrides Workflow)
2. Verás una tabla con los 31 tipos del catálogo. Por cada uno: código, nombre, modalidad, indicador de override (badges)
3. Encuentra el tipo a ajustar (ej. `ATN_EMERG` Atención de Emergencia)
4. Clic en el botón "Configurar" (o "Editar" si ya hay override existente)
5. Verás un formulario con 4 campos:

### Campo "Activo en este establecimiento"
- **Usar global**: respeta el `activo` del catálogo (default)
- **Forzar activo**: aunque el catálogo lo marque inactivo, en este establecimiento sigue activo
- **Forzar inactivo**: el tipo desaparece del wizard de episodios y del catálogo visible

### Campo "Obligatoriedad"
- **Usar global**: política normal del catálogo (default)
- **Obligatorio**: el wizard lo marca como bloqueante si faltan deps
- **Opcional**: el wizard lo trata como `NO_APLICA` — no se incluye en cálculo de progreso ni enforcement

### Campo "Override del grafo de dependencias"
Checkbox para activar. Si activas, escribe los códigos de dependencias separados por coma (ej. `FICHA_ID, HOJA_ING`). Esto REEMPLAZA el `depende_de` global del catálogo para este tipo en tu establecimiento. Si dejas el campo vacío, el tipo no tendrá dependencias.

### Campo "Nota DIR"
Justificación obligatoria del override (máx 2000 caracteres). Ejemplo:
> "Este establecimiento es ambulatorio puro; no atendemos urgencias. El documento ATN_EMERG no aplica para nuestro flujo operativo. Acta de Comité Médico 2026-05-20."

6. Botón "Guardar override"
7. Si quieres revertir: botón "Eliminar override" (vuelve al comportamiento del catálogo global)

## Cómo verificar que funciona

1. Una vez guardado, ve a `/ece/episodio-hospitalario/[id]` de un episodio en tu establecimiento
2. Pestaña "Documentos"
3. El wizard "Próximos documentos del episodio" debería:
   - **No mostrar** el tipo si marcaste `activo=false`
   - **Mostrar como NO_APLICA** (gris) si marcaste `obligatorio=false`
   - **Mostrar nuevas dependencias** si modificaste `depende_de`

## Errores comunes

- **"Sin permisos"**: solo el DIR puede editar. Verifica tu rol con TI.
- **"Dependencia no existe"**: el código en `depende_de_override` debe existir en el catálogo. Revisa nombres exactos en `/admin/workflow-designer`.
- **"Override no afecta a otros establecimientos"**: correcto, es por diseño. Cada establecimiento tiene su propio override.

## Auditoría

Todo cambio de override:
- Se registra en `ece.bitacora_acceso` con `componente='workflow.tipoDocOverride'`
- Queda firmado con tu usuario + timestamp
- Es visible en historial del documento (no se borra al eliminar el override)

## Referencias

- [`docs/24_user_manual_workflow_designer.md`](24_user_manual_workflow_designer.md) — Manual del diseñador central
- [`docs/31_flujos_operativos_consolidado.md`](31_flujos_operativos_consolidado.md) — Catálogo de 30 flujos NTEC
- [`packages/database/sql/102_tipo_documento_establecimiento.sql`](../packages/database/sql/102_tipo_documento_establecimiento.sql) — Estructura técnica de la tabla
