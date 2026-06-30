# REQ-ECE-EVOLUCION-MEDICA
## Incorporación del módulo "Evolución Médica" (nota SOAP) al HIS Multipaís
**Producto:** HIS Multipaís · Complejo Avante (El Salvador)
**Tipo:** Requerimiento de implementación para Claude Code
**Idioma de la UI:** español (es-SV)
**Fidelidad exigida:** 100 % a la funcionalidad y al diseño del mockup.

---

## 1. Objetivo

Incorporar al HIS la pantalla **Evolución Médica** reproduciendo **al 100 %** la funcionalidad y el diseño del mockup ya validado, conectándola al modelo de datos real (Prisma + Supabase/PostgreSQL). Como parte del trabajo:

1. **Agregar a la base de datos todos los campos que el formulario necesite y que aún no existan**, de forma **aditiva y no destructiva**.
2. **Verificar la consistencia de las estructuras del formulario contra la base de datos del HIS y contra el ORM (Prisma)**, dejando los tres planos alineados: *campo de UI ↔ columna en PostgreSQL ↔ modelo/campo en Prisma*.

No se permite degradar ni simplificar ninguna conducta del mockup para "encajar" en el esquema actual: si el esquema no soporta un campo o una relación, **se extiende el esquema**, no se recorta el formulario.

---

## 2. Fuentes de verdad (no reinterpretar)

| Artefacto | Rol | Uso |
|---|---|---|
| `evolucion-medica-avante.html` | **Fuente de verdad de UI/UX y comportamiento** | Replicar layout, secciones, modales, estados, validaciones, cálculos y microinteracciones exactamente. |
| `spec-mockup-evolucion-medica.md` | Especificación funcional del mockup | Detalle de tokens, rangos, umbrales, fórmulas, datos de muestra y criterios. |
| **Este documento (REQ-ECE-EVOLUCION-MEDICA)** | Requerimiento de integración al HIS | Modelo de datos, verificación de consistencia, migraciones, contratos backend. |

Ante cualquier discrepancia entre este documento y el mockup respecto a **comportamiento o apariencia**, **manda el mockup**. Este documento manda en lo relativo a **persistencia, modelo de datos y backend**.

---

## 3. Stack y restricciones

- **Frontend:** Next.js (App Router), React, TypeScript. **Diseño: Avante DS v2.0** (tokens OKLCH, primarios navy/teal, tipografía Inter). La paridad visual con el mockup se logra mapeando los colores/medidas del mockup a los **tokens del DS** (§12), no copiando hex sueltos.
- **API:** tRPC con validación **Zod** en cada procedimiento.
- **ORM:** Prisma. **BD:** Supabase/PostgreSQL. **Hosting:** Vercel.
- **Reglas clínicas** (rangos, umbrales de alerta, conversiones, fórmulas) viven en **un único módulo compartido** y son la misma fuente para el frontend y el backend (paridad garantizada).
- **Sin** lógica de negocio duplicada entre capas; **sin** valores mágicos dispersos.

---

## 4. Arquitectura de implementación

```
app/(ece)/expedientes/[expedienteId]/cuentas/[cuentaId]/evolucion/[evolucionId]/page.tsx
components/ece/evolucion/…            → secciones SOAP, modales, sub-bloques (Plan + Misceláneos)
server/api/routers/evolucion.ts       → tRPC: create/update/get/firmar/list
server/api/routers/catalogos.ts       → especialidades, catálogo de exámenes
server/api/routers/expediente.ts       → updateContactoEmergencia
lib/ece/evolucion/clinica.ts          → rangos, umbrales, conversiones, IMC, ICT, Glasgow, FPP (compartido FE/BE)
lib/ece/evolucion/contract.ts         → CONTRATO DEL FORMULARIO (inventario canónico, §5) — única fuente para Zod y para la verificación de consistencia
prisma/schema.prisma                  → modelos (extendidos/reconciliados, §6)
prisma/migrations/…                   → migraciones aditivas (§8)
```

La pantalla **se embebe en el shell real** del HIS (sidebar + header de sesión del HIS). El mockup viene **sin** shell; al integrarlo, el encabezado de paciente sticky debe anclarse **debajo** del header del HIS fijando la variable `--app-header-h` a la altura real de ese header (ver mockup, clase `.px-sticky`).

---

## 5. Contrato del formulario (inventario canónico de campos)

