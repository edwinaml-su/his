# E.F2.4 — ECE Hospitalario, Quirúrgico y Obstétrico
## Backlog Priorizado — Fase 2 · Stream 6

> **Idioma:** es-SV.
> **Fuentes:** analisis_workflows_ece.md §B + §2.2 + §3.11-3.16 + §3.18; 04_episodios.sql; 06_documentos_clinicos.sql; NTEC (Acuerdo 1616 MINSAL).
> **Roles normalizados:** ADM (Administrativo) · AC (Atención al Cliente) · ARCH (Archivo/ESDOMED) · ENF (Enfermería) · MT (Médico de Turno) · MC (Médico de Cabecera/Tratante) · ESP (Especialista/Cirujano) · ANEST (Anestesiólogo) · IC (Interconsultante) · OBS (Obstetra/Partero) · NEO (Neonatólogo) · DIR (Dirección del establecimiento).

---

## Visión del Producto

Digitalizar completamente el ciclo de hospitalización — desde la orden de ingreso hasta el archivo del expediente — garantizando inmutabilidad criptográfica, firmas electrónicas simples por profesional, consentimientos bloqueantes y trazabilidad normativa NTEC en cada documento del episodio.

---

## Definition of Ready (DoR)

- [ ] Historia redactada con formato `Como / Quiero / Para`.
- [ ] Criterios de aceptación en Gherkin (happy + edge + error).
- [ ] Dependencias identificadas y resueltas o explicitamente aceptadas como riesgo.
- [ ] Story Points estimados con Planning Poker.
- [ ] Trazabilidad a §analisis + NTEC documentada.
- [ ] Mockup de referencia o nota al @UIUX entregada.

## Definition of Done (DoD)

- [ ] Código mergeado en `main` con PR aprobado por @Dev + @QA.
- [ ] Tests unitarios e integración con cobertura >= 80 %.
- [ ] E2E Playwright cubriendo happy path y al menos un escenario de error.
- [ ] Firma electrónica simple integrada (campo `registrado_por` + timestamp).
- [ ] RLS via `withTenantContext` aplicado en todos los routers.
- [ ] Audit hash chain activo para tablas HISTÓRICO.
- [ ] axe-core sin críticos/serios.
- [ ] Entrada en matriz de trazabilidad actualizada.
- [ ] @QAF aprueba escenarios Gherkin completos.

---

## KPIs de Producto

| KPI | Meta Sprint | Meta Release |
|---|---|---|
| Documentos hospitalarios digitalizados / total requeridos | 100 % | 100 % |
| Consentimientos firmados electrónicamente antes del procedimiento | 100 % | 100 % |
| Epicrisis completadas dentro de las 24 h post-egreso | >= 90 % | >= 95 % |
| Codificación CIE-10 de egreso completa al cierre | 100 % | 100 % |
| Tiempo promedio apertura episodio (desde orden de ingreso) | < 5 min | < 3 min |
| Ruptura de cadena hash detectada automáticamente | 0 % tolerado | 0 % tolerado |
| Certificaciones de copia emitidas sin autorización DIR | 0 | 0 |

---

## Épica Padre

**E.F2.4 — ECE Hospitalario, Quirúrgico y Obstétrico**

Digitalización de los 29 documentos del ciclo hospitalario completo: ingreso, estancia, rutas especializadas (quirúrgica y obstétrica), egreso y cierre documental. Todos los documentos HISTÓRICO son inmutables post-firma; todos los documentos TRANSACCIONAL tienen rectificación trazable.

---

## Mapa de Dependencias (grafo simplificado)

```
US.F2.4.1 Orden de Ingreso
  └─> US.F2.4.2 Hoja de Ingreso / Apertura de Episodio
        ├─> US.F2.4.3 Consentimiento Hospitalización (bloqueante admisión plena)
        ├─> US.F2.4.4 Historia Clínica de Ingreso
        ├─> US.F2.4.5 Valoración Enfermería + Plan de Cuidados
        ├─> US.F2.4.6 Indicaciones Médicas Hospitalarias
        │     └─> US.F2.4.7 Hoja de Evolución Médica (SOAP, diario)
        ├─> US.F2.4.8 Registro Enfermería + Signos Vitales + Kardex (por turno)
        ├─> US.F2.4.9 Interconsulta (solicitud + respuesta)
        ├─> US.F2.4.10 Solicitud/Resultado Lab/Gabinete hospitalario
        │
        ├── RUTA QUIRURGICA ──────────────────────────────────────────────
        ├─> US.F2.4.11 Nota Preoperatoria + Valoración Anestésica + Riesgo Qx
        ├─> US.F2.4.12 Consentimiento Quirúrgico + Anestésico (bloqueante)
        ├─> US.F2.4.13 Checklist Cirugía Segura (3 fases)
        ├─> US.F2.4.14 Nota / Descripción Operatoria
        ├─> US.F2.4.15 Registro Anestésico Transanestésico
        ├─> US.F2.4.16 Hoja de Recuperación URPA
        ├─> US.F2.4.17 Notas UCI/UCIN
        │
        ├── RUTA OBSTETRICA ─────────────────────────────────────────────
        ├─> US.F2.4.18 Partograma (series temporales)
        ├─> US.F2.4.19 Hoja de Labor de Parto
        ├─> US.F2.4.20 Hoja de Sala de Expulsión
        ├─> US.F2.4.21 Atención del Recién Nacido (genera CUN/NUI)
        │
        └── EGRESO ──────────────────────────────────────────────────────
              US.F2.4.22 Orden de Egreso / Certificación Alta Médica
                └─> US.F2.4.23 Epicrisis / Hoja de Egreso + Indicaciones + Receta + Citas
                      ├─> US.F2.4.24 Certificado de Defunción (condicional fallecido)
                      ├─> US.F2.4.25 Acta de Entrega de Cuerpo + Registro Morgue
                      ├─> US.F2.4.26 Censo de Movimiento Diario / Liberación de Cama
                      ├─> US.F2.4.27 Codificación CIE-10 de Egreso + Verificación Integridad
                      ├─> US.F2.4.28 Foliado + Archivo (Art. 19-21 NTEC)
                      └─> US.F2.4.29 Certificación Administrativa de Copia (solo DIR)
```

---

## Historias de Usuario

---

### ✅ US.F2.4.1 — Orden de Ingreso Hospitalario

| Campo | Valor |
|---|---|
| **Como** | médico de turno o médico tratante |
| **Quiero** | emitir digitalmente la orden de ingreso hospitalario con circunstancia, procedencia, servicio y modalidad |
| **Para** | autorizar el internamiento y dar inicio formal al episodio hospitalario con trazabilidad médico-legal |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 1 · §2.2 Proceso Hospitalario fila "Orden de ingreso" |
| **Trazabilidad NTEC** | Art. 17 lit. b; Art. 23 lit. a.4 (firma electrónica simple) |
| **Tabla SQL** | `ece.orden_ingreso` |
| **Dependencias** | US ambulatoria (episodio_origen_id) o US emergencia |

**Criterios de Aceptación:**

```gherkin
Característica: Orden de ingreso hospitalario

  Escenario: Médico emite orden de ingreso desde emergencia
    Dado que el médico MT está autenticado y tiene un episodio de emergencia activo del paciente
    Y el episodio tiene diagnóstico CIE-10 registrado
    Cuando selecciona "Emitir Orden de Ingreso"
    Y completa: circunstancia_ingreso="demanda_espontanea", procedencia="emergencia",
                servicio_ingreso="medicina_interna", modalidad="hospitalizacion",
                motivo_ingreso="Neumonía grave requiere hospitalización"
    Y aplica su firma electrónica simple
    Entonces el sistema crea el registro en ece.orden_ingreso con estado_registro="vigente"
    Y vincula episodio_origen_id al episodio de emergencia
    Y notifica a Admisión para apertura del episodio hospitalario
    Y el documento queda disponible para consulta en el expediente

  Escenario: Orden de ingreso programado (cirugía electiva)
    Dado que el médico MC tiene un episodio de consulta externa con decisión "orden_ingreso"
    Cuando emite la orden con circunstancia="programado" y modalidad="hospitalizacion"
    Entonces el sistema programa el ingreso y reserva el servicio indicado
    Y genera notificación a Admisión con fecha/hora de ingreso esperado

  Escenario: Intento sin diagnóstico CIE-10
    Dado que el médico MT intenta emitir la orden de ingreso
    Y el episodio de origen no tiene diagnóstico codificado en CIE-10
    Cuando intenta guardar
    Entonces el sistema bloquea el guardado con mensaje "Se requiere al menos un diagnóstico CIE-10 para emitir la orden de ingreso"

  Escenario: Intento sin firma electrónica
    Dado que los campos de la orden están completos
    Cuando el médico intenta guardar sin aplicar firma
    Entonces el sistema rechaza con "La firma electrónica simple del médico es obligatoria (Art. 23 NTEC)"

  Escenario: Hospital de día — modalidad < 24 h
    Dado que el médico ordena ingreso con modalidad="hospital_de_dia"
    Cuando se crea la orden
    Entonces el sistema registra la modalidad y alerta si la estancia supera 24 h sin egreso
```

**Notas técnicas:** `tenantProcedure` + `requireRole(["PHYSICIAN"])`. `withTenantContext` obligatorio. El campo `disposicion` del episodio_origen pasa a `"orden_ingreso"` al guardar.

---

### ✅ US.F2.4.2 — Hoja de Ingreso / Apertura de Episodio Hospitalario

| Campo | Valor |
|---|---|
| **Como** | administrativo de admisión |
| **Quiero** | abrir el episodio hospitalario asignando servicio y cama, vinculado a la orden de ingreso |
| **Para** | formalizar el registro de hospitalización y habilitar la documentación clínica posterior |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 2 · §3.12 · §2.2 fila "Admisión hospitalaria" |
| **Trazabilidad NTEC** | Art. 15 (identificación); Art. 17 lit. b |
| **Tabla SQL** | `ece.hoja_ingreso` · `ece.episodio_hospitalario` · `ece.asignacion_cama` |
| **Dependencias** | US.F2.4.1 (orden_ingreso) · Ficha de identificación del paciente |

**Criterios de Aceptación:**

```gherkin
Característica: Apertura de episodio hospitalario

  Escenario: Admisión abre episodio desde orden de ingreso
    Dado que ADM tiene una orden de ingreso en estado "vigente"
    Y el paciente tiene ficha de identificación con NUI registrado
    Cuando selecciona la orden y asigna: servicio="medicina_interna", cama="3B-12"
    Entonces el sistema crea ece.hoja_ingreso con fecha_hora_ingreso=now()
    Y crea ece.episodio_hospitalario vinculado al episodio_atencion con modalidad="hospitalario"
    Y registra la asignación de cama en ece.asignacion_cama
    Y cambia el estado del episodio a "en_curso"
    Y muestra el brazalete de identificación del paciente para impresión

  Escenario: Verificación derechohabiencia ISSS
    Dado que el paciente es derechohabiente ISSS
    Cuando ADM abre el episodio
    Entonces el sistema verifica y registra numero_afiliado, tipo_derechohabiente y numero_patronal
    Y alerta si la derechohabiencia está suspendida

  Escenario: Cama ya ocupada
    Dado que ADM intenta asignar la cama "3B-12"
    Y esa cama tiene ece.asignacion_cama activa (hasta IS NULL)
    Cuando intenta guardar
    Entonces el sistema rechaza con "La cama 3B-12 está ocupada; seleccione otra disponible"

  Escenario: Orden de ingreso ya procesada
    Dado que la orden_ingreso ya tiene una hoja_ingreso vinculada
    Cuando ADM intenta crear otra hoja de ingreso para la misma orden
    Entonces el sistema rechaza por violación de constraint UNIQUE en episodio_id

  Escenario: Paciente sin ficha de identificación
    Dado que el paciente no tiene ficha de identificación en el sistema
    Cuando ADM intenta abrir el episodio
    Entonces el sistema bloquea con "El paciente requiere ficha de identificación (Art. 15 NTEC) antes del ingreso"
```

