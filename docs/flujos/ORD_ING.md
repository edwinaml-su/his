# ORD_ING — Orden de Ingreso Hospitalario

| Campo         | Valor                                                             |
|---------------|-------------------------------------------------------------------|
| **Código**    | `ORD_ING`                                                         |
| **Nombre**    | Orden de Ingreso Hospitalario                                     |
| **Norma**     | NTEC Art. 33; Acuerdo MINSAL n.° 1616 (2024)                      |
| **Modalidad** | Hospitalario / Hospital de Día                                    |
| **Inmutable** | Sí — tras firma electrónica                                       |
| **Tabla BD**  | `ece.orden_ingreso`                                               |
| **Instancia** | `ece.documento_instancia` (tipo = `ORD_ING`)                      |

---

## Descripción funcional

La **Orden de Ingreso** es la **decisión clínica del médico** que autoriza formalmente el internamiento de un paciente al establecimiento hospitalario. No es un documento administrativo — es el acto médico escrito que precede y habilita la Hoja de Ingreso Hospitalario (HOJA_ING).

**Distinción clave con HOJA_ING:**
- `ORD_ING` = decisión clínica (médico ordena). Normativa: Art. 33 NTEC.
- `HOJA_ING` = documento administrativo-clínico que apertura la admisión. El admisionista la crea una vez que la orden existe y está firmada.

NTEC Art. 33 establece que ningún paciente puede ser ingresado formalmente sin que exista una orden de ingreso firmada por el médico responsable.

---

## Dependencias (NTEC Art. 33)

La orden de ingreso puede preceder o seguir a otros documentos según el contexto:

| Código dep.   | Nombre                                | Condición                                   |
|---------------|---------------------------------------|---------------------------------------------|
| *(ninguna)*   | —                                     | ORD_ING puede ser el primer documento ECE   |

> En la implementación actual `depende_de = []` para ORD_ING. El motor de enforcement no bloqueará su creación. Sin embargo, la política clínica establece que debe haber una evaluación previa documentada (emergencia o consulta externa).

---

## Workflow de estados

```
borrador ──────────────────► firmado ──────────────────► [ fin: firmado ]
   │                            │
   │ (MC/ESP: firmar con PIN)    │ (DIR: anular — solo pre-HOJA_ING)
   │                            ▼
   └──────────────────────► anulado
```

| Estado     | Descripción                                                       |
|------------|-------------------------------------------------------------------|
| `borrador` | Creada pero no firmada. Editable.                                  |
| `firmado`  | Firmada con PIN argon2id. Inmutable. Habilita HOJA_ING.           |
| `anulado`  | Cancelada por DIR antes de que exista HOJA_ING activa.            |

---

## Roles

| Acción       | Rol requerido              | Descripción                                    |
|--------------|----------------------------|------------------------------------------------|
| `list`, `get`| MC, ESP, ENF, ARCH, DIR, ADM | Lectura                                      |
| `create`     | MC, ESP                    | El médico crea la orden                        |
| `firmar`     | MC, ESP                    | Firma electrónica con PIN argon2id             |
| `anular`     | DIR                        | Solo desde estado `firmado`, pre-HOJA_ING      |

---

## Campos del formulario clínico