Esta tabla es el **contrato**: cada campo de UI debe existir como columna en PostgreSQL y como campo en Prisma, con el tipo y la obligatoriedad indicados. Codificar este inventario en `lib/ece/evolucion/contract.ts` como la **única fuente** para (a) generar/derivar los Zod, y (b) ejecutar la verificación de consistencia (§7).

> Convención: **[N]** = campo probablemente **NUEVO** (verificar y crear si no existe). **[D]** = valor **derivado** (no se digita; se calcula en `clinica.ts`; ver regla de persistencia en §6.4).

### 5.1 Encabezado de paciente (lectura desde Expediente/Cuenta; emergencia editable)
| Campo UI | Entidad.columna | Tipo Prisma / PG | Oblig. | Notas |
|---|---|---|---|---|
| Nombre | Expediente.nombre | String / text | R | lectura |
| Código expediente | Expediente.codigo | String / text | R | formato país+aa+correlativo (existente) |
| Código cuenta | Cuenta.codigo | String / text | R | lectura |
| Edad | (derivado de fechaNacimiento) | Int / — | R | calcular, no persistir |
| DUI | Expediente.dui | String / text | R | lectura |
| Sexo | Expediente.sexo | Enum Sexo (F/M) | R | gobierna condicionales gineco |
| Fecha de nacimiento | Expediente.fechaNacimiento | DateTime / date | R | lectura |
| Tipo de cuenta | Cuenta.tipo | Enum TipoCuenta (CONVENIO/PRIVADO/…) | R | chip |
| Domicilio | Expediente.domicilio | String / text | R | lectura |
| Alergias | Expediente.alergias | String? / text | O | banner verde/ámbar **[N posible]** |
| Nombre de pila | Expediente.nombrePila | String? / text | O | nota de preferencia **[N]** |
| Nota de preferencia (inclusiva) | Expediente.notaPreferencia | String? / text | O | **[N]** |
| Emergencia — nombre | Expediente.emergenciaNombre | String? / text | O | editable (modal) **[N]** |
| Emergencia — parentesco | Expediente.emergenciaParentesco | String? / text | O | editable (modal) **[N]** |
| Emergencia — teléfono | Expediente.emergenciaTelefono | String? / text | O | editable (modal) **[N]** |

> Si hoy el contacto de emergencia existe como **un solo campo de texto**, normalizarlo a los **tres** campos anteriores y migrar los datos existentes con un parser (formato `NOMBRE (PARENTESCO) — TELÉFONO`). No perder datos.

### 5.2 Cabecera de la Evolución (EvolucionMedica)
| Campo UI | Columna | Tipo | Oblig. | Notas |
|---|---|---|---|---|
| Especialidad médica | especialidadId **o** especialidad | FK Especialidad / String | **Sí** | catálogo ~34 (§11) |
| Subjetivo | subjetivo | String / text | **Sí** | textarea |
| Objetivo (registro) | objetivo | String / text | **Sí** | textarea |
| Evaluación / Análisis | analisis | String / text | **Sí** | textarea |
| Estado | estado | Enum EstadoEvolucion (BORRADOR/FIRMADA) | Sí | gating firma |
| Médico | medicoId | FK Usuario/Medico | Sí | autor |
| Fecha creación | createdAt | DateTime | Sí | auto |
| Fecha de firma | firmadaEn | DateTime? | — | al firmar |

### 5.3 Problemas (Problema, con agrupación sindrómica)
| Campo UI | Columna | Tipo | Oblig. | Notas |
|---|---|---|---|---|
| Descripción del problema | descripcion | String / text | **≥1** | |
| Código diagnóstico | cie11Codigo | String? / text | O | **CIE-11** (§11) **[N posible]** |
| Agrupación "Problema Sindrómico" | parentId | self-FK Problema | O | padre = grupo sindrómico |
| Nombre del grupo sindrómico | grupoNombre | String? / text | O | en el nodo padre |
| Tipo | tipo | Enum (INDIVIDUAL/SINDROMICO) | Sí | |
| Orden | orden | Int | Sí | |

### 5.4 Signos vitales (SignosVitales)
Núcleo obligatorio (7) + opcionales. Rangos = validación dura (idénticos al mockup).