**Notas técnicas:** `requireRole(["ADMIN","NURSE"])`. Asignación de cama actualiza estado `ece.cama.estado` a `"ocupada"`. El censo de movimiento diario se actualiza automáticamente.

---

### US.F2.4.3 — Consentimiento Informado de Hospitalización

| Campo | Valor |
|---|---|
| **Como** | médico tratante |
| **Quiero** | registrar el consentimiento informado de hospitalización firmado por el paciente o representante legal |
| **Para** | garantizar el derecho del paciente a decidir informadamente y cumplir requisito legal previo a la estancia |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 3 · §3.9 hospitalario · §2.2 fila "Consentimiento de hospitalización" |
| **Trazabilidad NTEC** | Art. 4 (definición); Ley Deberes y Derechos Pacientes Art. 5 lit. a) |
| **Tabla SQL** | `ece.consentimiento_informado` (tipo="hospitalizacion") |
| **Dependencias** | US.F2.4.2 (episodio abierto) |

**Criterios de Aceptación:**

```gherkin
Característica: Consentimiento informado de hospitalización

  Escenario: Registro de consentimiento firmado por paciente capaz
    Dado que el episodio hospitalario está en estado "en_curso"
    Y el MC ha explicado procedimiento, riesgos y alternativas al paciente
    Cuando el MC registra el consentimiento con:
      tipo="hospitalizacion", procedimiento_descrito, riesgos_explicados, alternativas,
      firmante_rol="paciente", firmante_nombre, firmante_documento
    Y captura la evidencia de firma/huella del paciente
    Y aplica su firma electrónica simple
    Entonces el sistema inserta en ece.consentimiento_informado
    Y el registro queda en estado HISTÓRICO (inmutable)
    Y el episodio avanza al paso "Ingreso al servicio" habilitando historia clínica

  Escenario: Paciente incapaz — representante legal firma
    Dado que el paciente no puede firmar (inconsciente, menor de edad)
    Cuando el MC registra firmante_rol="representante_legal" con nombre y documento del responsable
    Entonces el sistema acepta y registra la firma del representante
    Y deja constancia en observaciones del motivo de representación

  Escenario: Intento de modificar consentimiento ya firmado
    Dado que existe un consentimiento en ece.consentimiento_informado para el episodio
    Cuando cualquier usuario intenta editar el registro directamente
    Entonces el sistema rechaza la operación (no hay endpoint de UPDATE para esta tabla)
    Y el audit log registra el intento fallido

  Escenario: Ingreso al servicio sin consentimiento registrado
    Dado que el episodio tiene hoja_ingreso pero no consentimiento_informado tipo="hospitalizacion"
    Cuando el ENF intenta crear la historia clínica de ingreso
    Entonces el sistema muestra advertencia "El consentimiento de hospitalización no ha sido registrado"
    Y permite continuar solo si el rol es MC o superior (consentimiento bloqueante no-hard para urgencia)

  Escenario: Doble firma requerida
    Cuando el MC intenta guardar el consentimiento sin evidencia de firma del paciente/representante
    Entonces el sistema rechaza con "Se requiere evidencia de firma/huella del paciente o representante legal"
```

**Notas técnicas:** Tabla `ece.consentimiento_informado` solo tiene INSERT, sin UPDATE. El campo `evidencia_firma` almacena referencia a objeto firmado en storage. Consentimiento es condición bloqueante en flujo quirúrgico (hard block en US.F2.4.12).

---

### US.F2.4.4 — Historia Clínica de Ingreso

| Campo | Valor |
|---|---|
| **Como** | médico tratante |
| **Quiero** | registrar la historia clínica de ingreso completa (anamnesis, examen físico, impresión diagnóstica) |
| **Para** | establecer la línea base clínica del episodio hospitalario y fundamentar el plan terapéutico |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 4 · §3.2 hospitalario · §2.2 fila "Historia clínica de ingreso" |
| **Trazabilidad NTEC** | Art. 4.14; Art. 42 (rectificación); Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.historia_clinica` (tipo_consulta="primera_vez") |
| **Dependencias** | US.F2.4.2 · US.F2.4.3 |

**Criterios de Aceptación:**

```gherkin
Característica: Historia clínica de ingreso hospitalario

  Escenario: MC registra historia clínica completa
    Dado que el episodio hospitalario está activo y tiene consentimiento registrado
    Cuando el MC completa:
      motivo_consulta, enfermedad_actual,
      antecedentes={personales_patologicos, familiares, gineco_obstetricos, alergias, habitos},
      examen_fisico={signos_vitales_ref, hallazgos_por_sistema},
      diagnosticos=[{cie10:"J18.9", tipo:"presuntivo"}],
      plan_manejo, disposicion="observacion"
    Y aplica firma electrónica simple
    Entonces el sistema inserta en ece.historia_clinica con tipo_consulta="primera_vez"
    Y estado_registro="vigente"
    Y el formulario queda en modo solo-lectura para el MC

  Escenario: Rectificación de historia clínica
    Dado que existe una historia_clinica en estado "vigente"
    Cuando el MC detecta un error y solicita rectificación
    Entonces el sistema cambia estado_registro="rectificado" en el registro original
    Y crea nuevo registro con los datos corregidos y referencia al registro anterior
    Y el audit_log registra: usuario, timestamp, campo modificado, valor anterior, valor nuevo

  Escenario: Diagnóstico CIE-10 obligatorio al cierre
    Dado que el MC intenta firmar la historia clínica
    Y el array diagnosticos está vacío
    Entonces el sistema rechaza con "Se requiere al menos un diagnóstico CIE-10 (presuntivo o definitivo)"

  Escenario: Antecedentes alérgicos con alerta
    Dado que el MC registra alergias=["penicilina","ibuprofeno"]
    Cuando se guarda la historia
    Entonces el sistema muestra banner de alerta de alergias en la cabecera del expediente
    Y propaga la alerta a la hoja de indicaciones médicas

  Escenario: Historia previa importada de episodios anteriores
    Dado que el paciente tiene episodios previos cerrados
    Cuando el MC abre la historia clínica de ingreso
    Entonces el sistema ofrece importar antecedentes del último episodio cerrado como plantilla editable
    Y el MC puede aceptar, modificar o descartar la importación
```

**Notas técnicas:** `requireRole(["PHYSICIAN"])`. Sección `antecedentes` y `examen_fisico` como JSONB. Integrar con `ece.signos_vitales` via referencia para rellenar `examen_fisico.signos_vitales_ref`.

---

### ✅ US.F2.4.5 — Valoración de Enfermería al Ingreso + Plan de Cuidados

| Campo | Valor |
|---|---|
| **Como** | enfermera/enfermero a cargo |
| **Quiero** | registrar la valoración inicial de enfermería y el plan de cuidados al ingreso del paciente |
| **Para** | documentar el estado inicial del paciente desde la perspectiva de cuidados y establecer prioridades de atención de enfermería |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 4 · §3.7 hospitalario · §2.2 fila "Valoración de enfermería al ingreso" |
| **Trazabilidad NTEC** | Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.registro_enfermeria` (turno inicial) |
| **Dependencias** | US.F2.4.2 |

**Criterios de Aceptación:**

```gherkin
Característica: Valoración de enfermería al ingreso

  Escenario: ENF registra valoración inicial
    Dado que el episodio hospitalario está activo
    Y la enfermera está autenticada con rol ENF
    Cuando completa la valoración con:
      turno="matutino", nota_evolucion="Paciente ingresa alerta, orientado, en silla de ruedas",
      plan_cuidados="Control de signos vitales cada 4h, vía periférica permeable"
    Y aplica firma electrónica simple
    Entonces el sistema crea registro en ece.registro_enfermeria
    Y asocia el turno y timestamp al registro

  Escenario: Plan de cuidados vinculado a diagnóstico de enfermería
    Dado que la historia clínica tiene diagnóstico CIE-10 registrado
    Cuando ENF elabora el plan de cuidados
    Entonces el sistema sugiere intervenciones estándar basadas en el diagnóstico
    Y ENF puede aceptar, modificar o crear intervenciones propias

  Escenario: Registro sin firma
    Cuando ENF intenta guardar la valoración sin aplicar firma electrónica simple
    Entonces el sistema rechaza con "La firma electrónica simple es obligatoria (Art. 23 NTEC)"

  Escenario: Registro por turno duplicado
    Dado que ya existe una valoración de ingreso registrada por ENF en el mismo turno
    Cuando ENF intenta crear otra valoración de ingreso
    Entonces el sistema alerta "Ya existe valoración de ingreso para este turno; use Evolución de Enfermería para registros posteriores"
```

---

### US.F2.4.6 — Indicaciones Médicas Hospitalarias

| Campo | Valor |
|---|---|
| **Como** | médico tratante o médico de turno |
| **Quiero** | registrar, versionar y revisar diariamente las indicaciones médicas del paciente hospitalizado |
| **Para** | ordenar el tratamiento con trazabilidad prescriptiva y vincular cada indicación a la administración de enfermería |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 4-5 · §3.6 · §2.2 fila "Indicaciones iniciales" |
| **Trazabilidad NTEC** | Art. 23 lit. a.4; Art. 42 |
| **Tabla SQL** | `ece.indicaciones_medicas` · `ece.indicacion_item` |
| **Dependencias** | US.F2.4.4 |

**Criterios de Aceptación:**

```gherkin
Característica: Indicaciones médicas hospitalarias

  Escenario: MC crea indicaciones iniciales
    Dado que el episodio tiene historia clínica de ingreso registrada
    Cuando el MC crea una hoja de indicaciones con items:
      [{tipo:"medicamento", descripcion:"Amoxicilina", dosis:"500mg", via:"VO", frecuencia:"cada 8h", duracion:"7 días"},
       {tipo:"dieta", descripcion:"Dieta blanda hipocalórica"},
       {tipo:"cuidado", descripcion:"Reposo relativo en cama"}]
    Y aplica firma electrónica simple
    Entonces el sistema crea ece.indicaciones_medicas con version=1, vigencia="activa"
    Y crea los ece.indicacion_item correspondientes
    Y notifica a ENF asignada

  Escenario: Revisión diaria y actualización de indicaciones
    Dado que existen indicaciones con vigencia="activa" del día anterior
    Cuando el MC revisa y suspende un medicamento y agrega otro
    Entonces el sistema cambia vigencia="suspendida" en el item anterior (nuevo registro de versión)
    Y crea nueva versión de indicaciones con version=N+1
    Y preserva el historial completo de versiones

  Escenario: Alerta de alergias en prescripción
    Dado que el paciente tiene alergia registrada a "penicilina"
    Cuando el MC intenta prescribir "Amoxicilina" (betalactámico)
    Entonces el sistema muestra alerta de alergias cruzadas con nivel "ALTO"
    Y requiere confirmación explícita del MC con justificación clínica para continuar

  Escenario: Trascripción por enfermería
    Dado que las indicaciones han sido creadas y firmadas por el MC
    Cuando ENF transcribe las indicaciones al kardex
    Entonces el sistema registra transcripcion_enf con el usuario ENF y timestamp

  Escenario: Indicación sin firma del prescriptor
    Cuando el MC intenta guardar indicaciones sin firma electrónica simple
    Entonces el sistema rechaza con "Toda indicación requiere firma electrónica del prescriptor"
```

---

### US.F2.4.7 — Hoja de Evolución Médica Diaria (SOAP)

| Campo | Valor |
|---|---|
| **Como** | médico tratante o médico de turno |
| **Quiero** | registrar la nota de evolución médica diaria en formato SOAP con diagnóstico actualizado |
| **Para** | documentar el seguimiento cronológico de la estancia y respaldar las decisiones clínicas del episodio |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 5 · §3.8 · §2.2 fila "Seguimiento médico" |
| **Trazabilidad NTEC** | Art. 19 (orden cronológico ascendente); Art. 42 |
| **Tabla SQL** | `ece.evolucion_medica` |
| **Dependencias** | US.F2.4.4 |

**Criterios de Aceptación:**

