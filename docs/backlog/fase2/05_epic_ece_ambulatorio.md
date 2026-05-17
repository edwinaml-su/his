# E.F2.3 — ECE Maestros y Procesos Ambulatorios
## Épica: Expediente Clínico Electrónico — Ciclo Ambulatorio Completo

> **Fase:** 2 — Digitalización del ECE
> **Stream:** 5 de 10
> **Normativa base:** Acuerdo n.° 1616 MINSAL (30/05/2024), Ley SNIS Arts. 24-26, Ley Deberes y Derechos de los Pacientes, Ley de Protección de Datos Personales.
> **Stack HIS:** Next.js 14 App Router + tRPC v11 + Prisma 5 + PostgreSQL 15 (Supabase) + Tailwind/Shadcn.

---

## Visión de la Épica

Digitalizar íntegramente el ciclo de atención ambulatoria del Complejo Hospitalario Avante, desde la captación del usuario hasta el alta ambulatoria y archivo del expediente, cumpliendo el conjunto mínimo de variables del Art. 15 NTEC, la firma electrónica simple obligatoria, la inmutabilidad con rectificación trazable (Art. 42 NTEC) y la conservación diferenciada (Art. 34-35 NTEC).

---

## Definition of Ready (DoR)

- Historia priorizada en el backlog con SP asignados.
- Criterios de aceptación Gherkin revisados por @QAF.
- Dependencias técnicas identificadas y bloqueadoras resueltas.
- Esquema SQL del documento correspondiente disponible en `_insumos/`.
- Router tRPC del módulo padre existente o en desarrollo concurrente.
- Catálogos MINSAL/ISSS cargados en la BD (seed).

---

## Definition of Done (DoD)

- Código merged a `main` con PR aprobado por @Dev + @QA.
- Tests unitarios y de integración >= 80% cobertura.
- Criterios Gherkin automatizados o con evidencia de prueba manual firmada.
- Axe-core sin críticos ni serios (a11y).
- Lint + typecheck verde en CI.
- Firma electrónica simple registrada en `audit.audit_log` con hash chain intacto.
- Entrada en matriz de trazabilidad `docs/05_backlog.md`.
- RLS `withTenantContext` aplicado en todos los routers con datos tenant-scoped.

---

## Roles normalizados

| Código | Descripción |
|--------|-------------|
| ADM | Administrativo de admisión |
| AC | Atención al Cliente |
| ARCH | Personal de Archivo / ESDOMED |
| ENF | Enfermería |
| MT | Médico de Turno |
| MC | Médico de Cabecera / Tratante |
| ESP | Especialista / Interconsultante |
| PAC | Paciente o representante legal |
| SIS | Sistema / proceso automático |

---

## KPIs de Producto

| KPI | Definición | Meta MVP |
|-----|-----------|---------|
| Tasa de duplicados de paciente | % episodios con paciente duplicado detectado/bloqueado | < 0.5% |
| Completitud de firma electrónica | % documentos con firma electrónica simple registrada | 100% |
| Tiempo de creación de expediente | Mediana de tiempo ARCH para crear ficha nueva | < 3 min |
| Integridad del audit hash chain | % episodios sin ruptura de cadena | 100% |
| Cobertura documental del episodio | % episodios cerrados con todos los documentos mínimos | >= 95% |
| Tasa de incapacidades ISSS emitidas digitalmente | % certificados emitidos sin papel | >= 90% |

---

## Backlog Priorizado

### Resumen de Épica

| ID | Título | SP | MoSCoW | Documento ECE |
|----|--------|----|--------|--------------|
| US.F2.3.1 | Crear ficha de identificación — paciente nuevo | 8 | Must | 3.1 Ficha |
| US.F2.3.2 | Buscar y recuperar expediente (NUI/DUI/nombre) | 5 | Must | 3.1 Ficha |
| US.F2.3.3 | Actualizar datos demográficos con trazabilidad | 3 | Must | 3.1 Ficha |
| US.F2.3.4 | Registrar paciente desconocido / sin documentos | 3 | Must | 3.1 Ficha |
| US.F2.3.5 | Gestionar afiliación ISSS (derechohabiencia) | 5 | Must | 3.1 Ficha |
| US.F2.3.6 | Detectar y unificar expedientes duplicados | 8 | Must | 3.1 Ficha |
| US.F2.3.7 | Abrir episodio ambulatorio (consulta externa / emergencia) | 5 | Must | 04_episodios |
| US.F2.3.8 | Registrar admisión administrativa MINSAL/ISSS | 3 | Must | 2.1 Proceso |
| US.F2.3.9 | Registrar hoja de triaje Manchester en emergencia | 8 | Must | 3.4 Triaje |
| US.F2.3.10 | Registrar signos vitales / preconsulta (serie temporal) | 5 | Must | 3.3 Signos |
| US.F2.3.11 | Visualizar tendencias de signos vitales del episodio | 3 | Should | 3.3 Signos |
| US.F2.3.12 | Crear historia clínica — primera vez | 8 | Must | 3.2 HC |
| US.F2.3.13 | Registrar nota de evolución — consulta subsecuente | 5 | Must | 3.8 Evolución |
| US.F2.3.14 | Firmar electrónicamente documento clínico | 5 | Must | Transversal |
| US.F2.3.15 | Rectificar documento clínico con trazabilidad | 5 | Must | 3.2 / 3.8 |
| US.F2.3.16 | Crear hoja de atención de emergencia | 8 | Must | 3.5 Emergencia |
| US.F2.3.17 | Registrar hoja de observación en emergencia (< 24h) | 5 | Must | 3.5 / 3.8 |
| US.F2.3.18 | Emitir hoja de indicaciones médicas (prescripción) | 8 | Must | 3.6 Indicaciones |
| US.F2.3.19 | Versionar y suspender indicaciones médicas | 3 | Must | 3.6 Indicaciones |
| US.F2.3.20 | Registrar notas de enfermería por turno | 5 | Must | 3.7 Enfermería |
| US.F2.3.21 | Registrar administración de medicamento (kardex) | 8 | Must | 3.7 Kardex |
| US.F2.3.22 | Registrar hoja de evolución médica (SOAP) ambulatoria | 5 | Must | 3.8 Evolución |
| US.F2.3.23 | Emitir solicitud de laboratorio / gabinete (RELAB) | 5 | Must | 3.18 Estudios |
| US.F2.3.24 | Registrar resultado de laboratorio / gabinete | 5 | Must | 3.18 Estudios |
| US.F2.3.25 | Visualizar resultados adjuntos al episodio | 3 | Must | 3.18 Estudios |
| US.F2.3.26 | Emitir hoja RRI — Referencia a otro nivel | 8 | Must | 3.10 RRI |
| US.F2.3.27 | Emitir hoja RRI — Retorno / Interconsulta | 5 | Must | 3.10 RRI |
| US.F2.3.28 | Registrar respuesta de interconsulta | 3 | Must | 3.10 RRI |
| US.F2.3.29 | Registrar consentimiento informado para procedimiento menor | 5 | Must | 3.9 Consent. |
| US.F2.3.30 | Registrar hoja de procedimiento menor / curaciones | 5 | Must | Doc. 14 |
| US.F2.3.31 | Dispensar medicamento desde farmacia (registro documental) | 3 | Must | 2.1 §8 |
| US.F2.3.32 | Emitir certificado de incapacidad temporal ISSS | 8 | Must | 3.17 Incap. |
| US.F2.3.33 | Registrar alta ambulatoria con firma médica | 5 | Must | Doc. 13 Alta |
| US.F2.3.34 | Cerrar episodio ambulatorio y registrar disposición | 3 | Must | 04_episodios |
| US.F2.3.35 | Registrar devolución de expediente a archivo | 3 | Must | 2.1 §12 |
| US.F2.3.36 | Generar listado de movimiento de expedientes (ARCH) | 3 | Should | Art. 30 NTEC |
| US.F2.3.37 | Visualizar cronología completa del episodio | 5 | Should | Transversal |
| US.F2.3.38 | Gestionar estado activo/pasivo del expediente | 3 | Should | Art. 34 NTEC |
| US.F2.3.39 | Emitir receta de egreso ambulatoria | 3 | Should | 2.1 §12 |
| US.F2.3.40 | Registrar modalidad telesalud en episodio | 3 | Should | 04_episodios |
| US.F2.3.41 | Buscar episodios por rango de fecha / servicio / estado | 3 | Should | Transversal |
| US.F2.3.42 | Verificar integridad documental del episodio (checklist) | 5 | Should | Art. 19 NTEC |
| US.F2.3.43 | Codificar diagnóstico CIE-10 al cierre del episodio | 5 | Must | Art. 16-17 NTEC |
| US.F2.3.44 | Consultar bitácora de accesos al expediente | 3 | Must | Art. 55-56 NTEC |
| US.F2.3.45 | Configurar retención diferenciada por diagnóstico | 5 | Should | Art. 34-35 NTEC |
| US.F2.3.46 | Solicitar cita de seguimiento post-alta ambulatoria | 3 | Should | 2.1 §12 |
| US.F2.3.47 | Registrar captación por referencia externa (módulo RRI) | 3 | Should | 2.1 §1 |
| US.F2.3.48 | Imprimir / exportar PDF de documento clínico firmado | 3 | Could | Transversal |
| US.F2.3.49 | Certificar copia del expediente (solo Dirección) | 5 | Should | Art. 21 NTEC |
| US.F2.3.50 | Notificar al médico resultado de estudio disponible | 3 | Could | 3.18 / Workflow |

**SP Total: 230**

---

## Historias de Usuario Detalladas

---

### US.F2.3.1 — Crear ficha de identificación para paciente nuevo

**Como** ARCH **quiero** registrar la ficha de identificación de un paciente nuevo en el sistema **para** dar cumplimiento al Art. 15 NTEC y habilitar la creación de su expediente médico único.

**AC Gherkin:**
```gherkin
Funcionalidad: Creación de ficha de identificación del expediente clínico

  Escenario: Registro exitoso de paciente adulto con DUI verificado
    Dado que soy ARCH autenticado en el establecimiento "Complejo Hospitalario Avante"
    Y el sistema no encuentra ningún expediente previo para el DUI "04567890-1"
    Cuando completo los campos obligatorios: primer nombre, primer apellido, fecha de nacimiento, sexo, DUI, dirección, teléfono
    Y selecciono origen_identidad "verificado"
    Y confirmo el registro
    Entonces el sistema genera un numero_expediente único para el establecimiento
    Y crea el registro en ece.paciente con estado_expediente "activo"
    Y registra el responsable_toma_datos con mi usuario
    Y registra el evento en audit.audit_log con hash chain

  Escenario: Intento de registro con DUI ya existente en el establecimiento
    Dado que soy ARCH autenticado
    Y el DUI "04567890-1" ya está asociado a un expediente activo
    Cuando intento crear una nueva ficha con el mismo DUI
    Entonces el sistema muestra la alerta "Expediente existente encontrado" con enlace al expediente previo
    Y bloquea la creación del nuevo registro sin confirmación de unificación

  Escenario: Registro de menor de 18 años con carnet de minoridad
    Dado que soy ARCH autenticado
    Y el paciente es menor de 18 años sin DUI
    Cuando registro el carnet_minoridad y los datos del responsable (nombre, parentesco, documento, teléfono)
    Entonces el sistema permite guardar sin DUI
    Y valida que responsable_paciente esté completo
    Y asigna origen_identidad "verificado"
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** Catálogos de establecimiento, personal_salud (ARCH), seed inicial.
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.2 | `03_paciente_maestro.sql` tabla `ece.paciente`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 11, 12, 15 NTEC
- **Notas técnicas:** Router tRPC `patientRouter.create`. `withTenantContext` obligatorio. Índice `idx_paciente_dui` para deduplicación. Número de expediente generado por función Postgres (`ece.gen_numero_expediente`).

---

### US.F2.3.2 — Buscar y recuperar expediente por NUI, DUI o nombre

**Como** ARCH o ADM **quiero** buscar un expediente existente por NUI, DUI o nombre aproximado **para** recuperar el expediente del paciente sin crear duplicados.

**AC Gherkin:**
```gherkin
Funcionalidad: Búsqueda y recuperación de expediente clínico

  Escenario: Búsqueda exitosa por DUI exacto
    Dado que soy ARCH o ADM autenticado
    Cuando ingreso el DUI "04567890-1" en el campo de búsqueda
    Entonces el sistema muestra la ficha del paciente con nombre completo, número de expediente y estado del expediente
    Y habilita el botón "Abrir expediente"

  Escenario: Búsqueda por nombre aproximado con múltiples resultados
    Dado que ingreso "García López" como criterio de búsqueda
    Cuando ejecuto la búsqueda
    Entonces el sistema muestra hasta 20 registros ordenados por similitud (trigram GIN)
    Y cada resultado muestra: nombre completo, fecha de nacimiento, número de expediente, estado

  Escenario: Búsqueda sin resultados
    Dado que ingreso un DUI "99999999-9" que no existe
    Cuando ejecuto la búsqueda
    Entonces el sistema muestra "No se encontraron expedientes" con el botón "Crear nuevo expediente"

  Escenario: Búsqueda bloqueada por expediente unificado
    Dado que un expediente tiene estado_registro "unificado"
    Cuando lo encuentro en la búsqueda
    Entonces el sistema lo muestra con etiqueta "Unificado" y enlace al expediente maestro activo
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1, índices `idx_paciente_nui`, `idx_paciente_dui`, `idx_paciente_nom`
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.2 | `03_paciente_maestro.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 11, 14 lit. g NTEC
- **Notas técnicas:** Query tRPC `patientRouter.search` con `ilike` + `pg_trgm`. Máximo 20 resultados paginados. Excluir `estado_registro = 'unificado'` de la búsqueda primaria.

---

### US.F2.3.3 — Actualizar datos demográficos con trazabilidad

**Como** ARCH **quiero** actualizar datos demográficos del paciente (dirección, teléfono, estado familiar, responsable) **para** mantener la información vigente sin perder el historial de cambios.

**AC Gherkin:**
```gherkin
Funcionalidad: Actualización de datos demográficos del expediente

  Escenario: Actualización de dirección con registro de cambio
    Dado que soy ARCH autenticado y tengo abierto el expediente del paciente
    Cuando modifico el campo "dirección" de "Col. Escalón, SV" a "Col. Médica, SV"
    Y guardo el cambio
    Entonces el sistema actualiza el campo en ece.paciente
    Y registra en audit.audit_log: usuario, campo modificado, valor anterior, valor nuevo, timestamp completo
    Y el hash chain no se rompe

  Escenario: Intento de modificar número de expediente
    Dado que soy ARCH autenticado
    Cuando intento editar el campo numero_expediente
    Entonces el sistema muestra el campo como solo lectura
    Y muestra "El número de expediente es inmutable (Art. 14 lit. g NTEC)"

  Escenario: Actualización de responsable del paciente
    Dado que el paciente es menor y cambió su responsable legal
    Cuando agrego un nuevo registro en responsable_paciente con vigente=true
    Entonces el sistema marca el responsable anterior como vigente=false
    Y conserva el historial de responsables anteriores
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.2 | `03_paciente_maestro.sql` tabla `ece.responsable_paciente`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 42, 55-56 NTEC
- **Notas técnicas:** `numero_expediente` y `nui` son campos inmutables — deshabilitar en UI y validar en capa tRPC. Audit trigger en `ece.paciente`.