| Campo UI | Columna | Tipo | Rango | Oblig. |
|---|---|---|---|---|
| TA sistólica | sistolica | Int | 60–260 | **Sí** |
| TA diastólica | diastolica | Int | 40–160 | **Sí** |
| Frecuencia cardíaca | fc | Int | 30–220 | **Sí** |
| Frecuencia respiratoria | fr | Int | 4–60 | **Sí** |
| Temperatura (°C) | temperatura | Decimal | 30–43 | **Sí** |
| SpO₂ (%) | spo2 | Int | 50–100 | **Sí** |
| FiO₂ (%) | fio2 | Int | 21–100 | **Sí** (def. 21) |
| Glasgow ocular | glasgowOcular | Int? | 1–4 | O |
| Glasgow verbal | glasgowVerbal | Int? | 1–5 | O |
| Glasgow motor | glasgowMotor | Int? | 1–6 | O |
| Glasgow total | glasgowTotal | Int? | 3–15 | **[D]** |
| Glucometría (mg/dL) | glucometria | Int? | 10–900 | O |
| Peso (kg) | pesoKg | Decimal? | 0.5–400 | O (canónico; lb es conversión) |
| Talla (m) | tallaM | Decimal? | 0.3–2.5 | O (canónico; ft es conversión) |
| IMC (kg/m²) | imc | Decimal? | — | **[D]** |
| Perímetro de cintura (cm) | perimetroCintura | Decimal? | 30–250 | O |
| **Índice cintura-talla** | indiceCinturaTalla | Decimal? | — | **[D] [N]** |
| Balance hídrico (mL) | balanceHidrico | Int? | −20000…20000 | O |
| Diuresis (mL/h) | diuresis | Int? | 0–2000 | O |
| FUR | fur | DateTime? (date) | — | O · solo sexo F |
| FPP | fpp | DateTime? (date) | — | **[D]** · solo F 10–55 |
| Gestas (G) | gestaG | Int? | ≥0 | O · solo F |
| Partos a término (P) | partoTermino | Int? | ≥0 | O · solo F |
| Partos pretérmino (P) | partoPretermino | Int? | ≥0 | O · solo F |
| Abortos (A) | abortos | Int? | ≥0 | O · solo F |
| Vivos (V) | vivos | Int? | ≥0 | O · solo F |
| Dolor EVA | dolorEva | Int? | 0–10 | O |

> **lb / ft NO se persisten** (son conversiones de UI a partir de kg / m). Persistir solo las canónicas. Factores: `1 kg = 2.20462 lb`, `1 m = 3.28084 ft`.

### 5.5 Plan de manejo (PlanItem)
| Campo UI | Columna | Tipo | Oblig. | Notas |
|---|---|---|---|---|
| Indicación | descripcion | String / text | **≥1** | |
| Orden | orden | Int | Sí | |
| Código de procedimiento | cptCodigo | String? / text | O | **CPT** (opcional) |

### 5.6 Misceláneos de consulta (segundo sub-bloque del Plan)
**a) Órdenes de exámenes — OrdenExamen** (laboratorio + gabinete)
| Campo UI | Columna | Tipo | Oblig. |
|---|---|---|---|
| Tipo | tipo | Enum (LABORATORIO/RADIOLOGIA/CARDIOLOGIA) | Sí |
| Categoría | categoria | String / text | Sí |
| Examen | examen | String / text | Sí |
| Cantidad | cantidad | Int (≥1) | Sí |
| Código | codigo | String? (LOINC/CPT) | O |

**b) Terapia respiratoria — OrdenTerapiaRespiratoria** (1:1 con la evolución)
| Campo UI | Columna | Tipo |
|---|---|---|
| Gasometría — tipo | gasometriaTipo | Enum (BASAL/CON_O2_SUPLEMENTARIO) |
| Gasometría — FiO₂ (%) | gasometriaFio2 | Int? · solo con O₂ suplementario |
| Gasometría — Flujo (L/min) | gasometriaFlujo | Decimal? · solo con O₂ suplementario |
| Nebulizaciones | nebulizaciones | String? / text |
| Vibroterapia | vibroterapia | String? / text |
| Palmo percusión | palmoPercusion | String? / text |

**c) Orden de inyecciones — OrdenInyeccion**
| Campo UI | Columna | Tipo | Oblig. |
|---|---|---|---|
| Descripción | descripcion | String / text | Sí |
| Orden | orden | Int | Sí |

