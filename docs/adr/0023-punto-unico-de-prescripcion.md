# ADR 0023 — Punto único de prescripción de medicamentos (R06)

- **Estado:** Propuesto — requiere decisión de Edwin (dirección) antes de ejecutar
- **Fecha:** 2026-09-09
- **Decisores:** @Orq/@AS (proponentes), @DrHIS (evaluación clínica base), pendiente Edwin
- **Insumos:** `docs/qa/drhis/R06-evaluacion-datos-farmacologicos.md` (6 hallazgos, 2 críticos),
  assessment Code Castle R06, CC-0026 (`ece.indicacion_item.drug_id`, SQL 211),
  PR #588 (Prescription actúa como pharmacy order en dispensación)

## Contexto (verificado por @DrHIS contra prod, 2026-08-22)

Hay **dos módulos de prescripción que no se hablan**:

1. **Indicaciones médicas NTEC** (`ece.indicacion_item`) — el flujo que el hospital USA.
   Desde CC-0026 tiene `drug_id` estructurado en el punto de captura, pero **ningún
   chequeo de interacciones se ejecuta al firmar**.
2. **Farmacia** (`pharmacy.prescription`) — tiene el hard-stop de interacciones bien
   implementado en `prescription.sign`… que **ninguna pantalla llama** (H-02). `Prescription`
   = 0 filas en prod. La dispensación (#588) navega con ids de `Prescription`.

Conclusión de @DrHIS: la decisión previa a licenciar cualquier fuente farmacológica es
**cuál es la única ruta de prescripción**. Un motor de interacciones cableado a la ruta
equivocada protege a nadie (H-01) y genera falsa seguridad (H-03).

## Opciones

### A (recomendada) — La indicación médica NTEC es el punto único
- `firmar()` de indicaciones (tipo MEDICAMENTO) ejecuta el pipeline de seguridad:
  `detectInteractionAlerts` (por `drug_id`→ATC) + alerta renal Cockcroft-Gault
  (`formula/engine.ts`, hoy huérfano — H-04) como advertencia no bloqueante inicial;
  hard-stop `major/contraindicated` con override de segunda firma (patrón 2-eyes de
  `RX_CONTROLLED`, cierra H-06).
- Al firmar una indicación de MEDICAMENTO se **genera la `Prescription` automáticamente**
  (estado SIGNED) — farmacia/dispensación/BCMA siguen funcionando sin doble captura y
  sin re-cablear #588.
- `/pharmacy/new` (crear receta manual) se retira o queda solo para recetas ambulatorias
  de salida, decisión operativa posterior.
- **Costo:** medio (pipeline en `firmar()` + generación de Prescription + UI de alerta).
  **Riesgo:** bajo — extiende el flujo en uso; regla "adecuar legacy, no duplicar".

### B — Farmacia es el punto único
- Cablear `prescription.sign` a la UI y obligar a que toda orden de medicamento pase por
  `/pharmacy/new`. **Contra:** abandona el flujo NTEC real (la enfermería administra desde
  `indicacion_item`), duplica captura, contradice CC-0026 recién entregado. Descartada
  salvo objeción.

### C — Mantener ambos y sincronizar
- Perpetúa el defecto estructural que R06 señala (dos rutas). Descartada.

## Recomendación

**Opción A.** Secuencia propuesta al aprobarse:
1. Pipeline de seguridad en `firmar()` (interacciones + renal advisory) — no requiere
   licencia: usa el dataset Wave 1 YA cargado, ampliable después.
2. Generación automática de `Prescription` desde la indicación firmada.
3. Ampliar dataset con los 12 fármacos ISMP sin reglas (H-03) — carga de datos, no licencia.
4. Poblar `CatalogoMedicamento` desde SRS + tarifario Odoo (H-05) antes de evaluar
   licenciar una fuente comercial.

## Qué se necesita de Edwin

- [ ] Aprobar Opción A (o pedir ajustes).
- [ ] Confirmar si `/pharmacy/new` queda para recetas ambulatorias de salida o se retira.

Sin esta decisión no se ejecuta nada de R06 (acordado en la jornada Code Castle 2026-08-24).

## Addendum 2026-09-09 — BCMA bedside también está bloqueado por esta decisión

La resurrección del E2E `bedside-hard-stops` reveló que el circuito BCMA
(`bedside.validate5Correct` → `bedside.administration.record`) **nunca pudo
terminar en éxito** para una indicación nativa ECE: `record` resolvía el
`PrescriptionItem` consultando una columna que jamás existió
(`ece.indicaciones_medicas.prescription_item_id`, 42703 siempre). Eso sube la
urgencia de este ADR: sin ruta de prescripción resuelta, la enfermería no puede
registrar administraciones bedside — P0 para Go-Live del circuito BCMA.

**Fix interino (no decide R06):** `record` ahora resuelve el `PrescriptionItem`
leyendo el **resultado de la conciliación** en la cola R04
`ece.indicacion_farmacia_pendiente` (columna `prescription_item_id`, sql/222;
filtro `estado='RECONCILIADO'`). Sin fila conciliada, bloquea con
`PRECONDITION_FAILED` — fail-safe, jamás mapeo automático texto→Drug. Ese
SELECT es compatible con cualquier resolución de este ADR:

- **Opción A** (recomendada): al generar la `Prescription` en `firmar()`, el
  mismo flujo auto-concilia la fila de la cola (escribe `prescription_item_id`
  del item generado + `estado='RECONCILIADO'`) — BCMA funciona sin tocar
  `record` de nuevo, y la cola queda como rastro/excepción para ítems de texto
  libre sin `drug_id`.
- **Conciliación manual** (flujo R04 original): el pendiente sería el
  router/UI de farmacia que escriba esa misma columna. Hoy NO existe — hasta
  que exista (o se apruebe A), `record` bloquea el 100 % de las indicaciones
  nativas en prod.

Lo que **sí** queda decidido por el fix interino (y no cambia con A/B):
`MedicationAdministration.bedsideValidationId` ahora se puebla con el id que
devuelve `validate5Correct`, y el check de ventana terapéutica del Paso 6 usa
ese enlace (`MedicationAdministration ⋈ ece.bedside_validation.indication_id`)
— antes consultaba otra columna inexistente (`"orderId"`, 42703).
