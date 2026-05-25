# Diferenciación Admisión / Asignación de Cama / Ingreso

**Fuente normativa:** ISSS — *Manual de Normas y Procedimientos para Otorgar Atención Médica Hospitalaria* (MNP-S-138, Versión 3.0, Mayo 2019), Subdirección de Salud.

**Propósito:** establecer la semántica correcta de los 3 hitos del ciclo hospitalario para que el HIS los pueda discriminar y, en consecuencia, **determinar qué productos y servicios facturar/registrar en cada fase**.

---

## 1. Marco normativo

El proceso *"Otorgar atención médica hospitalaria"* del ISSS se descompone en **4 procedimientos** secuenciales (MNP-S-138 §9):

| # | Procedimiento | Disparador | Responsable |
|---|---|---|---|
| 9.1 | **Asignación de cama** | Solicitud de hospitalización desde emergencia/consulta | Médico jefe/coordinador + Enfermera jefe servicio |
| 9.2 | **Ingreso del paciente** al servicio de hospitalización | Llegada física + documentación completa | Recepción central / Secretaría clínica / Enfermería |
| 9.3 | **Atención** de pacientes hospitalizados | Estancia activa | Médico tratante + Equipo de enfermería |
| 9.4 | **Egreso** | Alta clínica o defunción | Médico tratante |

La **Norma General 5** del manual fija la unidad de medida y la **Norma General 6** establece de forma explícita el momento que arranca el reloj:

> *"Los días de hospitalización es la suma de todos los días que un paciente ha estado ingresado en un centro de atención. Para el cálculo del período de hospitalización de un paciente se tomará el tiempo de estancia partiendo de **la fecha y hora que contenga la Hoja de ingreso, observación, hospitalización y alta (SAFISSS 130201132)**."*

Esto significa que **"ingreso" tiene un significado normativo preciso** y diferente al de "admisión" en el sentido coloquial.

---

## 2. Los tres hitos diferenciados

### 🔵 Hito 1 — **Admisión** (decisión clínica)
- **Qué es:** la decisión médica de hospitalizar al paciente. Es el momento en que un médico de emergencia / consulta externa / quirófano indica que el paciente requiere internación.
- **Quién:** Médico especialista (emergenciólogo, consulta externa o cirujano).
- **Evidencia:** orden médica registrada en el expediente (futuro: documento NTEC `ORD_ING`).
- **No implica:** ni cama asignada, ni paciente físicamente en sala de hospitalización.
- **MNP-S-138 §9.1 Norma 2:** *"El Médico será responsable de indicar el ingreso del paciente, generando con esto la Hoja de ingreso, observación, hospitalización y alta (SAFISSS 130201132)."*

### 🟡 Hito 2 — **Asignación de cama** (reserva operativa)
- **Qué es:** la reserva de una cama física específica del servicio de hospitalización para el paciente ya admitido.
- **Quién:** Médico encargado del servicio / Enfermera de servicio de hospitalización.
- **Evidencia:** asiento en `ece.asignacion_cama` con `activa=true`.
- **No implica:** que el paciente esté ocupando la cama todavía (puede haber traslado en curso desde emergencia, espera de camilla, etc.).
- **MNP-S-138 §9.1 Norma 1:** *"El médico encargado y/o enfermera de servicio de hospitalización verifica disponibilidad de camas..."*

### 🟢 Hito 3 — **Ingreso** (recepción física + inicia día-cama)
- **Qué es:** el momento en que el paciente es físicamente recibido en el servicio de hospitalización, identificado con brazalete, y se le abre la Hoja de Ingreso.
- **Quién:** Recepción Central / Secretaría Clínica + Enfermería de servicio.
- **Evidencia:** Hoja SAFISSS 130201132 firmada con fecha y hora; pulsera GSRN colocada (IPSG.1 JCI).
- **Implica:** **arranca el cómputo del día-cama** (Norma General 6).
- **MNP-S-138 §9.2 Normas 1, 3 y 4:** documentación verificada, recepción por enfermería, custodia de pertenencias.