**d) Órdenes que invocan otros módulos** (Prescripción médica, Orden de Ingreso hospitalario, Interconsulta, Hoja de Remisión, Incapacidad médica, Constancia médica): **son integraciones/navegaciones** a otros módulos del ECE, no campos de esta entidad. Registrar el vínculo en `EvolucionVinculo(tipo, refTabla, refId, creadoEn)` cuando esos módulos generen un artefacto. No bloquean la firma.

### 5.7 Firma del médico (snapshot al firmar)
La firma (grafo) y el sello se **traen de la ficha médica** del médico autenticado; no se digitan. Al firmar, persistir un **snapshot inmutable** en EvolucionMedica.
| Campo | Columna | Origen |
|---|---|---|
| Médico | medicoId | sesión |
| Nombre del médico | medicoNombre | FichaMedica.nombre |
| JVPM | medicoJvpm | FichaMedica.jvpm |
| Ref. grafo | firmaGrafoRef | FichaMedica.grafoFirmaUrl |
| Ref. sello | firmaSelloRef | FichaMedica.selloUrl |
| Fecha firma | firmadaEn | servidor |

---

## 6. Modelo de datos objetivo (Prisma) — reconciliar, no duplicar

**Antes de crear nada**, ejecutar la introspección (§7) y **reconciliar** estas entidades con las existentes: si ya hay `EvolucionMedica`, `SignosVitales`, `Problema`, etc., **extenderlas**; no crear duplicados ni renombrar lo existente.

Entidades objetivo (nombres orientativos; respetar la convención de nombres ya usada en el repo):

- **EvolucionMedica** (1:1 con SignosVitales y OrdenTerapiaRespiratoria; 1:N con Problema, PlanItem, OrdenExamen, OrdenInyeccion, EvolucionVinculo) → pertenece a **Cuenta**, que pertenece a **Expediente**; `medicoId` → autor.
- **SignosVitales** — campos de §5.4.
- **Problema** — §5.3 (self-FK para sindrómico).
- **PlanItem** — §5.5.
- **OrdenExamen / OrdenTerapiaRespiratoria / OrdenInyeccion / EvolucionVinculo** — §5.6.
- **Catálogos**: **Especialidad**, **CatalogoExamen** (tipo/categoria/nombre/codigo), **Cie11** (diagnósticos), **Cpt** (opcional).
- **Expediente / Cuenta / FichaMedica**: agregar los campos marcados **[N]** (emergencia normalizada, nombre de pila, nota de preferencia, alergias si falta; en FichaMedica: grafoFirmaUrl, selloUrl, jvpm si faltan).

### 6.1 Relaciones e integridad
- FKs con `onDelete` apropiado (las hijas de EvolucionMedica → `Cascade`; catálogos → `Restrict`).
- Índices: `EvolucionMedica(cuentaId, createdAt)`, `Problema(evolucionId)`, etc.
- Enums Postgres explícitos (`EstadoEvolucion`, `TipoCuenta`, `Sexo`, `TipoOrdenExamen`, `TipoGasometria`, `TipoProblema`).

### 6.2 Inmutabilidad de la nota firmada
Una EvolucionMedica con `estado = FIRMADA` es **no editable**. Persistir snapshot de firma (§5.7) y, para validez legal, **persistir también el snapshot de los derivados** (`imc`, `indiceCinturaTalla`, `glasgowTotal`, `fpp`) calculados al momento de firmar.

### 6.3 Multipaís
Respetar el alcance multipaís existente (p. ej. discriminador de país en Expediente/Cuenta). Las nuevas entidades heredan el contexto de país a través de la cuenta/expediente; no introducir un modelo de aislamiento distinto al ya vigente.

### 6.4 Persistencia de derivados
- **Borrador:** persistir solo entradas crudas; los derivados se calculan en `clinica.ts`.
- **Firmada:** además, **congelar** los derivados en columnas snapshot (§6.2).

---

## 7. Verificación de consistencia formulario ↔ BD ↔ ORM (núcleo del requerimiento)

Implementar y ejecutar este procedimiento **obligatorio**. Su salida es un **reporte de consistencia** que debe quedar en verde antes de dar por terminado.

### Paso 1 — Construir el contrato
Codificar el inventario de §5 en `lib/ece/evolucion/contract.ts` (lista tipada: `{ campoUI, entidad, columna, tipoPrisma, tipoPg, obligatorio, rango?, derivado?, nuevoProbable? }`). Este contrato es la referencia de la verificación.

