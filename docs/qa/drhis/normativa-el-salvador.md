# @DrHIS — Marco normativo salvadoreño aplicable al HIS

Qué exigirle al sistema por cada norma. **Este documento se usa para fundamentar una calificación de cumplimiento, no para reemplazar la lectura de la norma.**

## Cómo usar este archivo

1. **Verificá la versión vigente antes de calificar.** La regulación salvadoreña se ha reformado con frecuencia desde 2023 — en protección de datos, en facturación electrónica y en normativa técnica del MINSAL. Cuando tu conclusión dependa de la versión, buscá en web y **anotá la fecha de consulta** en la fila de la matriz.
2. **Citá artículo cuando lo tengas**, y cuando no lo tengas decí "norma aplicable, artículo por confirmar" en vez de inventar la referencia. Un artículo mal citado destruye la credibilidad de toda la matriz.
3. **Distinguí el régimen del establecimiento**: privado, público (MINSAL/RIISS) o ISSS. Varias obligaciones aplican solo a uno.
4. En decisiones legales de alto riesgo —validez probatoria de la firma electrónica, sanciones, retención documental— **recomendá asesoría legal**. Sos evaluador funcional, no abogado.

---

## 1. Fuentes primarias

| Norma | Qué gobierna | Aplica a |
|---|---|---|
| **Código de Salud** | Ejercicio de la profesión, obligaciones de los establecimientos, notificación de enfermedades, certificación de defunción | Todos |
| **Ley de Deberes y Derechos de los Pacientes y Prestadores de Servicios de Salud** | Consentimiento informado, información al paciente, acceso al expediente, atención de urgencia sin condicionamiento | Todos |
| **Ley de Protección de Datos Personales** | Datos sensibles de salud: consentimiento, finalidad, acceso, rectificación, cancelación, oposición (ARCO), seguridad | Todos |
| **Normativa técnica del MINSAL (NTEC)** para el expediente clínico electrónico | Estructura, contenido, firma e inmutabilidad de los documentos clínicos | Establecimientos regulados |
| **Ley de Firma Electrónica** | Validez de la firma electrónica simple y certificada | Todos |
| **Normativa de facturación electrónica del Ministerio de Hacienda (DTE)** | Tipos de comprobante, esquema, transmisión y conservación | Todos los que facturan |
| **Reglamento / lineamientos del ISSS** | Formatos, autorizaciones y liquidación para derechohabientes | Los que atienden ISSS |

En este repositorio, la traducción operativa de la NTEC ya está hecha: **`docs/flujos/{CODIGO}.md`** (30 fichas con metadata, dependencias, roles y eventos por documento) y el índice `docs/31_flujos_operativos_consolidado.md`. Es la fuente de verdad normativa del proyecto y el punto de partida de cualquier matriz de cumplimiento.

---

## 2. Qué exigirle al HIS, por obligación

### Atención de urgencia

| Obligación | Requisito para el HIS | Cómo se verifica |
|---|---|---|
| La urgencia no se condiciona a pago ni a trámite previo | Registrar y atender sin exigir documento, cuenta ni autorización | Recorré el escenario del politraumatizado sin documentos: si alguna pantalla bloquea, es **Crítico** |
| Estabilizar antes de referir | Registro del estado del paciente al momento de la referencia | Documento de referencia con constantes y condición |

### Consentimiento informado

| Obligación | Requisito para el HIS | Cómo se verifica |
|---|---|---|
| Consentimiento previo, informado y por escrito para procedimientos que lo exigen | Documento firmado por paciente (o responsable) **y** médico, anterior al acto, e inmutable después | Intentá modificar un consentimiento firmado: si el sistema lo permite, es **Crítico** |
| Consentimiento en términos comprensibles | Plantilla con el procedimiento, riesgos, alternativas y quién informa | Revisá la plantilla real, no el campo vacío |
| Derecho a revocarlo | Registro de revocación, sin borrar el original | Verificá que revocar no destruya el documento previo |

Ojo con la distinción que ya existe en este HIS y que confunde a los evaluadores: `/consents` (admin) son consentimientos de **tratamiento de datos**; `/ece/consentimiento` (clínico) son los **consentimientos médicos informados NTEC**. Son dominios distintos y coexisten legítimamente.

### Expediente clínico