---

### US.F2.3.4 — Registrar paciente desconocido o sin documentos

**Como** ARCH o MT **quiero** registrar un paciente sin documentos de identidad (inconsciente, situación de calle, desconocido) **para** no bloquear la atención de emergencia mientras no se puede identificar al paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Registro de paciente desconocido

  Escenario: Creación de ficha con documento_no_presentado
    Dado que soy ARCH o MT autenticado
    Y el paciente no puede presentar documentos de identidad
    Cuando marco la opción "Documento no presentado"
    Y selecciono origen_identidad "desconocido"
    Y registro observaciones descriptivas (sexo aparente, edad estimada, características físicas)
    Entonces el sistema crea la ficha sin DUI ni NUI
    Y asigna un numero_expediente provisional prefijado "DESC-"
    Y habilita la atención inmediata

  Escenario: Identificación posterior del paciente desconocido
    Dado que existe una ficha con origen_identidad "desconocido"
    Y el paciente es identificado posteriormente con DUI "04567890-1"
    Cuando ARCH actualiza el DUI y cambia origen_identidad a "verificado"
    Entonces el sistema verifica que no exista un expediente previo con ese DUI
    Y si existe, lanza el flujo de unificación (US.F2.3.6)
    Y si no existe, vincula el documento al expediente provisional
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.2 | `03_paciente_maestro.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 15 NTEC
- **Notas técnicas:** `documento_no_presentado = true` desactiva validación de DUI en schema Zod. Prefijo "DESC-" configurable por establecimiento.

---

### US.F2.3.5 — Gestionar afiliación ISSS (derechohabiencia)

**Como** AC o ADM **quiero** registrar y verificar la afiliación ISSS del paciente (cotizante, beneficiario, pensionado) **para** habilitar los servicios ISSS correspondientes y el número patronal.

**AC Gherkin:**
```gherkin
Funcionalidad: Gestión de afiliación ISSS

  Escenario: Registro de afiliación cotizante
    Dado que soy AC autenticado en admisión
    Y el paciente tiene carnet de afiliación ISSS activo
    Cuando registro numero_afiliado, tipo_derechohabiente "cotizante" y numero_patronal
    Y guardo la afiliación
    Entonces el sistema crea el registro en ece.afiliacion_isss
    Y muestra la etiqueta "ISSS Verificado" en la ficha del paciente

  Escenario: Intento de registrar afiliación duplicada
    Dado que el paciente ya tiene una afiliación ISSS vigente
    Cuando intento crear otra afiliación
    Entonces el sistema muestra "Este paciente ya tiene afiliación ISSS activa"
    Y ofrece la opción "Actualizar afiliación"

  Escenario: Paciente sin afiliación ISSS en establecimiento ISSS
    Dado que el establecimiento es de la red ISSS
    Y el paciente no tiene afiliación registrada
    Cuando el administrativo confirma atención como "no derechohabiente"
    Entonces el sistema registra la atención sin bloque ISSS
    Y marca en el episodio la modalidad de financiamiento "particular"
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.3 | `03_paciente_maestro.sql` tabla `ece.afiliacion_isss`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Reglamentación interna ISSS — derechohabiencia
- **Notas técnicas:** `ece.afiliacion_isss` tiene constraint `unique(paciente_id)`. Router `admissionRouter.upsertIsssAffiliation`.

---

### US.F2.3.6 — Detectar y unificar expedientes duplicados

**Como** ARCH **quiero** detectar y unificar expedientes duplicados del mismo paciente **para** garantizar el expediente médico único por usuario (Ley SNIS Art. 24-26) y cumplir el Art. 14 lit. g NTEC.

**AC Gherkin:**
```gherkin
Funcionalidad: Unificación de expedientes duplicados

  Escenario: Detección automática de duplicado al crear expediente
    Dado que soy ARCH creando una nueva ficha
    Y el sistema detecta que ya existe un expediente con el mismo DUI "04567890-1"
    Entonces bloquea la creación y muestra "Se encontró expediente existente"
    Y presenta ambos registros para comparar
    Y ofrece el botón "Iniciar unificación"

  Escenario: Unificación exitosa — expediente sobreviviente
    Dado que soy ARCH con rol de unificación habilitado
    Y tengo dos expedientes del mismo paciente: EXP-001 (antiguo) y EXP-002 (nuevo)
    Cuando selecciono EXP-001 como expediente maestro
    Y confirmo la unificación
    Entonces el sistema marca EXP-002 con estado_registro "unificado" y expediente_maestro_id = EXP-001
    Y migra todos los episodios de EXP-002 a EXP-001
    Y registra la unificación en audit.audit_log con detalle completo
    Y EXP-002 queda inaccesible para nuevas atenciones

  Escenario: Intento de unificación sin confirmación de dirección
    Dado que el proceso de unificación está iniciado
    Cuando intento confirmar sin haber revisado los episodios de ambos expedientes
    Entonces el sistema exige que ARCH marque "He revisado los episodios de ambos expedientes"
    Y no permite continuar sin esa confirmación
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1, US.F2.3.2, permisos de rol ARCH
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.2 | `03_paciente_maestro.sql` campo `expediente_maestro_id`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 14 lit. g NTEC; Ley SNIS Arts. 24-26
- **Notas técnicas:** Operación transaccional en Postgres. Requiere rol con permiso `UNIFY_PATIENT`. Trigger de audit en cascada. Índices NUI + DUI para detección proactiva.

---

### US.F2.3.7 — Abrir episodio ambulatorio

**Como** ADM o ARCH **quiero** abrir un episodio de atención ambulatoria (consulta externa o emergencia) para un paciente con expediente activo **para** habilitar el registro de todos los documentos clínicos del contacto asistencial.

**AC Gherkin:**
```gherkin
Funcionalidad: Apertura de episodio ambulatorio

  Escenario: Apertura de episodio de consulta externa — primera vez
    Dado que soy ADM autenticado
    Y el paciente tiene expediente activo con ID "EXP-001"
    Cuando selecciono modalidad "ambulatorio", servicio_categoria "consulta_externa" y origen_consulta "cita_previa"
    Y confirmo la apertura
    Entonces el sistema crea el registro en ece.episodio_atencion con estado "abierto"
    Y registra fecha_hora_inicio con timestamp completo
    Y habilita la botonera de documentos del episodio (signos vitales, historia clínica, indicaciones)

  Escenario: Apertura de episodio de emergencia
    Dado que soy MT o ENF autenticado en urgencias
    Cuando abro episodio con servicio_categoria "emergencia" y origen_consulta "espontanea"
    Entonces el sistema abre el episodio en estado "abierto"
    Y habilita el módulo de triaje como primer paso obligatorio

  Escenario: Intento de abrir episodio con expediente pasivo
    Dado que el expediente tiene estado_expediente "pasivo"
    Cuando ADM intenta abrir un nuevo episodio
    Entonces el sistema muestra "Expediente pasivo — reactivar antes de continuar"
    Y ofrece el flujo de reactivación con justificación
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.1, US.F2.3.2
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.1-A.3 | `04_episodios.sql` tabla `ece.episodio_atencion`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 16, 17 NTEC
- **Notas técnicas:** Router `episodeRouter.create`. `withTenantContext` obligatorio. Estado inicial siempre "abierto". Validar que no exista episodio "en_curso" del mismo tipo para el mismo paciente en el mismo día (regla de negocio configurable).

---

### US.F2.3.8 — Registrar admisión administrativa MINSAL / ISSS

**Como** ADM o AC **quiero** completar el registro administrativo de la admisión (MINSAL: gratuidad; ISSS: verificación de derechohabiencia y número patronal) **para** cumplir los requisitos administrativos previos a la atención clínica.

**AC Gherkin:**
```gherkin
Funcionalidad: Admisión administrativa

  Escenario: Admisión en red MINSAL — gratuidad
    Dado que soy ADM en establecimiento MINSAL
    Y el episodio está en estado "abierto"
    Cuando registro la atención como "gratuita MINSAL"
    Y confirmo datos del establecimiento y fecha-hora
    Entonces el sistema marca el episodio con financiamiento "MINSAL_gratuito"
    Y habilita el paso siguiente del flujo (triaje o sala de espera)

  Escenario: Admisión en red ISSS con derechohabiencia verificada
    Dado que soy AC en establecimiento ISSS
    Y el paciente tiene afiliación ISSS vigente con tipo "cotizante"
    Cuando registro el número patronal vigente y verifico derechohabiencia
    Entonces el sistema marca el episodio con financiamiento "ISSS"
    Y registra el número patronal en el episodio

  Escenario: Paciente no derechohabiente en establecimiento ISSS
    Dado que el paciente no tiene afiliación ISSS activa
    Cuando AC registra la atención como "particular" con justificación
    Entonces el episodio avanza sin bloqueo
    Y se genera una nota administrativa de "atención particular"
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.5, US.F2.3.7
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.3 | `04_episodios.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Reglamentación MINSAL/ISSS — gratuidad y derechohabiencia
- **Notas técnicas:** Campo `financiamiento` en `ece.episodio_atencion` (enum extensible). Router `admissionRouter.registerAdmission`.

---

### US.F2.3.9 — Registrar hoja de triaje Manchester en emergencia

**Como** ENF o MT **quiero** registrar la clasificación de triaje según el protocolo Manchester institucional **para** priorizar la atención por gravedad y dejar evidencia médico-legal del tiempo de espera y nivel asignado.

**AC Gherkin:**
```gherkin
Funcionalidad: Triaje de emergencia

  Escenario: Registro de triaje nivel I (resucitación) exitoso
    Dado que soy ENF autenticado en urgencias
    Y el episodio de emergencia está abierto para el paciente
    Y ya existen signos vitales registrados en el episodio
    Cuando registro: motivo "trauma cráneo-encefálico grave", nivel_prioridad "I-Resucitacion", destino_asignado "Box-1-UCI"
    Y firmo electrónicamente
    Entonces el sistema guarda el triaje en ece.triaje con fecha_hora_clasificacion exacta al segundo
    Y vincula signos_vitales_id al triaje registrado
    Y actualiza el estado del episodio a "en_curso"
    Y emite alerta visual al médico de turno del Box-1

  Escenario: Intento de triaje sin signos vitales previos
    Dado que el episodio no tiene signos vitales registrados
    Cuando ENF intenta guardar el triaje
    Entonces el sistema muestra advertencia "Se recomienda registrar signos vitales antes del triaje"
    Y permite continuar con justificación documentada (emergencia extrema)

  Escenario: Modificación de nivel de triaje
    Dado que existe un triaje nivel "III" registrado
    Y el estado del paciente se deteriora
    Cuando MT reclasifica a nivel "II"
    Entonces el sistema crea un nuevo registro de triaje (no modifica el anterior)
    Y conserva el historial de clasificaciones con timestamps
    Y registra el motivo de reclasificación
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.7, US.F2.3.10 (soft), Motor workflow Stream 3
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.4a | `06_documentos_clinicos.sql` tabla `ece.triaje`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 lit. a.4 NTEC (firma electrónica simple)
- **Notas técnicas:** Catálogo `nivel_prioridad` configurable por institución (Manchester: I-V). Router `triageRouter.create`. Notificación vía motor workflow (no diseñar aquí). Fix UAT-BUG-01 ya merged (#86) — validar que el PR de triaje referencia ese fix.

---

### US.F2.3.10 — Registrar signos vitales y antropometría (serie temporal)

**Como** ENF **quiero** registrar los signos vitales y datos antropométricos del paciente en preconsulta **para** alimentar la hoja de signos vitales del episodio y apoyar las decisiones clínicas.

**AC Gherkin:**
```gherkin
Funcionalidad: Registro de signos vitales

  Escenario: Registro completo de signos vitales en adulto
    Dado que soy ENF autenticado
    Y el episodio está en estado "abierto" o "en_curso"
    Cuando registro: PA 120/80, FC 72, FR 16, Temp 36.7, SatO2 98, peso 70 kg, talla 1.70 m
    Y guardo el registro
    Entonces el sistema calcula IMC automáticamente (70/(1.70^2) = 24.2)
    Y almacena la serie en ece.signos_vitales con timestamp al segundo
    Y muestra alerta si algún valor está fuera del rango fisiológico para adulto

  Escenario: Registro de signos vitales en paciente pediátrico con perímetro cefálico
    Dado que el paciente tiene menos de 2 años
    Cuando registro los signos vitales incluyendo perimetro_cefalico "38 cm"
    Entonces el sistema acepta el campo y lo valida contra rangos pediátricos

  Escenario: Alerta por valor crítico de saturación de oxígeno
    Dado que registro saturacion_o2 de 85
    Cuando guardo el registro
    Entonces el sistema muestra alerta roja "SatO2 crítica — verificar y notificar al médico"
    Y el registro se guarda igualmente con el valor reportado
    Y genera evento en motor de alertas

  Escenario: Registro con escala de dolor
    Dado que el paciente reporta dolor
    Cuando registro escala_dolor = 8 (de 0 a 10)
    Entonces el sistema acepta el valor y lo incluye en el resumen del episodio
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.7
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.5 | `06_documentos_clinicos.sql` tabla `ece.signos_vitales`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 lit. a.4 NTEC
- **Notas técnicas:** IMC calculado en Postgres trigger o capa de aplicación. Rangos fisiológicos en catálogo por grupo etario. Router `vitalsRouter.create`. Índice compuesto `(episodio_id, fecha_hora_toma)`.