```gherkin
Característica: Evolución médica diaria SOAP

  Escenario: MC registra nota SOAP diaria
    Dado que el episodio hospitalario está activo
    Cuando el MC registra:
      subjetivo="Paciente refiere mejoría del dolor torácico",
      objetivo="PA 120/80, FC 78, afebril, murmullo vesicular presente bilateral",
      analisis="Evolución favorable de neumonía",
      plan="Continuar antibioticoterapia, alta mañana si afebril",
      diagnostico_cie10=[{cie10:"J18.9"}]
    Y aplica firma electrónica simple
    Entonces el sistema crea registro en ece.evolucion_medica con fecha_hora=now()
    Y los registros se ordenan cronológicamente ascendente en la vista del expediente

  Escenario: Múltiples notas por día (médico de turno distinto)
    Dado que el MC registró una nota a las 08:00
    Cuando el MT del turno vespertino registra otra nota a las 14:00
    Entonces el sistema crea un nuevo registro independiente
    Y ambas notas aparecen en orden cronológico con su respectivo autor

  Escenario: Rectificación de nota de evolución
    Dado que el MC detecta error en una nota ya firmada
    Cuando solicita rectificación
    Entonces el sistema crea nuevo registro con estado_registro="vigente"
    Y marca el anterior como estado_registro="rectificado"
    Y el audit_log registra: usuario, timestamp, motivo de rectificación

  Escenario: Vista ordenada del expediente
    Dado que existen 10 notas de evolución en el episodio
    Cuando el médico visualiza el expediente
    Entonces las notas aparecen en orden cronológico ascendente (Art. 19 NTEC)
    Y cada nota muestra: autor, rol, fecha_hora, contenido SOAP firmado
```

---

### US.F2.4.8 — Registro de Enfermería + Signos Vitales + Kardex por Turno

| Campo | Valor |
|---|---|
| **Como** | enfermera/enfermero de turno |
| **Quiero** | registrar por turno: nota de enfermería, signos vitales y administración de medicamentos (kardex) |
| **Para** | documentar el cuidado brindado, los parámetros fisiológicos y la administración del tratamiento prescrito |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 5 · §3.7 · §3.3 · §2.2 fila "Seguimiento de enfermería" |
| **Trazabilidad NTEC** | Art. 23 lit. a.4; Art. 48 |
| **Tabla SQL** | `ece.registro_enfermeria` · `ece.signos_vitales` · `ece.administracion_medicamento` |
| **Dependencias** | US.F2.4.5 · US.F2.4.6 |

**Criterios de Aceptación:**

```gherkin
Característica: Registro de enfermería por turno

  Escenario: ENF registra turno completo
    Dado que el episodio está activo y existen indicaciones médicas vigentes
    Cuando ENF registra para turno="nocturno":
      nota_evolucion="Paciente descansó, sin incidencias",
      plan_cuidados="Continuar plan establecido"
    Y registra signos vitales: PA=118/76, FC=72, FR=16, T=36.8, SatO2=97%
    Y registra administración de cada indicacion_item: estado="administrado", hora_aplicada=now()
    Y aplica firma electrónica simple
    Entonces el sistema crea registro_enfermeria, signos_vitales y administracion_medicamento vinculados

  Escenario: Medicamento omitido con justificación
    Dado que una indicación de medicamento no pudo administrarse
    Cuando ENF registra estado="omitido" con observación "Paciente náuseas, vómito"
    Entonces el sistema registra la omisión y alerta al médico de turno

  Escenario: Signos vitales fuera de rango fisiológico
    Dado que ENF registra temperatura=40.2 (fuera de rango normal)
    Cuando guarda el registro
    Entonces el sistema registra el valor y genera alerta clínica visible en el dashboard del médico
    Y el alerta queda trazada en el audit_log con timestamp

  Escenario: Kardex vinculado a indicaciones activas
    Dado que existen 5 items de indicaciones con vigencia="activa"
    Cuando ENF abre el kardex del turno
    Entonces el sistema muestra solo los items activos para ese turno
    Y preselecciona la hora programada según frecuencia de la indicación

  Escenario: Turno ya cerrado por otro ENF
    Dado que el turno "matutino" ya tiene registro_enfermeria firmado
    Cuando otro ENF del mismo turno intenta crear otro registro
    Entonces el sistema alerta y requiere justificación para el registro adicional
```

---

### US.F2.4.9 — Hoja de Interconsulta (Solicitud + Respuesta)

| Campo | Valor |
|---|---|
| **Como** | médico tratante |
| **Quiero** | solicitar interconsulta a un especialista y que el interconsultante registre su respuesta en el expediente |
| **Para** | garantizar la continuidad asistencial y la integración del criterio especializado en el plan terapéutico |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 6 · §3.10 · §2.2 fila "Interconsulta" |
| **Trazabilidad NTEC** | Art. 40 (teleinterconsulta); módulo RRI |
| **Tabla SQL** | `ece.referencia_rri` (tipo="interconsulta") |
| **Dependencias** | US.F2.4.4 |

**Criterios de Aceptación:**

```gherkin
Característica: Interconsulta hospitalaria

  Escenario: MC solicita interconsulta a Cardiología
    Dado que el MC identifica necesidad de valoración especializada
    Cuando registra la solicitud con:
      tipo="interconsulta", especialidad_solicitada="cardiologia",
      motivo="Arritmia no controlada, solicitar criterio",
      resumen_clinico="Paciente masculino 65 años, Hx de IAM previo..."
    Y aplica firma electrónica simple
    Entonces el sistema crea registro en ece.referencia_rri
    Y notifica al servicio de cardiología o al ESP designado

  Escenario: Especialista registra respuesta
    Dado que el IC recibe notificación de interconsulta
    Cuando accede al expediente y registra respuesta_interconsultante="Se valora paciente..."
    Y aplica firma electrónica simple con su usuario IC
    Entonces el sistema actualiza el campo respondido_por y fecha_respuesta
    Y el MC recibe notificación de respuesta disponible

  Escenario: Teleinterconsulta (Art. 40 NTEC)
    Dado que el especialista está en establecimiento diferente
    Cuando MC registra tipo="teleinterconsulta" con establecimiento_destino
    Entonces el sistema registra en ambos expedientes (origen y destino)
    Y marca la fecha/hora del contacto virtual en los metadatos

  Escenario: Solicitud sin resumen clínico
    Cuando el MC intenta guardar la solicitud sin resumen_clinico
    Entonces el sistema rechaza con "El resumen clínico es obligatorio para la interconsulta"
```

---

### US.F2.4.10 — Solicitud y Resultado de Lab/Gabinete Hospitalario

| Campo | Valor |
|---|---|
| **Como** | médico tratante o médico de turno |
| **Quiero** | solicitar estudios de laboratorio/gabinete durante la hospitalización y recibir los resultados integrados al expediente |
| **Para** | sustentar objetivamente el diagnóstico y ajustar el tratamiento con datos de apoyo diagnóstico |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 5 · §3.18 · §2.2 fila "Solicitud y resultado de estudios" |
| **Trazabilidad NTEC** | Art. 16 (CIE-10); módulo RELAB SIS |
| **Tabla SQL** | `ece.solicitud_estudio` · `ece.resultado_estudio` |
| **Dependencias** | US.F2.4.4 |

**Criterios de Aceptación:**

```gherkin
Característica: Solicitud y resultado de estudios hospitalarios

  Escenario: MC solicita panel de laboratorio
    Dado que el episodio hospitalario está activo
    Cuando MC registra solicitud con:
      tipo="laboratorio",
      examenes=[{nombre:"Hemograma completo"},{nombre:"PCR"},{nombre:"Glucosa"}]
    Y aplica firma electrónica simple
    Entonces el sistema crea ece.solicitud_estudio con estado="solicitado"
    Y notifica a laboratorio clínico

  Escenario: Laboratorio registra resultado validado
    Dado que la muestra fue procesada
    Cuando el responsable de laboratorio registra:
      valores=[{analito:"Hemoglobina", valor:"8.5", unidad:"g/dL", rango_referencia:"12-16"}]
    Y aplica su firma de validación
    Entonces el sistema crea ece.resultado_estudio con estado_registro="vigente"
    Y cambia solicitud.estado="resultado_listo"
    Y notifica al MC solicitante

  Escenario: Resultado con valor crítico
    Dado que el resultado incluye un valor fuera del rango de pánico (ej. K+=6.8 mEq/L)
    Cuando se registra el resultado
    Entonces el sistema genera alerta crítica de valor de pánico visible inmediatamente al MC
    Y el alerta requiere confirmación de lectura por el médico

  Escenario: Solicitud anulada
    Dado que el MC decide cancelar un estudio antes de tomar la muestra
    Cuando cambia estado="anulado"
    Entonces el sistema registra el cambio con usuario y timestamp
    Y no genera resultado para esa solicitud

  Escenario: Resultado sin solicitud previa
    Cuando el responsable de laboratorio intenta registrar resultado sin solicitud_id válida
    Entonces el sistema rechaza "Todo resultado debe vincularse a una solicitud médica firmada"
```

---

### US.F2.4.11 — Nota Preoperatoria + Valoración Anestésica + Riesgo Quirúrgico

| Campo | Valor |
|---|---|
| **Como** | cirujano (ESP) y anestesiólogo |
| **Quiero** | registrar la nota preoperatoria, la valoración anestésica y la clasificación de riesgo quirúrgico |
| **Para** | documentar la preparación del paciente y respaldar la decisión de proceder con la cirugía |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.1 · §3.13 sub: valoración preop · §2.2 fila "Valoración preoperatoria" |
| **Trazabilidad NTEC** | Art. 23 lit. a.4; §3.13 NTEC |
| **Tabla SQL** | `ece.acto_quirurgico` campo `valoracion_preop` (JSONB) |
| **Dependencias** | US.F2.4.4 · US.F2.4.7 |

**Criterios de Aceptación:**

```gherkin
Característica: Valoración preoperatoria

  Escenario: Cirujano registra nota preoperatoria
    Dado que el episodio tiene historia clínica e indicación quirúrgica documentada
    Cuando el ESP registra la nota preoperatoria con:
      diagnostico_pre, procedimiento_propuesto, hallazgos_relevantes, plan_quirurgico
    Y aplica firma electrónica simple
    Entonces el sistema guarda en valoracion_preop.nota_preoperatoria con timestamp

  Escenario: Anestesiólogo registra valoración y riesgo ASA
    Dado que la nota preoperatoria del cirujano está registrada
    Cuando el ANEST registra:
      clasificacion_asa="II", via_aerea="normal",
      antecedentes_anestesia, plan_anestesico
    Y aplica su firma electrónica simple
    Entonces el sistema guarda valoracion_preop.valoracion_anestesica
    Y registra riesgo_quirurgico con clasificación ASA

  Escenario: Bloqueo si consentimiento quirúrgico no registrado
    Dado que la valoración preoperatoria está completa
    Pero el consentimiento quirúrgico (tipo="quirurgico") no existe en el episodio
    Cuando el sistema intenta habilitar el acto quirúrgico
    Entonces bloquea el avance con "Se requiere consentimiento quirúrgico y anestésico firmado"

  Escenario: Riesgo quirúrgico alto — alerta obligatoria
    Dado que el ANEST clasifica riesgo ASA="IV" o "V"
    Cuando guarda la valoración
    Entonces el sistema genera alerta de alto riesgo visible para ESP, ANEST y jefe de servicio
    Y requiere nota de justificación para proceder
```

---

### US.F2.4.12 — Consentimiento Quirúrgico + Anestésico (Bloqueante)

| Campo | Valor |
|---|---|
| **Como** | cirujano y anestesiólogo |
| **Quiero** | registrar los consentimientos quirúrgico y anestésico firmados por el paciente o representante legal |
| **Para** | cumplir el requisito legal previo al acto quirúrgico y garantizar la autonomía del paciente |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.1 · §3.9 quirúrgico · §2.2 fila "Consentimiento quirúrgico/anestésico" |
| **Trazabilidad NTEC** | Ley Deberes y Derechos Art. 5 lit. a); §3.9 |
| **Tabla SQL** | `ece.consentimiento_informado` (tipo="quirurgico" y tipo="anestesico") |
| **Dependencias** | US.F2.4.11 · US.F2.4.3 |

