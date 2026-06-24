# Requerimiento — Identidad de Paciente, Expediente Único y Cuentas

**Proyecto:** HIS Multipaís · **Tipo:** Requerimiento funcional + técnico para Claude Code
**Alcance transversal:** modelo de datos, capa de servicios (tRPC), validación, UI de registro/admisión, multitenancy (RLS).

> **Cómo usar este documento.** Ejecutar en **dos fases**: primero la **auditoría** del código existente (§13, Fase 1) y entregar un *reporte de brechas*; **no modificar código** hasta aprobar ese reporte. Luego implementar (§13, Fase 2) según las decisiones confirmadas en §11.

---

## 1. Objetivo

Garantizar que **todo paciente tenga un único número de expediente, permanente e inmutable**, derivado de su documento de identidad y su año de nacimiento, y que dicho expediente agrupe lógicamente **una o más cuentas**, cada una compuesta por **uno o más servicios** (hospitalarios o no hospitalarios), **independientemente de si el paciente fue admitido o no** en el hospital.

## 2. Entidades y glosario

| Entidad | Definición |
|---|---|
| **Expediente** | Identificador clínico único y **permanente** del paciente. |
| **Documento de identidad** | Documento que identifica al paciente o, en menores, a su responsable. |
| **Cuenta** | Agrupador lógico-financiero de servicios bajo un expediente. |
| **Servicio** | Prestación hospitalaria o ambulatoria asociada a una cuenta. |
| **País / Tenant** | Dominio multipaís. El código de país forma parte del expediente y **delimita las secuencias y la unicidad** (RLS). |

## 3. Tipos de documento

| Código (enum) | Tipo | Aplica a | Validación |
|---|---|---|---|
| `DUI` | Documento Único de Identidad | Salvadoreños ≥ 18 | Formato `########-#` + dígito verificador SV (reutilizar utilidad existente si la hay). |
| `DNI` | Documento Nacional de Identidad | Extranjeros con DNI | Formato según país emisor. |
| `PASAPORTE` | Pasaporte | Extranjeros | Alfanumérico. |
| `DUI_RESP` | **DUI de Responsable** | Menores de edad sin documento propio (SV) | El documento **pertenece al adulto responsable**, no al paciente. Requiere capturar datos del responsable. |

## 4. Formato del expediente

```
{PAIS}{AA}{NNNNN}
```

- **PAIS** — código ISO de país, parametrizable por tenant (`SV`, `GT`, `HN`, …). *Multipaís: no fijar `SV` por código.*
- **AA** — dos últimos dígitos del **año de nacimiento del paciente** (1987 → `87`; 2004 → `04`).
- **NNNNN** — correlativo auto-incremental de **5 dígitos** con relleno de ceros, inicia en `00001`.
- **Ejemplo:** `SV8400001` → salvadoreño nacido en 1984, primer correlativo de esa secuencia.