### 🔴 Hito 4 — **Egreso** (alta / defunción / traslado)
- **Qué es:** salida del paciente del servicio. Cierra el cómputo día-cama.
- **Quién:** Médico tratante + enfermería + recepción.
- **Evidencia:** Hoja SAFISSS 130201132 sección "Alta" + Hoja de Referencia y Retorno + Resumen Clínico + Certificado de Defunción (si aplica).

---

## 3. Estado actual del HIS — gap identificado

El modelo `InpatientAdmission` actual de la BD condensa los 3 primeros hitos en un único campo `admittedAt`:

```prisma
model InpatientAdmission {
  id              String  @id
  encounterId     String  @unique
  attendingId     String              // ← médico tratante (decisión clínica)
  admittedAt      DateTime            // ← ambiguo: ¿hito 1, 2 o 3?
  expectedLos     Int?
  reason          String
  status          InpatientStatus     // ACTIVE | DISCHARGED | ...
  dischargedAt    DateTime?
  ...
}
```

**Problema:** sin separar los hitos, el HIS no puede:

1. Determinar **qué facturar** en cada fase (día-cama solo arranca tras el Hito 3).
2. Detectar **paciente admitido pero no físicamente ingresado** (espera de cama, traslado en curso).
3. Cumplir la **Norma General 6** del ISSS para el cálculo del día-cama.
4. Generar reportes operativos diferenciados (tiempo decisión→cama, tiempo cama→ingreso, etc.).

---

## 4. Modelo propuesto

### 4.1 Columnas nuevas en `InpatientAdmission`

| Columna | Tipo | Hito | Descripción |
|---|---|---|---|
| `admissionDecidedAt` | `timestamptz` | 1 | Decisión médica de hospitalizar |
| `admissionDecidedById` | `uuid` | 1 | Médico que indicó el ingreso |
| `bedAssignedAt` | `timestamptz?` | 2 | Cuándo se asignó cama física |
| `bedAssignedById` | `uuid?` | 2 | Médico/enfermera que asignó |
| `bedId` | `uuid?` | 2 | FK a `public."Bed"` |
| `physicalAdmittedAt` | `timestamptz?` | 3 | **Recepción física — inicia día-cama** |
| `physicalAdmittedById` | `uuid?` | 3 | Enfermera/recepción que recibió |
| `wristbandPlacedAt` | `timestamptz?` | 3 | Brazalete GSRN colocado (IPSG.1) |
| `admissionFormNumber` | `varchar(40)?` | 3 | N° SAFISSS 130201132 |

**Mantener** `admittedAt` actual como **alias semántico** = `physicalAdmittedAt` (Norma 6 ISSS) para no romper consumidores existentes. La columna queda como sinónimo computado.

### 4.2 Enum `InpatientStatus` extendido

| Valor actual | Valor nuevo |
|---|---|
| — | `ADMISSION_DECIDED` — médico indicó ingreso, sin cama |
| — | `BED_ASSIGNED` — cama reservada, sin recibir paciente |
| `ACTIVE` | `ADMITTED` *(renombrado, físicamente en sala)* |
| — | `DISCHARGE_PENDING` — alta firmada, esperando salida |
| `DISCHARGED` | `DISCHARGED` *(sin cambio)* |
| `CANCELLED` | `CANCELLED` *(sin cambio — admisión decidida pero cancelada antes de cama)* |

Transiciones permitidas:

```
ADMISSION_DECIDED ──┬──→ BED_ASSIGNED ──→ ADMITTED ──→ DISCHARGE_PENDING ──→ DISCHARGED
                    │
                    └──→ CANCELLED (decisión revertida pre-cama)
```

### 4.3 Productos / Servicios discriminables por hito

Una vez la BD diferencia los hitos, el HIS puede emitir/facturar correctamente:

| Hito | Productos asociados | Centro de costo | Nota |
|---|---|---|---|
| 🔵 ADMISSION_DECIDED | Consultas emergencia, observación, exámenes urgentes | T-ATN-EME (emergencia) | Sin día-cama |
| 🟡 BED_ASSIGNED | (sin nuevos cargos) — cama reservada consume disponibilidad pero no genera ingresos | — | Útil para gestión de capacidad |
| 🟢 ADMITTED | **Día-cama** (Norma 6) + dieta + enfermería + medicación intrahospitalaria + estudios + interconsultas | T-ATN-HOS (hospitalización) | Punto de arranque facturable |
| 🔴 DISCHARGE_PENDING | Cierre de cargos + facturación + certificado de incapacidad ISSS | — | Trigger del egreso administrativo |