**Criterios de Aceptación:**

```gherkin
Característica: Consentimiento quirúrgico y anestésico

  Escenario: Registro de consentimientos quirúrgico y anestésico
    Dado que la valoración preoperatoria está completa
    Cuando el ESP registra consentimiento tipo="quirurgico" con:
      procedimiento_descrito, riesgos_explicados, alternativas,
      firmante_rol="paciente", evidencia_firma
    Y el ANEST registra consentimiento tipo="anestesico" con su propia descripción
    Y ambos aplican firma electrónica simple
    Entonces el sistema crea dos registros HISTÓRICO en ece.consentimiento_informado
    Y habilita el paso "Acto quirúrgico"

  Escenario: Bloqueo del acto quirúrgico sin consentimientos
    Dado que el sistema intenta abrir el checklist de cirugía segura
    Y no existen ambos consentimientos firmados (quirúrgico + anestésico)
    Entonces el sistema bloquea con "No se puede iniciar el acto quirúrgico sin consentimientos quirúrgico y anestésico registrados y firmados"

  Escenario: Revocación del consentimiento por el paciente
    Dado que el paciente desea revocar su consentimiento antes de la cirugía
    Cuando el ESP registra la revocación con nota y timestamp
    Entonces el sistema suspende el flujo quirúrgico
    Y crea un registro de revocación en el expediente (no borra el consentimiento original)

  Escenario: Menor de edad — representante legal
    Dado que el paciente es menor de edad
    Cuando se registra el consentimiento
    Entonces el sistema obliga firmante_rol="representante_legal"
    Y valida que el documento del representante esté registrado
```

---

### US.F2.4.13 — Lista de Verificación de Cirugía Segura (3 fases)

| Campo | Valor |
|---|---|
| **Como** | equipo quirúrgico (cirujano, anestesiólogo, enfermera instrumentista) |
| **Quiero** | completar la lista de verificación de cirugía segura en sus tres fases: entrada, pausa quirúrgica y salida |
| **Para** | prevenir eventos adversos quirúrgicos y cumplir el protocolo de seguridad del paciente |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.3 · §3.13 sub: checklist · §2.2 fila "Acto quirúrgico" |
| **Trazabilidad NTEC** | §3.13; Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.acto_quirurgico` campo `checklist_cirugia_segura` (JSONB) |
| **Dependencias** | US.F2.4.12 |

**Criterios de Aceptación:**

```gherkin
Característica: Lista de verificación de cirugía segura

  Escenario: Fase de entrada — verificación antes de anestesia
    Dado que ambos consentimientos están firmados
    Cuando el equipo quirúrgico inicia la fase "entrada" del checklist
    Entonces el sistema presenta items obligatorios:
      identidad_confirmada, sitio_marcado, equipo_anestesia_revisado, oximetro_funcionando,
      alergias_conocidas, riesgo_via_aerea, riesgo_hemorragia
    Y cada item requiere confirmación individual con usuario y timestamp

  Escenario: Fase de pausa — verificación antes de incisión
    Dado que la fase de entrada fue completada al 100%
    Cuando el equipo inicia la fase "pausa"
    Entonces el sistema presenta items:
      presentacion_equipo, confirmacion_paciente_procedimiento_sitio,
      profilaxis_antibiotica_administrada, imagenes_disponibles
    Y bloquea el avance si algún item crítico no está marcado

  Escenario: Fase de salida — conteo de instrumental y especímenes
    Dado que el procedimiento quirúrgico concluyó
    Cuando el equipo completa la fase "salida"
    Entonces el sistema registra:
      conteo_instrumental_completo, conteo_gasas_completo,
      especimenes_etiquetados, instrucciones_postoperatorias
    Y cierra el checklist con timestamp de cierre y firmas del equipo

  Escenario: Item crítico no completado — bloqueo de siguiente fase
    Dado que en la fase de entrada el item "identidad_confirmada=false"
    Cuando el sistema intenta avanzar a la fase de pausa
    Entonces bloquea con "Todos los items de la fase anterior deben estar confirmados antes de continuar"

  Escenario: Checklist completo habilita descripción operatoria
    Dado que las 3 fases del checklist están completadas y firmadas
    Entonces el sistema habilita el registro de la Nota/Descripción Operatoria (US.F2.4.14)
```

---

### US.F2.4.14 — Nota / Descripción Operatoria

| Campo | Valor |
|---|---|
| **Como** | cirujano responsable |
| **Quiero** | registrar la descripción operatoria completa del acto quirúrgico |
| **Para** | documentar los hallazgos y el procedimiento realizado con valor médico-legal e inmutabilidad post-firma |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.3 · §3.13 sub: descripción operatoria · §2.2 |
| **Trazabilidad NTEC** | §3.13 (HISTÓRICO); Art. 42 |
| **Tabla SQL** | `ece.acto_quirurgico` campos `diagnostico_post`, `procedimiento_realizado`, `hallazgos` |
| **Dependencias** | US.F2.4.13 |

**Criterios de Aceptación:**

```gherkin
Característica: Descripción operatoria

  Escenario: Cirujano registra descripción operatoria
    Dado que el checklist de cirugía segura está completo
    Cuando el ESP registra:
      diagnostico_pre, diagnostico_post, procedimiento_realizado,
      hallazgos, hora_inicio, hora_fin,
      ayudantes=[{nombre:"Dr. García", rol:"primer ayudante"}]
    Y aplica firma electrónica simple
    Entonces el sistema actualiza ece.acto_quirurgico con los datos
    Y el registro queda en estado HISTÓRICO (inmutable post-firma)

  Escenario: Intento de modificación post-firma
    Dado que la descripción operatoria está firmada
    Cuando el ESP intenta editar el campo procedimiento_realizado
    Entonces el sistema rechaza la edición
    Y muestra "La descripción operatoria es un documento HISTÓRICO inmutable"

  Escenario: Diagnóstico post diferente al pre — alerta
    Dado que diagnostico_post difiere significativamente de diagnostico_pre
    Cuando el ESP guarda
    Entonces el sistema registra la discrepancia diagnóstica en el audit_log
    Y notifica al jefe de servicio

  Escenario: Horario de inicio mayor a horario de fin
    Cuando hora_inicio > hora_fin
    Entonces el sistema rechaza con "La hora de inicio no puede ser posterior a la hora de fin"
```

---

### US.F2.4.15 — Registro Anestésico Transanestésico (Series Temporales)

| Campo | Valor |
|---|---|
| **Como** | anestesiólogo |
| **Quiero** | registrar el monitoreo transanestésico en series temporales (fármacos, parámetros, incidentes) |
| **Para** | documentar el manejo anestésico completo con trazabilidad temporal y respaldo médico-legal |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.3 · §3.13 sub: registro anestésico · §2.2 fila "Anestesia" |
| **Trazabilidad NTEC** | §3.13 (HISTÓRICO); Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.acto_quirurgico` campo `registro_anestesico` (JSONB series) |
| **Dependencias** | US.F2.4.12 |

**Criterios de Aceptación:**

```gherkin
Característica: Registro anestésico transanestésico

  Escenario: ANEST registra monitoreo en series temporales
    Dado que el acto quirúrgico está en curso
    Cuando el ANEST registra periódicamente (cada 5-15 min):
      {timestamp, PA, FC, SatO2, EtCO2, farmacos_administrados, dosis, respuesta}
    Entonces el sistema acumula la serie temporal en registro_anestesico.monitoreo[]
    Y cada entrada lleva timestamp preciso a segundos

  Escenario: Registro de incidente anestésico
    Dado que ocurre un evento (laringoespasmo, broncoespasmo)
    Cuando el ANEST registra incidente con: tipo, hora, manejo, evolución
    Entonces el sistema lo añade a registro_anestesico.incidentes[]
    Y genera alerta auditable en el expediente

  Escenario: Tipo de anestesia y fármacos inductores
    Cuando el ANEST registra tipo_anestesia="general_balanceada" e inductores=[{farmaco:"Propofol", dosis:"2mg/kg"}]
    Entonces el sistema valida que tipo_anestesia pertenezca al catálogo definido
    Y registra los fármacos en el historial

  Escenario: Cierre del registro al finalizar cirugía
    Dado que hora_fin del acto quirúrgico está registrada
    Cuando el ANEST aplica firma electrónica de cierre
    Entonces el registro_anestesico queda inmutable (HISTÓRICO)
    Y habilita la Hoja de Recuperación URPA (US.F2.4.16)
```

---

### US.F2.4.16 — Hoja de Recuperación Postanestésica (URPA)

| Campo | Valor |
|---|---|
| **Como** | enfermera de recuperación y anestesiólogo |
| **Quiero** | registrar el monitoreo postanestésico en URPA y los criterios de egreso de recuperación |
| **Para** | documentar la seguridad postquirúrgica y formalizar el egreso del paciente de la sala de recuperación |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 7.4 · §3.13 sub: recuperación URPA · §2.2 fila "Recuperación postanestésica" |
| **Trazabilidad NTEC** | §3.13 |
| **Tabla SQL** | `ece.acto_quirurgico` campo `recuperacion_urpa` (JSONB) |
| **Dependencias** | US.F2.4.15 |

**Criterios de Aceptación:**

```gherkin
Característica: Recuperación postanestésica URPA

  Escenario: ENF registra monitoreo postanestésico
    Dado que el paciente ingresó a URPA
    Cuando ENF registra series: {timestamp, PA, FC, SatO2, escala_Aldrete, nivel_dolor}
    Entonces el sistema acumula en recuperacion_urpa.monitoreo[] con timestamps precisos
    Y calcula automáticamente el puntaje Aldrete en cada registro

  Escenario: Criterios de egreso de recuperación cumplidos
    Dado que el puntaje Aldrete >= 9 (o criterio institucional) en dos evaluaciones consecutivas
    Cuando el ANEST confirma los criterios de egreso
    Y aplica firma electrónica de egreso de URPA
    Entonces el sistema registra hora_egreso_urpa y el destino (sala, UCI)
    Y habilita el traslado al servicio de hospitalización o UCI

  Escenario: Puntaje Aldrete insuficiente para egreso
    Dado que el puntaje Aldrete < 9 al momento programado de egreso
    Cuando el sistema evalúa los criterios
    Entonces bloquea el egreso de URPA
    Y notifica al ANEST y al ESP para reevaluar

  Escenario: Egreso a UCI directamente desde URPA
    Dado que el paciente requiere cuidados críticos postoperatorios
    Cuando el ANEST registra destino="UCI"
    Entonces el sistema genera traslado a la US.F2.4.17 (Notas UCI)
    Y notifica al servicio de UCI
```

---

### US.F2.4.17 — Notas de UCI / UCIN

| Campo | Valor |
|---|---|
| **Como** | médico intensivista |
| **Quiero** | registrar notas de evolución específicas de UCI/UCIN con parámetros de cuidado intensivo |
| **Para** | documentar el seguimiento del paciente crítico con la frecuencia y detalle que requiere la atención intensiva |
| **Story Points** | 5 |
| **MoSCoW** | Should |
| **Trazabilidad analisis** | §B paso 7.5 · §3.8 con particularidades UCI |
| **Trazabilidad NTEC** | Art. 19; Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.evolucion_medica` con marcador servicio="UCI/UCIN" |
| **Dependencias** | US.F2.4.16 o US.F2.4.2 (ingreso directo a UCI) |

**Criterios de Aceptación:**

```gherkin
Característica: Notas de UCI/UCIN

  Escenario: Intensivista registra nota UCI
    Dado que el paciente está asignado al servicio UCI
    Cuando el médico intensivista registra evolución con parámetros:
      subjetivo, objetivo (incluye: vasopresores, ventilación mecánica, balance hídrico),
      analisis, plan, APACHE_score, scores_especificos
    Y aplica firma electrónica simple
    Entonces el sistema crea ece.evolucion_medica con metadato servicio="UCI"

  Escenario: Frecuencia de notas UCI — mínimo 1 por turno
    Dado que el paciente lleva 8 h en UCI sin nota de evolución
    Cuando el sistema revisa el período
    Entonces genera alerta "Sin nota de evolución UCI en las últimas 8 horas" al médico de turno

  Escenario: Traslado de UCI a sala general
    Dado que el paciente mejora y se decide traslado a sala
    Cuando el intensivista registra la nota de traslado con criterios de egreso UCI
    Entonces el sistema actualiza la asignacion_cama y cambia el servicio activo
    Y notifica al servicio receptor