### Paso 2 — Introspeccionar el estado actual
- **ORM (Prisma):** leer `prisma/schema.prisma`; enumerar modelos, campos y tipos.
- **BD (PostgreSQL/Supabase):** introspeccionar la BD real para detectar *drift* contra el schema:
  ```bash
  npx prisma db pull --schema=./prisma/_introspected.prisma
  ```
  (o, vía el conector de Supabase: listar tablas y columnas de los esquemas relevantes). Comparar `_introspected.prisma` con `schema.prisma`.

### Paso 3 — Diff de tres vías y resolución
Para **cada** campo del contrato:

| Hallazgo | Acción |
|---|---|
| Falta la **columna** en PostgreSQL | **Crear** la columna (migración aditiva, §8). |
| Falta el **campo** en Prisma | **Agregar** al `schema.prisma`. |
| Existe en BD pero no en Prisma (o viceversa) | **Alinear** ambos planos. |
| **Tipo** divergente (p. ej. `text` vs `int` para `dolorEva`) | **Corregir** al tipo del contrato (migración con casteo seguro). |
| **Obligatoriedad/constraint** divergente (NOT NULL, default, CHECK de rango) | **Alinear** con la obligatoriedad/rango del contrato. |
| Columna existente sin campo en el contrato | **No tocar**; documentar en el reporte (posible dato legado). |

**Prohibido:** `DROP COLUMN`, `DROP TABLE`, renombres con pérdida o cualquier operación destructiva sobre datos existentes sin una migración explícita de preservación de datos y aprobación.

### Paso 4 — Aplicar cambios (Prisma-first)
```bash
npx prisma migrate dev --name ece_evolucion_consistencia
npx prisma generate
npx prisma validate
```
Revisar el **SQL generado**: debe contener solo `CREATE TABLE` / `ADD COLUMN` / `CREATE INDEX` / `ALTER … TYPE … USING` seguros. Para nuevas tablas en Supabase, **habilitar RLS y políticas** acordes (defecto: denegar; permitir según rol clínico) y correr los *advisors* de seguridad/desempeño.

### Paso 5 — Pruebas de consistencia (gate automatizado)
1. **Test de contrato:** un test que recorre `contract.ts` y, contra el cliente Prisma generado, verifica que **cada** `entidad.columna` existe y su tipo coincide (usar el DMMF de Prisma / metadatos). Falla el build si algo no cuadra.
2. **Round-trip:** crear una EvolucionMedica **con todos los campos llenos** (incluyendo gineco, todos los misceláneos y firma), guardarla y releerla; **aserción**: cada campo del contrato persiste y vuelve idéntico.
3. **Typecheck/build:** `tsc --noEmit` y build de Next/Vercel en verde.

### Paso 6 — Reporte
Generar `reporte-consistencia-evolucion.md` con: campos verificados, columnas creadas, tipos alineados, columnas legadas detectadas, migraciones aplicadas y resultado de los gates. Es un **entregable**.

---

## 8. Migraciones (reglas)

- **Aditivas y reversibles**; una migración nombrada por intención (`ece_evolucion_*`).
- Nuevas columnas obligatorias en tablas con datos: agregar primero como **nullable + default**, *backfill*, luego endurecer constraint.
- **CHECK constraints** para los rangos duros donde aplique (p. ej. `dolorEva BETWEEN 0 AND 10`, `spo2 BETWEEN 50 AND 100`), reflejando exactamente los rangos del contrato.
- Normalización de contacto de emergencia con **migración de datos** (parser del formato antiguo) sin pérdida.

---

## 9. Validación (Zod) y reglas clínicas compartidas

