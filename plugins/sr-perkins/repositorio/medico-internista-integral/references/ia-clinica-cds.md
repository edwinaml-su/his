# Tecnología e IA clínica: del conocimiento del internista al sistema

Cómo convertir criterio clínico en reglas, alertas y pathways que un HIS pueda ejecutar, y cómo evaluar herramientas de IA en salud sin ingenuidad ni tecnofobia.

## Contenido
1. Principios
2. Plantilla: ficha de regla clínica / alerta (CDS)
3. Catálogo de reglas de alto valor para un HIS
4. Pathways digitalizables
5. Estándares y terminologías
6. Evaluación de herramientas de IA en salud
7. Uso responsable de IA generativa por el médico

---

## 1. Principios

- **Una alerta que se ignora es peor que ninguna**: diseña pocas alertas, de alto valor, con baja tasa de falsos positivos; mide la tasa de omisión (override) y retira las que superen ~90 % de omisión sin justificación.
- **Interrumpir solo cuando la seguridad lo exige**: alertas duras (bloqueo) para alergia documentada, duplicidad terapéutica grave, dosis letal, interacción mayor; el resto, no interruptivas (sugerencia, lista de verificación, recordatorio).
- **La regla cita su fuente**: cada umbral lleva guía, año y nivel de evidencia; se revisa cuando la guía cambia.
- **El clínico decide**: el sistema sugiere y registra la decisión; el override con motivo es información valiosa, no una falta.
- **Datos correctos primero**: una regla sobre creatinina falla si la creatinina no está estructurada; antes de la regla, valida que el dato exista, en la unidad correcta, con fecha.

## 2. Plantilla: ficha de regla clínica / alerta

```
ID · Nombre · Objetivo clínico (qué daño evita o qué beneficio produce)
Población / contexto (dónde dispara: admisión, prescripción, resultado de laboratorio, triage, alta)
Condición lógica (en lenguaje claro y en pseudocódigo; variables con fuente, unidad y antigüedad máxima del dato)
Acción (mensaje exacto que ve el clínico; tipo: bloqueo / interruptiva / no interruptiva; a quién; opción de override con motivo)
Excepciones y exclusiones
Umbral y fuente (guía, año, clase/nivel; fecha de próxima revisión)
Riesgo de la regla (falsos positivos esperados, fatiga de alertas, consecuencia de un fallo)
Indicadores de la regla (disparos/mes, tasa de override, desenlace que mide su efecto)
Pruebas de aceptación (casos que deben disparar y casos que no)
Responsable clínico · Versión
```

## 3. Catálogo de reglas de alto valor para un HIS

Punto de partida; prioriza por daño evitable y factibilidad de datos.

**Seguridad de la prescripción**: alergias (con reacción y severidad); interacciones mayores (anticoagulante+AINE, ISRS+tramadol, litio+IECA/diurético, QT prolongado acumulado); ajuste por función renal (TFGe) y hepático; dosis máxima; duplicidad terapéutica; fármacos de alto riesgo (insulina, opioides, heparinas, potasio IV, quimioterapia) con doble verificación; embarazo/lactancia (categoría y trimestre); criterios Beers en ≥65 años; conciliación al ingreso/traslado/alta.

**Deterioro y sepsis**: NEWS2 automático con cada toma de signos y escalamiento según umbral; qSOFA/SOFA; lactato >2 con sospecha de infección → bundle de sepsis con reloj de la primera hora; hipoglucemia e hiperglucemia; hiperkalemia, hiponatremia severa, troponina elevada, hemoglobina crítica → notificación al médico responsable (valores críticos con acuse de recibo).

**Emergencia**: triage estructurado (Manchester/ESI) con reevaluación por tiempo; ECG en <10 min para dolor torácico; "código ictus" y "código infarto" con cronómetros; test de embarazo pendiente en mujer en edad fértil antes de imagen con radiación; escalas de riesgo (HEART, Wells, PERC, Glasgow-Blatchford) calculadas desde datos estructurados.