```

---

### US.F2.4.18 — Partograma (Series Temporales)

| Campo | Valor |
|---|---|
| **Como** | obstetra o médico de turno obstétrico |
| **Quiero** | registrar el partograma con series temporales de dilatación cervical, descenso de la presentación y frecuencia cardiaca fetal (FCF) |
| **Para** | monitorear el progreso del trabajo de parto y detectar desviaciones que requieran intervención oportuna |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 8 · §3.14 sub: partograma · §2.2 fila "Atención obstétrica" |
| **Trazabilidad NTEC** | §3.14; Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.documento_obstetrico` campo `partograma` (JSONB series) |
| **Dependencias** | US.F2.4.2 (ingreso obstétrico) |

**Criterios de Aceptación:**

```gherkin
Característica: Partograma obstétrico

  Escenario: Registro de series temporales del partograma
    Dado que el episodio es de modalidad obstétrica y la paciente está en trabajo de parto
    Cuando el OBS o ENF registra cada evaluación:
      {timestamp, dilatacion_cm, estacion_presentacion, FCF, contracciones_frecuencia,
       contracciones_duracion, membranas, color_liquido_amniotico}
    Entonces el sistema acumula la serie en partograma.registros[]
    Y genera la gráfica del partograma en tiempo real con la curva de Friedman como referencia

  Escenario: Alerta de progreso lento
    Dado que la dilatación no progresa 1 cm/h en fase activa (criterio de Friedman)
    Cuando el sistema evalúa la curva de progreso
    Entonces genera alerta "Progreso lento — evaluar conducta obstétrica"
    Y el alerta queda registrada en el expediente con timestamp

  Escenario: FCF fuera de rango normal
    Dado que se registra FCF < 110 lpm o > 160 lpm
    Cuando el sistema procesa el valor
    Entonces genera alerta de sufrimiento fetal potencial al OBS y MC
    Y el registro incluye la acción tomada

  Escenario: Partograma completo al nacimiento
    Dado que ocurrió el parto
    Cuando el OBS registra el nacimiento en la hoja de sala de expulsión (US.F2.4.20)
    Entonces el sistema cierra el partograma con timestamp de nacimiento
    Y lo vincula al episodio de la paciente y al nuevo episodio del recién nacido
```

---

### US.F2.4.19 — Hoja de Labor de Parto

| Campo | Valor |
|---|---|
| **Como** | médico obstetra o enfermera obstétrica |
| **Quiero** | registrar el proceso del trabajo de parto con sus fases, intervenciones y evolución |
| **Para** | documentar la atención obstétrica intrahospitalaria y respaldar la toma de decisiones durante el parto |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 8 · §3.14 sub: labor de parto · §2.2 fila "Atención obstétrica" |
| **Trazabilidad NTEC** | §3.14 |
| **Tabla SQL** | `ece.documento_obstetrico` campo `labor_parto` (JSONB) |
| **Dependencias** | US.F2.4.18 |

**Criterios de Aceptación:**

```gherkin
Característica: Hoja de labor de parto

  Escenario: Registro de labor de parto completo
    Dado que el partograma está iniciado
    Cuando el OBS registra:
      hora_inicio_labor, hora_ruptura_membranas, tipo_inicio=[espontaneo, inducido, conduccion],
      oxitocina_usada, analgesia, intervenciones=[amniotomia, instrumentacion],
      duracion_fases=[latente_min, activa_min, expulsivo_min]
    Entonces el sistema guarda en labor_parto del documento_obstetrico
    Y habilita la hoja de sala de expulsión

  Escenario: Registro de inducción con oxitocina
    Dado que se administra oxitocina para inducción
    Cuando el OBS registra: oxitocina_usada=true, dosis_inicial, dosis_maxima, tiempo_administracion
    Entonces el sistema vincula la indicación médica de oxitocina con el registro de labor

  Escenario: Parto sin inducción — campo opcional
    Dado que el parto es espontáneo
    Cuando el OBS guarda con oxitocina_usada=false
    Entonces el sistema acepta y no requiere datos de dosis de oxitocina
```

---

### US.F2.4.20 — Hoja de Sala de Expulsión

| Campo | Valor |
|---|---|
| **Como** | médico obstetra |
| **Quiero** | registrar la atención en sala de expulsión: tipo de parto, episiotomía, placenta y condición neonatal inmediata |
| **Para** | documentar el momento del nacimiento y la condición del recién nacido con trazabilidad legal y clínica |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 8 · §3.14 sub: sala de expulsión · §2.2 |
| **Trazabilidad NTEC** | §3.14; Art. 23 lit. a.4 |
| **Tabla SQL** | `ece.documento_obstetrico` campo `sala_expulsion` (JSONB) |
| **Dependencias** | US.F2.4.19 |

**Criterios de Aceptación:**

```gherkin
Característica: Hoja de sala de expulsión

  Escenario: OBS registra parto vaginal
    Dado que la labor progresó a expulsivo
    Cuando el OBS registra:
      hora_nacimiento, tipo_parto=[eutocico, instrumentado_forceps, instrumentado_vacuum],
      presentacion, episiotomia=[si, no], laceraciones_grado,
      hora_expulsion_placenta, integridad_placenta,
      perdida_sanguinea_ml, medicamentos_uterotonicos
    Y aplica firma electrónica simple
    Entonces el sistema guarda sala_expulsion en documento_obstetrico
    Y registra hora_nacimiento como campo indexado para generación del CUN/NUI

  Escenario: Cesárea — referencia a acto quirúrgico
    Dado que el parto finaliza por cesárea (ya documentada en US.F2.4.14)
    Cuando el OBS registra tipo_parto="cesarea"
    Entonces el sistema vincula sala_expulsion.acto_quirurgico_id al registro de la cesárea
    Y evita duplicación de información del acto quirúrgico

  Escenario: APGAR inmediato requerido
    Dado que el nacimiento fue registrado
    Cuando el sistema verifica la sala de expulsión
    Entonces bloquea el guardado si APGAR al minuto 1 no está registrado
    Y alerta que APGAR a los 5 minutos es obligatorio si el de 1 min < 7
```

---

### US.F2.4.21 — Hoja de Atención del Recién Nacido (genera CUN/NUI)

| Campo | Valor |
|---|---|
| **Como** | neonatólogo o médico que atiende al recién nacido |
| **Quiero** | registrar la atención inmediata del recién nacido y que el sistema genere automáticamente el CUN y NUI del neonato |
| **Para** | abrir el expediente del recién nacido desde el momento del nacimiento cumpliendo la obligación normativa MINSAL |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 8 · §3.14 sub: atención RN · §2.2 fila "Atención del recién nacido" |
| **Trazabilidad NTEC** | Art. 12 (CUN); §3.14; §3.1 (ficha identificación RN) |
| **Tabla SQL** | `ece.documento_obstetrico` campo `atencion_rn` + `recien_nacido_paciente_id` |
| **Dependencias** | US.F2.4.20 |

**Criterios de Aceptación:**

```gherkin
Característica: Atención del recién nacido y generación de CUN/NUI

  Escenario: Registro completo y generación automática de CUN
    Dado que la hora de nacimiento está registrada en sala de expulsión
    Cuando el NEO o MC registra la atención del RN:
      sexo_rn, peso_g, talla_cm, perimetro_cefalico_cm,
      apgar_1min, apgar_5min,
      edad_gestacional_semanas, clasificacion=[AEG, PEG, GEG],
      reanimacion_requerida=[no, si], maniobras_reanimacion,
      estado_alta=[vivo_normal, traslado_ucin, obito]
    Y aplica firma electrónica simple
    Entonces el sistema genera CUN y NUI para el recién nacido
    Y crea automáticamente la ficha de identificación del neonato en ece.paciente
    Y vincula recien_nacido_paciente_id en documento_obstetrico

  Escenario: Recién nacido trasladado a UCIN
    Dado que estado_alta="traslado_ucin"
    Cuando se guarda la atención del RN
    Entonces el sistema crea un nuevo episodio hospitalario para el neonato en UCIN
    Y notifica al servicio UCIN con los datos del neonato

  Escenario: APGAR a los 5 min ausente cuando 1 min < 7
    Dado que apgar_1min=4
    Cuando el NEO intenta guardar sin apgar_5min
    Entonces el sistema bloquea con "APGAR a los 5 minutos es obligatorio si el APGAR al minuto es menor de 7"

  Escenario: Óbito fetal — flujo diferente
    Dado que el neonato nace sin signos de vida (óbito)
    Cuando el NEO registra estado_alta="obito"
    Entonces el sistema no genera CUN/NUI sino que activa el flujo de certificado de defunción fetal
    Y requiere registro de causa de muerte perinatal con CIE-10

  Escenario: CUN duplicado — prevención
    Dado que el sistema intenta generar CUN para un neonato
    Y ya existe un paciente con los mismos datos de nacimiento
    Entonces el sistema alerta de posible duplicado y requiere confirmación del NEO antes de crear nuevo registro
```

---

### ✅ US.F2.4.22 — Orden de Egreso / Certificación de Alta Médica

| Campo | Valor |
|---|---|
| **Como** | médico tratante |
| **Quiero** | emitir la orden de egreso certificando el alta médica con tipo de egreso y circunstancia |
| **Para** | formalizar la finalización del episodio hospitalario y habilitar los procesos administrativos de egreso |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 9 · §3.15 dependencia · §2.2 fila "Orden de egreso" |
| **Trazabilidad NTEC** | Art. 4 (alta médica, egreso hospitalario); Art. 17 lit. b |
| **Tabla SQL** | `ece.episodio_hospitalario` campos `tipo_egreso`, `circunstancia_alta`, `fecha_hora_egreso` |
| **Dependencias** | US.F2.4.7 (evolución completa) |

**Criterios de Aceptación:**

```gherkin
Característica: Orden de egreso y alta médica

  Escenario: MC emite alta hospitalaria de paciente vivo
    Dado que el episodio tiene evolución médica registrada y el MC decide el alta
    Cuando el MC registra:
      tipo_egreso="vivo",
      circunstancia_alta="alta_hospitalaria",
      fecha_hora_egreso=now()
    Y aplica firma electrónica simple
    Entonces el sistema actualiza ece.episodio_hospitalario con los datos de egreso
    Y habilita la elaboración de la Epicrisis (US.F2.4.23)
    Y notifica a Admisión para egreso administrativo

  Escenario: Alta voluntaria — documentación especial
    Dado que el paciente solicita alta en contra de criterio médico
    Cuando el MC registra circunstancia_alta="alta_voluntaria"
    Entonces el sistema requiere nota de renuncia firmada por el paciente/representante
    Y registra el consentimiento de alta voluntaria en el expediente

  Escenario: In extremis — cuidados paliativos en casa
    Dado que el paciente está en fase terminal
    Cuando el MC registra circunstancia_alta="in_extremis"
    Entonces el sistema genera instrucciones de cuidados paliativos en la epicrisis
    Y alerta a trabajo social para seguimiento domiciliario

  Escenario: Fallecido — flujo diferente
    Dado que el paciente falleció durante la hospitalización
    Cuando el MC registra tipo_egreso="fallecido"
    Entonces el sistema habilita obligatoriamente el Certificado de Defunción (US.F2.4.24)
    Y bloquea el egreso administrativo hasta que el certificado esté registrado

  Escenario: Egreso sin evolución médica del día
    Dado que el MC intenta emitir orden de egreso
    Y no existe evolución médica registrada para el día actual
    Entonces el sistema advierte "No hay nota de evolución médica del día de hoy"
    Y requiere confirmación explícita del MC para continuar
```

---

### ✅ US.F2.4.23 — Epicrisis / Hoja de Egreso + Indicaciones + Receta + Citas

