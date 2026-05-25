# DOC_ASOC — Documentos Clínicos Asociados

## Metadata

- **codigo**: `DOC_ASOC`
- **nombre**: Documento Clínico Asociado (archivos adjuntos al expediente)
- **modalidad**: `AMBOS` (ambulatorio y hospitalario)
- **NTEC artículo**: §15 (el expediente clínico debe incluir los documentos clínicos asociados al episodio de atención); §38 (referencias y contra-referencias — los adjuntos de laboratorio externo y de establecimientos remitentes forman parte del expediente del paciente receptor).
- **modulo_his_target**: `/ece/documento-asociado` (lista) + `/ece/documento-asociado/nuevo` (wizard 2 pasos) + `/ece/documento-asociado/[id]` (detalle + firma + descarga). No existe módulo legacy equivalente — los documentos externos no tenían representación formal en el HIS pre-ECE.
- **tabla_datos**: `ece.documento_asociado` (payload NTEC) + `ece.documento_instancia` (cabecera workflow). Los archivos físicos residen en Supabase Storage (bucket `ece-documentos-asociados`); la tabla almacena solo metadata + `storage_path` (ruta relativa, NO URL firmada).
- **inmutable**: **true post-firma**. El trigger `ece.trg_doc_asoc_inmutable` bloquea modificaciones de `storage_path`, `hash_sha256`, `titulo`, `storage_bucket` y `mime_type` cuando `estado_registro = 'firmado'`. Permite actualizar `estado_registro` a `'anulado'` (proceso administrativo) pero no revertir a borrador ni modificar el contenido. El hash SHA-256 calculado en cliente (browser `crypto.subtle`) garantiza integridad del archivo respecto a lo que firmó el profesional.
- **tipo_registro**: **OPCIONAL** (complementa otros documentos NTEC). Sin dependencias bloqueantes propias — puede adjuntarse a cualquier episodio en cualquier momento. Prioridad: relevante para auditorías ISSS, MINSAL y procesos médico-legales donde se requieran resultados de laboratorio externo, radiografías escaneadas o documentación de referencia.

---

## Propósito normativo

Los documentos clínicos asociados son el mecanismo formal NTEC para incorporar al expediente electrónico material probatorio que no fue generado en el HIS propio. Casos de uso principales:

1. **Laboratorio externo**: resultados de laboratorio de establecimientos privados o ISSS que el paciente trae al consultar.
2. **Imagen diagnóstica escaneada**: radiografías, ecografías, tomografías en soporte físico digitalizadas.
3. **Referencia externa (§38)**: documentos de referencia enviados por otro establecimiento (carta de referencia, resumen clínico, hoja de manejo previo).
4. **Consentimiento externo**: consentimientos informados firmados fuera del establecimiento (cirugía ambulatoria, terapias domiciliarias).
5. **Otro**: cualquier documento clínico auxiliar que el profesional estime necesario incorporar al expediente con valor probatorio.

La firma electrónica con PIN argon2id sobre el `hash_sha256` del archivo acredita que el profesional revisó el documento y lo incorporó responsablemente al expediente.

---

## Storage

| Atributo | Valor |
|---|---|
| Bucket | `ece-documentos-asociados` |
| Acceso | Privado — solo service_role puede generar URLs firmadas |
| TTL upload URL | 300 segundos (5 min) |
| TTL download URL | 3,600 segundos (60 min) |
| Tamaño máximo | 50 MB por archivo |
| Tipos permitidos | `application/pdf`, `image/jpeg`, `image/png`, `image/tiff`, `image/dicom`, `application/dicom`, `application/octet-stream` |
| Retención | 10 años (TDR §6.3, Art. 35 NTEC — mismo plazo que el expediente) |
| Política de purga | No automática — la eliminación del bucket requiere proceso administrativo con respaldo en `audit.audit_log` |
| Hash de integridad | SHA-256 calculado en cliente (`crypto.subtle.digest`) y almacenado en `ece.documento_asociado.hash_sha256` |

El archivo nunca se almacena en la base de datos. La columna `storage_path` contiene la ruta relativa dentro del bucket (ej. `uploads/1716000000000/uuid/radiografia-torax.pdf`). Las URLs firmadas son efímeras y se generan bajo demanda vía el Route Handler `/api/ece/documento-asociado/signed-url`.

---

## Dependencias

DOC_ASOC no tiene dependencias bloqueantes — puede crearse en cualquier momento del episodio. Como complemento documental, se asocia opcionalmente al `episodio_id` y obligatoriamente al `paciente_id`.

---

## Obligatoriedad

**OPCIONAL** — complementa al expediente clínico cuando existen documentos externos relevantes. La ausencia de DOC_ASOC no bloquea ningún otro workflow NTEC.

