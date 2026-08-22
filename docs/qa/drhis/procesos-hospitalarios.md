# @DrHIS — Criterios de evaluación por proceso asistencial

Criterios y escenarios de paciente para evaluar el HIS como usuario clínico. Cada proceso trae: el escenario que hay que recorrer, dónde está en el sistema, qué exigirle, y los defectos que en este hospital ya se pagaron.

**Regla transversal:** un módulo puede tener todos los campos y aun así fallar el escenario. Se evalúa el recorrido completo, no la pantalla.

---

## 1. Emergencia y máxima urgencia

**Fichas normativas:** `docs/flujos/TRIAJE.md`, `docs/flujos/ATN_EMERG.md`, `docs/flujos/SV.md`
**Rutas:** `/triage`, `/emergency`, `/ece/atencion-emergencia`, `/ece/signos-vitales`

### Escenario A — Politraumatizado sin documentos

1. Llega en ambulancia, inconsciente, sin acompañante ni documentos.
2. Triage lo clasifica como máxima urgencia (rojo).
3. Se le toman signos vitales y se inicia atención antes de cualquier trámite administrativo.
4. Aparece un familiar 40 minutos después con el DUI: se identifica al paciente.
5. Pasa a quirófano de emergencia.
6. Se abre la cuenta y se capturan los cargos retroactivamente.

### Qué exigir

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | Registrar al paciente **sin documento** con un identificador temporal trazable, y atenderlo sin bloqueo administrativo | La Ley de Deberes y Derechos de los Pacientes prohíbe condicionar la urgencia a trámite o pago |
| 2 | **Fusionar** después el registro temporal con el expediente real sin perder nada de lo registrado | Si la fusión pierde el triage o los signos, el expediente queda mutilado |
| 3 | Clasificación de triage con escala explícita y **tiempo objetivo por nivel**, con reloj visible | El nivel sin reloj no sirve: lo que se audita es el tiempo puerta-atención |
| 4 | El nivel de triage **no** se puede bajar sin registrar quién y por qué | Rebajar la prioridad es una decisión clínica con consecuencias |
| 5 | Signos vitales con rangos por edad y **alerta automática** fuera de rango | El deterioro se detecta por tendencia, no por memoria |
| 6 | Hora de llegada, de triage, de primera atención médica y de destino, **capturadas por el sistema**, no digitadas | Son los indicadores que audita el MINSAL; digitadas a mano no son evidencia |
| 7 | El alta o el destino (domicilio, ingreso, quirófano, referencia, fallecido) cierra el episodio y **abre el siguiente** sin re-digitar al paciente | Doble digitación = hallazgo |

### Ya verificado en este hospital

- Existe pre-registro de paciente no identificado con numeración diaria `DDMMAAAA-NN` por organización (CC-0008b).
- El triage Manchester está implementado en `/triage` y sincroniza con `ece.hoja_triaje` vía bridge.
- **Verificá el reloj de tiempos objetivo**: la ficha lo exige; que exista el campo no prueba que corra.

---

## 2. Bloque quirúrgico

**Fichas:** `docs/flujos/PROG_QX.md`, `PREOP.md`, `CONS_QX.md`, `ACT_QX.md`, `REG_ANEST.md`, `URPA.md`, `IND_MED_POSTOP.md`
**Rutas:** `/surgery`, `/ece/quirofano` y sus subrutas

### Escenario B — Colecistectomía programada

1. Se programa la cirugía con cirujano, sala, fecha y duración estimada.
2. Se realiza la evaluación preanestésica.
3. Se firma el consentimiento informado quirúrgico y el de anestesia.
4. Ingresa el día de la cirugía; se verifica el listado de verificación (WHO) antes de la incisión.
5. Acto quirúrgico: hallazgos, procedimientos, tiempos, equipo, insumos y prótesis.
6. Recuperación post-anestésica (URPA) con criterios de egreso.
7. Indicaciones postoperatorias y alta.

### Qué exigir

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | **No se programa** sin diagnóstico, procedimiento codificado y cirujano responsable | Una programación incompleta desordena todo el bloque |
| 2 | Detección de **conflicto de sala** y de disponibilidad de equipo | Dos cirugías en la misma sala es un evento evitable |
| 3 | La evaluación preanestésica es **prerrequisito duro** del ingreso a sala | Es el control que evita una anestesia sobre un paciente no evaluado |
| 4 | Consentimiento informado **firmado antes** del acto, con doble firma (paciente y médico) e **inmutable después** | Art. 40 NTEC: firmado no se modifica; se rectifica por el flujo formal |
| 5 | Listado de verificación quirúrgica con sus tres pausas, cada una con responsable y hora | Es un control de seguridad exigido por JCI; si se puede saltar, no es control |
| 6 | Registro anestésico con constantes en el tiempo, fármacos y eventos | Sin curva temporal no hay defensa ante un evento adverso |
| 7 | Insumos, prótesis y material implantable con **lote y trazabilidad** que bajen a la cuenta | Un implante sin lote es irrastreable en un recall |
| 8 | Criterios de egreso de URPA explícitos y firmados | Egresar antes de tiempo es la causa clásica de reingreso a UCI |
| 9 | Todo lo consumido en sala **genera cargo automáticamente** | Quirófano es donde más se pierde facturación |

