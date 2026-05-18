# ADR 0016 — Auditoría módulos legacy vs ECE: coexistencia, consolidación o eliminación

**Estado:** Aceptado  
**Fecha:** 2026-05-17  
**Autor:** @Dev (auditado en branch feat/fase2-s1-gate)  
**Relacionado:** ADR-0011 (motor workflow ECE), ADR-0012 (RLS ECE)

---

## Contexto

El sidebar (`apps/web/src/components/app-shell.tsx`) expone módulos legacy (`/emergency`, `/pharmacy`, `/emar`, `/lis/results`, `/imaging`, `/deaths`, `/consents`) en paralelo con módulos ECE (`/ece/*`). La auditoría verifica si hay duplicación real de funcionalidad o si los pares son semánticamente distintos.

Se examinó: comentario JSDoc, imports tRPC, lógica de filtros y scope del rol en cada `page.tsx`.

---

## Pares analizados

### 1. `/emergency` vs `/ece/atencion-emergencia`

**Decisión: COEXISTEN — scopes distintos.**

- `/emergency` (§12, Wave 7): listado administrativo de visitas a urgencias, filtrado por disposition/fecha. Router: `trpc.emergency.*`. Sin workflow.
- `/ece/atencion-emergencia`: documento ECE con workflow firma electrónica (borrador → en_revision → firmado → validado). Scope: por episodio, rol MT/DIR.

Diferencia real: listado operativo vs documento legal firmado. No hay duplicación de datos; son vistas complementarias del mismo hecho clínico.

### 2. `/pharmacy` vs `/ece/indicaciones`

**Decisión: COEXISTEN — prescripción vs dispensación.**

- `/pharmacy` (§15): listado de recetas/prescripciones. Router: `trpc.pharmacy.prescription.list`. Rol farmacéutico.
- `/ece/indicaciones`: indicaciones médicas dentro del episodio con workflow (BORRADOR → FIRMADA_MC → VALIDADA_ENF → ANULADA). Rol MC/ENF.

El acto de prescribir (ECE) y el de dispensar (Pharmacy) son flujos normativos distintos (TDR §15 vs §ECE). No consolidar.

### 3. `/lis/results` vs `/ece/estudios`

**Decisión: COEXISTEN — cola LIS vs documento NTEC.**

- `/lis/results` (§17): cola de resultados pendientes de validación ("4-eyes" ADR-0002). Router: `trpc.lis.order.list`. Rol laboratorista.
- `/ece/estudios`: solicitudes de estudio por episodio hospitalario (Doc 18 NTEC). Split lista solicitudes / con resultado. Rol MC.

`/lis/results` es el worklist del laboratorio; `/ece/estudios` es la vista clínica del médico. Dos actores distintos, dos modelos mentales. No consolidar.

### 4. `/imaging` vs ECE

**Decisión: SIN PAR ECE — módulo standalone.**

`/imaging` (§18 RIS/PACS, Wave 7): órdenes de imagen, filtro modalidad. No existe `/ece/imaging` ni enlace desde ECE. Módulo aislado correcto: integración DICOM/modality-worklist es dominio técnico separado.

### 5. `/emar` vs `/ece/registro-enfermeria`

**Decisión: COEXISTEN — MAR vs registro turno.**

- `/emar` (§16): listado de administraciones de medicamentos (BCMA, doble-check). Router: `trpc.emar.*`. Rol enfermería.
- `/ece/registro-enfermeria`: agenda del turno del enfermero (matutino/vespertino/nocturno) con estado workflow por paciente. Rol ENF.

eMAR registra el acto de administración con firma BCMA; Registro Enfermería gestiona el turno y vincula al MAR por paciente. Flujos secuenciales, no duplicados.

### 6. `/deaths` (admin) vs `/ece/defuncion`

**Decisión: COEXISTEN — registro administrativo vs documento legal.**

- `/deaths` (admin, US-5.6): listado organizacional de certificados emitidos, acceso PHYSICIAN/ADMIN, sin workflow.
- `/ece/defuncion`: emisión del certificado ECE con workflow MC → MC (validación) → DIR, INMUTABLE post-firma (NTEC Art. 21).

`/deaths` es la vista de consulta; `/ece/defuncion` es el flujo de creación con firma electrónica. No duplicar.

### 7. `/consents` (admin) vs `/ece/consentimiento`

**Decisión: COEXISTEN — GDPR vs consentimiento informado clínico.**

- `/consents` (US-2.9): consentimientos de datos GDPR — filtros por propósito, estado vigente/revocado/expirado, acción inline revocar.
- `/ece/consentimiento`: consentimientos informados por episodio (Acuerdo 1616 MINSAL 2024), INMUTABLES post-firma.

Regulaciones distintas (GDPR vs normativa clínica SV), datos distintos, flujos distintos. No consolidar.

### 8. `/ece/camas` vs `/beds`

**Decisión: COEXISTEN — camas ECE (por episodio) vs gestión general.**

`/beds` (admin): gestión de inventario de camas (ocupada/disponible/mantenimiento). `/ece/camas`: vista de camas vinculadas al episodio activo del paciente. Complementarios.

---

## Duplicaciones reales encontradas

**Ninguna.** Todos los pares examinados son semánticamente distintos. No se requieren PRs de consolidación.

---

## Riesgos detectados (no duplicación, pero anotados)

1. **Sidebar muestra `/deaths` (Soporte clínico) y no enlaza a `/ece/defuncion`**: el usuario podría buscar la emisión en el lugar equivocado. Mitigación: documentar en onboarding clínico, no en código.
2. **`/ece/camas`** existe como ruta pero no aparece en el sidebar — enlazado solo desde `/ece/episodio-hospitalario`. Consistente con el diseño; no es bug.
3. **`/ece/admisiones-pendientes`** (en admin group) y `/admission` (en clinical) podrían confundir. Scope: `/admission` crea la admisión; `/ece/admisiones-pendientes` lista episodios sin hoja de ingreso ECE. Distintos actores (admisionista vs médico). No consolidar.

---

## Decisión

Todos los módulos legacy coexisten con sus contrapartes ECE por diseño. La separación refleja actores, regulaciones y flujos de firma distintos. No abrir PRs de consolidación.

---

## Consecuencias

- El sidebar con múltiples secciones ECE es correcto y no genera deuda técnica por duplicación.
- El riesgo de confusión usuario se mitiga con capacitación, no con cambios de código.
- Esta ADR sirve de referencia para futuras incorporaciones: cualquier módulo nuevo debe justificar su diferencia con los existentes antes de crear una ruta paralela.