**Reglas:**
1. El expediente se asigna **una sola vez** al registrar/admitir y es **inmutable** (§6).
2. La unicidad del string se garantiza **por construcción** si el correlativo se versiona por la clave `(país, AA)` (ver Decisión #1 y Riesgo #1).
3. El **año de nacimiento completo** se almacena aparte en el modelo (precisión clínica); `AA` es solo presentación dentro del expediente.

## 5. Unicidad documento ↔ expediente

| Tipo de documento | ¿Único? | Regla |
|---|---|---|
| `DUI`, `DNI`, `PASAPORTE` (documentos propios) | **Sí (1:1)** | Un mismo documento propio **no puede** asociarse a dos expedientes. Si en admisión el documento ya existe, **recuperar el expediente existente** (no crear uno nuevo). |
| `DUI_RESP` (documento del responsable) | **No** | Un adulto responsable puede tener **varios menores** → el **mismo `DUI_RESP` puede asociarse a varios expedientes** (uno por menor). |

**Caso compuesto:** el adulto responsable puede a su vez ser paciente con su **propio DUI** → ese DUI propio genera su **propio expediente**, independiente de su rol como responsable.

> **Nota de alcance:** el emparejamiento de un mismo individuo con varios tipos de documento (p. ej. la misma persona con DUI y pasaporte) y la identidad única **entre países** quedan **fuera de alcance** — el formato hace el expediente intrínsecamente *país-dependiente*.

## 6. Inmutabilidad y transición menor → adulto

- El número de expediente **nunca cambia**. Correcciones de documento, nombre o fecha de nacimiento **no** lo regeneran (es un identificador opaco tras su emisión; el `AA` conserva el valor original aunque se corrija la fecha).
- **Transición de menor a adulto** (el menor obtiene su DUI):
  - El expediente **permanece igual**.
  - El `document_type` cambia de `DUI_RESP` a `DUI` propio.
  - Se registra el cambio en **auditoría** y se archiva la relación con el responsable.

## 7. Cuentas y servicios

- **Formato de cuenta:** `CTA{NNNNN}` (`CTA` + 5 dígitos, inicia `CTA00001`).
- **Relaciones:**
  - Expediente **1 — N** Cuenta.
  - Cuenta **1 — N** Servicio (`HOSPITALARIO` | `NO_HOSPITALARIO`).
  - Un servicio pertenece a **exactamente una** cuenta; una cuenta a **exactamente un** expediente.
- Las cuentas y servicios se generan **con o sin admisión hospitalaria** (un paciente ambulatorio también genera cuenta).

## 8. Modelo de datos (recomendado — Prisma / PostgreSQL)

> Mapear contra el esquema real durante la auditoría; los nombres son orientativos.

```prisma
enum DocumentType { DUI DNI PASAPORTE DUI_RESP }
enum TipoServicio { HOSPITALARIO NO_HOSPITALARIO }

model Paciente {
  id             String   @id @default(cuid())
  countryCode    String                 // 'SV', 'GT', ...
  expediente     String   @unique       // SV8400001 (inmutable)
  birthDate      DateTime               // fecha completa; AA deriva de aquí
  documentType   DocumentType
  documentNumber String
  // Responsable (ver Decisión #2): entidad aparte o campos embebidos
  cuentas        Cuenta[]
  // @@índice único parcial (abajo), por documento propio
}

model Cuenta {
  id          String       @id @default(cuid())
  pacienteId  String
  numeroCuenta String                    // CTA00001 (ver Decisión #3)
  servicios   Servicio[]
  paciente    Paciente     @relation(fields: [pacienteId], references: [id])
}

model Servicio {
  id        String       @id @default(cuid())
  cuentaId  String
  tipo      TipoServicio
  cuenta    Cuenta       @relation(fields: [cuentaId], references: [id])
}
```

**Índice único parcial** (unicidad solo para documentos propios; excluye `DUI_RESP`):

```sql
CREATE UNIQUE INDEX uq_documento_propio
ON "Paciente" (country_code, document_type, document_number)
WHERE document_type IN ('DUI','DNI','PASAPORTE');
```

**Tabla de secuencias** (correlativos): `secuencia_expediente(country_code, aa, last_value)` y, según Decisión #3, `secuencia_cuenta(...)`.

## 9. Generación concurrente de correlativos (atomicidad)

Los correlativos **deben** generarse de forma atómica para evitar duplicados bajo registros simultáneos. Opciones (en orden de preferencia para Supabase):

1. **Función `plpgsql` / RPC `SECURITY DEFINER`** que reserve y devuelva el siguiente correlativo dentro de una transacción.
2. `UPDATE secuencia ... RETURNING` o `SELECT ... FOR UPDATE` sobre la fila de contador.
3. Inserción optimista con `UNIQUE` + **reintento** ante colisión.

**Obligatorio:** generar el correlativo **en el servidor/DB, nunca en el cliente**, y respetar **RLS por tenant**.

## 10. Validaciones (Zod / tRPC)

- `birthDate` **obligatoria** (deriva `AA`).
- `DUI`: formato + dígito verificador SV. `DNI`/`PASAPORTE`: formato por país.
- `DUI_RESP`: **solo para menores de edad** (< 18 según país) y **requiere datos del responsable** (nombre, parentesco, su DUI).
- En admisión con documento propio ya existente → **devolver expediente existente**, no crear.

## 11. Decisiones de diseño a confirmar

| # | Decisión | Recomendación | Trade-off |
|---|---|---|---|
| 1 | **Alcance del correlativo de expediente** | Por clave **`(país, AA)`** | Garantiza unicidad del string por construcción y aprovecha la capacidad (99 999 por bucket). Alternativa global por país agota antes y no resuelve colisión de siglo. |
| 2 | **Modelado del responsable** | **Entidad `ParteResponsable` separada**, referenciada por el menor | Evita duplicar datos cuando un responsable cubre varios menores y mantiene limpia la unicidad de documentos propios. Alternativa mínima: campos embebidos + índice parcial. |
| 3 | **Alcance del correlativo de cuenta** | **Por expediente** (cada paciente inicia en `CTA00001`) | Encaja con 5 dígitos; la unicidad es `(expediente, cuenta)`. Si se requiere `CTA` **único global**, hay que **ampliar dígitos** (5 → 99 999 totales/país se agota). |
| 4 | **Capacidad de 5 dígitos** | Confirmar si se acepta el límite o se amplía | 99 999 por secuencia. Definir política de desborde antes de producción. |

## 12. Riesgos

1. **Año de 2 dígitos (colisión de siglo).** 1984 y 2084 comparten `AA=84`. Mitigado por Decisión #1 (comparten secuencia → strings siempre únicos) + almacenar fecha completa. Persiste la **ambigüedad de lectura** del `AA`.
2. **Capacidad 99 999** por secuencia (expediente y cuenta). Definir monitoreo y política de desborde.
3. **Duplicación de pacientes** si la deduplicación por documento propio no se aplica en admisión → expedientes duplicados. Cubierto por §5 y la auditoría.

## 13. Tareas para Claude Code

### Fase 1 — Auditoría (entregar reporte de brechas, **sin modificar código**)
Revisar y reportar, con **archivo y línea**, el cumplimiento de:
1. **Esquema / migraciones:** ¿existe `expediente` único e inmutable? ¿enum de documentos **incluye `DUI_RESP`**? ¿índice único parcial correcto? ¿tablas `Cuenta`/`Servicio` con FKs y cardinalidades correctas?
2. **Generadores de correlativo:** ¿atómicos y *concurrency-safe*? ¿alcance correcto? ¿se generan en servidor/DB y no en cliente?
3. **Routers tRPC (registro/admisión):** ¿deduplican documento propio y **recuperan expediente existente**? ¿excluyen `DUI_RESP` de la regla 1:1?
4. **Validadores Zod:** ¿formato DUI/DNI/Pasaporte y `DUI_RESP` con responsable y edad?
5. **UI registro/admisión:** ¿captura tipo de documento, fecha de nacimiento y responsable? ¿muestra el expediente generado?
6. **Inmutabilidad:** ¿alguna ruta regenera/edita el expediente? Debe bloquearse.
7. **Multitenancy/RLS:** ¿secuencias y unicidad respetan el `country_code`/tenant?

➡️ **Entregable:** tabla de brechas (cumple / no cumple / parcial) + propuesta de corrección priorizada.

### Fase 2 — Implementación (tras aprobar §11 y el reporte)
Aplicar **cambios quirúrgicos** que cierren las brechas: migraciones, función/RPC de correlativo atómico, índice parcial, validadores, ajustes de routers y UI, y bloqueo de mutación del expediente. Incluir **pruebas** (unitarias + concurrencia).

## 14. Criterios de aceptación (Gherkin)

```gherkin
Característica: Expediente único de paciente y cuentas

  Escenario: Generar expediente para salvadoreño con DUI
    Dado un paciente salvadoreño nacido en 1984 con DUI válido
    Y es el primer registro en la secuencia SV-84
    Cuando se registra en el sistema
    Entonces se genera el expediente "SV8400001"
    Y queda asociado de forma única a su DUI

  Escenario: Documento propio existente recupera expediente
    Dado un DUI ya asociado a un expediente
    Cuando se intenta registrar nuevamente ese DUI
    Entonces el sistema recupera el expediente existente
    Y no genera un expediente nuevo

  Escenario: Menor con DUI de Responsable
    Dado un menor sin documento propio y un adulto responsable con DUI válido
    Cuando se registra al menor con tipo DUI_RESP
    Entonces el expediente usa el año de nacimiento del menor
    Y el DUI del responsable puede asociarse a otros menores

  Escenario: Un responsable con dos menores
    Dado un responsable con DUI "X"
    Y dos menores distintos registrados con DUI_RESP "X"
    Entonces existen dos expedientes distintos
    Y ambos referencian al mismo responsable

  Escenario: Transición de menor a adulto
    Dado un menor con expediente "SV1000001" registrado con DUI_RESP
    Cuando obtiene su propio DUI y se actualiza el registro
    Entonces el expediente "SV1000001" permanece sin cambios
    Y el tipo de documento cambia a DUI propio

  Escenario: Expediente con varias cuentas y servicios
    Dado un expediente "SV8400001"
    Cuando se le crean las cuentas "CTA00001" y "CTA00002"
    Y cada cuenta agrupa uno o varios servicios hospitalarios o no
    Entonces ambas cuentas pertenecen al mismo expediente

  Escenario: Cuenta sin admisión hospitalaria
    Dado un paciente ambulatorio no admitido
    Cuando recibe un servicio no hospitalario
    Entonces se genera una cuenta asociada a su expediente

  Escenario: Concurrencia sin duplicados
    Dado N registros simultáneos de pacientes
    Cuando se generan sus expedientes y cuentas
    Entonces no existen expedientes ni cuentas duplicados
```

## 15. Fuera de alcance

- Lógica de facturación DTE más allá de la relación cuenta ↔ servicio.
- Estados de cuenta (abierta/cerrada/facturada) salvo lo necesario para las relaciones.
- Refactorización de módulos no relacionados. **No** crear código antes de aprobar el reporte de brechas.
- Identidad única de un mismo paciente **entre países** y emparejamiento cruzado de documentos.
