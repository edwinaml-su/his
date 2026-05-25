# 31 — Flujos Operativos Consolidados (HIS Multipaís Avante)

> **Última actualización:** 2026-05-25 — sincronizado contra `ece.tipo_documento` en Supabase prod y contra implementación real en `packages/trpc/src/routers/ece/` + `apps/web/src/app/(clinical)/ece/`.
>
> **Fuente de verdad** para el motor de workflow data-driven (`ece.tipo_documento` + `ece.flujo_estado` + `ece.flujo_transicion`).
>
> Este documento es el **índice maestro** que el módulo `/admin/workflow-designer` lee para visualizar y permitir la edición de los flujos clínicos NTEC (Acuerdo MINSAL 1616/2024) implementados en el HIS.
>
> Cada flujo tiene su propia ficha en `docs/flujos/{CODIGO}.md` con: metadata, propósito normativo, dependencias, obligatoriedad por modalidad, roles firmantes, campos obligatorios, estados, transiciones, eventos de dominio, drift conocido y descripción rica markdown (esta última se siembra en `ece.tipo_documento.descripcion_markdown` y se renderiza en el workflow designer).
>
> **Resumen del estado:** 31 tipos sembrados en BD · 30 fichas MD · **27 documentos con implementación funcional completa** (router + UI + ficha) · **4 gaps** identificados ([CERT_INC](#gaps-de-implementaci%C3%B3n-verificado-2026-05-25), DOC_ASOC, DOC_OBST, ORD_ING).

---

## Enforcement y obligatoriedad

| Propiedad | Decisión |
|---|---|
| **Configurable por establecimiento** | Sí. Cada establecimiento puede activar/desactivar la obligatoriedad de un documento (overrides controlados por DIR y configurados en `ece.tipo_documento_establecimiento`). |
| **Editor de descripción rica** | WYSIWYG (TipTap/Lexical) en `/admin/workflow-designer/[codigo]/editar`. Persiste markdown en `ece.tipo_documento.descripcion_markdown`. |
| **Documentos médicos obligatorios** | El servidor (mutations tRPC) valida `depende_de` antes de crear `documento_instancia`. Si la dependencia no está firmada, falla con `PRECONDITION_FAILED`. |

---

## Índice por modalidad

### Ambulatorio

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [FICHA_IDENT](flujos/FICHA_IDENT.md) | Ficha de Identificación de Paciente | Art. 15 | Siempre (al registro) | No (historizado) |
| [HC_AMB](flujos/HC_AMB.md) | Historia Clínica Ambulatoria | Arts. 15/19/23 | Primera vez | Sí |
| [NEV](flujos/NEV.md) | Nota de Evolución | Art. 19 | Subsecuente con misma HC | Sí |
| [SOL_EST](flujos/SOL_EST.md) | Solicitud de Estudios | Art. 42 | Cuando se solicita lab/imagen | Sí |
| [RES_EST](flujos/RES_EST.md) | Resultado de Estudios | Art. 42 | Al validar resultado | Sí |
| [CONS_INF](flujos/CONS_INF.md) | Consentimiento Informado Médico | Arts. 39/40 | Procedimiento mayor / decisión sensible | Sí |

### Emergencia

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [TRIAJE](flujos/TRIAJE.md) | Hoja de Triaje Manchester | TDR §9 | Triaje formal | Sí |
| [ATN_EMERG](flujos/ATN_EMERG.md) | Atención de Emergencia | Art. 35 | Siempre en urgencia | Sí |
| [SV](flujos/SV.md) | Signos Vitales (1ª toma) | — | Siempre | Cada toma inmutable |

### Hospitalización

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [HOJA_ING](flujos/HOJA_ING.md) | Hoja de Ingreso Hospitalario | Art. 34 | Siempre al admitir | Sí |
| [VAL_INI_ENF](flujos/VAL_INI_ENF.md) | Valoración Inicial de Enfermería | Art. 37 | ≤24h post-admisión | Sí |
| [IND_MED](flujos/IND_MED.md) | Indicaciones Médicas | Art. 36 | Diaria | Sí (cada cierre diario) |
| [REG_ENF](flujos/REG_ENF.md) | Registros de Enfermería | Art. 37 | Por turno | Sí (cada turno) |
| [SV](flujos/SV.md) | Signos Vitales | — | Según frecuencia IND_MED | Cada toma inmutable |
| [RRI_HOS](flujos/RRI_HOS.md) | Resumen / Referencia / Interconsulta | Art. 38 | Transferencia o IC | Sí |
| [EPI_EGR](flujos/EPI_EGR.md) | Epicrisis de Egreso | Arts. 21/41/42 | Siempre al cierre | Sí |
| [CERT_DIR](flujos/CERT_DIR.md) | Certificación del Director Médico | Art. 21 | Defunción / Centinela / Quejas | Sí |

### Quirúrgico

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [PROG_QX](flujos/PROG_QX.md) | Programación Quirúrgica | — | Cirugía electiva | Sí (post-confirmación) |
| [CONS_QX](flujos/CONS_QX.md) | Consentimiento Quirúrgico | Arts. 39/40 | Toda cirugía | Sí |
| [PREOP](flujos/PREOP.md) | Valoración Preoperatoria | Art. 28 | Pre-quirúrgico electivo | Sí |
| [WHO_CHECK](flujos/WHO_CHECK.md) | WHO Surgical Safety Checklist | TDR §13.3 | Toda cirugía | Sí (3 pausas) |
| [ACT_QX](flujos/ACT_QX.md) | Acta Quirúrgica | Arts. 19/23/40/42 | Toda cirugía completada | Sí |
| [REG_ANEST](flujos/REG_ANEST.md) | Registro Anestésico | TDR §13.4 | Cirugía con anestesia | Sí |
| [URPA](flujos/URPA.md) | Recuperación Post-Anestésica | TDR §13.5 | Post-anestesia gen/regional | Sí |

### Obstetricia / Neonatología

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [PARTOGRAMA](flujos/PARTOGRAMA.md) | Partograma OMS | — | Trabajo de parto activo | Sí (registros seriados) |
| [SALA_EXP](flujos/SALA_EXP.md) | Sala de Expulsión | — | Parto vaginal | Sí |
| [ATN_RN](flujos/ATN_RN.md) | Atención del Recién Nacido | — | Todo nacido vivo | Sí |
| [NRP](flujos/NRP.md) | Reanimación Neonatal | — | Apgar <7 a 1' o decisión clínica | Sí |

### Cierre / Transversal

| Código | Documento | NTEC | Obligatoriedad | Inmutable post-firma |
|---|---|---|---|---|
| [CERT_DEF](flujos/CERT_DEF.md) | Certificado de Defunción | — | Toda defunción | Sí (rectificable vía RECT) |
| [RECT](flujos/RECT.md) | Rectificación de Documento Firmado | Art. 42 | Error material en firmado | Sí (transversal) |
| [BIT](flujos/BIT.md) | Bitácora Clínica ECE | Arts. 45–52 | Automático (sistema) | Sí (cadena SHA-256) |

---

## Grafo de dependencias (resumen)

```
FICHA_IDENT (raíz, único por paciente)
   ├── HC_AMB ──┬──── NEV (subsecuente)
   │           └──── SOL_EST ──── RES_EST
   │
   ├── ATN_EMERG ────┬──── TRIAJE (opcional precedente)
   │                ├──── SV (1ª toma)
   │                └──── HOJA_ING (si admite) | CERT_DEF (si fallece) | RRI_HOS (si refiere)
   │
   ├── HOJA_ING ──┬──── VAL_INI_ENF (≤24h)
   │             ├──── IND_MED ──── BCMA 5R (MedicationAdministration)
   │             ├──── REG_ENF (por turno)
   │             ├──── SV (según frecuencia)
   │             ├──── RRI_HOS (si interconsulta o traslado)
   │             ├──── EPI_EGR (al cierre) ──── CERT_DIR (post-egreso si aplica)
   │             └──── CERT_DEF (si defunción intra-hospitalaria) ──── CERT_DIR
   │
   ├── PROG_QX ──┬──── CONS_QX (firma pre-fecha)
   │            ├──── PREOP (firma anestesiólogo pre-fecha)
   │            └──── WHO_CHECK ──── ACT_QX ──── REG_ANEST ──── URPA
   │
   ├── HOJA_ING obstétrica ──┬──── PARTOGRAMA
   │                        ├──── SALA_EXP ──── ATN_RN (todo RN vivo)
   │                        │                  └──── NRP (si Apgar <7)
   │                        └──── ACT_QX (si cesárea)
   │
   └── RECT (transversal: rectifica cualquier documento firmado)

BIT (transversal AUTOMATICO sobre todas las operaciones — cadena SHA-256)
```

---

## Modalidades

| Modalidad | Documentos típicos |
|---|---|
| **AMBULATORIO** | FICHA_IDENT, HC_AMB, NEV, SOL_EST, RES_EST, CONS_INF (si procede) |
| **EMERGENCIA** | FICHA_IDENT, TRIAJE, SV, ATN_EMERG, → HOJA_ING / RRI / CERT_DEF |
| **HOSPITALIZACION** | HOJA_ING, VAL_INI_ENF, IND_MED diarias, REG_ENF por turno, SV, → EPI_EGR + CERT_DIR / CERT_DEF |
| **QUIRURGICO** | PROG_QX, CONS_QX, PREOP, WHO_CHECK, ACT_QX, REG_ANEST, URPA |
| **OBSTETRICO** | HOJA_ING, PARTOGRAMA, SALA_EXP (parto) ó ACT_QX (cesárea), ATN_RN, NRP si aplica |
| **TRANSVERSAL** | RECT (rectificación), BIT (bitácora), CERT_DIR (certificación administrativa) |

---

## Roles del catálogo `ece.rol`

| Código | Rol | Documentos firma |
|---|---|---|
| MEDICO_GENERAL / MEDICO_TRATANTE | Médico tratante | HC_AMB, NEV, HOJA_ING, IND_MED, RRI_HOS, EPI_EGR, ATN_EMERG, CERT_DEF |
| MEDICO_CIRUJANO | Cirujano | CONS_QX, ACT_QX (gen+PROG_QX) |
| ANESTESIOLOGO | Anestesiólogo | PREOP, REG_ANEST, validación URPA, anexo CONS_QX |
| MEDICO_URGENCIAS | Médico de urgencias | ATN_EMERG, CERT_DEF (urgencia) |
| GINECO_OBSTETRA | Gineco-obstetra | PARTOGRAMA, SALA_EXP, ACT_QX (cesárea) |
| PEDIATRA / NEONATOLOGO | Pediatra/Neonatólogo | ATN_RN, NRP |
| ENFERMERIA / NURSE | Enfermería | VAL_INI_ENF, REG_ENF, SV (registro), TRIAJE, URPA registro |
| ENFERMERIA_TRIAGE | Triaje | TRIAJE |
| ENFERMERIA_NEONATAL | Neonatal | ATN_RN asistencia, NRP asistencia |
| ENFERMERIA_URPA | URPA | URPA registro + Aldrete |
| ENFERMERIA_OBSTETRICIA | Obstetricia | SALA_EXP asistencia, PARTOGRAMA registro |
| COORD_QX | Coordinación Quirúrgica | PROG_QX |
| ADMISIONISTA / ARCH | Admisión / Archivo | FICHA_IDENT captura, HOJA_ING (apertura formal) |
| DIRECTOR_MEDICO (DIR) | Director Médico | CERT_DIR, validación RECT impacto medio/alto, anulación universal |
| LAB_TEC / RAD / PAT | Técnicos | RES_EST (registro) |
| (Sistema) | Sistema | BIT (automático) |

---

## Convenciones del workflow-designer

1. **Encabezado del flujo** se renderiza desde el bloque `## Metadata` de cada `docs/flujos/{CODIGO}.md`.
2. **Grafo de dependencias** se construye desde `depende_de` en `ece.tipo_documento` (sembrado a partir de la sección `## Dependencias` del archivo).
3. **Editor markdown WYSIWYG** carga `descripcion_markdown` (sembrado desde `## Descripción markdown rica`) y persiste con preview en vivo.
4. **Estados y transiciones** se sincronizan con `ece.flujo_estado` + `ece.flujo_transicion` (sembrados desde `## Estados` y `## Transiciones`).
5. **Eventos de dominio** documentados en `## Eventos de dominio` deben emitirse desde routers tRPC vía `emitDomainEvent` (outbox pattern); enforcement por test de contrato.
6. **Drift conocido** alimenta el dashboard de "Hallazgos abiertos" del workflow-designer (importado de `docs/audit/2026-05-19_audit_stream_*.md`).

---

## Estado de implementación

| Fase | Descripción | Estado | PR |
|---|---|---|---|
| **Phase 1** | Documentación NTEC consolidada (30 fichas) | ✅ Completada 2026-05-22 | [#211](https://github.com/edwinaml-su/his/pull/211) |
| **Phase 2** | Seed `ece.tipo_documento` (31 tipos) + `flujo_estado` (152) + `flujo_transicion` (120) + `descripcion_markdown` (31/31) | ✅ Completada 2026-05-22 | [#212](https://github.com/edwinaml-su/his/pull/212) |
| **Phase 3** | UI extensions: grafo `depende_de` (ReactFlow) + WYSIWYG TipTap en workflow-designer | ✅ Completada 2026-05-22 | [#213](https://github.com/edwinaml-su/his/pull/213) |
| **Phase 4** | Server enforcement: `fn_assert_dependencias_firmadas` (trigger BEFORE INSERT) + helper TS `assertDependenciasFirmadas()` | ✅ Completada 2026-05-22 | [#214](https://github.com/edwinaml-su/his/pull/214) |
| **Phase 5** | UI wizard "próximos documentos" integrado en `/ece/episodio-hospitalario/[id]` | ✅ Completada 2026-05-22 | [#215](https://github.com/edwinaml-su/his/pull/215) |
| **Phase 6** | Overrides por establecimiento (`ece.tipo_documento_establecimiento`) + UI DIR | ✅ Completada 2026-05-22 | [#216](https://github.com/edwinaml-su/his/pull/216) |

---

## Mapeo de códigos MD ↔ BD

El índice de fichas usa nombres "didácticos" del documento NTEC. En BD (`ece.tipo_documento.codigo`) se usan abreviaturas técnicas. Mapping vigente:

| Código en ficha MD | Código real en BD | Razón |
|---|---|---|
| `FICHA_IDENT` | `FICHA_ID` | Abreviatura técnica |
| `HC_AMB` | `HIST_CLIN` | BD usa el genérico (ambulatorio y hospitalario comparten estructura) |
| `NEV` | `EVOL_MED` | BD unifica nota de evolución y evolución médica |
| `EPI_EGR` | `EPICRISIS` | BD usa el término clínico canónico |
| `PREOP` | `PREOP_CHECK` | BD enfatiza que es checklist |
| `SV` | `SIG_VIT` | Abreviatura técnica |
| `RRI_HOS` | `RRI` | BD generaliza (no solo hospitalización) |
| `SALA_EXP` | `SALA_EXPULSION` | BD nombre completo |
| `WHO_CHECK` | `WHO_CHK` | Abreviatura técnica |
| `ACT_QX` | `ACTO_QX` | BD nombre completo |

> El workflow-designer en `/admin/workflow-designer` muestra el **código BD**. Las fichas MD conservan su slug original para no romper enlaces — pero el sembrado vincula ambos vía `descripcion_markdown`.

---

## Gaps de implementación (verificado 2026-05-25)

Códigos sembrados en BD que **NO tienen router tRPC dedicado, ni UI propia, ni ficha MD**. Son documentos NTEC presentes en el catálogo pero pendientes de implementación funcional:

| Código BD | Documento | Modalidad | Estado actual | Pendiente |
|---|---|---|---|---|
| **`CERT_INC`** ⚠ | Certificado de Incapacidad ISSS | ambos | Solo schema + seed BD | Router + UI + ficha MD — específico SLV (ISSS); ver TDR §17 |
| **`DOC_ASOC`** ⚠ | Documentos Clínicos Asociados (adjuntos genéricos) | ambos | Solo schema + seed BD | Router + UI uploader + ficha MD |
| **`DOC_OBST`** ⚠ | Documentos Obstétricos (wrapper genérico) | hospitalario | Solo schema + seed BD; los específicos PARTOGRAMA/SALA_EXP/ATN_RN/NRP **sí** están implementados | Decidir si retirar el wrapper o convertirlo en agregador |
| **`ORD_ING`** ⚠ | Orden de Ingreso | hospitalario | Cubierto operacionalmente por `HOJA_ING` (router + UI); BD lo conserva como tipo aparte | Decidir si retirar el tipo BD o crear flujo separado (orden médica → admisión administrativa) |

**Códigos en ficha MD pero sin tipo BD propio** (transversales o acciones, no documentos firmables independientes):
- `CERT_DIR` — implementado vía `certificacion.router.ts` como acción sobre EPI_EGR / CERT_DEF.
- `BIT` — automático del sistema (cadena SHA-256), no genera `documento_instancia`.
- `RECT` — transversal, implementado vía `ece-rectificacion.router.ts` sobre cualquier documento firmado.

### Plan recomendado

1. **CERT_INC** — sprint dedicado JCI/SLV (alto valor para acreditación ISSS). Estimado: 8 SP (schema ya está, falta router + UI + ficha).
2. **DOC_ASOC** — sprint UX corto (uploader + metadata mínima). Estimado: 5 SP.
3. **DOC_OBST + ORD_ING** — decisión arquitectónica antes de implementar:
   - Opción A: retirar del catálogo BD vía migración (los flujos reales ya están cubiertos).
   - Opción B: convertir en agregadores que renderizan documentos hijos.
   - Pendiente de RFC con @AS / @PO.

---

## Drift transversal acumulado (audit Streams A–J)

Los hallazgos críticos (P0/P1) de las auditorías 2026-05-19 documentados por flujo:

- **Stream A** (paciente/admisión/triaje): H1-01..H1-08 — ver [FICHA_IDENT.md](flujos/FICHA_IDENT.md), [TRIAJE.md](flujos/TRIAJE.md)
- **Stream B** (HC ambulatorio): HC-001/002 — ver [HC_AMB.md](flujos/HC_AMB.md), [NEV.md](flujos/NEV.md), [IND_MED.md](flujos/IND_MED.md)
- **Stream C** (defunción): B-01..B-08 — ver [CERT_DEF.md](flujos/CERT_DEF.md)
- **Stream D** (hospitalización): HD-01..HD-27 — ver [HOJA_ING.md](flujos/HOJA_ING.md), [VAL_INI_ENF.md](flujos/VAL_INI_ENF.md), [REG_ENF.md](flujos/REG_ENF.md), [RRI_HOS.md](flujos/RRI_HOS.md)
- **Stream E** (cirugía): HE-01..HE-18 — ver [PROG_QX.md](flujos/PROG_QX.md), [CONS_QX.md](flujos/CONS_QX.md), [PREOP.md](flujos/PREOP.md), [WHO_CHECK.md](flujos/WHO_CHECK.md), [ACT_QX.md](flujos/ACT_QX.md)
- **Stream F** (obstetricia/neonatal): HF-05..HF-31 — ver [PARTOGRAMA.md](flujos/PARTOGRAMA.md), [SALA_EXP.md](flujos/SALA_EXP.md), [ATN_RN.md](flujos/ATN_RN.md), [NRP.md](flujos/NRP.md)
- **Stream G** (bitácora/seguridad): HG-01..HG-04 — ver [BIT.md](flujos/BIT.md)
- **Stream H** (diagnósticos): HH-01..HH-17 — ver [SOL_EST.md](flujos/SOL_EST.md), [RES_EST.md](flujos/RES_EST.md)
- **Stream I** (GS1/BCMA): integrado en [IND_MED.md](flujos/IND_MED.md)
- **Stream J** (auth/MFA/PIN): HJ-04..HJ-31 — transversal, afecta firma electrónica en TODO documento que firma con PIN

---

## Referencias

- TDR HIS Multipaís Avante (`TDR_HIS_Multipais.md`)
- Acuerdo MINSAL 1616/2024 (NTEC) — referido en cada ficha
- `docs/backlog/fase2/_insumos/analisis_workflows_ece.md` — análisis arquitectónico previo
- `packages/database/sql/05_motor_workflow.sql` — DDL motor workflow ECE
- `packages/database/sql/63_ece_08_seed.sql` — seed inicial documentos
- `packages/database/sql/08_seed_workflows.sql` — seed transiciones y estados
- `apps/web/src/app/(admin)/workflow-designer/` — UI workflow designer
- `packages/trpc/src/routers/workflow-*.router.ts` — 10 routers del motor
