# CERT_INC — Certificado de Incapacidad ISSS

## Metadata

- **codigo**: `CERT_INC`
- **nombre**: Certificado de Incapacidad ISSS
- **modalidad**: `ambulatorio` / `hospitalario` (ambos)
- **NTEC artículo**: §22 (Informes ISSS) — Reglamento de Evaluación de Incapacidades del ISSS El Salvador
- **modulo_his_target**:
  - Listado: `/ece/certificado-incapacidad`
  - Crear: `/ece/certificado-incapacidad/nuevo`
  - Detalle / firmar / anular: `/ece/certificado-incapacidad/[id]`
- **tabla_datos**: `ece.certificado_incapacidad` (creada en `124_certificado_incapacidad.sql`)
- **inmutable**: `false` en estado `borrador`; **`true` post-firma** (estado `firmado`). Tras firma solo se permite anulación con motivo documentado.
- **tipo_registro**: **CONDICIONAL** — obligatorio cuando el diagnóstico CIE-10 aplica a incapacidad temporal reconocida por el ISSS y el paciente es cotizante activo.

## Propósito normativo

El Reglamento de Evaluación de Incapacidades del ISSS (Acuerdo N.° 2003-01 y sus reformas) establece que todo médico tratante de un establecimiento afiliado o convenio ISSS debe expedir un **Certificado de Incapacidad** cuando el paciente requiere suspensión temporal de labores por:

1. **Enfermedad común** — patología no relacionada con el trabajo ni la maternidad.
2. **Accidente común** — lesión ocurrida fuera del lugar/tiempo de trabajo.
3. **Riesgo profesional / Accidente de trabajo** — lesión ocurrida en el lugar de trabajo o en trayecto (requiere coordinación con empleador y notificación ISSS Art. 13 Reglamento).
4. **Maternidad** — incapacidad prenatal y postnatal (Art. 309 y ss. Código de Trabajo SV).
5. **Paternidad** — licencia por nacimiento (Art. 309-A Código de Trabajo SV, 3 días hábiles).

El documento es el respaldo médico-legal para el pago de subsidio ISSS al cotizante y el comprobante que justifica la ausencia laboral ante el empleador (patrono).

## Dependencias

| Documento / Recurso | Obligatoriedad | Cuándo se exige |
|---|---|---|
| **FICHA_IDENT** (paciente registrado con DUI/NIT/NIE) | Obligatoria | Antes de crear cualquier documento ECE |
| **ATN_EMERG** o consulta equivalente | Recomendada (no bloqueante) | El certificado debe respaldarse en una atención documentada; sin episodio se permite en ambulatorio aislado |

## Obligatoriedad

**CONDICIONAL** — se genera cuando:

- El médico tratante determina incapacidad temporal ≥ 1 día.
- El paciente es cotizante activo ISSS (o derechohabiente en maternidad/paternidad).
- El establecimiento tiene convenio o habilitación ISSS para expedir certificados.

No aplica a pacientes sin afiliación ISSS (privados), aunque el campo `numero_afiliacion_isss` es opcional para capturar el NUI del paciente.

## Roles firmantes

| Rol (código RBAC) | Acción | Momento |
|---|---|---|
| `MC` (Médico General) | Crea borrador + firma | Al expedir el certificado |
| `PHYSICIAN` (Médico Especialista) | Crea borrador + firma | Ídem |
| `DIR` (Director Médico) | Lectura | Auditoría |
| `NURSE` | Lectura | Consulta |

Solo el médico que atiende al paciente (MC o PHYSICIAN) puede firmar. La firma es con PIN argon2id — patrón `ece.firma_electronica`.

## Campos obligatorios

| Campo | Tipo | Descripción |
|---|---|---|
| `paciente_id` | uuid | Paciente ECE |
| `medico_id` | uuid | Personal de salud que expide |
| `tipo_incapacidad` | enum | `enfermedad_comun` \| `accidente_comun` \| `riesgo_profesional` \| `maternidad` \| `paternidad` \| `accidente_trabajo` |
| `fecha_inicio` | date | Inicio de la incapacidad |
| `fecha_fin` | date | Fin de la incapacidad (≥ `fecha_inicio`) |
| `dias_otorgados` | int (calculado) | `(fecha_fin - fecha_inicio + 1)` — generado por BD |
| `diagnostico_cie10` | text | Código CIE-10 (regex `^[A-Z][0-9]{2}(\.[0-9]{1,2})?$`) |
| `diagnostico_descripcion` | text | Descripción ≥ 10 chars |

## Campos opcionales ISSS

| Campo | Tipo | Descripción |
|---|---|---|
| `numero_afiliacion_isss` | text | NUI del trabajador (9 dígitos) |
| `patrono_nit` | text | NIT del empleador |
| `observaciones` | text | Notas adicionales |
| `episodio_id` | uuid | Episodio hospitalario/ambulatorio de origen (omisible en certificados aislados) |

## Estados

| Estado | Descripción |
|---|---|
| `borrador` | Creado, editable, no válido para ISSS |
| `firmado` | Firmado por MC/PHYSICIAN con PIN — válido para ISSS |
| `anulado` | Anulado por el médico con motivo documentado (irreversible) |

## Transiciones

```
borrador ──(firmar + PIN)──► firmado ──(anular + motivo)──► anulado
```

Solo se puede anular un certificado en estado `firmado`. Un certificado en `borrador` se descarta sin anulación formal.

## Eventos de dominio

| EventType | Cuándo |
|---|---|
| `ece.certificado_incapacidad.firmado` | Firma exitosa con PIN |
| `ece.certificado_incapacidad.anulado` | Anulación con motivo |

Los eventos se emiten al outbox (`audit.event_outbox`) vía `emitDomainEvent` y quedan en el hash-chain de auditoría (TDR §6.3).

## Descripción markdown (workflow-designer WYSIWYG)

> El **Certificado de Incapacidad ISSS** es el documento clínico-legal que el médico tratante expide cuando el paciente cotizante activo requiere suspensión temporal de labores por enfermedad, accidente o maternidad/paternidad, con arreglo al Reglamento de Evaluación de Incapacidades del ISSS El Salvador.
>
> **Proceso:**
> 1. El médico abre el formulario, selecciona el tipo de incapacidad, ingresa el rango de fechas y el diagnóstico CIE-10.
> 2. El sistema calcula automáticamente los días otorgados.
> 3. El médico firma con su PIN electrónico → el certificado queda en estado `firmado` y es válido para presentación ante el ISSS y el empleador.
> 4. Si se detecta un error después de la firma, el médico puede anular el certificado con motivo documentado (irreversible) y expedir uno nuevo.
>
> **Campos ISSS críticos:**
> - `numero_afiliacion_isss` (NUI) — identificador del cotizante en ISSS.
> - `patrono_nit` — NIT del empleador para notificaciones de riesgo profesional.
>
> **Normativa de referencia:** Reglamento de Evaluación de Incapacidades ISSS (Acuerdo N.° 2003-01 y reformas) — Art. 3 (tipos), Art. 13 (riesgo profesional), Art. 21 (formato).

## Drift conocido

- La tabla `ece.certificado_incapacidad` fue creada en `124_certificado_incapacidad.sql` el 2026-05-24. El tipo `CERT_INC` en `ece.tipo_documento` ya existía con `tabla_datos = 'certificado_incapacidad'` desde el seed Fase 2.
- `schema.prisma` no incluye el modelo `CertificadoIncapacidad` — la tabla opera con raw SQL dentro de `withWorkflowContext` (patrón estándar ECE).