### Advertencia específica de este HIS

**Conviven dos representaciones del proceso quirúrgico** (`SurgeryCase` del dominio HIS y las entidades `ece.*`), ambas registradas. Ver `docs/adr/0021-fuente-verdad-quirurgica.md`. Al evaluar, **decí explícitamente por cuál ruta entraste**, porque un hallazgo en una puede no aplicar a la otra. Y no des por buenas las specs E2E de quirófano: varias fueron escritas para tolerar rutas inexistentes, así que pasan en verde sin ejercitar el circuito.

---

## 3. Cirugía ambulatoria

Mismo circuito que el bloque quirúrgico, con tres diferencias que hay que verificar aparte:

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | El episodio se abre y **se cierra el mismo día** sin ocupar cama censable | Si consume cama del censo, los indicadores de ocupación quedan falseados |
| 2 | Criterios de alta ambulatoria explícitos, con responsable | El alta precoz es el riesgo propio de esta modalidad |
| 3 | La **conversión a hospitalización** (por complicación) no re-digita al paciente ni abre una segunda cuenta | Es el escenario que más rompe el ciclo de ingresos |

---

## 4. Hospitalización

**Fichas:** `docs/flujos/ORD_ING.md`, `HOJA_ING.md`, `IND_MED.md`, `REG_ENF.md`, `EPI_EGR.md`, `RRI_HOS.md`
**Rutas:** `/admission`, `/inpatient`, `/beds`, `/census`, `/transfers`, `/ece/episodio-hospitalario`, `/ece/hoja-ingreso`, `/ece/epicrisis`

### Escenario C — Diabético descompensado que sube de emergencia

1. Orden de ingreso desde emergencia, con diagnóstico y servicio destino.
2. Asignación de cama; el censo se actualiza.
3. Hoja de ingreso e historia clínica.
4. Indicaciones médicas; farmacia dispensa; enfermería administra y registra en el eMAR.
5. Evolución diaria y notas de enfermería.
6. Traslado a otro servicio (de medicina a UCI y de vuelta).
7. Epicrisis y alta.

### Qué exigir

| # | Requisito | Por qué importa |
|---|---|---|
| 1 | La cama cambia de estado **en el momento** de asignar, trasladar y dar alta, y el censo lo refleja sin proceso nocturno | Un censo que se cuadra al día siguiente no sirve para decidir hoy |
| 2 | El traslado conserva la cuenta y **no** reabre expediente | Reabrir expediente rompe la continuidad y duplica el paciente |
| 3 | Indicación médica firmada → farmacia la recibe **sin re-digitación** | Es el punto donde más errores de medicación se generan |
| 4 | Administración con identificación positiva del paciente y del medicamento (código de barras) | Los cinco correctos no se verifican de memoria |
| 5 | Alergias y **hard-stop** ante interacción grave o medicamento de alto riesgo | Debe frenar, no solo advertir |
| 6 | Epicrisis con diagnósticos codificados, procedimientos, condición de egreso e indicaciones | Es el documento que sostiene la continuidad y la facturación del episodio |
| 7 | El alta **no se puede firmar** con documentos obligatorios pendientes | Es el único momento en que el expediente se puede completar |

### Advertencias específicas de este HIS

- **La sincronización admisión→ECE es no-fatal por diseño** (`packages/trpc/src/lib/ece-hooks.ts`): la admisión se confirma aunque falle la creación en ECE. Probalo explícitamente y reportalo como riesgo de expediente huérfano.
- `ece.personal_salud` está **vacía en producción**: los flujos que exigen firma de personal clínico registrado pueden ser inalcanzables hoy. Verificalo antes de reportar un defecto de firma como defecto de software.

---

## 5. Servicios de apoyo (en lo que tocan los flujos anteriores)

| Servicio | Ruta | Qué exigir |
|---|---|---|
| **Farmacia / eMAR** | `/pharmacy`, `/emar`, `/bedside` | Que la indicación firmada llegue sola; que la dispensación descuente stock real; que la administración quede con hora, responsable y lote |
| **Laboratorio** | `/lis` | Solicitud → toma con dos identificadores → resultado → **notificación de valor crítico al médico tratante con lectura de vuelta** |
| **Imágenes** | `/imaging` | Solicitud con justificación clínica; informe firmado; que el estudio quede asociado al episodio correcto |

**Resultados críticos (IPSG.2):** en este HIS el módulo existía completo y **nunca funcionó** — sus endpoints abortaban con error de sintaxis SQL antes de tocar la tabla. Es el ejemplo canónico de por qué se prueba el circuito y no la pantalla. Verificá que hoy sí notifica, y que la lectura de vuelta queda registrada.

---

## Cierre de cualquier evaluación

Antes de dar un proceso por evaluado, respondé estas tres:

1. ¿Recorriste el escenario **completo**, o te detuviste en la primera pantalla que abrió?
2. Por cada paso que marcaste `Pasa`, ¿tenés evidencia — captura, id de registro o consulta?
3. ¿Listaste explícitamente lo que quedó **No verificado**?

Si alguna respuesta es no, la evaluación no está terminada.