| Obligación | Requisito para el HIS | Cómo se verifica |
|---|---|---|
| Registro completo, veraz y oportuno | Todo documento con autor, fecha/hora y contenido; sin campos clínicos obligatorios omitibles | Intentá firmar con obligatorios vacíos |
| Inalterabilidad tras la firma | Documento firmado no se edita; se corrige por **rectificación formal** que conserva el original | Es el Art. 40 de la NTEC. Probalo en `/ece/rectificacion` |
| Identificación del profesional responsable | Firma ligada al profesional registrado, no al usuario genérico del sistema | Verificá que resuelva a personal de salud registrado y no al id de usuario |
| Conservación por el plazo legal | Retención y recuperabilidad del expediente | Requisito de infraestructura; verificá política de respaldo y restauración |
| Acceso del paciente a su expediente | Mecanismo de entrega de copia | Verificá que exista y quede registrado quién la entregó |

### Protección de datos personales

| Obligación | Requisito para el HIS | Cómo se verifica |
|---|---|---|
| Datos de salud = categoría sensible | Acceso por rol y **mínimo privilegio**; nada de "todos ven todo" | Iniciá sesión con un rol limitado e intentá ver lo que no le corresponde |
| Registro de accesos | Pista de auditoría de **lecturas**, no solo de escrituras | Un expediente que se puede leer sin dejar rastro incumple |
| Derechos ARCO | Flujo de acceso, rectificación, cancelación y oposición | Verificá que exista el flujo, no solo la intención |
| Acceso de emergencia (break-glass) | Permitido, pero **registrado, justificado y revisable** | Un break-glass sin auditoría posterior es una puerta trasera |
| Aislamiento entre entidades | Un establecimiento no ve datos de otro | En este HIS se han encontrado fugas reales entre organizaciones; **probalo, no lo asumas** |

### Certificación de defunción y notificaciones

| Obligación | Requisito para el HIS | Cómo se verifica |
|---|---|---|
| Certificado de defunción emitido por profesional facultado, con causas encadenadas | Documento con causa básica, intermedia y directa, codificadas | Ficha `docs/flujos/CERT_DEF.md` |
| Notificación de enfermedades de declaración obligatoria | Detección y reporte al MINSAL | Verificá que el sistema lo dispare, no que dependa de que alguien se acuerde |

### Facturación

Ver `cobros-cuentas.md` §4. Lo que la matriz debe registrar: tipo de comprobante correcto por receptor, inalterabilidad del emitido, referencia en notas de crédito/débito, y cumplimiento del esquema y plazos DTE vigentes al momento de la evaluación.

---

## 3. Trampas frecuentes al calificar cumplimiento

- **Confundir "el campo existe" con "la norma se cumple".** La NTEC exige que el documento esté firmado y sea inmutable; un campo `firmado_por` que se puede editar no cumple nada.
- **Dar por cumplido lo que dice la documentación.** En este proyecto hubo módulos con documentación completa que nunca funcionaron. Se prueba el circuito.
- **Calificar como incumplimiento normativo lo que es falta de carga de datos.** Un catálogo vacío no es un incumplimiento de la norma: es un pendiente de implantación. Clasificá bien la naturaleza del hallazgo.
- **Asumir que una norma aplica a todo régimen.** Verificá si el establecimiento es privado, MINSAL o ISSS antes de exigir un formato.
- **Citar de memoria.** Si no verificaste el artículo, decilo.

---

## 4. Insumos internos ya disponibles

Antes de escribir una matriz desde cero, revisá lo que el proyecto ya produjo:

| Documento | Contenido |
|---|---|
| `TDR_HIS_Multipais.md` | Términos de referencia regulatorios, 30 módulos — fuente de verdad contractual |
| `docs/flujos/{CODIGO}.md` | 30 fichas NTEC con dependencias, roles y eventos |
| `docs/31_flujos_operativos_consolidado.md` | Índice maestro de los flujos |
| `docs/32_gap_jci_assessment.md` | Brechas contra estándares JCI |
| `tests/features/jci/` | Escenarios Gherkin de cumplimiento JCI ya escritos |
| `docs/12_rls_validation.md` | Validación de aislamiento multi-entidad y gaps documentados |

Si tu hallazgo contradice alguno de estos documentos, decilo explícitamente: o el documento está desactualizado o el sistema se desvió de él. **Las dos cosas son hallazgos.**
