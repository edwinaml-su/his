# Esquema Supabase — Expediente Clínico Electrónico (ECE)

Modelo de base de datos para la digitalización del expediente clínico conforme a la **Norma técnica del expediente clínico, Acuerdo n.° 1616 (MINSAL, 2024)** y procesos ISSS. Todo el esquema vive en el schema `ece`.

## Modelo Entidad-Relación

Ver `modelo_entidad_relacion.mermaid` (se renderiza en cualquier visor Mermaid). Tres bloques:

1. **Estructura institucional y seguridad** — `institucion → establecimiento → servicio/cama`; `personal_salud` ligado a `auth.users`, con `asignacion_rol`, `firma_electronica` y `perfil_acceso` (RBAC).
2. **Dominio clínico** — `paciente` (raíz, MAESTRO) → `episodio_atencion` (+ especialización hospitalaria) → un conjunto de tablas de documentos clínicos.
3. **Motor de workflow** — `tipo_documento → flujo_estado / flujo_transicion / documento_rol`; `documento_instancia` une el tipo, el episodio y la fila de datos clínicos; `documento_instancia_historial` es la bitácora de transiciones.

## Cómo se definen los workflows (lo central de la solicitud)

Los flujos **no están codificados**: son datos.

| Pregunta | Tabla que la responde |
|---|---|
| ¿Qué documentos existen y de qué dependen? | `tipo_documento` (`depende_de`, `tipo_registro`, `inmutable`) |
| ¿Qué estados tiene un documento? | `flujo_estado` |
| ¿Quién puede moverlo al siguiente estado (autorizador)? | `flujo_transicion.rol_autoriza_id` + `requiere_firma` |
| ¿Quién lo llena / es responsable / autoriza / firma? | `documento_rol.funcion` ∈ {`LLENA`,`RESPONSABLE`,`AUTORIZA`,`FIRMA`} |
| ¿Qué pasó con cada documento y quién lo firmó? | `documento_instancia_historial` |

Cambiar un workflow = `INSERT/UPDATE` en estas tablas. `08_seed_workflows.sql` los siembra con la matriz de la Fase 2.

## Orden de aplicación (obligatorio)

```
00_extensions.sql          extensiones + schema ece
01_catalogos.sql           institución, establecimiento, servicio, cama, rol, catálogos
02_seguridad_personal.sql  personal_salud, asignacion_rol, firma_electronica, perfil_acceso
03_paciente_maestro.sql    paciente (Ficha de Identificación), identificadores, ISSS
04_episodios.sql           episodio_atencion + episodio_hospitalario + camas
05_motor_workflow.sql      tipo_documento, estados, transiciones, documento_rol, instancias
06_documentos_clinicos.sql tablas de datos de cada formulario del ECE
07_auditoria_seguridad.sql bitácoras, rectificación/supresión, inmutabilidad, RLS
08_seed_workflows.sql      siembra del motor de workflow (Fase 2)
```

## Decisiones de diseño y trazabilidad normativa

- **Inmutabilidad (Art. 42):** documentos `historico` (`consentimiento_informado`, `epicrisis_egreso`, `certificado_defuncion`, `acto_quirurgico`) y las bitácoras tienen trigger que **bloquea UPDATE/DELETE**. Las correcciones pasan por `ece.rectificacion`; nunca se borra.
- **Firma electrónica simple (Art. 23):** `firma_electronica` con vínculo único 1:1 al profesional; sólo se guarda el hash (almacenamiento sin posibilidad de descifrado, Art. 4.1).
- **Bitácora de accesos (Art. 55-56):** `bitacora_acceso` registra todo intento (autorizado/denegado) con marca temporal a nivel segundo (`clock_timestamp()`); conservación mínima 2 años.
- **Certificación restringida (Art. 21):** sólo el rol `DIR` autoriza la transición `certificar` (epicrisis, certificado de defunción, ficha) — modelado en `flujo_transicion`.
- **Confidencialidad / RBAC (Art. 33, 45, 52):** RLS habilitado; `perfil_acceso` define permisos por rol; andamiaje de policies en `07` (ajustar al JWT del proyecto).
- **Número de expediente (Art. 11):** estructura definida por establecimiento (`establecimiento.patron_num_expediente`); unicidad por establecimiento, deduplicación por NUI/DUI con índice trigram.
- **Conservación diferenciada (Art. 34-35):** `paciente.estado_expediente` activo/pasivo; las reglas de retención por diagnóstico se implementan como job sobre estos campos.

## Notas de implementación

- Las subestructuras clínicas muy variables (examen físico, monitoreo transanestésico, partograma) usan `jsonb`; el **conjunto mínimo de variables que exige la norma** está como columnas tipadas.
- Las policies RLS de `07` son un **andamiaje base**: deben afinarse según cómo el proyecto mapee `auth.uid()` ↔ `personal_salud` y los claims del JWT.
- Verificación realizada: los 9 archivos parsean correctamente contra la gramática PostgreSQL (libpg_query).