- **`lib/ece/evolucion/clinica.ts`** centraliza: rangos (§5.4), factores de conversión, clasificación **IMC** (<18.5 Bajo peso · 18.5–24.9 Normal · 25–29.9 Sobrepeso · ≥30 Obesidad), clasificación **Índice cintura-talla** (<0.5 Saludable · 0.5–0.6 Riesgo aumentado · ≥0.6 Riesgo alto), **Glasgow** (13–15 Leve · 9–12 Moderado · 3–8 Grave), **FPP** (Naegele: +1 año −3 meses +7 días) y la **tabla de alertas críticas** (SpO₂<90; sist≥180 o dia≥110 crisis HTA; sist<90 hipotensión; temp≥39.5 fiebre / ≤35 hipotermia; FC>120 taqui / <50 bradi; FR>24 taqui / <10 bradi; gluco<70 hipo / ≥250 hiper; Glasgow≤8; diuresis<0.5 mL/kg/h oliguria; dolor≥7). **Idénticas al mockup.**
- **Zod** deriva del contrato y de `clinica.ts`. Reglas condicionales: bloque gineco-obstétrico **solo** `sexo = F`; **FPP** solo `F` y edad 10–55. Gating de firma: especialidad + ≥1 problema + 7 signos del núcleo + subjetivo + objetivo + análisis + ≥1 plan.
- Validar **en cliente y en servidor** con el mismo esquema.

---

## 10. tRPC (procedimientos)

- `evolucion.create` (borrador) · `evolucion.update` (solo BORRADOR) · `evolucion.get` · `evolucion.list` · `evolucion.firmar` (valida gating completo en servidor, escribe snapshot de firma y de derivados, fija `estado = FIRMADA`, vuelve inmutable).
- `catalogos.especialidades` · `catalogos.examenes(tipo)`.
- `expediente.updateContactoEmergencia(expedienteId, {nombre, parentesco, telefono})`.
- Autorización por rol (médico tratante) y por pertenencia a la cuenta/país. Entradas validadas con los Zod de §9.
- **Autoguardado** de borrador (cada 30 s) vía `evolucion.update`.

---

## 11. Catálogos y datos de referencia

- **Especialidad:** sembrar las ~34 del mockup.
- **CatalogoExamen:** sembrar los catálogos exactos del mockup (Laboratorio: Hematología y coagulación, Química sanguínea, Hormonas y pruebas especiales, Microbiología, Urianálisis, Coprología, Banco de sangre, Pruebas moleculares, Inmunología, Gasometría venosa; Radiología: Rayos X, Ultrasonografía, Tomografía, Resonancia, Estudios Especiales; Cardiología: ECG, Ecocardiograma, Holter, Prueba de esfuerzo, Estudios Especiales). Mantener nombres y agrupaciones idénticos.
- **Cie11** para diagnósticos de problemas (alinear con la migración CIE-11 ya planificada del HIS). **Cpt** opcional para procedimientos.
- En producción, los exámenes deben quedar referenciados a su catálogo (no texto libre); el mockup ya modela categoría→examen.

---

## 12. Diseño (Avante DS v2.0) y paridad visual

- Reproducir el mockup **píxel a píxel en intención**, implementado con **tokens OKLCH del DS** (primarios navy/teal, Inter). Mapear cada color del mockup a su token equivalente del DS; no introducir hex fuera del sistema.
- Conservar exactamente: tarjetas-resumen con badges por sección, sub-bloques (Objetivo = Signos vitales + Registro; **Plan = Plan de manejo + Misceláneos**), píldoras Obligatorio/Opcional, iconografía de sexo (♀ rosa / ♂ navy), banner de alergias (verde/ámbar), nota de nombre de pila, modales (incluido el de contacto de emergencia con 3 campos), selector de exámenes (radio de categoría + lista con cantidad + solicitud), gasometría con FiO₂/Flujo condicionados, tablas de inyecciones, tarjetas de acción, firma con grafo + sello, footer con gating y pista de pendientes.
- Reutilizar componentes del DS (inputs, botones, modales, chips) respetando el aspecto del mockup.

---

## 13. Reglas de negocio

- **Borrador → Firmada** (irreversible); firmada = inmutable.
- **Autoguardado** cada 30 s; **Ctrl/Cmd+S** guarda borrador; **Esc** cierra modal.
- Firma y sello **traídos automáticamente** de la ficha médica (no editables).
- Encabezado de paciente **read-only** salvo el contacto de emergencia (editable, persiste en Expediente).
- Condicionales gineco por sexo/edad (§9). Alertas críticas recalculadas en vivo (§9).
- Toda regla replica el comportamiento del mockup **sin desviación**.

---

## 14. Criterios de aceptación

**Funcionalidad / diseño**
- [ ] La pantalla integrada reproduce el mockup al 100 % (secciones, orden, modales, estados, validaciones, cálculos, microinteracciones) implementada con Avante DS v2.0.
- [ ] Plan con **dos sub-bloques**: Plan de manejo + Misceláneos (con todas las órdenes y tarjetas).
- [ ] Gating de firma y pista de pendientes idénticos; autoguardado 30 s; firma/sello traídos de la ficha.
- [ ] Reglas clínicas (rangos, alertas, IMC, **ICT**, Glasgow, FPP, condicionales) idénticas al mockup, desde el módulo compartido.