---

### US.F2.3.11 — Visualizar tendencias de signos vitales del episodio

**Como** MC o MT **quiero** visualizar la serie temporal de signos vitales del episodio en formato gráfico **para** evaluar tendencias y tomar decisiones clínicas informadas.

**AC Gherkin:**
```gherkin
Funcionalidad: Visualización de tendencias de signos vitales

  Escenario: Gráfica de frecuencia cardíaca del episodio
    Dado que soy MC autenticado y tengo abierto el episodio
    Y existen 5 o más registros de signos vitales en el episodio
    Cuando abro la pestaña "Tendencias Signos Vitales"
    Entonces el sistema muestra gráficas de línea para PA, FC, FR, Temp y SatO2 en el eje del tiempo
    Y marca con línea discontinua los rangos de normalidad

  Escenario: Sin suficientes registros para graficar
    Dado que el episodio tiene solo 1 registro de signos vitales
    Entonces el sistema muestra los valores en tabla
    Y muestra el mensaje "Se requieren 2 o más registros para mostrar tendencia"
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.10
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.3 | `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** N/A (valor clínico)
- **Notas técnicas:** Componente Recharts/Chart.js en Next.js. Query tRPC `vitalsRouter.getByEpisode` ordenada por `fecha_hora_toma ASC`.

---

### US.F2.3.12 — Crear historia clínica de primera vez

**Como** MC o MT **quiero** registrar la historia clínica completa de primera vez (anamnesis, antecedentes, examen físico, diagnóstico CIE-10, plan) **para** documentar el contacto clínico inicial con evidencia legal y epidemiológica.

**AC Gherkin:**
```gherkin
Funcionalidad: Historia clínica de primera vez

  Escenario: Registro completo con diagnóstico definitivo
    Dado que soy MC autenticado
    Y el episodio es de tipo consulta_externa con tipo_consulta "primera_vez"
    Y existen signos vitales registrados en el episodio
    Cuando completo: motivo_consulta, enfermedad_actual, antecedentes, examen_fisico, diagnóstico CIE-10 "J06.9 IRAS" tipo "definitivo", plan y disposición "alta_ambulatoria"
    Y firmo electrónicamente
    Entonces el sistema guarda el registro en ece.historia_clinica con estado_registro "vigente"
    Y vincula signos_vitales mediante examen_fisico.signos_vitales_ref
    Y registra mi firma electrónica con timestamp en audit.audit_log

  Escenario: Guardado con diagnóstico presuntivo (sin cerrar episodio)
    Dado que no tengo resultado de laboratorio aún
    Cuando registro diagnóstico CIE-10 "A09" tipo "presuntivo"
    Y selecciono disposición "observacion"
    Entonces el sistema guarda el registro sin cerrar el episodio
    Y muestra la etiqueta "Diagnóstico presuntivo — pendiente resultados"

  Escenario: Intento de guardar sin diagnóstico CIE-10
    Cuando intento guardar la historia clínica sin código CIE-10
    Entonces el sistema bloquea el guardado
    Y muestra "El diagnóstico CIE-10 es obligatorio para cerrar la historia clínica (Art. 16 NTEC)"

  Escenario: Intento de eliminar historia clínica existente
    Dado que existe una historia clínica firmada
    Cuando intento eliminarla
    Entonces el sistema rechaza la operación
    Y muestra "Los registros clínicos no pueden eliminarse. Use la función de rectificación (Art. 42 NTEC)"
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.7, US.F2.3.10, Catálogo CIE-10
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.6, §3.2 | `06_documentos_clinicos.sql` tabla `ece.historia_clinica`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 4.14, 16, 42 NTEC
- **Notas técnicas:** `antecedentes` y `examen_fisico` almacenados como `jsonb`. `diagnosticos` array jsonb. Router `clinicalHistoryRouter.create`. Borrado físico prohibido — solo `estado_registro = 'rectificado'` vía US.F2.3.15.

---

### US.F2.3.13 — Registrar nota de evolución médica en consulta subsecuente

**Como** MC o MT **quiero** registrar una nota de evolución (SOAP) en una consulta subsecuente del mismo episodio o en un episodio de seguimiento **para** documentar el progreso clínico del paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Nota de evolución médica subsecuente

  Escenario: Registro de nota SOAP en consulta subsecuente
    Dado que soy MC autenticado
    Y existe una historia clínica previa del paciente con tipo_consulta "primera_vez"
    Y el episodio actual es de tipo "subsecuente"
    Cuando registro nota SOAP: subjetivo, objetivo, analisis, plan
    Y actualizo diagnóstico CIE-10 si cambió
    Y firmo electrónicamente
    Entonces el sistema guarda en ece.evolucion_medica con fecha_hora exacta al segundo
    Y conserva el orden cronológico ascendente del episodio (Art. 19 NTEC)

  Escenario: Visualización de notas previas antes de registrar nueva
    Dado que el episodio tiene 3 notas de evolución previas
    Cuando abro el formulario de nueva nota
    Entonces el sistema muestra las notas previas en panel lateral colapsable, ordenadas cronológicamente

  Escenario: Intento de modificar nota de evolución ya firmada
    Dado que existe una nota SOAP firmada hace 2 horas
    Cuando intento editar el texto
    Entonces el sistema muestra solo el modo lectura
    Y habilita el botón "Rectificar con trazabilidad" que lanza US.F2.3.15
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.6, §3.8 | `06_documentos_clinicos.sql` tabla `ece.evolucion_medica`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 19, 42 NTEC
- **Notas técnicas:** Índice `idx_evol_episodio(episodio_id, fecha_hora)`. No DELETE nunca. Router `evolutionRouter.create`.

---

### US.F2.3.14 — Firmar electrónicamente documento clínico

**Como** profesional de salud (MC, MT, ENF, ESP) **quiero** aplicar mi firma electrónica simple a cualquier documento clínico que complete **para** cumplir el Art. 4.17 NTEC y dar validez legal al registro.

**AC Gherkin:**
```gherkin
Funcionalidad: Firma electrónica simple de documentos clínicos

  Escenario: Firma exitosa de historia clínica
    Dado que soy MC autenticado con sesión activa
    Y he completado todos los campos obligatorios de la historia clínica
    Cuando hago clic en "Firmar y guardar"
    Entonces el sistema registra: usuario_id, rol, timestamp al segundo, establecimiento_id, hash del documento
    Y almacena la firma en audit.audit_log dentro del hash chain
    Y el documento queda en estado "firmado" (solo lectura en adelante)

  Escenario: Intento de firma con sesión expirada
    Dado que mi sesión expiró hace 2 minutos
    Cuando intento firmar un documento
    Entonces el sistema rechaza la firma
    Y muestra "Sesión expirada — por favor autentíquese nuevamente"
    Y conserva el borrador del documento sin firmar

  Escenario: Documento firmado no puede ser eliminado
    Dado que un documento tiene firma electrónica registrada
    Cuando cualquier usuario intenta eliminarlo desde la API
    Entonces tRPC retorna error 403 "Documento firmado — inmutable"
    Y el intento queda registrado en audit.audit_log
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** Supabase Auth, `audit.audit_log`, hash chain (`05_audit_hash_chain.sql`)
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3 (metadatos obligatorios) | `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 4.17, 23 lit. a.4, 55-56 NTEC
- **Notas técnicas:** Firma = `{userId, orgId, establishmentId, documentType, documentId, timestamp}` hasheado y almacenado. Reutilizar infraestructura de `02_audit_triggers.sql` + `05_audit_hash_chain.sql`. No usar firma criptográfica PKI en MVP — firma electrónica simple según definición NTEC Art. 4.17.

---

### US.F2.3.15 — Rectificar documento clínico con trazabilidad

**Como** MC o MT **quiero** rectificar un error en un documento clínico ya firmado **para** corregir la información sin destruir el registro original, cumpliendo el Art. 42 NTEC.

**AC Gherkin:**
```gherkin
Funcionalidad: Rectificación trazable de documentos clínicos

  Escenario: Rectificación de diagnóstico en historia clínica
    Dado que soy MC autenticado y soy el autor de la historia clínica EXP-001/HC-001
    Cuando selecciono "Rectificar" en la historia clínica firmada
    Y ingreso el campo a corregir: diagnóstico CIE-10 de "J06.9" a "J00"
    Y registro el motivo: "Error de codificación — diagnóstico correcto es J00"
    Y firmo la rectificación
    Entonces el sistema marca el registro original con estado_registro "rectificado"
    Y crea un nuevo registro como versión corregida con referencia al original
    Y registra en audit.audit_log: usuario, campo, valor_anterior, valor_nuevo, motivo, timestamp
    Y el hash chain no se rompe

  Escenario: Intento de rectificación por usuario diferente al autor
    Dado que soy MT diferente al autor de la historia clínica
    Cuando intento rectificar el documento
    Entonces el sistema rechaza la operación
    Y muestra "Solo el autor del documento o el jefe de servicio puede rectificar (Art. 42 NTEC)"

  Escenario: Visualización del historial de rectificaciones
    Dado que una historia clínica tiene 2 rectificaciones
    Cuando el ARCH consulta el historial de versiones
    Entonces el sistema muestra todas las versiones con: autor, motivo, timestamp, diferencias resaltadas
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14, `audit.audit_log`
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | `06_documentos_clinicos.sql` campo `estado_registro`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 42 NTEC
- **Notas técnicas:** Pattern: INSERT nueva fila + UPDATE estado_registro='rectificado' en la original. Nunca UPDATE de contenido. Autorización: `authorId = ctx.user.id OR role IN ['CHIEF_PHYSICIAN','ARCH']`.

---

### US.F2.3.16 — Crear hoja de atención de emergencia

**Como** MT **quiero** registrar la hoja de atención de emergencia con examen, diagnóstico y disposición **para** documentar la atención no programada y soportar la decisión clínica de alta, observación o ingreso.

**AC Gherkin:**
```gherkin
Funcionalidad: Hoja de atención de emergencia

  Escenario: Registro con disposición de alta ambulatoria
    Dado que soy MT autenticado en urgencias
    Y existe triaje y signos vitales en el episodio de emergencia
    Cuando registro: circunstancia_llegada "demanda_espontanea", examen físico, diagnósticos CIE-10, manejo, disposición "alta_ambulatoria"
    Y firmo electrónicamente
    Entonces el sistema guarda en ece.atencion_emergencia
    Y actualiza la disposición del episodio a "alta_ambulatoria"
    Y habilita el flujo de alta ambulatoria (US.F2.3.33)

  Escenario: Disposición de ingreso desde emergencia
    Dado que el paciente requiere hospitalización
    Cuando selecciono disposición "orden_ingreso"
    Y confirmo
    Entonces el sistema habilita el formulario de Orden de Ingreso Hospitalario
    Y marca el episodio ambulatorio con disposicion "orden_ingreso"
    Y el episodio hospitalario se crea en Stream 6 (fuera de scope aquí)

  Escenario: Disposición de observación
    Cuando selecciono disposición "observacion"
    Entonces el sistema abre la hoja de observación en emergencia (US.F2.3.17)
    Y el episodio pasa a estado "en_curso" con subtipos de observación habilitados
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.9, US.F2.3.10, US.F2.3.14, Catálogo CIE-10
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.6, §3.5 | `06_documentos_clinicos.sql` tabla `ece.atencion_emergencia`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 17 lit. a NTEC
- **Notas técnicas:** Router `emergencyRouter.create`. La decisión de disposición dispara transiciones de estado en motor workflow (Stream 3). Este US define el documento; el motor ejecuta la transición.

---

### US.F2.3.17 — Registrar hoja de observación en emergencia (< 24h sin ingreso)

**Como** MT o ENF **quiero** registrar reevaluaciones médicas y de enfermería durante el período de observación en emergencia (máximo 24 horas sin ingreso formal) **para** documentar el seguimiento y la decisión de alta u orden de ingreso.

**AC Gherkin:**
```gherkin
Funcionalidad: Observación en emergencia

  Escenario: Registro de reevaluación médica durante observación
    Dado que soy MT autenticado y el paciente está en observación de emergencia
    Y la disposición del episodio es "observacion"
    Y han transcurrido 2 horas desde el ingreso a observación
    Cuando registro nota de reevaluación SOAP con nuevos signos vitales
    Y firmo electrónicamente
    Entonces el sistema guarda la nota de evolución en ece.evolucion_medica vinculada al episodio
    Y actualiza el panel de observación con timestamp de última reevaluación

  Escenario: Alerta por exceder 24 horas en observación
    Dado que el paciente lleva 23 horas en observación
    Cuando el sistema detecta que se acerca el límite
    Entonces muestra alerta al MT: "Paciente en observación > 23h — defina disposición: alta o ingreso"
    Y bloquea nuevas reevaluaciones sin disposición definida si supera 24h

  Escenario: Alta desde observación
    Dado que el paciente mejoró durante la observación
    Cuando MT registra disposición "alta_ambulatoria" en la última nota
    Entonces el sistema cierra el período de observación
    Y habilita el flujo de alta ambulatoria (US.F2.3.33)
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.16, US.F2.3.13, US.F2.3.10, Motor workflow Stream 3
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.10 | `06_documentos_clinicos.sql` tablas `ece.evolucion_medica`, `ece.atencion_emergencia`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 4 (hospital de día < 24h) NTEC
- **Notas técnicas:** Regla de negocio: `fecha_hora_inicio + 24h`. Alerta vía motor workflow. El límite 24h es configurable en catálogo institucional.