**Hospitalización**: profilaxis de TVP (Caprini/Padua) pendiente; úlceras por presión (Braden); caídas (Morse); delirium (CAM) en ≥65 años; catéter urinario/venoso >72 h sin indicación revisada; antibiótico sin revisión a las 48–72 h (stewardship); nutrición (MUST/NRS) al ingreso; planificación de alta desde el ingreso; cita y medicación conciliada antes de firmar el alta.

**Consulta externa y prevención**: tamizajes vencidos por edad/sexo/riesgo; vacunas pendientes; metas de crónicos fuera de rango (PA, HbA1c, LDL, TFGe/albuminuria); paciente con insuficiencia cardíaca sin terapia con beneficio pronóstico documentada; diabético sin examen de pie/fondo de ojo anual; seguimiento post-alta a 7 días en IC/EPOC.

**Paciente especial**: embarazada con PA ≥140/90 y síntomas de preeclampsia; preoperatorio con RCRI/STOP-BANG/Caprini y lista de fármacos a suspender; SGLT2 activo en paciente programado para cirugía; riesgo suicida (Columbia) positivo → protocolo de seguridad; psicofármaco con QT prolongado en ECG reciente.

## 4. Pathways digitalizables

Para cada pathway (sepsis, SCA, ictus, IC descompensada, EPOC exacerbado, neumonía, cetoacidosis, HDA, preoperatorio, alta segura) define: criterio de entrada, pasos con tiempos objetivo, puntos de decisión con la regla explícita, órdenes agrupadas (order sets) con dosis por defecto ajustables, documentación mínima obligatoria, criterios de salida, indicadores de proceso (tiempo puerta-aguja, cumplimiento del bundle) y de resultado (mortalidad, estancia, reingreso). Entrégalo como tabla de pasos + diagrama de flujo + lista de órdenes; el equipo de TI debe poder implementarlo sin interpretar.

## 5. Estándares y terminologías

Diagnósticos: CIE-10 (CIE-11 cuando el país lo adopte); procedimientos: CIE-9-MC/CPT o catálogo nacional; clínico: SNOMED CT; laboratorio: LOINC; fármacos: ATC, catálogo nacional, con GS1/GTIN para producto; interoperabilidad: HL7 FHIR (recursos Patient, Encounter, Condition, Observation, MedicationRequest, AllergyIntolerance, CarePlan); CDS Hooks para integrar reglas; documentos: CDA/FHIR Composition. Pide siempre que los datos clínicos se registren estructurados en el punto de atención; el texto libre no dispara reglas ni alimenta indicadores.

## 6. Evaluación de herramientas de IA en salud

Antes de recomendar o adoptar una herramienta de IA (triage, predicción de deterioro, lectura de imágenes, transcripción clínica, chatbot de pacientes), evalúa:
- **Problema clínico y desenlace**: ¿qué decisión mejora y cómo se mide?
- **Validación**: datos de entrenamiento (población, país, periodo), validación externa y prospectiva, desempeño (sensibilidad, especificidad, AUC, calibración, VPP en la prevalencia local), subgrupos (sexo, edad, etnia), deriva en el tiempo.
- **Sesgos y equidad**: ¿penaliza a poblaciones subrepresentadas?
- **Explicabilidad y flujo de trabajo**: ¿el clínico entiende por qué sugiere?, ¿añade clics o los quita?, ¿quién responde ante un error?
- **Regulación y privacidad**: estatus regulatorio (FDA/CE/autoridad local), tratamiento de datos (dónde se procesan, anonimización, consentimiento), normativa local de protección de datos y de expediente clínico.
- **Gobernanza**: dueño clínico, monitoreo continuo de desempeño y seguridad, plan de retiro. Guías de reporte: TRIPOD-AI, CONSORT-AI, DECIDE-AI; marcos: OMS sobre ética de la IA en salud.

## 7. Uso responsable de IA generativa por el médico

Úsala para lo que hace bien (resúmenes, borradores, búsqueda estructurada, educación al paciente, código de análisis, traducción) y verifica siempre lo que afirma: dosis, cifras, citas y guías deben confirmarse en la fuente. No introduzcas datos identificables de pacientes en herramientas sin acuerdo de tratamiento de datos. Declara el uso de IA en publicaciones según la política editorial. Enseña a residentes y estudiantes a usarla como "colega que puede equivocarse", nunca como autoridad final.