**Datos / consistencia (núcleo)**
- [ ] **Todos** los campos del contrato (§5) existen en PostgreSQL y en Prisma, con tipos y constraints alineados.
- [ ] Los campos faltantes fueron **agregados** mediante migración **aditiva y no destructiva** (sin DROP/rename con pérdida).
- [ ] **Sin drift** entre `schema.prisma` y la BD (introspección coincide).
- [ ] **Test de contrato** y **round-trip** en verde; `prisma validate`, `tsc --noEmit` y build en verde.
- [ ] Contacto de emergencia normalizado a 3 campos con datos migrados sin pérdida.
- [ ] Nuevas tablas con **RLS/políticas** y *advisors* de Supabase sin hallazgos críticos.
- [ ] Entregado `reporte-consistencia-evolucion.md`.

---

## 15. Entregables y comandos de verificación

**Entregables:** código (pantalla + componentes + tRPC + lib clínica + contract), `schema.prisma` actualizado, migraciones, seeds de catálogos, tests (contrato + round-trip), y `reporte-consistencia-evolucion.md`.

**Verificación:**
```bash
npx prisma db pull --schema=./prisma/_introspected.prisma   # detectar drift
npx prisma validate
npx prisma migrate dev --name ece_evolucion_consistencia
npx prisma generate
npm run test -- evolucion        # test de contrato + round-trip
npx tsc --noEmit
npm run build
```

---

## 16. Prompt de arranque para Claude Code

```
Incorpora el módulo "Evolución Médica" al HIS Multipaís respetando AL 100% la funcionalidad y el
diseño del mockup evolucion-medica-avante.html (fuente de verdad de UI/UX) y la spec
spec-mockup-evolucion-medica.md. Implementa con Next.js App Router + tRPC + Prisma + Supabase y el
Design System Avante v2.0 (OKLCH, navy/teal, Inter). No simplifiques el formulario para encajar en el
esquema: si falta soporte en BD, extiende el esquema.

Trabaja en este orden:
1) Codifica el CONTRATO DEL FORMULARIO (lib/ece/evolucion/contract.ts) con el inventario de la sección 5
   del REQ-ECE-EVOLUCION-MEDICA (campo UI ↔ entidad.columna ↔ tipo ↔ obligatoriedad ↔ rango/derivado).
2) Introspecciona el estado actual: lee prisma/schema.prisma y corre `prisma db pull` para detectar drift
   contra la BD. Reconcilia con las entidades existentes (NO dupliques).
3) Haz el diff de tres vías (formulario ↔ PostgreSQL ↔ Prisma). Agrega TODO campo faltante de forma
   ADITIVA y NO DESTRUCTIVA (sin DROP/rename con pérdida). Alinea tipos y constraints (incl. CHECK de
   rangos). Normaliza el contacto de emergencia a 3 campos migrando datos sin pérdida.
4) Aplica migración (`prisma migrate dev`), regenera cliente, `prisma validate`. Habilita RLS/políticas
   para tablas nuevas y corre los advisors de Supabase.
5) Centraliza las reglas clínicas (rangos, alertas, IMC, índice cintura-talla, Glasgow, FPP, conversiones)
   en lib/ece/evolucion/clinica.ts y deriva los Zod del contrato; valida en cliente y servidor.
6) Implementa la pantalla y los tRPC (create/update/get/list/firmar + catálogos + updateContactoEmergencia)
   reproduciendo el mockup (incl. Plan con sub-bloques Plan de manejo + Misceláneos, modal de emergencia,
   selector de exámenes, gasometría condicionada, inyecciones, firma con grafo+sello, gating + autoguardado).
7) Agrega tests: test de CONTRATO (cada entidad.columna existe con el tipo correcto vía DMMF) y ROUND-TRIP
   (guardar una evolución con todos los campos y releerla idéntica). Deja `tsc --noEmit` y build en verde.
8) Entrega reporte-consistencia-evolucion.md.

Verifica contra los criterios de aceptación de la sección 14. La nota firmada es inmutable y persiste
snapshot de firma y de derivados.
```