---

### US.F2.3.18 — Emitir hoja de indicaciones médicas (prescripción)

**Como** MC o MT **quiero** registrar las indicaciones médicas (medicamentos, dietas, cuidados, estudios, reposo) con firma electrónica **para** establecer el plan terapéutico con trazabilidad prescriptiva y habilitar la administración de enfermería.

**AC Gherkin:**
```gherkin
Funcionalidad: Hoja de indicaciones médicas

  Escenario: Prescripción de medicamento con dosis y frecuencia
    Dado que soy MC autenticado
    Y el episodio está en curso
    Cuando agrego una indicación de tipo "medicamento": descripción "Paracetamol 500mg", dosis "500mg", vía "oral", frecuencia "cada 8 horas", duración "3 días"
    Y firmo electrónicamente la hoja de indicaciones
    Entonces el sistema guarda en ece.indicaciones_medicas con versión = 1 y vigencia "activa"
    Y guarda cada ítem en ece.indicacion_item
    Y habilita la transcripción de enfermería

  Escenario: Prescripción de estudio de laboratorio desde indicaciones
    Cuando agrego indicación tipo "estudio": "BHC + Química sanguínea"
    Y guardo
    Entonces el sistema genera automáticamente una solicitud_estudio vinculada (US.F2.3.23)
    Y notifica al módulo de laboratorio

  Escenario: Firma de transcripción por enfermería
    Dado que existe una hoja de indicaciones firmada por MC
    Cuando ENF revisa y transcribe las indicaciones
    Y firma la transcripción
    Entonces el sistema registra transcripcion_enf con el usuario ENF y timestamp
    Y habilita el kardex de administración (US.F2.3.21)
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.6, §3.6 | `06_documentos_clinicos.sql` tablas `ece.indicaciones_medicas`, `ece.indicacion_item`
- **Trazabilidad GS1:** N/A (dispensación GS1 en Stream 7-8)
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 lit. a.4 NTEC
- **Notas técnicas:** Router `ordersRouter.createPrescription`. Un cambio de indicación NO modifica la versión anterior — crea nueva versión con `version = prev + 1` y marca la anterior como `vigencia = 'modificada'`.

---

### US.F2.3.19 — Versionar y suspender indicaciones médicas

**Como** MC o MT **quiero** suspender o modificar indicaciones médicas previas generando una nueva versión **para** mantener la trazabilidad prescriptiva sin borrar el registro original.

**AC Gherkin:**
```gherkin
Funcionalidad: Versionado de indicaciones médicas

  Escenario: Suspensión de indicación por reacción adversa
    Dado que soy MC y existe una indicación "Amoxicilina" activa
    Cuando selecciono "Suspender" y registro el motivo "Reacción alérgica reportada"
    Y firmo
    Entonces el sistema cambia vigencia a "suspendida" en el ítem
    Y genera un evento de alerta en el kardex de ENF
    Y registra el motivo en audit.audit_log

  Escenario: Modificación de dosis
    Dado que quiero cambiar la dosis de Paracetamol de 500mg a 1000mg
    Cuando selecciono "Modificar dosis" en la indicación activa
    Entonces el sistema crea una nueva versión de la hoja de indicaciones (version + 1)
    Y la versión anterior queda con vigencia "modificada"
    Y la nueva versión queda "activa" con mi firma

  Escenario: Visualización del historial de versiones de indicaciones
    Dado que la hoja tiene 3 versiones
    Cuando ENF abre el historial de indicaciones
    Entonces ve todas las versiones con: fecha, médico, cambios, estado de vigencia
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.18
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.6 | `06_documentos_clinicos.sql` tabla `ece.indicaciones_medicas` campo `vigencia`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 42 NTEC (inmutabilidad + trazabilidad)
- **Notas técnicas:** Columna `version int` en `ece.indicaciones_medicas`. Solo INSERT; no UPDATE de contenido. Notificación al kardex vía motor workflow.

---

### US.F2.3.20 — Registrar notas de enfermería por turno

**Como** ENF **quiero** registrar la nota de evolución de enfermería y el plan de cuidados por turno **para** documentar la corresponsabilidad asistencial y el seguimiento del estado del paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Registro de enfermería por turno

  Escenario: Registro de nota matutina con plan de cuidados
    Dado que soy ENF autenticado en turno "matutino"
    Y el episodio está en estado "en_curso"
    Cuando registro nota_evolucion y plan_cuidados para el turno
    Y firmo electrónicamente
    Entonces el sistema guarda en ece.registro_enfermeria con turno "matutino" y timestamp
    Y el registro queda inmutable (solo rectificación con trazabilidad)

  Escenario: Intento de abrir turno ya registrado
    Dado que el turno matutino ya tiene nota de enfermería registrada y firmada
    Cuando otro ENF intenta registrar otra nota para el mismo turno
    Entonces el sistema informa "Ya existe nota de enfermería para el turno matutino"
    Y habilita solo "Agregar nota complementaria" como registro adicional

  Escenario: Visualización de notas de turno anterior
    Dado que soy ENF entrante al turno vespertino
    Cuando abro el panel de enfermería del episodio
    Entonces veo la nota del turno matutino, el kardex actualizado y los signos vitales del turno anterior
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.7, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.7 | `06_documentos_clinicos.sql` tabla `ece.registro_enfermeria`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 NTEC
- **Notas técnicas:** Constraint: un solo registro principal por `(episodio_id, turno, fecha)`. Registros complementarios usando `nota_complementaria` o fila adicional sin constraint. Router `nursingRouter.create`.

---

### US.F2.3.21 — Registrar administración de medicamento en kardex

**Como** ENF **quiero** registrar la administración de cada medicamento prescrito (administrado, omitido o diferido) con hora y firma **para** garantizar la trazabilidad entre prescripción y administración y auditar el cumplimiento terapéutico.

**AC Gherkin:**
```gherkin
Funcionalidad: Kardex de administración de medicamentos

  Escenario: Registro de medicamento administrado
    Dado que soy ENF autenticado
    Y existe la indicación_item "Paracetamol 500mg oral cada 8h" con vigencia "activa"
    Y la hora programada es 08:00
    Cuando registro administración en hora_aplicada "08:05" con estado "administrado"
    Y firmo
    Entonces el sistema guarda en ece.administracion_medicamento vinculado al indicacion_item_id y registro_enf_id
    Y el kardex muestra la celda en verde

  Escenario: Medicamento omitido con justificación
    Dado que el paciente rechazó el medicamento
    Cuando registro estado "omitido" y motivo "Paciente rechazó — náuseas"
    Entonces el sistema guarda el registro con estado "omitido"
    Y muestra la celda en amarillo con el motivo visible
    Y genera alerta para el médico de turno

  Escenario: Medicamento diferido
    Dado que el medicamento no está disponible en farmacia
    Cuando registro estado "diferido" con motivo "Sin stock en farmacia"
    Entonces el sistema guarda "diferido" y la celda queda en naranja
    Y notifica a farmacia (vía motor workflow)

  Escenario: Intento de administrar medicamento con vigencia suspendida
    Dado que la indicación fue suspendida (US.F2.3.19)
    Cuando ENF intenta registrar administración
    Entonces el sistema bloquea el registro
    Y muestra "Indicación suspendida — no administrar"
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.18, US.F2.3.19, US.F2.3.20
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.7 | `06_documentos_clinicos.sql` tabla `ece.administracion_medicamento`
- **Trazabilidad GS1:** N/A (scan GS1 BCMA en Stream 7-8)
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 lit. a.4 NTEC
- **Notas técnicas:** Verificar vigencia de `indicacion_item` antes de INSERT. Router `nursingRouter.recordAdministration`. Notificaciones vía motor workflow Stream 3.

---

### US.F2.3.22 — Registrar hoja de evolución médica (SOAP) ambulatoria

**Como** MC o MT **quiero** registrar notas de evolución SOAP durante el seguimiento ambulatorio de un episodio abierto **para** documentar cronológicamente el progreso clínico del paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Evolución médica SOAP ambulatoria

  Escenario: Registro de evolución con actualización de diagnóstico
    Dado que soy MC y el episodio tiene historia clínica previa
    Cuando registro nota SOAP: S "Mejoría del cuadro", O "Afebril, SatO2 99%", A "IRAS en resolución", P "Completar antibiótico 5 días más"
    Y actualizo diagnostico_cie10 a "J00 - Resuelto"
    Y firmo
    Entonces el sistema guarda en ece.evolucion_medica con fecha_hora al segundo
    Y mantiene el orden cronológico ascendente del episodio

  Escenario: Visualización de línea de tiempo de evoluciones
    Dado que el episodio tiene 4 notas de evolución
    Cuando MC abre el panel de evolución
    Entonces las notas se muestran en orden cronológico ascendente con nombre del autor y timestamp
    Y cada nota muestra el diagnóstico CIE-10 registrado en esa nota
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.6, §3.8 | `06_documentos_clinicos.sql` tabla `ece.evolucion_medica`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 19 NTEC (orden cronológico ascendente)
- **Notas técnicas:** Mismo router y tabla que US.F2.3.13. La distinción primera vez/subsecuente está en `ece.historia_clinica.tipo_consulta`; las evoluciones subsecuentes van a `ece.evolucion_medica`.

---

### US.F2.3.23 — Emitir solicitud de laboratorio o gabinete (módulo RELAB)

**Como** MC o MT **quiero** emitir una solicitud de exámenes de laboratorio o imagenología desde el episodio **para** obtener apoyo diagnóstico documentado y trazable (módulo RELAB del SIS).

**AC Gherkin:**
```gherkin
Funcionalidad: Solicitud de estudios diagnósticos

  Escenario: Solicitud de BHC y Química sanguínea
    Dado que soy MC autenticado y el episodio está en curso
    Cuando creo una solicitud de tipo "laboratorio" con exámenes ["BHC","QS básica"]
    Y firmo electrónicamente
    Entonces el sistema guarda en ece.solicitud_estudio con estado "solicitado" y fecha_hora
    Y notifica al módulo de laboratorio (motor workflow)
    Y la solicitud aparece en el panel del episodio como "Pendiente resultado"

  Escenario: Solicitud de Rx de tórax (imagenología)
    Cuando creo solicitud de tipo "imagenología" con exámenes ["Rx_torax_PA"]
    Entonces el sistema guarda con tipo "imagenologia"
    Y notifica al servicio de imagen (motor workflow)

  Escenario: Solicitud anulada antes de procesarse
    Dado que la solicitud está en estado "solicitado"
    Cuando MC la anula con justificación
    Entonces el sistema cambia el estado a "anulado"
    Y registra el motivo en audit.audit_log
    Y notifica al laboratorio/imagen

  Escenario: Intento de solicitud sin diagnóstico presuntivo registrado
    Dado que el episodio no tiene historia clínica ni diagnóstico
    Cuando intento crear una solicitud de laboratorio
    Entonces el sistema muestra advertencia "Se recomienda registrar diagnóstico antes de solicitar estudios"
    Y permite continuar con confirmación
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14, Motor workflow Stream 3
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.7, §3.18 | `06_documentos_clinicos.sql` tabla `ece.solicitud_estudio`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 NTEC; módulo RELAB SIS
- **Notas técnicas:** Router `labRouter.createRequest`. Los exámenes se almacenan como jsonb array. Estado-máquina: `solicitado → en_proceso → resultado_listo | anulado`.

---

### US.F2.3.24 — Registrar resultado de laboratorio o gabinete

**Como** personal de laboratorio/imagen **quiero** registrar y validar el resultado de un estudio solicitado **para** que esté disponible en el expediente electrónico adjunto al episodio.

