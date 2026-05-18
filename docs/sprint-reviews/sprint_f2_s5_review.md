# Sprint Review — Fase 2 Sprint 5 (F2-S5)

**Proyecto:** HIS Multipaís — Inversiones Avante
**Fecha:** 2026-05-17
**Autores:** @QA (métricas de calidad + evidencia de testing), @PO (logros + valor), @Orq (consolidación)
**Sprint:** F2-S5 — ECE Hospitalario: cierre quirúrgico + obstétrico + recién nacido + consolidación regla
**Rama base:** `feat/fase2-s1-gate` (último commit verificado: `6532a92`)

---

## 1. Resumen ejecutivo

El Sprint F2-S5 cierra la ruta quirúrgica completa (preop → sala → URPA) y la ruta obstétrica
(partograma → sala de expulsión → atención del recién nacido + reanimación neonatal), completando
así el núcleo clínico del ECE Hospitalario de HIS Avante. Los ~22 streams ejecutados (lote inicial
22 + relaunches lotes 1 y 2 por rate-limit) entregaron:

- **Ruta Quirúrgica cierre (US.F2.4.11–16):** preop_checklist (WHO 3 fases), nota preoperatoria
  completa, registro anestésico transanestésico, descripción operatoria, nota de URPA / recuperación.
  Nuevas tablas: `ece.preop_checklist`, `ece.who_checklist`, `ece.registro_anestesico`,
  `ece.urpa_recovery`.
- **Ruta Obstétrica (US.F2.4.18–21):** partograma con series temporales (dilatación, descenso,
  FUR, latidos fetales), hoja de sala de expulsión con eventos, atención del recién nacido
  (APGAR, somatometría, CRED inicial, generación CUN/NUI). Nuevas tablas:
  `ece.partograma_registro`, `ece.sala_expulsion_eventos`, `ece.atencion_recien_nacido`,
  `ece.reanimacion_neonatal`.
- **~12 routers nuevos** cubriendo los procedimientos de ambas rutas especializadas.
- **Consolidación regla "adecuar legacy":** se aplicó el patrón de refactor mínimo sobre
  los routers de F2-S3/S4 que carecían de `withTenantContext` explícito, sin reescribir
  lógica existente.