| Campo | Valor |
|---|---|
| **Como** | médico tratante |
| **Quiero** | elaborar la epicrisis completa del episodio hospitalario con diagnósticos de egreso CIE-10, resumen, indicaciones de alta, receta y citas de seguimiento |
| **Para** | cerrar la responsabilidad asistencial, garantizar la continuidad post-alta y cumplir el resumen de expediente (Art. 41 lit. c NTEC) |
| **Story Points** | 8 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 10 · §3.15 · §2.2 fila "Resumen de egreso" |
| **Trazabilidad NTEC** | Art. 41 lit. c; Art. 17 lit. b; Art. 42 |
| **Tabla SQL** | `ece.epicrisis_egreso` |
| **Dependencias** | US.F2.4.22 |

**Criterios de Aceptación:**

```gherkin
Característica: Epicrisis / hoja de egreso

  Escenario: MC elabora epicrisis completa
    Dado que la orden de egreso está registrada
    Cuando el MC completa:
      tipo_egreso="vivo", circunstancia_alta="alta_hospitalaria",
      diagnosticos_egreso_cie10=[{cie10:"J18.9"},{cie10:"E11.9"}],
      resumen_evolucion="Paciente evolucionó favorablemente...",
      procedimientos_realizados, resultados_complementarios,
      manejo_terapeutico, indicaciones_alta, citas_seguimiento=[{fecha, servicio}]
    Y crea la receta de egreso vinculada
    Y aplica firma electrónica simple
    Entonces el sistema inserta en ece.epicrisis_egreso como registro HISTÓRICO
    Y la epicrisis queda disponible para impresión/entrega al paciente

  Escenario: Plazo de 24 h post-egreso
    Dado que han pasado más de 24 h desde la fecha_hora_egreso
    Y la epicrisis aún no está registrada
    Entonces el sistema genera alerta para el MC y el jefe de servicio

  Escenario: Diagnósticos de egreso sin CIE-10
    Cuando el MC intenta firmar la epicrisis
    Y diagnosticos_egreso_cie10 está vacío
    Entonces el sistema rechaza con "Los diagnósticos de egreso deben estar codificados en CIE-10 (Art. 17 lit. b)"

  Escenario: Fallecido — certificado vinculado obligatorio
    Dado que tipo_egreso="fallecido"
    Cuando el MC intenta firmar la epicrisis
    Y no existe certificado_defuncion vinculado al episodio
    Entonces el sistema bloquea con "Se requiere Certificado de Defunción antes de cerrar la epicrisis de paciente fallecido"

  Escenario: Visto del jefe de servicio
    Dado que el establecimiento requiere visto bueno del jefe de servicio
    Cuando el MC firma la epicrisis
    Entonces el sistema notifica al jefe de servicio para que registre su visto (visto_jefe_servicio)
    Y la epicrisis puede imprimirse sin el visto pero queda marcada como "pendiente de visto"

  Escenario: Rectificación de epicrisis
    Dado que se detecta error en la epicrisis firmada
    Cuando el MC solicita rectificación
    Entonces el sistema crea nueva versión y marca la anterior estado_registro="rectificado"
    Y el audit_log registra todos los campos modificados con timestamps
```

---

### ✅ US.F2.4.24 — Certificado de Defunción

| Campo | Valor |
|---|---|
| **Como** | médico que certifica la defunción |
| **Quiero** | registrar el certificado de defunción con causa básica, causas intermedias y clasificación de la muerte |
| **Para** | cumplir la obligación médico-legal, habilitar los trámites post-mortem y determinar la retención extendida del expediente |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 11 · §3.16 · §2.2 fila "Egreso de paciente fallecido" |
| **Trazabilidad NTEC** | Art. 35 (retención extendida); §3.16 (HISTÓRICO) |
| **Tabla SQL** | `ece.certificado_defuncion` |
| **Dependencias** | US.F2.4.23 (epicrisis tipo_egreso="fallecido") |

**Criterios de Aceptación:**

```gherkin
Característica: Certificado de defunción

  Escenario: MC certifica defunción natural
    Dado que la epicrisis tiene tipo_egreso="fallecido"
    Cuando el MC registra:
      fecha_hora_defuncion, causa_basica_cie10="J18.9",
      causas_intermedias=[{causa:"Sepsis", cie10:"A41.9"}],
      clasificacion="natural"
    Y aplica firma electrónica simple
    Entonces el sistema crea ece.certificado_defuncion como registro HISTÓRICO
    Y vincula epicrisis_id al certificado
    Y activa retención extendida del expediente (5 años mínimo)

  Escenario: Muerte violenta o accidente — investigación
    Dado que clasificacion="violencia" o "accidente_transito" o "en_investigacion"
    Cuando el MC registra la clasificación
    Entonces el sistema activa retención extendida de 10 años (Art. 35 NTEC)
    Y genera notificación obligatoria a las autoridades correspondientes

  Escenario: Causa básica sin CIE-10
    Cuando el MC intenta guardar sin causa_basica_cie10
    Entonces el sistema rechaza con "La causa básica de muerte debe estar codificada en CIE-10"

  Escenario: Certificado inmutable post-firma
    Dado que el certificado está registrado y firmado
    Cuando cualquier usuario intenta modificar el contenido
    Entonces el sistema rechaza la operación
    Y el audit_log registra el intento con usuario y timestamp
```

---

### ✅ US.F2.4.25 — Acta de Entrega de Cuerpo + Registro de Morgue

| Campo | Valor |
|---|---|
| **Como** | administrativo del establecimiento |
| **Quiero** | registrar el acta de entrega del cuerpo y el ingreso/salida en el registro de morgue |
| **Para** | documentar la cadena de custodia del cuerpo y cumplir los trámites post-mortem requeridos |
| **Story Points** | 3 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 11 · §2.2 fila "Egreso de paciente fallecido" |
| **Trazabilidad NTEC** | Art. 21 (gobierno documental); §3.16 |
| **Tabla SQL** | Registro operativo separado (no expediente — Art. 37 NTEC) |
| **Dependencias** | US.F2.4.24 |

**Criterios de Aceptación:**

```gherkin
Característica: Acta de entrega de cuerpo y morgue

  Escenario: ADM registra entrega de cuerpo a familiar
    Dado que el certificado de defunción está registrado
    Cuando ADM registra:
      nombre_receptor, documento_receptor, parentesco,
      fecha_hora_entrega, testigos, observaciones
    Entonces el sistema crea el acta de entrega de cuerpo como registro operativo
    Y actualiza el estado del episodio a "cerrado_fallecido"

  Escenario: Cuerpo pendiente en morgue
    Dado que no hay familiar para recibir el cuerpo
    Cuando ADM registra ingreso_morgue con fecha_hora_ingreso y número de celda
    Entonces el sistema mantiene el estado "en_morgue" hasta el registro de entrega

  Escenario: Entrega sin certificado de defunción
    Cuando ADM intenta registrar la entrega de cuerpo
    Y no existe certificado_defuncion firmado para el episodio
    Entonces el sistema bloquea con "Se requiere certificado de defunción firmado antes de la entrega del cuerpo"
```

---

### US.F2.4.26 — Censo de Movimiento Diario / Liberación de Cama

| Campo | Valor |
|---|---|
| **Como** | administrativo de admisión |
| **Quiero** | registrar el egreso en el censo de movimiento diario y liberar la cama automáticamente |
| **Para** | mantener actualizado el censo hospitalario y habilitar la cama para un nuevo paciente |
| **Story Points** | 3 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 11 · §3.19 (registro operativo) · §2.2 fila "Egreso administrativo" |
| **Trazabilidad NTEC** | Art. 37 NTEC (conservación 1 año como documento operativo) |
| **Tabla SQL** | `ece.asignacion_cama` (cierre) · `ece.cama` (estado) |
| **Dependencias** | US.F2.4.22 |

**Criterios de Aceptación:**

```gherkin
Característica: Censo de movimiento y liberación de cama

  Escenario: ADM registra egreso y libera cama
    Dado que la orden de egreso está registrada por el MC
    Cuando ADM confirma el egreso administrativo
    Entonces el sistema cierra la asignacion_cama actual (hasta=now())
    Y cambia ece.cama.estado="disponible"
    Y registra el movimiento de egreso en el censo diario

  Escenario: Censo diario automático
    Dado que es las 00:00 de cada día
    Cuando el sistema ejecuta el proceso nocturno
    Entonces genera el censo de movimiento: ingresos, egresos, traslados, fallecidos, disponibilidad de camas
    Y el reporte queda disponible para ESDOMED y administración

  Escenario: Traslado de cama (cambio de servicio)
    Dado que el paciente es trasladado de "medicina" a "cirugía"
    Cuando ADM registra el traslado
    Entonces el sistema cierra la asignacion_cama anterior y abre una nueva
    Y actualiza el censo con el movimiento de traslado interno

  Escenario: Egreso ISSS — certificado de incapacidad
    Dado que el paciente es derechohabiente ISSS y requiere incapacidad
    Cuando ADM procesa el egreso
    Entonces el sistema habilita el módulo de Certificado de Incapacidad (US ambulatoria §3.17)
    Y alerta al médico autorizado ISSS para la firma
```

---

### US.F2.4.27 — Codificación CIE-10 de Egreso + Verificación de Integridad Documental

| Campo | Valor |
|---|---|
| **Como** | archivista/ESDOMED |
| **Quiero** | verificar la integridad documental del episodio cerrado y completar la codificación CIE-10 de egreso |
| **Para** | garantizar que el expediente cumple todos los requerimientos normativos antes del archivo definitivo |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 12 · §2.2 fila "Codificación y cierre" |
| **Trazabilidad NTEC** | Art. 16 (CIE-10); Art. 17 lit. b |
| **Tabla SQL** | `ece.epicrisis_egreso.diagnosticos_egreso` · `ece.episodio_atencion.estado` |
| **Dependencias** | US.F2.4.23 |

**Criterios de Aceptación:**

```gherkin
Característica: Codificación CIE-10 y verificación de integridad

  Escenario: ARCH verifica integridad documental
    Dado que el episodio tiene epicrisis firmada y orden de egreso
    Cuando ARCH abre el checklist de integridad
    Entonces el sistema verifica automáticamente la presencia de:
      orden_ingreso, hoja_ingreso, consentimiento_hospitalizacion,
      historia_clinica_ingreso, al_menos_una_evolucion_medica,
      al_menos_un_registro_enfermeria, epicrisis con diagnosticos_cie10
    Y muestra el resultado: "Completo" / "Incompleto [lista de faltantes]"

  Escenario: Codificación CIE-10 refinada por ARCH
    Dado que el médico registró diagnósticos CIE-10 a nivel de 3 dígitos
    Cuando ARCH refina la codificación a 4-5 dígitos según clasificador oficial
    Entonces el sistema actualiza diagnosticos_egreso con los códigos refinados
    Y registra en audit_log: usuario ARCH, timestamp, código anterior, código nuevo

  Escenario: Episodio incompleto — bloqueo de cierre
    Dado que el checklist de integridad detecta documentos faltantes
    Cuando ARCH intenta cerrar el episodio
    Entonces el sistema bloquea con la lista de documentos faltantes
    Y notifica al servicio correspondiente para completar

  Escenario: Cierre del episodio post-verificación
    Dado que el checklist de integridad está completo al 100%
    Y los CIE-10 de egreso están codificados
    Cuando ARCH confirma el cierre
    Entonces el sistema cambia episodio.estado="cerrado"
    Y registra fecha y usuario del cierre en el audit_log
    Y el episodio pasa a modo solo-lectura
```

---

### US.F2.4.28 — Foliado y Archivo (Art. 19-21 NTEC)

| Campo | Valor |
|---|---|
| **Como** | archivista (ARCH/ESDOMED) |
| **Quiero** | registrar el foliado del expediente y su incorporación al archivo con todas las reglas de retención |
| **Para** | cumplir los artículos 19-21 NTEC sobre integridad documental, orden cronológico y custodia |
| **Story Points** | 3 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §B paso 12 · §2.2 fila "Archivo / certificación" |
| **Trazabilidad NTEC** | Art. 19 (orden cronológico); Art. 20 (conservación); Art. 21 (custodia) |
| **Tabla SQL** | Registro operativo `ece.movimiento_expediente` (§3.19) |
| **Dependencias** | US.F2.4.27 |