**AC Gherkin:**
```gherkin
Funcionalidad: Registro de resultado de estudio diagnóstico

  Escenario: Resultado de BHC con valores normales
    Dado que soy personal de laboratorio autenticado
    Y existe una solicitud_estudio en estado "solicitado" o "en_proceso"
    Cuando registro los valores: [{analito:"Hemoglobina", valor:14.2, unidad:"g/dL", rango_referencia:"12-17 g/dL"}]
    Y valido el resultado con mi firma electrónica
    Entonces el sistema guarda en ece.resultado_estudio con fecha_hora_informe
    Y actualiza el estado de ece.solicitud_estudio a "resultado_listo"
    Y notifica al médico solicitante (motor workflow)
    Y el resultado queda como registro Histórico inmutable

  Escenario: Resultado con valor crítico fuera de rango
    Dado que el valor de Potasio es 2.1 mEq/L (rango 3.5-5.0)
    Cuando registro el resultado
    Entonces el sistema genera alerta crítica al médico solicitante con valor resaltado en rojo
    Y registra la alerta en audit.audit_log

  Escenario: Intento de modificar resultado ya validado
    Dado que el resultado tiene estado_registro "vigente" y fue firmado
    Cuando el laboratorista intenta editar el valor
    Entonces el sistema rechaza la modificación directa
    Y ofrece el flujo de rectificación con trazabilidad (US.F2.3.15)
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.23, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.7, §3.18 | `06_documentos_clinicos.sql` tabla `ece.resultado_estudio`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 42 NTEC (inmutabilidad resultado validado)
- **Notas técnicas:** `ece.resultado_estudio` es Histórico — solo INSERT. `valores` como jsonb para flexibilidad de analitos. Router `labRouter.recordResult`.

---

### US.F2.3.25 — Visualizar resultados de estudios adjuntos al episodio

**Como** MC o MT **quiero** visualizar todos los resultados de laboratorio y gabinete adjuntos al episodio en un panel unificado **para** tomar decisiones clínicas informadas sin salir del expediente.

**AC Gherkin:**
```gherkin
Funcionalidad: Panel de resultados del episodio

  Escenario: Visualización de resultados disponibles
    Dado que soy MC autenticado y el episodio tiene 3 solicitudes con resultado_listo
    Cuando abro el panel "Resultados de estudios"
    Entonces veo cada solicitud con: tipo, exámenes, estado, fecha_hora_informe y valores
    Y los valores fuera de rango se resaltan en rojo/amarillo
    Y los resultados sin leer muestran etiqueta "Nuevo"

  Escenario: Resultado pendiente visible
    Dado que existe una solicitud en estado "en_proceso"
    Entonces aparece en el panel con estado "Pendiente" y fecha de solicitud
    Y muestra el tiempo transcurrido desde la solicitud

  Escenario: Sin resultados en el episodio
    Dado que el episodio no tiene solicitudes de estudios
    Entonces el panel muestra "No hay estudios solicitados en este episodio"
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.23, US.F2.3.24
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.7 | `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** N/A (funcional)
- **Notas técnicas:** Query `labRouter.getByEpisode` con JOIN `solicitud_estudio + resultado_estudio`. Ordenar por `fecha_hora DESC`. Componente React Server Component con revalidación en tiempo real (SWR o tRPC subscription).

---

### US.F2.3.26 — Emitir hoja RRI — Referencia a otro nivel de atención

**Como** MC o MT **quiero** emitir una hoja de referencia a otro establecimiento o nivel de atención con resumen clínico y motivo **para** garantizar la continuidad asistencial del paciente en el SNIS (módulo RRI).

**AC Gherkin:**
```gherkin
Funcionalidad: Hoja de referencia (RRI)

  Escenario: Referencia a hospital de tercer nivel
    Dado que soy MC autenticado y el episodio tiene diagnóstico registrado
    Cuando creo una RRI de tipo "referencia" con: establecimiento_destino "Hospital Nacional", especialidad_solicitada "Cardiología", resumen_clinico y motivo
    Y firmo electrónicamente con sello del establecimiento
    Entonces el sistema guarda en ece.referencia_rri
    Y la disposición del episodio se actualiza a "referencia"
    Y el documento queda disponible para imprimir/exportar como PDF firmado

  Escenario: Referencia sin diagnóstico definitivo
    Dado que solo tengo diagnóstico presuntivo
    Cuando intento emitir la referencia
    Entonces el sistema permite continuar con diagnóstico presuntivo y muestra advertencia
    Y registra el diagnóstico presuntivo en el resumen clínico de la RRI

  Escenario: Recepción de retorno desde establecimiento destino
    Dado que el paciente fue referido y regresa con nota de retorno
    Cuando ARCH registra la recepción del retorno en el módulo RRI
    Entonces el sistema vincula la respuesta al mismo RRI original
    Y el episodio puede reabrirse para la atención de seguimiento
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14, catálogo de establecimientos SNIS
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12, §3.10 | `06_documentos_clinicos.sql` tabla `ece.referencia_rri`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 40 NTEC (teleinterconsulta); módulo RRI SIS
- **Notas técnicas:** Router `rriRouter.create`. Catálogo de establecimientos SNIS como tabla de referencia. PDF generado server-side (jsPDF o similar). Firma incluye sello del establecimiento como metadato.

---

### US.F2.3.27 — Emitir hoja RRI — Retorno e Interconsulta

**Como** MC **quiero** emitir una solicitud de interconsulta o registrar el retorno de una referencia previa **para** documentar la coordinación entre especialidades y niveles de atención.

**AC Gherkin:**
```gherkin
Funcionalidad: Interconsulta y retorno (RRI)

  Escenario: Solicitud de interconsulta a especialista interno
    Dado que soy MC y necesito criterio de Neurología
    Cuando creo RRI tipo "interconsulta" con especialidad_solicitada "Neurología" y resumen_clinico
    Y firmo
    Entonces el sistema notifica al servicio de Neurología (motor workflow)
    Y queda pendiente de respuesta en el estado "vigente" sin respondido_por

  Escenario: Emisión de retorno desde establecimiento destino
    Dado que el paciente fue atendido en el nivel de referencia
    Cuando el médico del establecimiento destino registra el retorno con diagnóstico y recomendaciones
    Entonces el sistema crea la RRI tipo "retorno" vinculada a la referencia original
    Y notifica al establecimiento origen

  Escenario: Teleinterconsulta documentada en ambos expedientes
    Dado que se realiza una teleinterconsulta con especialista remoto (Art. 40 NTEC)
    Cuando el MC registra tipo "teleinterconsulta" con resumen y respuesta
    Entonces el sistema crea el registro en ambos expedientes (origen y destino)
    Y marca el registro con metadato "teleinterconsulta" para estadísticas
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.26, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.10 | `06_documentos_clinicos.sql` tabla `ece.referencia_rri`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 40 NTEC
- **Notas técnicas:** Mismo router `rriRouter`, diferente `tipo`. Teleinterconsulta requiere doble INSERT en expedientes de ambos establecimientos si son del mismo HIS-tenant.

---

### US.F2.3.28 — Registrar respuesta de interconsulta

**Como** ESP (especialista interconsultante) **quiero** registrar mi respuesta a una interconsulta solicitada por otro médico **para** cerrar el ciclo de la RRI y que la respuesta quede en el expediente del paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Respuesta a interconsulta

  Escenario: Respuesta completa a interconsulta de Neurología
    Dado que soy ESP de Neurología autenticado
    Y tengo una interconsulta pendiente de respuesta con respondido_por = null
    Cuando registro mi respuesta con diagnóstico, recomendaciones y plan
    Y firmo electrónicamente
    Entonces el sistema actualiza ece.referencia_rri.respuesta_interconsultante y respondido_por con mi usuario
    Y notifica al MC solicitante que la respuesta está disponible (motor workflow)
    Y el registro de la interconsulta queda con estado completo

  Escenario: Interconsulta rechazada por el especialista
    Dado que el especialista considera que no aplica la interconsulta
    Cuando registra respuesta "No aplica interconsulta — justificación: ..."
    Entonces el sistema guarda la respuesta con mi firma
    Y el MC solicitante recibe la notificación de respuesta
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.27, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.10 | `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 40 NTEC
- **Notas técnicas:** Router `rriRouter.respond`. UPDATE de `respuesta_interconsultante` y `respondido_por` — este es el único UPDATE de contenido permitido en RRI (campo de respuesta inicialmente null).

---

### US.F2.3.29 — Registrar consentimiento informado para procedimiento menor

**Como** MC o MT **quiero** registrar el consentimiento informado del paciente antes de realizar un procedimiento menor ambulatorio **para** cumplir la Ley de Deberes y Derechos de los Pacientes y proteger la responsabilidad médico-legal.

**AC Gherkin:**
```gherkin
Funcionalidad: Consentimiento informado ambulatorio

  Escenario: Consentimiento para procedimiento firmado por el paciente
    Dado que soy MC autenticado
    Y el episodio está en curso
    Cuando registro: tipo "procedimiento", procedimiento_descrito "Sutura de laceración 3cm región frontal", riesgos_explicados, alternativas
    Y el paciente firma (evidencia_firma registrada como huella/imagen)
    Y yo firmo electrónicamente como médico_que_informa
    Entonces el sistema guarda en ece.consentimiento_informado como registro Histórico
    Y el registro es inmutable — ningún usuario puede modificar el contenido tras la firma

  Escenario: Consentimiento firmado por representante legal (menor de edad)
    Dado que el paciente es menor de edad
    Cuando registro firmante_rol "representante_legal" con nombre y documento del responsable
    Entonces el sistema acepta el consentimiento con las dos firmas (médico + representante)
    Y registra parentesco en metadatos del consentimiento

  Escenario: Intento de realizar procedimiento sin consentimiento
    Dado que el protocolo institucional requiere consentimiento previo para sutura
    Cuando MT intenta registrar el procedimiento menor sin consentimiento_informado previo
    Entonces el sistema muestra advertencia "Se requiere consentimiento informado para este procedimiento"
    Y permite continuar solo con confirmación de urgencia vital documentada
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.7, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.9, §3.9 | `06_documentos_clinicos.sql` tabla `ece.consentimiento_informado`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Ley Deberes y Derechos de Pacientes Art. 5 lit. a); Acuerdo 1616 Art. 42 NTEC
- **Notas técnicas:** `ece.consentimiento_informado` — SOLO INSERT. No UPDATE, no DELETE. Router `consentRouter.create`. `evidencia_firma` = URL a storage Supabase (imagen de firma o huella). Validar que existan dos firmas: `medico_que_informa` + `firmante_nombre/documento`.

---

### US.F2.3.30 — Registrar hoja de procedimiento menor, curaciones e inyectables

**Como** MC, MT o ENF **quiero** registrar la realización de un procedimiento menor (suturas, curaciones, inyectables, nebulizaciones) con nota de procedimiento firmada **para** documentar el acto médico y el resultado.

**AC Gherkin:**
```gherkin
Funcionalidad: Hoja de procedimiento menor

  Escenario: Registro de sutura de laceración
    Dado que soy MC autenticado
    Y existe consentimiento_informado registrado para el procedimiento (US.F2.3.29)
    Cuando registro: tipo_procedimiento "sutura", descripción "Sutura simple 5 puntos nylon 5-0, región frontal", materiales_utilizados, resultado "Sin complicaciones", indicaciones_post
    Y firmo electrónicamente
    Entonces el sistema guarda la nota de procedimiento vinculada al episodio
    Y el consentimiento previo queda vinculado a la nota como referencia

  Escenario: Registro de curación de herida por ENF
    Dado que soy ENF y el procedimiento es curación de herida (sin consentimiento requerido por protocolo)
    Cuando registro: tipo_procedimiento "curación", descripción, materiales y resultado
    Y firmo
    Entonces el sistema acepta el registro de ENF sin bloqueo por consentimiento

  Escenario: Inyectable registrado sin consentimiento para procedimiento de rutina
    Dado que la aplicación de inyectable de rutina no requiere consentimiento especial
    Cuando ENF registra el inyectable con referencia a la indicación médica correspondiente
    Entonces el sistema acepta y vincula la administración al kardex (ece.administracion_medicamento)
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.29 (condicional), US.F2.3.18, US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.9 | `06_documentos_clinicos.sql` — tabla de procedimiento menor (extensión de `ece.evolucion_medica` con tipo específico)
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 NTEC
- **Notas técnicas:** Implementar como subtipo de `ece.evolucion_medica` con campo `tipo_nota = 'procedimiento_menor'` o tabla separada `ece.nota_procedimiento`. Decisión de diseño a confirmar con @AS.

---

### US.F2.3.31 — Dispensar medicamento desde farmacia (registro documental del episodio)

**Como** personal de farmacia **quiero** registrar la dispensación de medicamentos contra la receta del episodio **para** completar el ciclo prescripción → dispensación en el expediente ambulatorio.