Esto permite generar la **factura correcta** sin caer en el error común de cobrar día-cama desde la decisión clínica (que es lo que está pasando si el sistema usa `admittedAt` como único timestamp).

---

## 5. Bridge ECE↔HIS

El motor de workflow ECE ya tiene los documentos NTEC relevantes — solo falta cablear los hitos:

| NTEC Doc | Hito que activa | Ya existente |
|---|---|---|
| `ORD_ING` (Orden de Ingreso) | Hito 1: ADMISSION_DECIDED | ✅ |
| Asignación cama (`ece.asignacion_cama`) | Hito 2: BED_ASSIGNED | ✅ |
| `HOJA_ING` (Hoja de Ingreso SAFISSS 130201132) | Hito 3: ADMITTED | ✅ |
| `EPICRISIS` | Hito 4: DISCHARGED | ✅ |

Los bridges existentes (`bridge-admision.router.ts`, `bridge-encounter.router.ts`) ya pueden cablearse a los nuevos timestamps con cambios menores.

---

## 6. Impacto en reportes MINSAL / ISSS

Reportes que se desbloquean correctamente al diferenciar los hitos:

1. **Tiempo de espera de cama** — `bedAssignedAt − admissionDecidedAt`. KPI operativo crítico ISSS.
2. **Tiempo de respuesta de servicio** — `physicalAdmittedAt − bedAssignedAt`. Mide eficiencia del traslado.
3. **Día-cama promedio (real)** — `dischargedAt − physicalAdmittedAt`. Cumple Norma 6.
4. **Tasa de admisiones canceladas** — `CANCELLED ÷ ADMISSION_DECIDED`. Indica reversiones clínicas.
5. **Ocupación efectiva** — separar camas asignadas (reservadas) vs camas ocupadas (paciente físicamente).

---

## 7. Plan de adopción (incremental, sin breaking changes)

### Fase 1 — Migración SQL aditiva (este PR)
- Agregar las 9 columnas nuevas a `InpatientAdmission` (todas nullable).
- Agregar valores nuevos al enum `InpatientStatus` (ADMISSION_DECIDED, BED_ASSIGNED, DISCHARGE_PENDING).
- **No** renombrar `ACTIVE` → `ADMITTED` (compatibilidad). Marcar como equivalente vía comentario.
- **No** tocar routers ni UI.

### Fase 2 — Backfill (opcional)
Para admisiones históricas: `physicalAdmittedAt := admittedAt` (asumir que ese timestamp era el ingreso físico).

### Fase 3 — Routers
- Actualizar `bridge-admision.router.ts` para escribir los 3 timestamps en cada hito.
- Nuevo procedure `inpatient.confirmarRecepcionFisica` para Hito 3.
- Nuevo procedure `inpatient.cancelarPreCama` para Hito 1 → CANCELLED.

### Fase 4 — UI
- Página `/admission` con stepper de 3 hitos.
- Indicador en mapa de camas: "asignada sin ocupar" vs "ocupada".
- Dashboard ejecutivo: KPIs de tiempo entre hitos.

### Fase 5 — Facturación
- Cargo día-cama solo a partir de `physicalAdmittedAt`.
- Auditoría retroactiva: detectar facturas cobradas desde `admissionDecidedAt`.

---

## 8. Referencias

- **MNP-S-138 v3.0** (ISSS, Mayo 2019) — *Manual de Normas y Procedimientos para Otorgar Atención Médica Hospitalaria*.
- **SAFISSS 130201132** — Hoja de ingreso, observación, hospitalización y alta.
- **Norma para el expediente clínico en el ISSS** (vigente).
- **TDR HIS Multipaís** §12 — Hospitalización.
- **NTEC El Salvador** — Documentos `ORD_ING`, `HOJA_ING`, `EPICRISIS`.
- **JCI IPSG.1** — Identificación correcta del paciente con brazalete (relacionado con `wristbandPlacedAt`).
