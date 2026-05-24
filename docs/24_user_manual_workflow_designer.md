# Manual de usuario — Workflow Designer

**Rol requerido**: `WORKFLOW_DESIGNER` o `DIR` (Dirección Médica)
**Ruta**: `/admin/workflow-designer`
**Versión**: 2026-05-24

## Quién lo usa

Personal con autoridad para configurar el flujo de los documentos clínicos NTEC:
- **Director Médico (DIR)**: configura overrides por establecimiento
- **WORKFLOW_DESIGNER**: técnico responsable del catálogo de documentos

## Cuándo se usa

- Al implementar nuevos tipos de documento NTEC
- Para modificar dependencias (`depende_de`) entre documentos
- Para escribir/actualizar la descripción rica que ve el equipo clínico
- Para cambiar el módulo HIS de destino (deeplink)
- Para diseñar estados y transiciones de un workflow

## Paso a paso — Editar descripción de un tipo de documento

1. Entra a `/admin/workflow-designer` desde el menú lateral (Admin → Workflow Designer)
2. Verás una lista de tarjetas con los 31 tipos de documento NTEC. Cada tarjeta muestra: código, nombre, modalidad (ambulatorio/hospitalario/ambos), tipo de registro
3. Clic en la tarjeta del tipo a editar (ej. `IND_MED`)
4. Verás el detalle con: descripción markdown renderizada + grafo de dependencias + estados/transiciones + matriz de roles
5. Botón "Editar workflow" arriba a la derecha
6. En la pantalla de edición verás 4 secciones: Descripción y módulo HIS / Estados / Transiciones / Roles funcionales
7. En **Descripción y módulo HIS**:
   - Campo "Módulo HIS legacy asociado": escribe la ruta del módulo (ej. `/indications`, `/ece/consentimiento`)
   - Editor WYSIWYG (TipTap): usa la toolbar para H2/H3, **negrita**, _itálica_, listas, citas, enlaces, código
   - Counter muestra caracteres usados (máx 20.000)
   - Botón "Guardar descripción" persiste en BD; verás indicador "Guardado a las HH:MM:SS"

## Paso a paso — Ver grafo de dependencias

1. Desde la lista, clic en cualquier tipo
2. Verás la tarjeta "Dependencias del flujo" con un grafo visual:
   - **Izquierda (ámbar)**: documentos que ESTE requiere firmados primero (`depende_de`)
   - **Centro (azul)**: el documento actual
   - **Derecha (verde)**: documentos que ESTE habilita
3. Clic en cualquier nodo para navegar a ese documento

## Paso a paso — Diseñar estados y transiciones

1. Desde el editor, sección "Estados"
2. Cada tipo tiene un workflow estándar: `borrador → en_revision → firmado → validado` + `anulado` (transición universal por DIR)
3. Botón "Agregar estado" para nuevos estados; especifica código, nombre, orden, si es inicial/final
4. Sección "Transiciones": especifica origen, destino, acción (ej. `firmar`, `validar`), rol autorizador, requiere firma electrónica

## Errores comunes

- **"Descripción muy larga"**: límite 20.000 caracteres. Reduce contenido o divide en docs.
- **"Estado inicial ya existe"**: solo puede haber un estado con `es_inicial=true` por tipo
- **"Transición ya existe"**: no se pueden duplicar acciones desde el mismo estado origen
- **"Sin permisos"**: requiere rol `WORKFLOW_DESIGNER` o `DIR`. Solicita acceso a Dirección TI.

## Referencias

- [`docs/31_flujos_operativos_consolidado.md`](31_flujos_operativos_consolidado.md) — Índice maestro de los 30 flujos NTEC
- [`docs/flujos/{CODIGO}.md`](flujos/) — Ficha detallada por tipo de documento
- `docs/blueprints/workflow-designer.md` (si existe) — Diseño técnico