**AC Gherkin:**
```gherkin
Funcionalidad: Dispensación de medicamentos en farmacia

  Escenario: Dispensación completa contra indicación médica
    Dado que soy personal de farmacia autenticado
    Y existe una hoja de indicaciones médicas con vigencia "activa" y medicamento "Amoxicilina 500mg"
    Cuando registro la dispensación: cantidad "21 cápsulas", lote, fecha_vencimiento y confirmo entrega al paciente
    Y firmo
    Entonces el sistema registra la dispensación vinculada a indicacion_item_id
    Y el medicamento queda marcado como "dispensado" en el panel del episodio
    Y el registro queda en audit.audit_log

  Escenario: Dispensación parcial por stock insuficiente
    Dado que farmacia tiene stock de 10 cápsulas y se requieren 21
    Cuando registro dispensación parcial de 10 cápsulas con motivo "stock insuficiente"
    Entonces el sistema registra la dispensación parcial
    Y mantiene el medicamento como "pendiente de completar dispensación"

  Escenario: Receta con indicación suspendida
    Dado que la indicación fue suspendida (vigencia = 'suspendida')
    Cuando farmacia intenta dispensar ese medicamento
    Entonces el sistema bloquea la dispensación
    Y muestra "Indicación suspendida — no dispensar. Consulte al médico."
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.18, US.F2.3.19
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.8 | `06_documentos_clinicos.sql` tabla `ece.indicacion_item`
- **Trazabilidad GS1:** N/A (dispensación GS1 con escáner en Streams 7-8; este US cubre solo el registro documental)
- **Trazabilidad normativa:** Acuerdo 1616 Art. 23 NTEC
- **Notas técnicas:** Tabla `ece.dispensacion` (extensión necesaria — confirmar con @DBA). Vincular `indicacion_item_id`. Sin integración GS1 en este stream.

---

### US.F2.3.32 — Emitir certificado de incapacidad temporal ISSS

**Como** MC o MT autorizado por ISSS **quiero** emitir el certificado de incapacidad temporal para el trabajo del derechohabiente **para** justificar la suspensión laboral ante el ISSS con respaldo clínico y administrativo.

**AC Gherkin:**
```gherkin
Funcionalidad: Certificado de incapacidad temporal ISSS

  Escenario: Emisión de certificado por consulta de morbilidad
    Dado que soy MC autorizado por ISSS autenticado
    Y el paciente tiene afiliación ISSS vigente con numero_afiliado "12345678" y tipo "cotizante"
    Y el episodio tiene diagnóstico CIE-10 registrado "J18.9"
    Cuando emito el certificado con: dias_incapacidad 3, fecha_inicio hoy, fecha_fin en 3 días
    Y firmo electrónicamente con sello ISSS
    Entonces el sistema guarda en ece.certificado_incapacidad con todos los campos
    Y genera el documento PDF para impresión o entrega digital
    Y registra mi firma en audit.audit_log

  Escenario: Intento de emisión sin afiliación ISSS del paciente
    Dado que el paciente no tiene afiliación ISSS registrada
    Cuando intento emitir el certificado
    Entonces el sistema bloquea y muestra "El paciente no tiene afiliación ISSS activa"

  Escenario: Intento de emisión por médico no autorizado ISSS
    Dado que soy MT sin autorización ISSS
    Cuando intento emitir el certificado
    Entonces el sistema rechaza con error "Solo médicos autorizados por ISSS pueden emitir certificados de incapacidad"
    Y registra el intento en audit.audit_log

  Escenario: Certificado con más de 3 días (requiere revisión)
    Dado que dias_incapacidad = 7
    Cuando guardo el certificado
    Entonces el sistema registra normalmente pero genera una nota "Incapacidad > 3 días requiere revisión por ISSS"
    Y el dato queda disponible para reporting ISSS
```

- **SP:** 8
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.5, US.F2.3.12, permisos de rol médico autorizado ISSS
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.11, §3.17 | `06_documentos_clinicos.sql` tabla `ece.certificado_incapacidad`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Reglamentación ISSS — certificados de incapacidad; Acuerdo 1616 Art. 23 NTEC
- **Notas técnicas:** Permiso `ISSS_CERTIFIER` en tabla de roles. Router `isssRouter.createIncapacity`. PDF con plantilla oficial ISSS. Constraint: `fecha_fin >= fecha_inicio`, `dias_incapacidad > 0`.

---

### US.F2.3.33 — Registrar alta ambulatoria con firma médica

**Como** MC o MT **quiero** registrar el alta ambulatoria del paciente con diagnóstico final, indicaciones de alta y plan de seguimiento **para** cerrar formalmente el episodio clínico y habilitar el archivo del expediente.

**AC Gherkin:**
```gherkin
Funcionalidad: Alta ambulatoria

  Escenario: Alta ambulatoria con diagnóstico definitivo e indicaciones
    Dado que soy MC autenticado
    Y el episodio tiene historia clínica con diagnóstico registrado
    Cuando registro el alta: diagnóstico_final CIE-10 "J00", indicaciones_alta "Reposo 2 días, continuar antibiótico", plan_seguimiento "Control en 7 días", disposición "alta_ambulatoria"
    Y firmo electrónicamente
    Entonces el sistema guarda el alta vinculada al episodio
    Y actualiza la disposición del episodio a "alta_ambulatoria"
    Y habilita el cierre del episodio (US.F2.3.34)

  Escenario: Alta con receta de egreso
    Dado que el paciente requiere continuar tratamiento en casa
    Cuando registro el alta e incluyo receta de egreso (US.F2.3.39)
    Entonces la receta queda vinculada al registro de alta
    Y se puede imprimir/exportar como documento firmado

  Escenario: Alta sin diagnóstico definitivo CIE-10
    Cuando intento registrar el alta sin diagnóstico CIE-10 final
    Entonces el sistema bloquea y muestra "El diagnóstico CIE-10 de cierre es obligatorio (Art. 16 NTEC)"
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.14, Catálogo CIE-10
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12, §2.1 (Alta ambulatoria) | `04_episodios.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 4 (Alta ambulatoria), Art. 16-17 NTEC
- **Notas técnicas:** Registrar como nota de tipo `alta_ambulatoria` en `ece.evolucion_medica` o tabla dedicada `ece.alta_ambulatoria`. Diagóstico CIE-10 de cierre obligatorio en validación Zod antes de permitir firma.

---

### US.F2.3.34 — Cerrar episodio ambulatorio y registrar disposición final

**Como** ADM, ARCH o sistema **quiero** cerrar formalmente el episodio ambulatorio una vez registrada el alta o la disposición final **para** actualizar el estado del expediente y habilitar el flujo de archivo.

**AC Gherkin:**
```gherkin
Funcionalidad: Cierre de episodio ambulatorio

  Escenario: Cierre automático tras alta ambulatoria firmada
    Dado que el episodio tiene alta ambulatoria firmada por el médico
    Cuando el sistema detecta la firma de alta
    Entonces actualiza ece.episodio_atencion.estado a "cerrado"
    Y registra fecha_hora_cierre con timestamp completo
    Y registra disposicion "alta_ambulatoria" en el episodio
    Y habilita el flujo de devolución de expediente (US.F2.3.35)

  Escenario: Cierre manual por ARCH con justificación
    Dado que el médico no cerró el episodio y han pasado 48 horas del alta
    Cuando ARCH cierra manualmente el episodio con justificación
    Entonces el sistema registra el cierre con usuario ARCH y motivo en audit.audit_log
    Y el episodio queda en estado "cerrado"

  Escenario: Intento de agregar documentos a episodio cerrado
    Dado que el episodio está en estado "cerrado"
    Cuando cualquier usuario intenta agregar un nuevo documento clínico
    Entonces el sistema rechaza la operación
    Y muestra "El episodio está cerrado. Abra un nuevo episodio para continuar la atención."
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.33, US.F2.3.7, Motor workflow Stream 3
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12 | `04_episodios.sql` campo `estado`, `fecha_hora_cierre`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 16-17 NTEC
- **Notas técnicas:** Transición de estado `en_curso → cerrado` vía motor workflow. Validar que `disposicion` no sea null antes de permitir cierre. Router `episodeRouter.close`.

---

### US.F2.3.35 — Registrar devolución del expediente físico a archivo

**Como** ARCH **quiero** registrar el movimiento de devolución del expediente físico al archivo clínico tras el alta ambulatoria **para** cumplir el Art. 30 NTEC (plazo máximo 48 horas) y mantener la trazabilidad de custodia del expediente.

**AC Gherkin:**
```gherkin
Funcionalidad: Devolución de expediente a archivo

  Escenario: Devolución dentro del plazo de 48 horas
    Dado que soy ARCH autenticado
    Y el episodio está cerrado con alta ambulatoria
    Y han transcurrido 6 horas desde el alta
    Cuando registro la devolución con fecha_hora y responsable de entrega
    Y firmo el movimiento
    Entonces el sistema registra el movimiento en el log de custodia del expediente
    Y actualiza el estado de custodia a "en_archivo"
    Y elimina la alerta de "devolución pendiente"

  Escenario: Alerta por expediente no devuelto en 48 horas
    Dado que han transcurrido 47 horas desde el alta sin devolución registrada
    Entonces el sistema muestra alerta al supervisor de ARCH: "Expediente EXP-001 debe devolverse en 1 hora (Art. 30 NTEC)"

  Escenario: Registro de movimiento de préstamo de expediente
    Dado que otro servicio solicita el expediente temporalmente
    Cuando ARCH registra el préstamo con: solicitante, servicio_destino, fecha_hora_salida
    Entonces el sistema registra el movimiento y marca el expediente como "prestado"
    Y el expediente permanece vinculado al mismo número en el sistema
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.34
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12, §2.1 (Devolución expediente) | Acuerdo 1616 Art. 30 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 30 NTEC (plazo 48h)
- **Notas técnicas:** Tabla `ece.movimiento_expediente` (clasificada como Doc. 3.19 NTEC — operativo, 1 año retención). Alerta de 47h vía cron job o motor workflow.

---

### US.F2.3.36 — Generar listado de movimiento de expedientes para ARCH

**Como** ARCH **quiero** generar el listado de registro de entrada y salida de expedientes clínicos **para** cumplir el Art. 30 NTEC y auditar la custodia documental del establecimiento.

**AC Gherkin:**
```gherkin
Funcionalidad: Listado de movimiento de expedientes

  Escenario: Listado del día con filtros
    Dado que soy ARCH autenticado
    Cuando filtro el listado por fecha "hoy" y estado "prestado"
    Entonces el sistema muestra todos los expedientes en préstamo con: número, paciente, servicio receptor, hora de salida, responsable
    Y permite exportar como CSV o PDF

  Escenario: Reporte de expedientes no devueltos en plazo
    Cuando solicito el reporte "Expedientes con devolución vencida (> 48h)"
    Entonces el sistema muestra todos los expedientes cuyo plazo venció sin registro de devolución
    Y resalta en rojo los que superan las 72 horas
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.35
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §3.19 | Acuerdo 1616 Art. 30 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 30 NTEC
- **Notas técnicas:** Query sobre `ece.movimiento_expediente`. Exportación CSV vía tRPC + stream. PDF con jsPDF server-side.

---

### US.F2.3.37 — Visualizar cronología completa del episodio

**Como** MC, MT o ARCH **quiero** visualizar la línea de tiempo completa de un episodio con todos sus documentos clínicos en orden cronológico **para** comprender la secuencia de atención y facilitar la auditoría clínica.

**AC Gherkin:**
```gherkin
Funcionalidad: Cronología del episodio

  Escenario: Visualización de episodio con 8 documentos
    Dado que soy MC autenticado con acceso al episodio
    Cuando abro la pestaña "Cronología del episodio"
    Entonces el sistema muestra en orden cronológico ascendente: apertura de episodio, signos vitales, triaje (si aplica), historia clínica, indicaciones, kardex, solicitudes de estudio, resultados, evoluciones, alta
    Y cada ítem muestra: tipo de documento, autor, timestamp y estado (vigente/rectificado)

  Escenario: Acceso bloqueado por RLS para otro establecimiento
    Dado que el paciente tuvo episodios en dos establecimientos diferentes
    Y mi usuario pertenece solo al establecimiento A
    Cuando busco el episodio del establecimiento B
    Entonces el sistema no lo muestra en mi cronología (RLS filtra por organization_id)
    Y no genera error visible — simplemente no aparece
```

- **SP:** 5
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.7 a US.F2.3.34
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §4 (grafo de dependencias) | Todos los `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 19 NTEC (orden cronológico)
- **Notas técnicas:** Query UNION de todas las tablas de documentos por `episodio_id`, ordenada por `registrado_en ASC`. `withTenantContext` obligatorio para RLS. Componente React con virtualización para episodios con muchos documentos.

---

### US.F2.3.38 — Gestionar estado activo/pasivo del expediente

**Como** ARCH **quiero** gestionar el cambio de estado del expediente entre activo y pasivo según el Art. 34 NTEC **para** aplicar correctamente las reglas de retención diferenciada y la reorganización del archivo.

**AC Gherkin:**
```gherkin
Funcionalidad: Estado activo/pasivo del expediente

  Escenario: Cambio automático a pasivo por inactividad de 5 años
    Dado que el expediente no tiene registros de atención en los últimos 5 años
    Cuando el sistema ejecuta el proceso batch nocturno de revisión de estados
    Entonces cambia estado_expediente de "activo" a "pasivo"
    Y registra el cambio en audit.audit_log con timestamp

  Escenario: Reactivación manual de expediente pasivo
    Dado que un paciente con expediente pasivo regresa a consulta
    Cuando ARCH reactiva el expediente con justificación "Regreso a consulta externa"
    Entonces el sistema cambia estado_expediente a "activo"
    Y registra la reactivación en audit.audit_log

  Escenario: Expediente pasivo no puede recibir nuevas atenciones sin reactivación
    Dado que el expediente está "pasivo"
    Cuando ADM intenta abrir un nuevo episodio
    Entonces el sistema muestra "Expediente pasivo — ARCH debe reactivarlo primero"
    Y bloquea la apertura del episodio
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.1, US.F2.3.7
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | `03_paciente_maestro.sql` campo `estado_expediente`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 4.15, 4.16, 34 NTEC
- **Notas técnicas:** Batch nocturno: cron job o Supabase pg_cron. Condición: `MAX(episodio.fecha_hora_inicio) < NOW() - INTERVAL '5 years'`. Router `patientRouter.updateExpedienteStatus`.