---

## Roles firmantes

| Rol (código RBAC) | Acción | Momento |
|---|---|---|
| **MT** / **PHYSICIAN** / **NURSE** | Adjuntar (`create`) y firmar (`firmar` + PIN) | Cualquier momento del episodio |
| **DIR** / **ADMIN** | Anulación (`anular`) — solo en estado borrador | Excepcional; documento firmado requiere proceso administrativo |

---

## Campos obligatorios

- `paciente_id` — paciente al que pertenece el documento.
- `establecimiento_id` — establecimiento activo del profesional (RLS).
- `categoria` — clasificación: `imagen_diagnostica | laboratorio_externo | referencia_externa | consentimiento_externo | otro`.
- `titulo` — nombre descriptivo del documento (3–255 chars).
- `storage_path` — ruta en el bucket (generada por el Route Handler, nunca editable por el cliente directamente).
- `mime_type` — tipo MIME del archivo (de la lista permitida).
- `tamano_bytes` — tamaño en bytes (1 a 52,428,800 = 50 MB).
- `hash_sha256` — hash SHA-256 hex de 64 chars del archivo, calculado en cliente.
- `adjuntado_por` — `his_user_id` del profesional que adjuntó.

Opcionales: `episodio_id`, `descripcion`, `fecha_documento` (default: hoy).

---

## Estados (flujo_estado)

```
borrador → firmado
    ↓         ↓
  anulado   (inmutable)
```

| codigo | descripción |
|---|---|
| `borrador` | Metadata registrada, firma pendiente. Archivo ya subido al bucket. |
| `firmado` | Profesional verificó el documento y firmó con PIN. **Inmutable** — trigger SQL bloquea cambios de contenido/hash/ruta. |
| `anulado` | Anulado en estado borrador por DIR/ADMIN con motivo obligatorio. El archivo permanece en Storage hasta TTL de retención. |

---

## Transiciones

| origen | destino | rol | acción tRPC | condición |
|---|---|---|---|---|
| (nada) | `borrador` | MT / PHYSICIAN / NURSE | `eceDocAsoc.create` | personal_salud activo + DOC_ASOC configurado en workflow |
| `borrador` | `firmado` | MT / PHYSICIAN / NURSE | `eceDocAsoc.firmar(firmaPin)` | PIN válido + firma no bloqueada |
| `borrador` | `anulado` | DIR / ADMIN | `eceDocAsoc.anular({ motivoAnulacion })` | Motivo ≥10 chars |

Un documento `firmado` no puede anularse directamente vía esta API.

---

## Eventos (outbox `ece.*`)

| evento | momento | payload |
|---|---|---|
| `ece.documento_asociado.adjuntado` | Post-`create` exitoso | `{ documentoId, instanciaId, pacienteId, episodioId, categoria, titulo, mimeType, tamanoBytes, hashSha256, adjuntadoPor, organizationId }` |
| `ece.documento_asociado.firmado` | Post-`firmar` exitoso | `{ documentoId, instanciaId, pacienteId, episodioId, hashSha256, firmaId, firmadoPor, firmadoEn, organizationId }` |

---

## Flujo operativo UI

```
UI → POST /api/ece/documento-asociado/signed-url
         (fileName, mimeType)
     ← { uploadUrl, storagePath }

UI → PUT {uploadUrl} con el archivo binario
     (fetch directo al bucket de Supabase Storage)
     ← 200 OK

UI → tRPC eceDocAsoc.create
         (metadata + storagePath + hashSha256)
     ← { id, instanciaId }

UI → /ece/documento-asociado/{id}
     (detalle: preview si imagen, enlace descarga PDF/DICOM)

Profesional → clic "Firmar con PIN"
UI → tRPC eceDocAsoc.firmar({ id, firmaPin })
     ← { ok, estado: "firmado" }
     → trigger BD bloquea campo storage_path / hash / titulo
```

---

## Drift conocido

- La tabla `ece.documento_asociado` fue creada con la migración `125_documento_asociado.sql` (2026-05-24). El `tipo_documento` con `codigo = 'DOC_ASOC'` y `tabla_datos = 'documento_asociado'` ya existía en el catálogo (sembrado en `100_seed_workflow_descriptions.sql`) pero apuntaba a una tabla inexistente. Esta migración cierra el gap.
- El bucket `ece-documentos-asociados` debe crearse manualmente en el dashboard de Supabase Storage antes del Go-Live con política de acceso privado (solo service_role).
- Los estados del workflow en `ece.flujo_estado` para DOC_ASOC (`borrador`, `firmado`, `anulado`) deben verificarse que estén sembrados para el `tipo_documento_id` correspondiente — si no están, `create` fallará con PRECONDITION_FAILED.
