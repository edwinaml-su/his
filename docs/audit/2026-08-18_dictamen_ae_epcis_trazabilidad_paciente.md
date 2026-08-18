# Dictamen de Cumplimiento y Análisis de Impacto — Trazabilidad GS1 EPCIS del Paciente (GSRN)

> **@AE — Arquitecto Empresarial — Inversiones Avante**
> Fecha: 2026-08-18 | Framework: TOGAF 10 (ADM Fase B/C) + ITIL 4 (gobierno de servicio)
> Alcance: dictamen de cumplimiento y análisis de impacto **previo** al diseño técnico. El diseño de @AS corre en paralelo y debe tratar este documento como entrada de gate, no como comentario opcional.
> Rama: `feat/gs1-trazabilidad-paciente` | Evidencia verificada contra HEAD `7279216` (2026-08-18).
> Relacionado: ADR 0017 (GS1 EPCIS event sourcing — farmacia), CC-0017 (RBAC/ABAC/break-glass), F2-S15 Stream C (Portal ARCO), `docs/39_sla_retencion_datos.md`, `docs/audit/2026-06-16_gs1_cumplimiento_remediacion.md`.

---

## 0. Dictamen

**PROCEDE CON CONDICIONES.**

El caso de uso tiene valor de cumplimiento real (JCI IPSG.1, trazabilidad epidemiológica intrahospitalaria, continuidad asistencial) y se apoya en infraestructura ya construida y aceptada (GSRN de pulsera, `GsrnHistory`, motor EPCIS de ADR 0017, RBAC/ABAC de CC-0017). No hay razón para frenarlo. Pero **no es trazabilidad de inventario** y no puede heredar sin más el patrón de inmutabilidad fuerte que el sistema usa para medicamentos y para el audit log — hacerlo crea un problema de cumplimiento que hoy no existe: una cadena criptográfica de ubicación de personas que ni Dirección ni una orden de la autoridad de protección de datos podrían tocar.