---

### US.F2.3.39 — Emitir receta de egreso ambulatoria

**Como** MC o MT **quiero** emitir la receta de medicamentos de egreso ambulatorio como documento del alta **para** que el paciente continúe el tratamiento en casa con respaldo documental del episodio.

**AC Gherkin:**
```gherkin
Funcionalidad: Receta de egreso ambulatoria

  Escenario: Receta de egreso vinculada al alta
    Dado que soy MC y estoy registrando el alta ambulatoria (US.F2.3.33)
    Cuando agrego la receta de egreso con medicamentos: "Amoxicilina 500mg cada 8h por 7 días, Paracetamol 500mg cada 6h SOS"
    Y firmo
    Entonces el sistema guarda la receta vinculada al alta del episodio
    Y genera el PDF de receta con sello digital del establecimiento y datos del médico

  Escenario: Receta de egreso sin medicamentos (solo indicaciones)
    Dado que el plan de alta no requiere medicamentos
    Cuando registro el alta sin agregar receta
    Entonces el sistema acepta el alta sin receta y no bloquea el proceso
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.33, US.F2.3.18
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12 | `06_documentos_clinicos.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 17 NTEC
- **Notas técnicas:** Receta de egreso puede modelarse como `ece.indicaciones_medicas` con `tipo = 'receta_egreso'` o tabla dedicada. PDF con plantilla de receta oficial.

---

### US.F2.3.40 — Registrar modalidad telesalud en episodio ambulatorio

**Como** MC o sistema **quiero** registrar un episodio de atención ambulatoria bajo la modalidad telesalud **para** distinguir las atenciones presenciales de las virtuales en el expediente y en los reportes estadísticos.

**AC Gherkin:**
```gherkin
Funcionalidad: Modalidad telesalud

  Escenario: Apertura de episodio telesalud
    Dado que soy MC autenticado
    Y la consulta se realizará por videollamada
    Cuando abro el episodio con modalidad_atencion "telesalud"
    Entonces el episodio se crea con el flag de telesalud
    Y todos los documentos del episodio quedan marcados con la modalidad "telesalud"
    Y el sistema registra la plataforma de comunicación usada (campo de texto libre)

  Escenario: Historia clínica de telesalud con firma
    Dado que el episodio es telesalud
    Cuando MC firma la historia clínica
    Entonces el sistema acepta la firma electrónica simple igual que en modalidad presencial
    Y el documento incluye el metadato modalidad_atencion = "telesalud"
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.7
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.1 | `04_episodios.sql` campo `modalidad_atencion`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 40 NTEC (teleinterconsulta)
- **Notas técnicas:** `modalidad_atencion enum('presencial','telesalud','extramural')` ya en `ece.episodio_atencion`. No requiere cambio de schema.

---

### US.F2.3.41 — Buscar episodios por rango de fecha, servicio y estado

**Como** ARCH, ADM o MC **quiero** buscar episodios con filtros de fecha, servicio, estado y tipo **para** localizar atenciones, generar reportes operativos y auditar el flujo de pacientes.

**AC Gherkin:**
```gherkin
Funcionalidad: Búsqueda y filtrado de episodios

  Escenario: Búsqueda de episodios abiertos en consulta externa hoy
    Dado que soy ARCH autenticado
    Cuando filtro: fecha = hoy, servicio_categoria = "consulta_externa", estado = "abierto"
    Entonces el sistema retorna la lista de episodios con: número de expediente, nombre del paciente, hora de apertura, estado
    Y muestra el total de resultados

  Escenario: Búsqueda por nombre de paciente
    Cuando ingreso "García" como nombre de paciente
    Entonces el sistema muestra episodios cuyo paciente contiene "García" en nombre o apellido
    Y limita el resultado a 50 registros con paginación

  Escenario: Sin resultados con los filtros aplicados
    Cuando aplico filtros que no coinciden con ningún registro
    Entonces el sistema muestra "No se encontraron episodios con los criterios indicados"
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.7
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A | `04_episodios.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** N/A (operacional)
- **Notas técnicas:** Router `episodeRouter.search` con parámetros opcionales y `withTenantContext`. Paginación cursor-based (performance). Índice `idx_episodio_estado` ya existente.

---

### US.F2.3.42 — Verificar integridad documental del episodio (checklist de cierre)

**Como** ARCH o sistema **quiero** verificar que el episodio ambulatorio tiene todos los documentos mínimos requeridos antes de cerrarlo definitivamente **para** garantizar la integridad documental del ECE (Art. 19 NTEC).

**AC Gherkin:**
```gherkin
Funcionalidad: Checklist de integridad documental

  Escenario: Episodio completo — todos los documentos mínimos presentes
    Dado que el episodio de consulta externa tiene: signos vitales, historia clínica firmada, indicaciones médicas, diagnóstico CIE-10, alta ambulatoria firmada
    Cuando ARCH ejecuta la verificación de integridad
    Entonces el sistema muestra "Episodio íntegro — todos los documentos mínimos presentes"
    Y habilita el cierre definitivo

  Escenario: Episodio con documentos faltantes
    Dado que el episodio no tiene alta ambulatoria firmada
    Cuando ejecuto la verificación
    Entonces el sistema lista los documentos faltantes: "Alta ambulatoria — pendiente de firma médica"
    Y bloquea el cierre hasta completar los faltantes (o con justificación de ARCH)

  Escenario: Verificación automática al intentar cerrar
    Dado que el médico intenta cerrar el episodio manualmente
    Cuando el sistema ejecuta la verificación previa al cierre
    Y detecta que falta el diagnóstico CIE-10
    Entonces bloquea el cierre y muestra el checklist de items pendientes
```

- **SP:** 5
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.34, todos los documentos del episodio
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | Acuerdo 1616 Art. 19 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 19 NTEC
- **Notas técnicas:** Función `ece.check_episode_completeness(episodio_id)` en Postgres retorna array de items faltantes. Reglas configurables por tipo de episodio (emergencia vs consulta externa vs observación).

---

### US.F2.3.43 — Codificar diagnóstico CIE-10 al cierre del episodio

**Como** ARCH/ESDOMED **quiero** codificar o verificar los diagnósticos CIE-10 de cierre del episodio **para** garantizar la calidad de los datos epidemiológicos y estadísticos del establecimiento.

**AC Gherkin:**
```gherkin
Funcionalidad: Codificación CIE-10 de cierre

  Escenario: Verificación de código CIE-10 ya registrado por el médico
    Dado que el episodio tiene diagnóstico CIE-10 "J00" registrado por el médico
    Cuando ARCH verifica la codificación al cierre
    Y confirma que el código es correcto
    Entonces el sistema registra la confirmación de codificación con timestamp de ARCH
    Y el episodio queda con estado de codificación "verificado"

  Escenario: Corrección de código CIE-10 por ARCH/ESDOMED
    Dado que el médico registró el código "J06.9" pero ARCH determina que corresponde "J00"
    Cuando ARCH corrige el código con justificación clínica y código correcto
    Entonces el sistema usa el flujo de rectificación trazable (US.F2.3.15)
    Y registra la corrección con: usuario ARCH, código anterior, código nuevo, motivo, timestamp

  Escenario: Autocompletado de CIE-10 en búsqueda
    Cuando el médico o ARCH escribe "resfriad" en el campo de diagnóstico
    Entonces el sistema muestra los primeros 10 códigos CIE-10 que coinciden con el término
    Y al seleccionar uno, autocompleta el código oficial
```

- **SP:** 5
- **MoSCoW:** Must
- **Dependencias:** US.F2.3.12, US.F2.3.15, Catálogo CIE-10 en BD
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | Acuerdo 1616 Art. 16-17 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 16, 17 NTEC (CIE-10 obligatorio en cierre)
- **Notas técnicas:** Catálogo CIE-10 en tabla `cat.cie10` (seed). Búsqueda fulltext con `pg_trgm`. Router `episodeRouter.codifyDiagnosis`. Permiso de corrección: rol `ESDOMED`.

---

### US.F2.3.44 — Consultar bitácora de accesos al expediente

**Como** ARCH o DIR **quiero** consultar la bitácora de accesos al expediente de un paciente **para** garantizar la confidencialidad y auditar todos los accesos autorizados y denegados (Art. 55-56 NTEC).

**AC Gherkin:**
```gherkin
Funcionalidad: Bitácora de accesos al expediente

  Escenario: Consulta de accesos del expediente EXP-001 en los últimos 30 días
    Dado que soy ARCH o DIR autenticado con permiso de auditoría
    Cuando consulto la bitácora del expediente EXP-001 en el rango de los últimos 30 días
    Entonces el sistema muestra: usuario, rol, tipo de acceso (lectura/escritura), documento accedido, resultado (autorizado/denegado), timestamp completo al segundo
    Y el listado es exportable como CSV

  Escenario: Intento de acceso denegado queda registrado
    Dado que un usuario sin permiso intenta acceder al expediente de un paciente fuera de su servicio
    Cuando tRPC retorna error 403
    Entonces el sistema registra en audit.audit_log: usuario, expediente_id, tipo "acceso_denegado", timestamp
    Y el intento aparece en la bitácora del expediente con marca "Denegado"

  Escenario: Conservación de bitácora mínimo 2 años
    Dado que la bitácora tiene registros de hace 18 meses
    Cuando el proceso de limpieza automática se ejecuta
    Entonces no elimina registros con antigüedad menor a 2 años
    Y registra en el log del sistema los registros que sí elimina (mayores a 2 años)
```

- **SP:** 3
- **MoSCoW:** Must
- **Dependencias:** `audit.audit_log`, hash chain, permisos DIR/ARCH
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | `07_auditoria_seguridad.sql`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 55, 56 NTEC (bitácora ≥ 2 años)
- **Notas técnicas:** Reutilizar `auditIntegrityRouter` existente. Query sobre `audit.audit_log` con filtro `resource_id = expediente_id`. Permiso `AUDIT_READER` en roles. Retención mínima 2 años gestionada vía política de retención en Supabase o pg_cron.

---

### US.F2.3.45 — Configurar retención diferenciada por diagnóstico/circunstancia

**Como** DIR o ARCH **quiero** configurar las reglas de retención del expediente según el diagnóstico o circunstancia del episodio **para** cumplir la conservación diferenciada del Art. 34-35 NTEC.

**AC Gherkin:**
```gherkin
Funcionalidad: Retención diferenciada de expedientes

  Escenario: Expediente de paciente fallecido extiende retención a 10 años
    Dado que el episodio tiene tipo_egreso "fallecido" (epcrisis)
    Cuando el sistema clasifica la retención del expediente
    Entonces aplica automáticamente retención de 10 años al expediente
    Y registra el motivo "Fallecido — Art. 35 NTEC"

  Escenario: Expediente con diagnóstico de enfermedad crónica
    Dado que el episodio de cierre tiene diagnóstico CIE-10 clasificado como "crónico" en el catálogo
    Cuando se cierra el episodio
    Entonces el sistema aplica la regla de retención extendida correspondiente

  Escenario: Configuración de regla de retención por DIR
    Dado que soy DIR autenticado
    Cuando accedo a "Configuración de retención" y agrego una regla: "CIE-10 familia Z (seguimiento) → retención 10 años"
    Entonces el sistema guarda la regla y la aplica a episodios futuros con ese diagnóstico
```

- **SP:** 5
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.34, US.F2.3.43, Catálogo CIE-10
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | Acuerdo 1616 Art. 34-35 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 34, 35 NTEC (retención 5 años estándar; 10 años violencia/accidente/judicial)
- **Notas técnicas:** Tabla `ece.regla_retencion` con condiciones (cie10_familia, circunstancia_alta, tipo_egreso) y plazo_meses. Función Postgres que evalúa reglas al cierre del episodio.

---

### US.F2.3.46 — Solicitar cita de seguimiento post-alta ambulatoria

**Como** MC o ADM **quiero** registrar y solicitar una cita de seguimiento al dar el alta ambulatoria **para** garantizar la continuidad del tratamiento y el seguimiento del paciente.

**AC Gherkin:**
```gherkin
Funcionalidad: Cita de seguimiento post-alta

  Escenario: Solicitud de cita de seguimiento desde el alta
    Dado que soy MC registrando el alta ambulatoria
    Cuando agrego "Cita de seguimiento en 7 días con MC de Medicina General"
    Y guardo el alta
    Entonces el sistema registra la solicitud de cita vinculada al episodio
    Y la solicitud queda visible en el módulo de agenda para su programación por ADM

  Escenario: Paciente sin seguimiento requerido
    Dado que el médico determina que no requiere seguimiento
    Cuando registra el alta sin cita de seguimiento
    Entonces el sistema acepta el alta sin bloqueo
    Y registra en el alta "Sin cita de seguimiento requerida"
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.33
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.12
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 17 NTEC
- **Notas técnicas:** Citas en `citas_seguimiento jsonb` del registro de alta o tabla `ece.cita_seguimiento`. Integración con módulo de agenda (si existe) o registro simple en tabla.

---

### US.F2.3.47 — Registrar captación por referencia externa (entrada por módulo RRI)

**Como** ARCH o ADM **quiero** registrar la llegada de un paciente referido desde otro establecimiento con la hoja RRI de referencia **para** vincular el episodio nuevo a la referencia recibida y garantizar la continuidad asistencial.