- **GS1 deuda parcial (PR #105):** procesos A+D completados; carry-over de procesos B, C, F,
  EPCIS query y alertas de inventario a F2-S6.

---

## 2. Logros por stream (resumen)

| Stream | Descripcion | Entregable principal | Estado |
|--------|-------------|---------------------|--------|
| QX-01 | Nota Preoperatoria + Valoración Anestésica | `notaPreoperatoriaRouter`, tabla `ece.preop_checklist` | Listo |
| QX-02 | Consentimiento Quirúrgico/Anestésico | `consentimientoQxRouter`, bloqueo pre-sala | Listo |
| QX-03 | WHO Checklist Cirugía Segura (3 fases) | `whoChecklistRouter`, tabla `ece.who_checklist`, firma por fase | Listo |
| QX-04 | Nota / Descripción Operatoria | `descripcionOperatoriaRouter`, UI con campos NTEC | Listo |
| QX-05 | Registro Anestésico Transanestésico | `registroAnestesicoRouter`, tabla `ece.registro_anestesico`, series por minuto | Listo |
| QX-06 | Hoja de Recuperación URPA | `urpaRecoveryRouter`, tabla `ece.urpa_recovery`, Aldrete score | Listo |
| OB-01 | Partograma (series temporales) | `partogramaRouter`, tabla `ece.partograma_registro`, endpoint append-only | Listo |
| OB-02 | Hoja de Labor de Parto | `laborPartoRouter`, sub-documentos hoja_labor | Listo |
| OB-03 | Hoja de Sala de Expulsión | `salaExpulsionRouter`, tabla `ece.sala_expulsion_eventos`, múltiples partos | Listo |
| OB-04 | Atención del Recién Nacido | `atencionRNRouter`, tabla `ece.atencion_recien_nacido`, genera CUN/NUI | Listo |
| OB-05 | Reanimación Neonatal | `reanimacionNeonatalRouter`, tabla `ece.reanimacion_neonatal`, condicional | Listo |
| CONS-01 | Consolidación regla "adecuar legacy" | Refactor mínimo RLS en routers F2-S3/S4 sin `withTenantContext` | Listo |
| GS1-P | GS1 Deuda parcial (procesos A+D) | Procesos A y D completos en PR #105 | Listo |
| DOC | ADR 0015 | `docs/adr/0015-ece-rutas-clinicas-criticas.md` — tablas separadas vs `document_data jsonb` | Listo |

---

## 3. Metricas

| Metrica | Valor |
|---------|-------|
| Story Points entregados (estimado) | ~95 SP |
| PRs mergeados | Multiples (#104 F2-S5 principal + #105 GS1/Deuda + relaunches lotes 1-2) |
| Tablas nuevas en schema ECE | 8 (`preop_checklist`, `who_checklist`, `registro_anestesico`, `urpa_recovery`, `partograma_registro`, `sala_expulsion_eventos`, `atencion_recien_nacido`, `reanimacion_neonatal`) |
| Routers tRPC nuevos | ~12 |
| US.F2.4 quirúrgicas cubiertas | US.F2.4.11–16 (6 historias) |
| US.F2.4 obstétricas cubiertas | US.F2.4.18–21 (4 historias) |
| ADRs nuevos | 1 (0015) |
| Rate-limit detectado (evento) | 1 (lote 1 → relaunch lote 2) |
| Cobertura unit routers nuevos | >= 80 % (threshold CI) |
| Advisor security CRITICAL al cierre | 0 (target) |

### 3.1 Rutas criticas cubiertas al cierre F2-S5

| Ruta | Documentos cubiertos | Documentos pendientes en F2-S6 |
|------|---------------------|-------------------------------|
| General (estancia) | US.F2.4.1–10, 22–25 | US.F2.4.26 (census auto), 27–29 |
| Quirúrgica | US.F2.4.11–16 | US.F2.4.17 (UCI/UCIN) |
| Obstétrica | US.F2.4.18–21 | — |
| GS1/Logística | Procesos A+D | Procesos B, C, F; EPCIS query; alertas inventario |

### 3.2 Patron series temporales — partograma

La tabla `ece.partograma_registro` usa un diseño append-only (nunca UPDATE de filas,
solo INSERT de nuevas mediciones con timestamp). El router `partogramaRouter.registrarMedicion`
es idempotente por `(episodio_id, timestamp_utc)` — insercion duplicada retorna el
registro existente sin error. Este patrón se documenta en el ADR 0015 como precedente
para otros documentos de series temporales (registro anestésico, signos vitales turno).

---

## 4. Retroactiva

### 4.1 Que funciono

1. **Paralelizacion masiva de ~22 streams.** El contrato de tipos entre streams (interfaces
   TypeScript exportadas desde `@his/contracts` antes de implementar routers) permitio que
   los streams OB-04 y QX-06 avanzaran sin esperar a OB-01 o QX-03. La estrategia "definir
   contrato primero, implementar despues" se consolida como practica del proyecto.

2. **Rate-limit detectado y manejado sin perdida de trabajo.** Cuando el lote 1 alcanzó
   el rate-limit del proveedor de IA, el estado intermedio estaba en commits parciales.
   El relaunch del lote 2 retomó desde el último commit válido sin reescribir trabajo ya
   mergeado. Leccion: los lotes de >15 streams deben dividirse preventivamente en sub-lotes
   de 10-12 para no depender del relaunch.

3. **Consolidacion robusta con regla "adecuar legacy".** Aplicar `withTenantContext` en
   los routers heredados de F2-S3/S4 que lo omitían se hizo como refactor quirúrgico
   (solo agregar el wrapper, no tocar la lógica). La regla "toca solo lo que pide el
   ticket" (careful-coding §3) evitó regressions por over-refactor.

4. **Regla "adecuar legacy" aplicada sistematicamente.** El patrón se formalizó en este
   sprint: si un router existente no usa `withTenantContext` y el PR toca ese archivo,
   el ajuste es obligatorio pero mínimo (solo wrapper, no refactor adicional). Se registra
   en CLAUDE.md como precedente.

### 4.2 Que mejorar

1. **Sub-lotes preventivos para >15 streams.** El rate-limit del lote 1 pudo evitarse
   dividiendo los 22 streams en 2 sub-lotes de 11 desde el inicio. Accion F2-S6:
   cualquier sprint con >12 streams paralelos se divide en sub-lotes antes del kick-off.

2. **WHO Checklist requiere firmantes multiples (QX-03).** La implementacion actual
   registra un solo `registrado_por`. El checklist OMS requiere firma de cirujano,
   anestesiólogo y enfermera circulante por separado. Accion F2-S6: refactor de
   `ece.who_checklist` con array de firmantes o tabla de firmas relacionada.

3. **CUN/NUI generacion sin integracion con RNPN.** El router `atencionRNRouter` genera
   un CUN interno. La integracion con el Registro Nacional de Personas Naturales (RNPN)
   para NUI real es fuera de scope F2-S5. Registrado como deuda tecnica en ADR 0015
   consecuencias negativas.

4. **GS1 procesos B/C/F quedan como carry-over.** La deuda GS1 parcial (PR #105) cubre
   solo A+D. Los procesos B (recepcion), C (dispensacion), F (gestion devolucion) mas
   EPCIS query y alertas de inventario son criticos para el gate F2-S6 GS1.

---

## 5. Carry-over F2-S6

| Item | Tipo | Razon | Prioridad |
|------|------|-------|-----------|
| GS1 Procesos B/C/F + EPCIS query + alertas inventario | Feature | Fuera de scope F2-S5; gate GS1 pendiente | Alta |
| WHO Checklist firmantes multiples (QX-03 refactor) | Deuda tecnica | Implementacion actual solo 1 firmante vs 3 requeridos OMS | Alta |
| CUN/NUI integracion RNPN | Feature | Generacion interna; RNPN fuera de scope | Media |
| US.F2.4.17 Notas UCI/UCIN | Feature | Fuera de scope F2-S5 | Media |
| US.F2.4.26 Censo automatico liberacion cama | Feature | Lleva de F2-S4; no resuelto en F2-S5 | Media |
| US.F2.4.27–29 Codificacion CIE-10 egreso + Foliado + Certificacion | Feature | Post-epicrisis; prerrequisito F2-S4 OK | Media |
| E2E cross-stream integrado quirurgico | Testing | Spec de F2-S4 usa seed, no flujo completo | Media |
| Sub-lotes <=12 streams (proceso) | Proceso | Accion preventiva rate-limit | Baja |

---

## 6. Proximos hitos

| Hito | ETA | Criterios |
|------|-----|-----------|
| Gate GS1 completo | F2-S6 inicio | Procesos B/C/F + EPCIS + alertas mergeados + E2E GS1 verde |
| WHO Checklist multi-firma | F2-S6 | Refactor `ece.who_checklist` + tests actualizados |
| E2E quirurgico cross-stream | F2-S6 | Spec bridge → preop → sala → URPA → egreso con datos reales |
| US.F2.4.26–29 cierre | F2-S6 | Codificacion CIE-10 + foliado + certificacion mergeados |
| Gate F2-S5 | F2-S6 inicio | ADR 0015 mergeado + 8 tablas nuevas aplicadas Supabase + CI verde |

---

## 7. Firmas

- [x] **@QA** — métricas de cobertura, tablas nuevas documentadas, carry-over trazado — 2026-05-17.
- [ ] **@PO** — pendiente validación criterios de aceptación US.F2.4.11–16, 18–21.
- [ ] **@Orq** — pendiente consolidación en reporte ejecutivo Fase 2.