Las condiciones no son cosméticas. La más importante — que este stream **no** se encadene en `audit.audit_log` ni replique el trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION` de ADR 0017 — es una condición de diseño, no una sugerencia de estilo. Ver §3.5.

Este dictamen no cubre el diseño técnico (routers, tablas, contratos Zod) — eso es entrega de @AS. Cubre lo que @AS **no puede decidir por su cuenta**: base de licitud, minimización, retención, control de acceso y la posición institucional ante una eventual solicitud ARCO.

---

## 1. Clasificación del dominio (TOGAF)

| Dimensión ADM | Impacto |
|---|---|
| **Business Architecture** | Nuevo proceso "trazabilidad de continuidad asistencial intramuros" — no es un proceso de negocio nuevo en sí, es instrumentación (observabilidad) de un proceso ADT que ya existe (admisión → traslado → alta). |
| **Data Architecture** | Nueva entidad de eventos (WHAT/WHERE/WHEN/WHY/WHO) que debe ser **proyección de solo lectura** sobre entidades ya gobernadas (`Encounter`, `EncounterTransfer`, `BedAssignment`, `GsrnHistory`) — nunca fuente primaria de identidad, estado clínico o ubicación. |
| **Application Architecture** | Overlay sobre el motor EPCIS existente (ADR 0017), pero como **stream propio** — no debe mezclarse con `ece.gs1_epcis_event` (que hoy contiene GSRN de paciente junto a GTIN de medicamento con un propósito y una base de licitud distintos: dispensación/administración, no ubicación). |
| **Technology Architecture** | RLS por `organizationId` vía `withTenantContext` (ya obligatorio, sin excepción) + RBAC/ABAC de CC-0017 + break-glass — **sin** el hash chain de `audit.audit_log` (condición, ver §3.5). |

**Principio TOGAF aplicado:** *Principio de Gestión de Datos como Activo* — un dato se gobierna según su naturaleza y su base de licitud, no según la conveniencia técnica de reutilizar un patrón ya construido. El hecho de que ADR 0017 ya resolvió "cómo persistir eventos EPCIS inmutables" no significa que la misma solución aplique aquí: el objeto trazado cambió de *producto* a *persona*, y eso cambia el régimen jurídico aplicable, no solo el volumen de datos.

---

## 2. Marco normativo consultado — con nivel de certeza explícito

Verifiqué lo siguiente **en esta sesión**, vía búsqueda web (no tengo acceso al texto primario del decreto ni a jurisprudencia salvadoreña; leí comentario de firmas legales especializadas en la reforma, no el Diario Oficial):

| Norma | Lo que verifiqué | Certeza |
|---|---|---|
| **Ley de Protección de Datos Personales (LPDP)** | Decreto Legislativo N.° 144, aprobado 12-nov-2024, publicado en Diario Oficial 15-nov-2024, vigente desde 24-nov-2024. Inspirada en RGPD/GDPR. Reconoce derechos **ARCO-POL** (Acceso, Rectificación, Cancelación, Oposición, Portabilidad, supresión en entornos digitales, Limitación). Autoridad de aplicación: Agencia de Ciberseguridad del Estado (ACE). Exige consentimiento específico, libre, informado y por escrito para **datos sensibles** (incluye salud). | **Media-alta** en existencia, vigencia y estructura general (confirmado por múltiples fuentes jurídicas independientes: Central Law, ALTA, BLP Legal, Ecija, Informática Jurídica). **Baja** en el articulado exacto (número de artículo para cada excepción, redacción literal de la base de licitud "fines médicos/gestión de servicios de salud") — no leí el texto del decreto. |
| **Hallazgo importante — corrección al repo:** `docs/39_sla_retencion_datos.md` §4 y otros puntos citan "LOPD El Salvador (Decreto 594)". El decreto verificado es el **N.° 144**, no 594. Recomiendo corregir la cita (ver §4, restricción 10). No es un hallazgo bloqueante, pero una cita normativa incorrecta en un documento de SLA de retención es el tipo de detalle que un auditor de cumplimiento señala primero. | — | **Alta** (verificado en 2 búsquedas independientes, ningún resultado corrobora "Decreto 594"). |
| **NTEC Art. 6** (retención expediente clínico, 10 años) | No verifiqué el texto primario en esta sesión. Lo doy por válido porque el repo lo cita de forma consistente en múltiples PRs y documentos ya aceptados (`docs/39_sla_retencion_datos.md`, CLAUDE.md, docs/flujos). | **Media** — confío en el trabajo de arquitectura previo del proyecto, no en verificación propia del texto legal. |
| **JCI IPSG.1 (7th edition, 2021)** | Estándar internacional, ya mapeado con evidencia técnica en `docs/32_gap_jci_assessment.md` y `docs/audit/2026-05-30_jci_ipsg_gap.md`. | **Alta**. |
| **GS1 EPCIS 1.2/2.0 + CBV** | Estándar técnico público, ya implementado (ADR 0017, `epcis-builder.ts`). | **Alta**. |
| **Código de Salud SV / Reglamento del Expediente Clínico** | **No consultado** en esta sesión. Relevante para confirmar si el registro de traslados internos es o no contenido obligatorio del expediente. | **No verificado — pendiente.** |

**Recomendación explícita:** antes de go-live de esta funcionalidad, el punto de mayor exposición legal (§3.5, la posición ARCO vs. inmutabilidad) debe pasar por **revisión de asesoría legal externa con el texto primario de la LPDP en mano**, no solo por este dictamen de arquitectura. Lo digo sin rodeos: mi lectura de la base de licitud y de la excepción de erasure para datos con retención legal es la interpretación razonable que cualquier framework GDPR-like sostiene, pero no es una cita verbatim de un artículo salvadoreño que yo haya leído.

---

## 3. Análisis por punto

### 3.1 Base de licitud LPDP — ¿consentimiento nuevo o encaje existente?

**Encaja en el consentimiento `data-processing` existente, ampliado — no requiere un consentimiento nuevo.**

Razonamiento:

- El propósito primario de este evento (registrar que el paciente admitido pasó de Urgencias a Hospitalización a las 14:32, para continuidad de cuidado, seguridad de identificación y trazabilidad epidemiológica) **no es opcional** dentro de la prestación asistencial — es instrumentación de un proceso ADT que el paciente ya no puede "rechazar" sin rechazar la atención misma. Por eso no debe modelarse como un consentimiento revocable independiente (a diferencia de `mpi-cross-org`, que sí es opcional porque el paciente puede negarse a que su información cruce a otro establecimiento sin perder la atención en el establecimiento actual).
- La base de licitud correcta es la misma que ya sostiene el resto del ADT/expediente: ejecución de la prestación asistencial + obligación legal (Código de Salud / NTEC) — no consentimiento como base primaria. Esto es consistente con el patrón GDPR-like que la LPDP salvadoreña adopta (bases alternativas al consentimiento para tratamiento médico).
- Lo que **sí** cambia es el **deber de información** (principio de transparencia, LPDP): el paciente tiene derecho a saber que su ubicación intramuros queda registrada con un identificador GS1. Esto se satisface **actualizando el texto** de `CONSENT_TEMPLATES.SLV["data-processing"]` en `packages/trpc/src/routers/consent.router.ts` para mencionarlo explícitamente — no creando un sexto propósito en `consentPurposeEnum`.
- **Excepción de alcance:** si en una fase posterior se propone compartir la traza de movimiento con un tercero (aseguradora, otra organización del grupo, autoridad), eso sí requiere pasar por `mpi-cross-org` o un consentimiento nuevo — pero eso está fuera del alcance descrito en el encargo (trazabilidad *intramuros*).

**Condición:** el PR que implemente esto debe tocar el texto de la plantilla de consentimiento en el mismo commit que el código. No es aceptable lanzarlo con el texto de consentimiento actual, que no menciona geolocalización intramuros de ningún tipo.

### 3.2 Minimización y proporcionalidad — regla concreta

El riesgo señalado en el encargo es real y ya tiene precedente parcial en el propio repo: `epcis-builder.ts` (ADR 0017) hoy sí mete `gsrnPaciente` dentro de `who` para eventos de dispensación/bedside — eso es aceptable porque el propósito es verificación de identidad 5-Rights (JCI IPSG.1 ME2), no vigilancia de ubicación. El nuevo caso de uso es distinto y exige una regla más estricta:

**Regla de minimización (obligatoria, no negociable):**

1. `who` contiene **exclusivamente** identificadores opacos: GSRN del paciente (18 dígitos), GSRN o `userId` del personal que ejecuta el movimiento. **Nunca** nombre, DUI/NIE/NIT, número de expediente en claro, diagnóstico, alergia o cualquier atributo clínico.
2. `where` usa **GLN o el id de catálogo** de la unidad/cama (`serviceUnitId`, `bedId`), no el nombre libre de la unidad cuando ese nombre es, por sí mismo, revelador de una condición de salud por inferencia — "Unidad de Aislamiento TB", "Psiquiatría", "Morgue" son ejemplos donde el *nombre* de la ubicación equivale a filtrar una categoría especial de dato aunque no haya ningún campo de diagnóstico explícito en el evento. El nombre human-readable se resuelve en la capa de presentación, para la misma audiencia que ya tiene RBAC para ver el episodio — no se persiste enriquecido dentro del jsonb.
3. `what`/`why` no llevan texto libre. El motivo clínico del traslado (`EncounterTransfer.reason`) **ya existe y ya está gobernado** por el RBAC del expediente clínico — no se duplica dentro del evento EPCIS. Duplicarlo sería el error clásico de minimización: crear una segunda copia del mismo dato sensible con un régimen de acceso distinto (y probablemente más laxo) que el original.
4. El evento debe ser una **referencia liviana** (`encounterId`, `transferId`/`bedAssignmentId`) a las tablas operacionales ya gobernadas — no una copia enriquecida. Esto no es solo higiene de datos: reduce la superficie de fuga y evita que el jsonb "se congele" con un dato que después hay que reclasificar (ver §3.5, por qué esto importa para ARCO).

**Prohibición explícita:** ningún campo de texto libre en el payload EPCIS de paciente. Si @AS necesita capturar un motivo, que referencie el `id` de la fila fuente, nunca el string.

### 3.3 Retención

No hereda automáticamente el fundamento de 10 años "RTCA" que hoy justifica `gs1.epcis_event` para medicamentos (`docs/39_sla_retencion_datos.md` — Reglamento Técnico Centroamericano de medicamentos). Ese fundamento es específico de trazabilidad farmacéutica y **no aplica** a trazabilidad de personas.

**Recomendación:** el mismo plazo numérico (10 años), pero sobre un **fundamento distinto y correcto**: NTEC Art. 6 (retención del expediente clínico), porque la secuencia de traslados es parte de la narrativa asistencial del episodio (evidencia de continuidad de cuidado y, potencialmente, insumo de una investigación de control de infecciones o de un evento centinela JCI). Es decir: mismo número, justificación distinta, y — condición — limitado a que el evento sea la referencia liviana descrita en §3.2, no un archivo enriquecido con más contenido del que la obligación NTEC exige conservar.

Si en el futuro se propone un caso de uso operativo/BI (tiempos de espera, ocupación de camas, flujo de pacientes) — caso de uso legítimo y de valor — debe construirse sobre datos **agregados o anonimizados** (sin GSRN), con retención libre de la restricción de 10 años, y como pipeline **separado** del registro nominal. No mezclar analítica operativa con el registro de trazabilidad individual.

**Condición:** documentar esto en `docs/39_sla_retencion_datos.md` como categoría propia ("Trazabilidad de ubicación de paciente — GS1 EPCIS"), distinta de la fila "Trazabilidad GS1 EPCIS" actual (que es de medicamentos), con su propio fundamento.

### 3.4 Control de acceso

**Criterio:** la misma población que hoy puede acceder al episodio/expediente del paciente bajo RBAC/ABAC (CC-0017) — médico y enfermería asignados al servicio, administración clínica de la organización — vía RLS `organizationId` + `withTenantContext`. **No** crear un rol nuevo tipo "logística/operaciones GS1" con visibilidad de la trazabilidad de pacientes: a diferencia de la trazabilidad de medicamentos (donde farmacia y logística necesitan legítimamente ver el GTIN sin necesitar ver al paciente), aquí el dato *es* el paciente. No existe hoy en el catálogo de roles del proyecto un rol de "seguridad/vigilancia" con necesidad legítima de ver ubicación de pacientes — si en el futuro se propone uno, requiere una condición de acceso ABAC explícita y una justificación de necesidad de saber, no un acceso general.

**Break-glass:** sí aplica, reutilizando el mecanismo ya funcional de CC-0017 Fase 3 (elevación real de RLS + justificación clínica ≥20 caracteres + notificación al jefe de servicio + auditoría `BREAK_GLASS severity=HIGH`). No crear un mecanismo de emergencia paralelo para este caso — sería exactamente el tipo de fragmentación de controles que CC-0017 se creó para eliminar.

**Condición adicional:** consultar el **recorrido histórico completo** de un paciente (todos sus eventos de ubicación) es una operación de sensibilidad equivalente a exportar el expediente completo — debe auditarse como tal (evento propio, distinguible de la lectura incidental de "¿dónde está el paciente ahora mismo?" en un dashboard operativo de camas, que es una consulta de menor sensibilidad porque no reconstruye un patrón histórico).

### 3.5 ARCO vs. inmutabilidad — posición explícita

Esta es mi posición, sin rodeo:

1. **Lo que no cambia:** los documentos clínicos y el audit hash chain (`audit.audit_log`, SQL 05) siguen inmutables. Eso es correcto y no está en discusión — es obligación legal (NTEC) y cadena de custodia forense.

2. **Lo que sí debe ser diferente:** el nuevo stream de eventos de **ubicación** del paciente no es, en mi lectura, contenido estatutariamente exigido del expediente clínico *por sí mismo* — es una **proyección/índice derivado** de tablas que sí lo son (`Encounter`, `EncounterTransfer`, `BedAssignment`). El precedente correcto para tratarlo **no es ADR 0017** (que fue diseñado para producto/GTIN, con la garantía de inmutabilidad fuerte propia de trazabilidad regulatoria de medicamentos — recall en <30s, cadena de custodia farmacéutica). El precedente correcto es el que **el propio repo ya usa para ARCO**: `portal-arco.router.ts` resuelve una solicitud de `SUPRESION` marcándola `APROBADA` y dejando la **ejecución como proceso administrativo manual** (US.F2.7.8/US.F2.7.10) — no como un `DELETE` automático en cascada. Es decir: el sistema ya reconoce, en producción, que "cancelar" un dato de salud no significa "borrarlo físicamente sin control" — significa un flujo de adjudicación humana. Ese es el patrón a replicar aquí, no el trigger `RAISE EXCEPTION` de ADR 0017.

3. **Condición de diseño (no negociable):** este stream de eventos de paciente **no debe** participar en la cadena SHA-256 de `audit.audit_log` ni replicar el patrón de trigger `BEFORE UPDATE OR DELETE ... RAISE EXCEPTION`. Debe ser una tabla operacional normal, con un campo `status` (`COMMITTED`/`VOIDED`/`SUPPRESSED`) como cualquier otra tabla del sistema — capaz de purgarse o anonimizarse bajo un proceso administrativo controlado.

4. **Qué pasa cuando una `SUPRESION` ARCO es aprobada:** los registros fuente (`Encounter`, `EncounterTransfer`, `BedAssignment`) **no se tocan** — siguen protegidos por la retención legal del expediente, igual que hoy. Lo que sí se purga o anonimiza es **la capa EPCIS derivada** (el índice de trazabilidad), precisamente porque no es la fuente de verdad legal. Esto le da a Dirección una vía real y legítima para honrar una cancelación parcial sin violar NTEC Art. 6, y evita construir una segunda cadena inmutable que después nadie — ni siquiera Dirección con autorización — pueda corregir.

5. **Ruta alternativa, si @AS insiste en inmutabilidad fuerte** por razones técnicas legítimas (querybilidad, paridad con el patrón de recall de farmacia): entonces la condición pasa a ser que la `SUPRESION` se resuelva por **anonimización del identificador** (sustituir el GSRN dentro del jsonb por un token no reversible, y coordinar con la revocación en `GsrnHistory` si aplica) en lugar de borrado físico de filas — el equivalente al "bloqueo" que los marcos tipo RGPD usan cuando el titular pide cancelación sobre un dato con retención legal obligatoria. Cualquiera de las dos rutas es aceptable. **Lo que no es aceptable es diseñar el stream asumiendo que nunca habrá una solicitud de supresión legítima** — `SolicitudArco` ya existe, ya se usa (F2-S15 Stream C, PR mergeado), y una función de trazabilidad de ubicación de personas es, precisamente, el tipo de dato sobre el que un paciente puede querer ejercer oposición o cancelación con más razón que sobre su historia clínica misma.

Esto es lo más cerca que voy a llegar de "frenar" algo en este dictamen: no freno la funcionalidad, pero **sí pongo una condición de arquitectura que bloquea el merge** si no se cumple. Si @AS entrega un diseño que encadena estos eventos en el hash chain sin plan de anonimización, ese PR no cumple este dictamen y no debería mergearse sin volver a pasar por @AE.

### 3.6 Encaje normativo positivo

No es solo riesgo — hay valor de cumplimiento real y vale decirlo con la misma claridad:

- **JCI IPSG.1 ME1** (2 identificadores únicos): ya cumplido vía GSRN de pulsera (trigger SQL 111). El evento de ADMISIÓN que asigna/valida el GSRN puede ser el primer evento del stream, dando evidencia objetiva y consultable de *cuándo* se verificó identidad — el gap actual documentado en `docs/32_gap_jci_assessment.md` ("cumplido en infraestructura; depende de adopción operativa") se reduce, porque pasa de ser un hecho implícito en logs dispersos a un registro consultable con timestamp.
- **Trazabilidad epidemiológica intrahospitalaria / control de infecciones (IPC):** un registro estructurado y consultable de "qué paciente estuvo en qué unidad/cama y cuándo" es exactamente el insumo que un equipo de control de infecciones necesita para reconstruir contactos ante un brote (TB, *C. difficile*, aislamiento respiratorio). Hoy esa reconstrucción exige un JOIN manual sobre `EncounterTransfer`/`BedAssignment`; el overlay lo vuelve consultable en segundos — el mismo argumento de valor que ya sostiene ADR 0017 para recall de medicamentos, aplicado a contact tracing de pacientes.
- **JCI IPSG.2** (handoff estructurado — hoy con brecha ⚠️ documentada: "sin SBAR formal"): un evento objetivo de traslado con timestamp y actor es insumo (no sustituto) de un futuro flujo SBAR estructurado.
- **NTEC:** la secuencia de traslados ya es narrativa exigida hoy (`HOJA_ING` captura `circunstancia_ingreso=traslado`; `EPI_EGR` captura `circunstancia_alta=referido_otro_hospital` + documento RRI). El overlay EPCIS no crea una obligación nueva — hace auditable y consultable con menor esfuerzo una obligación que ya existe y que hoy vive dispersa en varias tablas.

**Conclusión de este punto:** el caso de negocio es sólido. El problema nunca fue "¿debemos hacerlo?" — es "¿lo hacemos con el patrón de inmutabilidad equivocado?".

---

## 4. Restricciones accionables (checklist de aceptación — @AS / @Dev)

1. **Alcance:** eventos discretos de ADT ya existentes (admisión, traslado de servicio/cama, alta) derivados de `Encounter`/`EncounterTransfer`/`BedAssignment`/`GsrnHistory`. **No** implementar RTLS ni tracking continuo/geolocalización en tiempo real — no hay hardware de localización en el proyecto y no hay base normativa evaluada para ese nivel de vigilancia. Si a futuro se propone RTLS real, requiere un dictamen nuevo — no es una extensión trivial de este.
2. Tabla propia para este stream (ej. `ece.gs1_epcis_patient_event` o equivalente) — **no mezclar** con `ece.gs1_epcis_event` (farmacia) ni con `audit.audit_log`.
3. **Sin** trigger de inmutabilidad hash-chain sobre este stream. Si @AS justifica inmutabilidad fuerte por razones técnicas, debe incluir mecanismo de anonimización de GSRN como ruta de cumplimiento ARCO (§3.5, punto 5).
4. Payload `who`/`where`/`what` limitado estrictamente a identificadores opacos (GSRN, GLN/`bedId`/`serviceUnitId`, `userId`). Cero texto libre, cero diagnóstico, cero nombre/documento. Enforced por schema Zod — recomiendo revisión de @AE o @DevSec antes de merge, no solo de @QA.
5. Acceso: mismas políticas RBAC/ABAC/RLS que ya protegen `Encounter` — sin rol nuevo. Break-glass reutiliza el mecanismo funcional de CC-0017 Fase 3, sin mecanismo paralelo.
6. Retención: 10 años (mismo plazo que el `Encounter` padre), fundamento NTEC Art. 6 — **no** el fundamento RTCA usado para medicamentos. Documentar como categoría propia en `docs/39_sla_retencion_datos.md`.
7. Transparencia: actualizar `CONSENT_TEMPLATES.SLV["data-processing"]` (y equivalentes GTM/HND si aplica) en `consent.router.ts` para mencionar explícitamente la trazabilidad de ubicación intramuros vía GSRN. Mismo PR que el código, no un follow-up.
8. Nombre human-readable de unidad/servicio se resuelve en presentación, no se persiste enriquecido en el jsonb cuando el nombre es, por sí mismo, revelador de una condición de salud (aislamiento, psiquiatría, morgue, etc.).
9. Consultar el recorrido histórico completo de un paciente por GSRN es una operación sensible — debe generar su propio evento de auditoría, diferenciado de la consulta operativa de "ubicación actual".
10. Corregir la cita "LOPD... Decreto 594" en `docs/39_sla_retencion_datos.md` → decreto correcto: **Decreto Legislativo N.° 144** (LPDP, 2024). Hallazgo secundario, no bloqueante — corregir en este PR o en uno de housekeeping aparte.
11. El PR que implemente este stream debe referenciar este documento (`docs/audit/2026-08-18_dictamen_ae_epcis_trazabilidad_paciente.md`) en su descripción y marcar cada restricción 1-10 como cumplida o no-aplica explícitamente. Sin eso, no cumple Definition of Done de @QA (CLAUDE.md — "review @QA" no cubre gobierno normativo; ese es rol de @AE).

---

## 5. Matriz de impacto

| Stakeholder | Impacto | Riesgo si se ignora este dictamen |
|---|---|---|
| Paciente | Nuevo tipo de dato personal generado sobre él sin acción propia (es pasivo, no opt-in). | Fuga de patrón de ubicación → inferencia de diagnóstico (ej. estuvo en psiquiatría/aislamiento). Imposibilidad práctica de ejercer cancelación si el stream queda hash-chained. |
| Dirección / Compliance | Nuevo dato sujeto a LPDP con autoridad de aplicación activa (ACE). | Sanción o hallazgo de auditoría si se trata como "más trazabilidad GS1" sin diferenciar régimen jurídico de persona vs. producto. |
| Equipo clínico (médico/enfermería) | Insumo nuevo, potencialmente útil para IPC y handoff — sin cambio de flujo de trabajo si se implementa como overlay silencioso. | Ninguno directo si se respeta §3.4 (mismo RBAC que ya tienen). |
| @AS / @Dev | Deben diseñar un stream EPCIS *distinto* del patrón ya aprendido en ADR 0017 — mayor esfuerzo de diseño que "copiar y pegar" el patrón de farmacia. | Si copian ADR 0017 tal cual, entregan una funcionalidad que no se puede deshacer ante una ARCO legítima — retrabajo mayor después del hecho. |
| @DBA | Nueva tabla, sin hash chain, con RLS estándar — bajo esfuerzo relativo. | — |
| @QA / @QAF | Debe agregar caso de prueba explícito: "solicitud SUPRESION aprobada → verificar que el stream de ubicación es purgable/anonimizable y que Encounter/EncounterTransfer permanecen intactos". | Gap de cobertura si no se agrega — el patrón de test de ADR 0017 (inmutabilidad) es el opuesto de lo que hay que probar aquí. |
| Auditoría JCI / re-acreditación futura | Refuerza evidencia de IPSG.1; aporta insumo a IPC. | Ninguno — punto a favor. |

---

## 6. Criterios de aceptación arquitectónica (para @AS, @AT, @DA)

- El diseño técnico de @AS debe declarar explícitamente, en su propio documento, cómo satisface cada una de las 11 restricciones de §4 — no basta con "cumple el dictamen de @AE" sin detalle.
- @AT (si hay impacto de infraestructura — colas, storage adicional): confirmar que no se introduce ningún componente que persista o cachee GSRN de paciente fuera del perímetro RLS existente (ej. nada de replicar el stream a un data warehouse sin anonimizar primero — eso es competencia de @DA/@BID si se plantea un caso de uso analítico, ver §3.3).
- @DA: si se propone un pipeline analítico (ocupación de camas, tiempos de traslado) a partir de este stream, debe alimentarse de una vista **agregada/anonimizada**, nunca del stream nominal directamente.
- @DBA: la tabla nueva sigue el patrón RLS estándar del proyecto (`organizationId` + `withTenantContext`), no el patrón de tabla global de catálogo.

---

## 7. Límites de este análisis

Repito, sin diluir, lo que puedo afirmar con certeza y lo que no:

- **Confirmé con búsqueda web** (no con el texto primario del decreto) que la Ley de Protección de Datos Personales de El Salvador es el Decreto Legislativo N.° 144 (2024), vigente, de inspiración RGPD, con derechos ARCO-POL y autoridad ACE. Esto contradice la cita "Decreto 594" que aparece hoy en el repo — lo marco como hallazgo, no como corrección silenciosa.
- **No leí** el articulado exacto de la LPDP (no tengo el texto del Diario Oficial). Mi lectura de "la prestación asistencial es base de licitud suficiente sin consentimiento específico nuevo" y de "hay una excepción de erasure para datos con retención legal obligatoria" es la interpretación razonable que sostienen los marcos GDPR-like en general y que la LPDP salvadoreña, por diseño declarado, sigue — pero no es una cita verbatim de un artículo que yo haya verificado línea por línea. Recomiendo confirmación de asesoría legal antes de go-live, específicamente sobre §3.5.
- **No verifiqué** el texto primario de NTEC Art. 6 ni del Código de Salud / Reglamento del Expediente Clínico en esta sesión — me apoyé en la consistencia con la que el repo ya los cita en trabajo previo aceptado.
- **Sí verifiqué directamente en el código** (no en documentación descriptiva): el modelo `Patient.gsrn`/`GsrnHistory`, el modelo `PatientConsent` y su enum de propósitos, las plantillas de consentimiento en `consent.router.ts`, el modelo `SolicitudArco` y el flujo de resolución manual en `portal-arco.router.ts`, el trigger SQL 111 (wristband JCI IPSG.1), el motor EPCIS de ADR 0017 y `epcis-builder.ts`, los modelos `EncounterTransfer`/`BedAssignment`, y que las tablas ADT (`EncounterTransfer`/`BedAssignment`) no aparecen hoy en `02_audit_triggers.sql` (es decir, ni siquiera la fuente de verdad ADT tiene hash chain hoy — lo cual refuerza que no hay razón para que la proyección EPCIS derivada sí lo tenga).
- No propuse número de CC (control de cambios) — eso corresponde a @Orq/@AS al formalizar el diseño; este documento es insumo de gate, no el registro de cambio en sí.