**AC Gherkin:**
```gherkin
Funcionalidad: Captación por referencia externa

  Escenario: Paciente referido con hoja RRI del establecimiento origen
    Dado que soy ADM autenticado y el paciente trae hoja de referencia de otro establecimiento
    Cuando registro la captación: establ_origen, número de referencia origen, especialidad_solicitada, resumen_clinico recibido
    Y abro el episodio correspondiente
    Entonces el sistema vincula el nuevo episodio a la referencia RRI registrada
    Y el origen_consulta del episodio queda como "referencia"

  Escenario: Paciente referido sin hoja física (sistema integrado)
    Dado que el establecimiento origen emitió la RRI en el mismo HIS (red SNIS integrada)
    Cuando ADM busca la referencia por número de RRI
    Entonces el sistema la encuentra y pre-llena los datos del episodio
    Y vincula automáticamente el episodio nuevo a la RRI de origen
```

- **SP:** 3
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.7, US.F2.3.26
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.1 | `06_documentos_clinicos.sql` tabla `ece.referencia_rri`
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 40 NTEC; módulo RRI SIS
- **Notas técnicas:** Campo `origen_consulta = 'referencia'` y FK `referencia_rri_id` en `ece.episodio_atencion` (ampliar schema — confirmar con @DBA).

---

### US.F2.3.48 — Imprimir o exportar PDF de documento clínico firmado

**Como** MC, ARCH o ADM **quiero** exportar cualquier documento clínico firmado como PDF **para** compartirlo con el paciente, otro establecimiento o para respaldo físico cuando sea requerido.

**AC Gherkin:**
```gherkin
Funcionalidad: Exportación de documentos clínicos como PDF

  Escenario: Exportación de historia clínica firmada
    Dado que soy MC autenticado con acceso al episodio
    Cuando selecciono "Exportar PDF" en la historia clínica firmada
    Entonces el sistema genera un PDF con: membrete del establecimiento, datos del paciente, contenido del documento, firma del profesional (nombre, rol, timestamp), número de expediente
    Y el PDF incluye texto "Documento generado por el ECE — Firma electrónica simple registrada en sistema"

  Escenario: Intento de exportar documento sin firma
    Dado que la historia clínica no ha sido firmada
    Cuando intento exportar el PDF
    Entonces el sistema muestra advertencia "El documento no ha sido firmado — exportar en borrador?"
    Y si confirma, el PDF incluye marca de agua "BORRADOR — Sin firma electrónica"
```

- **SP:** 3
- **MoSCoW:** Could
- **Dependencias:** US.F2.3.14
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §5 | Acuerdo 1616 Art. 21 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 21 NTEC (certificación solo por Dirección)
- **Notas técnicas:** PDF generado server-side con `@react-pdf/renderer` o `jsPDF`. El PDF de exportación NO equivale a certificación oficial — esa es exclusiva de DIR (US.F2.3.49).

---

### US.F2.3.49 — Certificar copia oficial del expediente (solo Dirección)

**Como** DIR o su delegado autorizado **quiero** certificar una copia oficial del expediente clínico para entrega a autoridad judicial, al propio paciente o a tercero autorizado **para** cumplir el Art. 21 NTEC y mantener la trazabilidad de copias certificadas entregadas.

**AC Gherkin:**
```gherkin
Funcionalidad: Certificación oficial de copia del expediente

  Escenario: Certificación de expediente para autoridad judicial
    Dado que soy DIR autenticado con permiso `CERTIFY_RECORD`
    Cuando genero la certificación con: solicitante, motivo "requerimiento judicial", documentos incluidos, firma de Dirección
    Y confirmo la certificación
    Entonces el sistema genera el PDF con sello de Dirección y número de certificación único
    Y registra en audit.audit_log: usuario DIR, expediente certificado, destino, fecha-hora, número de certificación
    Y el evento queda en el hash chain de auditoría

  Escenario: Intento de certificación por ARCH sin delegación formal
    Dado que soy ARCH sin delegación formal de Dirección
    Cuando intento certificar un expediente
    Entonces el sistema rechaza con error "Solo Dirección o su delegado autorizado pueden certificar copias (Art. 21 NTEC)"
    Y registra el intento en audit.audit_log

  Escenario: Delegación temporal de certificación
    Dado que soy DIR y deseo delegar la certificación a un ARCH específico
    Cuando configuro la delegación con fecha de vigencia
    Entonces el sistema asigna el permiso `CERTIFY_RECORD` temporal al ARCH designado
    Y registra la delegación con timestamp de inicio y fin
```

- **SP:** 5
- **MoSCoW:** Should
- **Dependencias:** US.F2.3.48, Permisos de rol DIR, `audit.audit_log`
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §2.1 (nota Art. 21-32) | Acuerdo 1616 Art. 21, 32 NTEC
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** Acuerdo 1616 Art. 21, 32 NTEC (certificación restringida a Dirección)
- **Notas técnicas:** Permiso `CERTIFY_RECORD` exclusivo del rol `DIRECTOR`. Delegación vía tabla `ece.delegacion_permiso` con `valid_until`. Número de certificación: secuencial por establecimiento-año.

---

### US.F2.3.50 — Notificar al médico la disponibilidad de resultado de estudio

**Como** sistema **quiero** notificar automáticamente al médico solicitante cuando el resultado de un laboratorio o gabinete esté disponible **para** agilizar la toma de decisiones clínicas sin que el médico tenga que revisar manualmente el sistema.

**AC Gherkin:**
```gherkin
Funcionalidad: Notificación de resultado disponible

  Escenario: Notificación en panel del médico al disponibilizar resultado
    Dado que el laboratorio registró el resultado de la solicitud BHC del Dr. García
    Cuando el resultado pasa a estado "resultado_listo"
    Entonces el motor workflow genera una notificación en el panel del Dr. García
    Y la notificación muestra: paciente, tipo de estudio, episodio, botón "Ver resultado"
    Y el contador de notificaciones no leídas aumenta en 1

  Escenario: Resultado con valor crítico — notificación urgente
    Dado que el resultado tiene un valor crítico (K+ = 2.1 mEq/L)
    Cuando el laboratorio lo registra
    Entonces el sistema genera notificación urgente con prioridad alta
    Y la notificación aparece resaltada en rojo en el panel del médico
    Y si el médico no acusa recibo en 15 minutos, reenvía la alerta al jefe de turno

  Escenario: Médico no disponible — escalamiento de notificación
    Dado que el Dr. García no tiene sesión activa
    Cuando se genera la notificación de resultado crítico
    Entonces el sistema escala la alerta al médico de turno activo del servicio
    Y registra el escalamiento en audit.audit_log
```

- **SP:** 3
- **MoSCoW:** Could
- **Dependencias:** US.F2.3.24, Motor workflow Stream 3
- **Trazabilidad fuente:** `analisis_workflows_ece.md` §A.7 | Motor workflow (Stream 3 — solo usarlo, no diseñarlo aquí)
- **Trazabilidad GS1:** N/A
- **Trazabilidad normativa:** N/A (operacional de seguridad clínica)
- **Notas técnicas:** La lógica de notificación vive en el motor workflow (Stream 3). Este US define el disparador (evento `resultado_listo`) y el destino (panel del médico solicitante). Integración vía evento de dominio.

---

## Matriz de Cobertura de Documentos del ECE Ambulatorio

| # | Documento ECE | US que lo cubren | Cobertura |
|---|--------------|-----------------|-----------|
| 1 | Ficha de Identificación (3.1 MAESTRO, Art. 15) | US.F2.3.1, 2, 3, 4, 5, 6 | 100% |
| 2 | Historia Clínica (3.2, primera vez/subsecuente) | US.F2.3.12, 13, 15, 43 | 100% |
| 3 | Hoja de Signos Vitales (3.3, series temporales) | US.F2.3.10, 11 | 100% |
| 4 | Hoja de Triaje (3.4, esquema institucional) | US.F2.3.9 | 100% |
| 5 | Hoja de Atención de Emergencia (3.5) | US.F2.3.16, 17 | 100% |
| 6 | Hoja de Indicaciones Médicas (3.6, versionada) | US.F2.3.18, 19 | 100% |
| 7 | Registro de Enfermería + Kardex (3.7) | US.F2.3.20, 21 | 100% |
| 8 | Hoja de Evolución Médica (3.8, ambulatorio subsec.) | US.F2.3.13, 22, 15 | 100% |
| 9 | Hoja RRI — Referencia / Retorno / Interconsulta (3.10) | US.F2.3.26, 27, 28 | 100% |
| 10 | Consentimiento Informado para procedimiento menor (3.9) | US.F2.3.29 | 100% |
| 11 | Certificado de Incapacidad Temporal ISSS (3.17) | US.F2.3.32 | 100% |
| 12 | Solicitud + Resultado Lab/Gabinete (3.18, RELAB) | US.F2.3.23, 24, 25 | 100% |
| 13 | Alta Ambulatoria (registro de cierre) | US.F2.3.33, 34, 39 | 100% |
| 14 | Hoja de Procedimiento Menor / Curaciones / Inyectables | US.F2.3.30, 31 | 100% |
| 15 | Hoja de Observación en Emergencia (< 24h) | US.F2.3.17 | 100% |

**Cobertura de documentos: 15/15 = 100%**

---

## Matriz de Cobertura de Pasos del Proceso Ambulatorio

| Paso | Descripción | US que lo cubren | Cobertura |
|------|-------------|-----------------|-----------|
| §A.1 | Captación / llegada del usuario | US.F2.3.7, 40, 47 | 100% |
| §A.2 | Identificación / creación-recuperación expediente | US.F2.3.1, 2, 3, 4, 6 | 100% |
| §A.3 | Admisión administrativa (MINSAL/ISSS) | US.F2.3.5, 8 | 100% |
| §A.4a | Triaje Manchester (ruta Emergencia) | US.F2.3.9 | 100% |
| §A.4b | Sala de espera (ruta Consulta Externa) | US.F2.3.7, 41 | 100% |
| §A.5 | Preconsulta / signos vitales | US.F2.3.10, 11 | 100% |
| §A.6 | Atención clínica / consulta (1a vez / subsecuente / emergencia) | US.F2.3.12, 13, 16, 22, 43 | 100% |
| §A.7 | Apoyo diagnóstico (lab / imagen) | US.F2.3.23, 24, 25, 50 | 100% |
| §A.8 | Farmacia / dispensación (registro documental) | US.F2.3.31 | 100% |
| §A.9 | Procedimientos menores | US.F2.3.29, 30 | 100% |
| §A.10 | Observación en emergencia (< 24h, sin ingreso) | US.F2.3.17 | 100% |
| §A.11 | Cierre administrativo / caja / certificado incapacidad | US.F2.3.32 | 100% |
| §A.12 | Alta ambulatoria + devolución expediente | US.F2.3.33, 34, 35, 36, 39, 46 | 100% |

**Cobertura de pasos de proceso: 13/13 = 100%**

---

## Dependencias Técnicas y Notas de Integración

### Con Motor Workflow (Stream 3 — solo consumir, no diseñar)
- Transiciones de estado del episodio: `abierto → en_curso → cerrado`
- Notificaciones de resultado crítico y alerta de valor fuera de rango
- Alerta de observación > 23h
- Escalamiento de notificación de resultado a jefe de turno
- Dispensación diferida notificada a farmacia

### Con Módulo GS1 (Streams 7-8 — fuera de scope)
- US.F2.3.21 (kardex) y US.F2.3.31 (dispensación) son el punto de conexión futuro para BCMA y scan GS1
- El kardex actual registra administración manual; GS1 agregará validación por código de barras

### Con Stream 6 (Procesos Hospitalarios — fuera de scope)
- US.F2.3.16 (disposición `orden_ingreso`) es el punto de traspaso al flujo hospitalario
- El documento de Orden de Ingreso y Apertura de Episodio Hospitalario (3.11, 3.12) no se diseña aquí

### Con @DBA — Extensiones de Schema requeridas
- `ece.movimiento_expediente` — tabla de custodia de expediente físico (US.F2.3.35-36)
- `ece.dispensacion` — registro de dispensación en farmacia (US.F2.3.31)
- `ece.alta_ambulatoria` — alta ambulatoria estructurada (US.F2.3.33); alternativa: subtipo de `ece.evolucion_medica`
- `ece.delegacion_permiso` — delegación de certificación por Dirección (US.F2.3.49)
- FK `referencia_rri_id` en `ece.episodio_atencion` (US.F2.3.47)

### RLS — Obligatorio en todos los routers
- Todos los routers de esta épica deben usar `withTenantContext` de `packages/trpc/src/rls-context.ts`
- `organization_id` filtra automáticamente datos por institución (MINSAL vs ISSS vs privado)

---

## Resumen Ejecutivo de la Épica

| Métrica | Valor |
|---------|-------|
| Total de User Stories | 50 |
| SP Total | 230 |
| US Must | 35 (70%) |
| US Should | 11 (22%) |
| US Could | 4 (8%) |
| Documentos ECE cubiertos | 15 / 15 (100%) |
| Pasos de proceso ambulatorio cubiertos | 13 / 13 (100%) |
| Escenarios Gherkin totales | ~155 |
| Normativa de referencia principal | Acuerdo 1616 (Arts. 4, 11-17, 19-21, 30, 34-35, 40-42, 55-56) |

---

*Elaborado por @PO — Inversiones Avante / Complejo Hospitalario. Stream 5/10. Fase 2 ECE Ambulatorio. Idioma: es-SV. Fecha: 2026-05-16.*
*Insumos: `analisis_workflows_ece.md`, `03_paciente_maestro.sql`, `04_episodios.sql`, `06_documentos_clinicos.sql`.*