| Campo               | Tipo      | Obligatorio | Restricciones BD                                   |
|---------------------|-----------|-------------|-----------------------------------------------------|
| `pacienteId`        | uuid      | Sí          | FK → `ece.paciente.id`                              |
| `episodioOrigenId`  | uuid      | No          | FK → `ece.episodio_atencion.id` (episodio de urgencia u otra procedencia) |
| `medicoOrdena`      | uuid      | Sí          | FK → `ece.personal_salud.id`                        |
| `fechaHoraOrden`    | timestamptz | Sí        | Default `now()`                                     |
| `modalidad`         | enum      | Sí          | `hospitalizacion` \| `hospital_de_dia`              |
| `motivoIngresoTipo` | enum      | No          | `cirugia` \| `emergencia` \| `hospitalizacion` \| `obs` \| `otro` |
| `procedencia`       | enum      | Sí          | `consulta_externa` \| `emergencia` \| `traslado_externo` \| `traslado_interno` \| `espontaneo` \| `otro` |
| `motivoIngreso`     | text      | Sí          | Mín. 10 chars                                       |
| `circunstanciaIngreso` | text   | Sí          | Mín. 5 chars                                        |
| `servicioIngresoId` | uuid      | No          | FK → `ece.servicio.id`                              |
| `procedimientoCie10`| text      | No          | Regex CIE-10 `^[A-Z]\d{2}(\.\d{1,4})?$`           |
| `diagnosticoIngreso`| jsonb[]   | No          | Array `{cie10, descripcion, principal: bool}` mín. 1 si se provee |
| `reservaSalaQxId`   | uuid      | No          | FK → `ece.reserva_sala_qx.id`; obligatorio por política cuando `motivoIngresoTipo = 'cirugia'` |

---

## Relación con HOJA_ING (NTEC Art. 33 + Doc 12)

```
ORD_ING (firmado)
    │
    │  hoja_ingreso.orden_ingreso_id → ece.orden_ingreso.id
    ▼
HOJA_ING (borrador → firmado → validado)
```

La columna `ece.hoja_ingreso.orden_ingreso_id` referencia a `ece.orden_ingreso.id`. El router `eceHojaIngreso.create` valida que la orden exista antes de crear la hoja, y rechaza CONFLICT si ya existe una hoja activa para la misma orden.

**Regla NTEC:** no puede existir una HOJA_ING sin una ORD_ING firmada que la preceda. La ORD_ING no puede anularse una vez que la HOJA_ING asociada está en estado `firmado` o `validado` (enforcement en `eceHojaIngreso.create`).

---

## Relación con reserva quirúrgica

Cuando `motivoIngresoTipo = 'cirugia'`, el campo `reserva_sala_qx_id` enlaza la orden con `ece.reserva_sala_qx`. Esto permite al equipo de pabellón conocer la llegada programada del paciente y confirmar la sala asignada.

```
ORD_ING (cirugia)
    │
    │  orden_ingreso.reserva_sala_qx_id → ece.reserva_sala_qx.id
    ▼
reserva_sala_qx (programada → confirmada)
```

---

## Eventos de dominio

| EventType                       | Cuándo se emite                                    |
|---------------------------------|----------------------------------------------------|
| `ece.orden_ingreso.creada`      | `create` exitoso (borrador)                        |
| `ece.orden_ingreso.firmada`     | `firmar` exitoso; payload incluye `contentHash`    |
| `ece.orden_ingreso.anulada`     | `anular` exitoso; payload incluye `motivoAnulacion`|

---

## Drift conocido / decisiones de implementación

1. **`episodio_id` vs `episodio_origen_id`:** La tabla tiene ambas columnas. `episodio_origen_id` es el episodio previo que generó la indicación de ingreso (ej. atención de urgencias). `episodio_id` es el episodio hospitalario que se crea una vez que el ingreso es efectivo (lo setea HOJA_ING o el proceso de admisión). En `create` solo se provee `episodio_origen_id`; `episodio_id` se actualiza posteriormente.

2. **`estado_registro` vs estado workflow:** `orden_ingreso.estado_registro` solo refleja vigencia del registro (`vigente|rectificado`). El estado del flujo clínico (`borrador|firmado|anulado`) vive en `documento_instancia.estado_actual_id → flujo_estado.codigo`. Los schemas Zod usan los valores de BD para cada campo.

3. **Anulación:** Solo se permite desde `firmado`. Si la HOJA_ING ya existe y está activa, la anulación de la orden es un proceso administrativo que requiere intervención del ARCH/DIR en ambos documentos.

4. **`medicoOrdena`:** Se recibe como UUID de `ece.personal_salud`. El router resuelve el personal activo del usuario y lo usa como firmante. Si `medicoOrdena` difiere del usuario logueado, ambos quedan registrados (el campo `medico_ordena` en BD + el `ejecutado_por` en el historial de instancia).