**Criterios de Aceptación:**

```gherkin
Característica: Foliado y archivo del episodio

  Escenario: ARCH registra foliado y archivo del episodio
    Dado que el episodio está cerrado y verificado
    Cuando ARCH registra:
      numero_folio_inicio, numero_folio_fin, total_folios,
      ubicacion_fisica_archivo, fecha_archivo
    Entonces el sistema registra el movimiento en ece.movimiento_expediente
    Y actualiza el expediente con estado_documental="archivado"
    Y establece fecha_retencion_hasta según las reglas de retención

  Escenario: Regla de retención según diagnóstico (Art. 35 NTEC)
    Dado que el episodio tiene diagnósticos de patología crónica o violencia
    Cuando el sistema calcula la retención
    Entonces aplica: crónico => activo hasta 5 años sin movimiento; violencia/accidente => mínimo 10 años
    Y marca el expediente como "activo" o "pasivo" según última actividad (5 años sin registro)

  Escenario: Expediente digital sin folio físico
    Dado que el expediente es completamente electrónico
    Cuando ARCH registra el archivo
    Entonces el campo numero_folio queda nulo
    Y el sistema registra la ubicación del respaldo digital cifrado

  Escenario: Orden cronológico verificado
    Dado que el episodio tiene documentos
    Cuando ARCH verifica el orden antes de archivar
    Entonces el sistema lista los documentos en orden cronológico ascendente (Art. 19 NTEC)
    Y alerta si existe algún documento fuera de orden o sin timestamp
```

---

### US.F2.4.29 — Certificación Administrativa de Copia (Solo DIR)

| Campo | Valor |
|---|---|
| **Como** | dirección del establecimiento o su delegado autorizado |
| **Quiero** | emitir la certificación administrativa de copia del expediente o de un documento específico |
| **Para** | cumplir el Art. 21 NTEC que restringe esta facultad exclusivamente a la dirección del establecimiento |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad analisis** | §2.2 fila "Archivo / certificación" · Nota de gobierno documental §2.2 |
| **Trazabilidad NTEC** | Art. 21 (certificación restringida); Art. 32 |
| **Tabla SQL** | Registro auditable `ece.certificacion_copia` (nuevo) |
| **Dependencias** | US.F2.4.28 · RBAC rol DIR |

**Criterios de Aceptación:**

```gherkin
Característica: Certificación de copia — acceso restringido a DIR

  Escenario: DIR certifica copia de expediente completo
    Dado que el usuario tiene rol DIR o delegado autorizado
    Cuando DIR registra la solicitud de certificación con:
      solicitante_nombre, documento_solicitante, motivo_solicitud,
      tipo_solicitud=[expediente_completo, documento_especifico],
      autoridad_destinataria
    Y aplica firma electrónica de nivel DIR
    Entonces el sistema crea el registro en ece.certificacion_copia con timestamp y número de folio
    Y genera el documento de certificación para impresión/entrega
    Y el audit_log registra la operación como evento de nivel crítico

  Escenario: Intento de certificación por rol no autorizado
    Dado que un usuario con rol ENF, MT, ADM o ARCH intenta certificar una copia
    Cuando accede al módulo de certificación
    Entonces el sistema rechaza con "Solo la Dirección del establecimiento o su delegado pueden certificar copias del expediente (Art. 21 NTEC)"
    Y el intento queda registrado en el audit_log como evento de seguridad

  Escenario: Solicitud judicial — protocolo especial
    Dado que la solicitud de copia proviene de autoridad judicial
    Cuando DIR registra autoridad_destinataria="judicial" con número de oficio
    Entonces el sistema aplica protocolo de entrega judicial con registro adicional de cadena de custodia

  Escenario: Delegado temporal autorizado por DIR
    Dado que DIR designa un delegado para una fecha específica
    Cuando el delegado intenta certificar en esa fecha
    Entonces el sistema valida la delegación activa y permite la operación
    Y registra tanto el delegado como el DIR que autorizó la delegación

  Escenario: Registro auditable completo
    Dado que se emite cualquier certificación
    Entonces el sistema registra: quién solicitó, quién autorizó, qué documentos, para quién, cuándo, número correlativo
    Y el registro es inmutable (solo INSERT en ece.certificacion_copia)
```

---

## Historias de Soporte Transversal (E.F2.4.S)

---

### US.F2.4.30 — Firma Electrónica Simple Hospitalaria (transversal)

| Campo | Valor |
|---|---|
| **Como** | cualquier profesional de salud |
| **Quiero** | que cada documento del ECE hospitalario registre mi firma electrónica simple con metadatos completos (usuario, timestamp, establecimiento) |
| **Para** | cumplir Art. 4.17 y Art. 23 lit. a.4 NTEC y garantizar la responsabilidad profesional innegable por acto |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad NTEC** | Art. 4.17; Art. 23 lit. a.4; Art. 55-56 |
| **Dependencias** | US auth y gestión de usuarios |

**Criterios de Aceptación:**

```gherkin
Característica: Firma electrónica simple en documentos hospitalarios

  Escenario: Registro de metadatos obligatorios NTEC
    Dado que cualquier profesional guarda un documento transaccional o histórico
    Cuando el sistema persiste el registro
    Entonces almacena obligatoriamente:
      registrado_por (FK personal_salud), registrado_en (timestamp con precisión segundo),
      establecimiento_id, institucion_id
    Y los metadatos no pueden ser nulos ni modificados post-guardado

  Escenario: Bitácora de modificaciones inmutable
    Dado que un documento es rectificado
    Cuando el sistema registra la rectificación
    Entonces el audit_log incluye: usuario, timestamp_segundo, campo_modificado, valor_anterior, valor_nuevo
    Y la bitácora se conserva mínimo 2 años (Art. 55-56 NTEC)

  Escenario: Intento de acceso denegado registrado
    Dado que un usuario intenta acceder a un expediente sin permisos
    Cuando el sistema rechaza el acceso
    Entonces registra en la bitácora: usuario, timestamp, recurso_intentado, resultado="denegado"
```

---

### US.F2.4.31 — Inmutabilidad y Rectificación Trazable (transversal)

| Campo | Valor |
|---|---|
| **Como** | sistema ECE |
| **Quiero** | garantizar que los documentos HISTÓRICO no puedan modificarse y que los TRANSACCIONAL solo se corrijan via rectificación con trazabilidad completa |
| **Para** | cumplir Art. 42 NTEC y la cadena de hash de auditoría del sistema HIS |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad NTEC** | Art. 42; cadena hash TDR §6.3 |
| **Dependencias** | audit_triggers.sql · audit_hash_chain.sql |

```gherkin
Característica: Inmutabilidad documental

  Escenario: Documentos HISTÓRICO — solo INSERT
    Dado que un documento está marcado como HISTÓRICO (consentimiento, descripción operatoria, epicrisis, certificado_defuncion)
    Cuando cualquier usuario intenta un UPDATE o DELETE vía API
    Entonces el sistema rechaza la operación con HTTP 403
    Y la cadena de hash de auditoría detectaría cualquier modificación directa en BD

  Escenario: Documentos TRANSACCIONAL — rectificación trazable
    Dado que un documento TRANSACCIONAL tiene error
    Cuando el profesional solicita rectificación
    Entonces el sistema marca el registro como estado_registro="rectificado"
    Y crea nuevo registro con los datos corregidos y campo anterior_version_id
    Y ambos registros quedan accesibles en el historial del expediente
```

---

### US.F2.4.32 — Dashboard de Estado de Episodio Hospitalario

| Campo | Valor |
|---|---|
| **Como** | médico tratante y enfermera a cargo |
| **Quiero** | ver en un panel centralizado el estado actual del episodio: documentos pendientes, alertas activas, medicamentos del turno y signos vitales recientes |
| **Para** | tener visión completa del paciente y priorizar acciones durante la estancia hospitalaria |
| **Story Points** | 8 |
| **MoSCoW** | Should |
| **Trazabilidad analisis** | §B paso 5 (seguimiento) |
| **Dependencias** | US.F2.4.4 al US.F2.4.10 |

```gherkin
Característica: Dashboard de episodio hospitalario

  Escenario: Médico visualiza panel del paciente
    Dado que el MC accede al episodio activo
    Cuando abre el dashboard del paciente
    Entonces el sistema muestra:
      resumen: nombre, cama, días de hospitalización, diagnóstico principal,
      alertas activas (alergias, valores críticos, documentos pendientes),
      últimos signos vitales del turno,
      indicaciones vigentes del turno actual,
      notas de evolución del día,
      estudios pendientes de resultado

  Escenario: Documentos pendientes por completar
    Dado que el episodio tiene documentos requeridos sin registrar (ej. evolución del día)
    Cuando el MC abre el dashboard
    Entonces el sistema muestra badge de alerta "1 documento pendiente: Evolución médica del día"
```

---

### US.F2.4.33 — Modo de Contingencia (papel + digitación posterior)

| Campo | Valor |
|---|---|
| **Como** | cualquier profesional de salud durante falla del sistema |
| **Quiero** | activar el modo de contingencia para captura en papel, con digitación posterior vinculada al mismo episodio |
| **Para** | garantizar la continuidad asistencial en eventos de no disponibilidad del sistema (Art. 6 lit. c y Art. 23 lit. c NTEC) |
| **Story Points** | 5 |
| **MoSCoW** | Must |
| **Trazabilidad NTEC** | Art. 6 lit. c; Art. 23 lit. c |
| **Dependencias** | US.F2.4.2 |

```gherkin
Característica: Modo de contingencia

  Escenario: Activación de modo contingencia
    Dado que el sistema detecta indisponibilidad o el ADM activa el modo manualmente
    Cuando se activa el modo contingencia
    Entonces el sistema genera formularios en PDF para impresión con el número de episodio preimpreso
    Y alerta a todos los usuarios activos de la activación del modo contingencia

  Escenario: Digitación posterior post-contingencia
    Dado que el sistema se restauró y hay registros en papel del período de contingencia
    Cuando el profesional digita los datos retroactivamente
    Entonces el sistema registra: registrado_en=timestamp_actual, fecha_atencion_real=fecha_papel
    Y el registro queda marcado como "ingreso_retroactivo_contingencia"
    Y el audit_log registra el profesional que digitó y la justificación
```

---

### US.F2.4.34 — Respaldo Diario y Conservación Diferenciada

| Campo | Valor |
|---|---|
| **Como** | SRE del sistema HIS |
| **Quiero** | que el sistema ejecute respaldo diario en ubicación distinta y aplique las reglas de conservación diferenciada según diagnóstico |
| **Para** | cumplir Art. 48 (backup diario cifrado) y Art. 34-35 NTEC (conservación por tipo de expediente) |
| **Story Points** | 3 |
| **MoSCoW** | Must |
| **Trazabilidad NTEC** | Art. 34; Art. 35; Art. 48 |
| **Dependencias** | US.F2.4.27 · US.F2.4.28 |

```gherkin
Característica: Respaldo y conservación de expedientes

  Escenario: Respaldo diario automático
    Dado que es la hora programada de respaldo (00:00 o la configurada)
    Cuando se ejecuta el proceso de backup
    Entonces el sistema genera respaldo cifrado en ubicación distinta al primario
    Y registra en el log: fecha, hora, tamaño, hash de verificación, resultado

  Escenario: Clasificación de retención
    Dado que un episodio se cierra
    Cuando el sistema calcula la retención
    Entonces aplica:
      - Expediente con patología crónica: activo hasta 5 años sin actividad, luego pasivo
      - Fallecido por violencia/accidente/en investigación: retención mínima 10 años
      - Estándar: 5 años (Art. 34 NTEC)
```

---

## Resumen del Backlog

### Tabla de Story Points y Prioridad

| ID | Título (resumen) | SP | MoSCoW | Sprint Propuesto |
|---|---|---|---|---|
| US.F2.4.1 | Orden de Ingreso Hospitalario | 5 | Must | S1 |
| US.F2.4.2 | Apertura de Episodio Hospitalario | 5 | Must | S1 |
| US.F2.4.3 | Consentimiento Hospitalización | 5 | Must | S1 |
| US.F2.4.4 | Historia Clínica de Ingreso | 8 | Must | S1 |
| US.F2.4.5 | Valoración Enfermería + Plan Cuidados | 5 | Must | S1 |
| US.F2.4.6 | Indicaciones Médicas Hospitalarias | 8 | Must | S1 |
| US.F2.4.7 | Evolución Médica Diaria SOAP | 5 | Must | S2 |
| US.F2.4.8 | Registro Enfermería + SV + Kardex | 8 | Must | S2 |
| US.F2.4.9 | Interconsulta (solicitud + respuesta) | 5 | Must | S2 |
| US.F2.4.10 | Solicitud/Resultado Lab/Gabinete | 5 | Must | S2 |
| US.F2.4.11 | Nota Preoperatoria + Valoración Anestésica | 8 | Must | S2 |
| US.F2.4.12 | Consentimiento Quirúrgico + Anestésico | 5 | Must | S2 |
| US.F2.4.13 | Checklist Cirugía Segura 3 fases | 8 | Must | S3 |
| US.F2.4.14 | Descripción Operatoria | 5 | Must | S3 |
| US.F2.4.15 | Registro Anestésico Transanestésico | 8 | Must | S3 |
| US.F2.4.16 | Hoja Recuperación URPA | 5 | Must | S3 |
| US.F2.4.17 | Notas UCI/UCIN | 5 | Should | S3 |
| US.F2.4.18 | Partograma (series temporales) | 8 | Must | S3 |
| US.F2.4.19 | Hoja de Labor de Parto | 5 | Must | S3 |
| US.F2.4.20 | Hoja de Sala de Expulsión | 5 | Must | S4 |
| US.F2.4.21 | Atención RN (genera CUN/NUI) | 8 | Must | S4 |
| US.F2.4.22 | Orden de Egreso / Alta Médica | 5 | Must | S4 |
| US.F2.4.23 | Epicrisis / Hoja de Egreso completa | 8 | Must | S4 |
| US.F2.4.24 | Certificado de Defunción | 5 | Must | S4 |
| US.F2.4.25 | Acta Entrega de Cuerpo + Morgue | 3 | Must | S4 |
| US.F2.4.26 | Censo Movimiento / Liberación Cama | 3 | Must | S4 |
| US.F2.4.27 | Codificación CIE-10 + Integridad Documental | 5 | Must | S5 |
| US.F2.4.28 | Foliado y Archivo (Art. 19-21) | 3 | Must | S5 |
| US.F2.4.29 | Certificación Copia (solo DIR) | 5 | Must | S5 |
| US.F2.4.30 | Firma Electrónica Simple (transversal) | 5 | Must | S1 |
| US.F2.4.31 | Inmutabilidad + Rectificación Trazable | 5 | Must | S1 |
| US.F2.4.32 | Dashboard Estado Episodio | 8 | Should | S3 |
| US.F2.4.33 | Modo Contingencia papel+digital | 5 | Must | S2 |
| US.F2.4.34 | Respaldo Diario + Conservación Diferenciada | 3 | Must | S5 |
| **TOTAL** | | **193** | | |

---

## Matriz de Cobertura Documental

| Documento (scope solicitado) | US que lo cubre | NTEC | Estado |
|---|---|---|---|
| 1. Orden de Ingreso Hospitalario (3.11) | US.F2.4.1 | Art. 17 lit. b | Cubierto |
| 2. Hoja de Ingreso / Apertura Episodio (3.12) | US.F2.4.2 | Art. 15, 17 lit. b | Cubierto |
| 3. Consentimiento Hospitalización (3.9 hosp.) | US.F2.4.3 | Ley D y D Art. 5 | Cubierto |
| 4. Historia Clínica de Ingreso (3.2 hosp.) | US.F2.4.4 | Art. 4.14, 42 | Cubierto |
| 5. Valoración Enfermería + Plan Cuidados (3.7) | US.F2.4.5 | Art. 23 lit. a.4 | Cubierto |
| 6. Indicaciones Médicas hospitalarias (3.6) | US.F2.4.6 | Art. 42 | Cubierto |
| 7. Evolución Médica diaria SOAP (3.8) | US.F2.4.7 | Art. 19, 42 | Cubierto |
| 8. Registro Enfermería + SV + Kardex (3.3, 3.7) | US.F2.4.8 | Art. 23, 48 | Cubierto |
| 9. Interconsulta solicitud + respuesta (3.10) | US.F2.4.9 | Art. 40 | Cubierto |
| 10. Solicitud + Resultado Lab/Gabinete (3.18) | US.F2.4.10 | Art. 16 | Cubierto |
| 11. Nota Preoperatoria + Val. Anestésica (3.13) | US.F2.4.11 | §3.13 | Cubierto |
| 12. Consentimiento Quirúrgico + Anestésico (3.9) | US.F2.4.12 | Ley D y D Art. 5 | Cubierto |
| 13. Lista Verificación Cirugía Segura (3.13) | US.F2.4.13 | §3.13 | Cubierto |
| 14. Nota / Descripción Operatoria (3.13) | US.F2.4.14 | §3.13 | Cubierto |
| 15. Registro Anestésico transanestésico (3.13) | US.F2.4.15 | §3.13 | Cubierto |
| 16. Hoja de Recuperación URPA (3.13) | US.F2.4.16 | §3.13 | Cubierto |
| 17. Notas UCI/UCIN | US.F2.4.17 | Art. 19 | Cubierto |
| 18. Partograma (3.14) | US.F2.4.18 | §3.14 | Cubierto |
| 19. Hoja de Labor de Parto (3.14) | US.F2.4.19 | §3.14 | Cubierto |
| 20. Hoja de Sala de Expulsión (3.14) | US.F2.4.20 | §3.14 | Cubierto |
| 21. Atención RN + CUN/NUI (3.14) | US.F2.4.21 | Art. 12, §3.14 | Cubierto |
| 22. Orden de Egreso / Alta Médica | US.F2.4.22 | Art. 4, 17 lit. b | Cubierto |
| 23. Epicrisis + Indicaciones + Receta + Citas (3.15) | US.F2.4.23 | Art. 41 lit. c | Cubierto |
| 24. Certificado de Defunción (3.16) | US.F2.4.24 | Art. 35 | Cubierto |
| 25. Acta Entrega Cuerpo + Morgue | US.F2.4.25 | Art. 21, §3.16 | Cubierto |
| 26. Censo Movimiento Diario / Liberación Cama | US.F2.4.26 | Art. 37 | Cubierto |
| 27. Codificación CIE-10 + Integridad Documental | US.F2.4.27 | Art. 16, 17 lit. b | Cubierto |
| 28. Foliado + Archivo (Art. 19-21) | US.F2.4.28 | Art. 19-21 | Cubierto |
| 29. Certificación Copia (solo DIR, Art. 21) | US.F2.4.29 | Art. 21, 32 | Cubierto |

**Cobertura documental: 29/29 = 100 %**

---

## Pasos del Proceso Hospitalario §B — Cobertura

| Paso §B | US que lo cubre |
|---|---|
| 1. Origen del ingreso (orden de ingreso) | US.F2.4.1 |
| 2. Admisión hospitalaria | US.F2.4.2 |
| 3. Consentimiento informado | US.F2.4.3, US.F2.4.12 |
| 4. Ingreso al servicio | US.F2.4.4, US.F2.4.5, US.F2.4.6 |
| 5. Estancia / seguimiento | US.F2.4.7, US.F2.4.8, US.F2.4.10 |
| 6. Interconsulta | US.F2.4.9 |
| 7.1 Valoración preoperatoria | US.F2.4.11 |
| 7.2 Preparación quirúrgica | US.F2.4.11, US.F2.4.12 |
| 7.3 Acto quirúrgico | US.F2.4.13, US.F2.4.14, US.F2.4.15 |
| 7.4 Recuperación postanestésica | US.F2.4.16 |
| 7.5 Cuidados críticos UCI/UCIN | US.F2.4.17 |
| 8. Ruta obstétrica | US.F2.4.18, US.F2.4.19, US.F2.4.20, US.F2.4.21 |
| 9. Decisión y orden de egreso | US.F2.4.22 |
| 10. Epicrisis / resumen de egreso | US.F2.4.23 |
| 11. Egreso administrativo | US.F2.4.25, US.F2.4.26 |
| 12. Cierre clínico-documental y archivo | US.F2.4.24, US.F2.4.27, US.F2.4.28, US.F2.4.29 |

**Cobertura de pasos del proceso: 12/12 = 100 %**

---

## Decisiones de Producto

| ID | Decisión | Justificación |
|---|---|---|
| DEC-01 | Consentimiento quirúrgico es hard-block: sin él, el checklist de cirugía segura no abre | Ley Deberes y Derechos Art. 5; prevención de eventos adversos legales |
| DEC-02 | Certificado de Defunción es hard-block para cerrar epicrisis de fallecido | Art. 35 NTEC; trámites post-mortem dependen del certificado |
| DEC-03 | Certificación de copia restringida al rol DIR via RBAC, no delegable automáticamente | Art. 21 NTEC — "solo la dirección o su delegado" |
| DEC-04 | Registro anestésico y descripción operatoria son HISTÓRICO — sin UPDATE en API | §3.13 valor probatorio |
| DEC-05 | CUN/NUI del recién nacido generados automáticamente en `atencion_rn` | Ley SNIS: expediente único desde nacimiento |
| DEC-06 | Partograma con gráfica de Friedman como referencia visual (no validación forzada) | Flexibilidad clínica; la alerta es informativa, el médico decide |
| DEC-07 | US.F2.4.17 (UCI) clasificada como Should, no Must | Aplica solo si el establecimiento tiene UCI; configurable por institución |
| DEC-08 | Modo contingencia genera PDF con número de episodio preimpreso | Art. 23 lit. c — continuidad asistencial en falla |

---

## Riesgos del Producto

| ID | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R-01 | Integración con hardware de captura de firma/huella para consentimientos | Media | Alto | MVP: captura de imagen de firma; biométrico en release 2 |
| R-02 | Series temporales de partograma y registro anestésico con alta frecuencia de escritura | Media | Medio | JSONB acumulativo en una fila por episodio; evaluar partición si > 1000 registros |
| R-03 | Generación automática de CUN/NUI requiere integración con registro civil/MINSAL | Alta | Alto | MVP: genera CUN temporal interno; integración RNPN en release 2 |
| R-04 | RBAC del rol DIR — establecimiento puede tener múltiples sedes | Media | Alto | DIR se configura por establecimiento_id; la delegación es por fecha y establecimiento |
| R-05 | Checklist de cirugía segura: distintos establecimientos tienen items institucionales propios | Media | Medio | Catálogo base OMS + extensión institucional configurable |
| R-06 | Puntaje Aldrete: diferentes versiones y variantes (Steward para pediatría) | Baja | Bajo | Catálogo de scores configurable por institución |

---

## Capacidad Estimada

| Sprint | US incluidas | SP totales |
|---|---|---|
| Sprint 1 | US.F2.4.1, 2, 3, 4, 5, 6, 30, 31 | 51 |
| Sprint 2 | US.F2.4.7, 8, 9, 10, 11, 12, 33 | 49 |
| Sprint 3 | US.F2.4.13, 14, 15, 16, 17, 18, 19, 32 | 52 |
| Sprint 4 | US.F2.4.20, 21, 22, 23, 24, 25, 26 | 39 |
| Sprint 5 | US.F2.4.27, 28, 29, 34 | 16 |
| **Total** | **34 historias** | **193 SP** |

---

*Documento generado por @PO — Stream 6 de 10 — Fase 2 ECE Hospitalario, Quirúrgico y Obstétrico.*
*Trazabilidad: analisis_workflows_ece.md §B · §2.2 · §3.9-3.18 · 04_episodios.sql · 06_documentos_clinicos.sql · NTEC Acuerdo 1616 MINSAL.*
