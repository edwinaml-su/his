# Auditoría Stream K — Portal del Paciente (RLS / Acceso a Datos)

**Fecha:** 2026-05-24  
**Auditor:** @QA — Automatización QA (SDET), Unidad de Transformación Digital, Inversiones Avante  
**Rama:** chore/ola1-re-audits-y-docs (basada en feat/fase2-s1-gate)  
**Método:** Análisis estático de routers tRPC (portal.router.ts) + verificación de patrones RLS y filtros patientId  
**Scope:** 3 módulos clave del portal: citas, resultados, expediente

---

## Índice

1. [Módulo 1 — Citas (Appointments)](#modulo-1)
2. [Módulo 2 — Resultados de Laboratorio](#modulo-2)
3. [Módulo 3 — Expediente Clínico](#modulo-3)
4. [Hallazgos Consolidados](#hallazgos)
5. [Resumen de riesgo](#resumen)

---

## Módulo 1 — Citas (Appointments) {#modulo-1}

### 1.1 Resumen

La página /portal/citas (apps/web/src/app/(portal)/portal/citas/page.tsx) muestra citas próximas y pasadas del paciente autenticado en el portal. El router portal.hce.appointments implementa portalProcedure con contexto withPortalContext, que inyecta el patientId desde el JWT del portal. El módulo filtra correctamente por patientId en Prisma.

**Actores:** Paciente autenticado en portal.  
**Operación:** Lectura (queries).  
**RLS esperado:** Paciente ve solo sus propias citas.

### 1.2 Análisis de routers

#### appointments.list (línea 536-566)

El router filtra por patientId en la cláusula where:

```
where: {
  patientId,  // FILTRADO POR PATIENTID
  deletedAt: null,
  ...(upcoming ? { scheduledAt: { gte: now } } : { scheduledAt: { lt: now } })
}
```

**Hallazgo:** Correcto. El filtro where: patientId asegura que Prisma solo retorne citas del paciente autenticado.

#### appointments.upcoming (línea 568-594)

Idéntico patrón: where: patientId dentro de withPortalContext.

**Hallazgo:** Correcto.

### 1.3 Verificaciones de seguridad

| Control | Estado | Observación |
|---|---|---|
| RLS context (withPortalContext) | OK | Aplica GUC app.current_portal_account en SQL |
| Filtro patientId en Prisma | OK | Explícito en todas las queries |
| Validación de input | OK | guardianInput valida wardPatientId |
| Exposición PII | OK | Select restringido a datos básicos |

### 1.4 Conclusión Módulo 1

**SIN HALLAZGOS**. Las citas están correctamente aisladas por patientId.

---

## Módulo 2 — Resultados de Laboratorio {#modulo-2}

### 2.1 Resumen

La página /portal/resultados (apps/web/src/app/(portal)/portal/resultados/page.tsx) lista resultados de laboratorio validados del paciente. El router portal.hce.labResults navega desde LabResult a LabOrderItem.order a Order.patientId para filtrar.

**Actores:** Paciente autenticado.  
**Operación:** Lectura (queries).  
**RLS esperado:** Paciente ve solo sus resultados validados.

### 2.2 Análisis de routers

#### labResults.list (línea 605-641)

El router filtra por patientId anidado:

```
where: {
  validatedAt: { not: null },
  orderItem: {
    order: { patientId }  // FILTRADO POR PATIENTID
  }
}
```

**Hallazgo:** Correcto. El filtro anidado orderItem.order.patientId asegura RLS.

#### labResults.get (línea 643-688)

Idéntico patrón con validación adicional en findFirst.

**Hallazgo:** Correcto.

### 2.3 Verificaciones de seguridad

| Control | Estado | Observación |
|---|---|---|
| RLS context | OK | withPortalContext aplicado |
| Filtro patientId (anidado) | OK | Navega correctamente a order.patientId |
| Validación de acceso (get) | OK | Comprueba resultId + patientId |
| Exposición PII | OK | Select controlado |
| Filtro confidential | AUSENTE | Gap documentado: no hay columna confidential |

### 2.4 Hallazgo: HK-01 — Gap de confidencialidad en resultados (P2 MEDIA)

**Descripción:** El comentario en línea 603 documenta: "Gap 5.2: campo confidential no existe en schema". Si un laboratorio marca un resultado como privado (ej. test de HIV), el paciente lo vería igual que otros resultados.

**Severity:** P2 MEDIA (no es un RLS break, pero es una limitación funcional).

**Recomendación:** Añadir columna confidential a LabResult y filtrar en where.

### 2.5 Conclusión Módulo 2

**1 HALLAZGO MENOR (HK-01)**. RLS está correctamente implementado; el gap es funcional.

---

## Módulo 3 — Expediente Clínico {#modulo-3}

### 3.1 Resumen

La página /portal/mi-expediente muestra el resumen del expediente: demografía, episodios, diagnósticos y documentos. El router portal.expediente usa portalProcedure + withPortalContext.

**Actores:** Paciente autenticado.  
**Operación:** Lectura (queries).  
**RLS esperado:** Paciente ve solo su expediente.

### 3.2 Análisis de routers

#### expediente.getMiExpediente (línea 774-838)

El router filtra explícitamente por patientId:

```
patient = await tx.patient.findFirst({
  where: { id: patientId }
});

encounters = await tx.encounter.findMany({
  where: { patientId }
});
```

**Hallazgo:** Correcto.

#### expediente.getMisDocumentosFirmados (línea 841-885)

**PROBLEMA DETECTADO:** El router acepta input.encounterIds opcional. Si se pasan manualmente:

```
let eIds = input.encounterIds;
if (!eIds) {
  const encs = await tx.encounter.findMany({
    where: { patientId }
  });
  eIds = encs.map(e => e.id);
}

// LUEGO USA eIds SIN REVALIDAR CONTRA patientId
return tx.clinicalNote.findMany({
  where: {
    encounterId: { in: eIds }
  }
});
```

Si un paciente pasa encounterIds manualmente (ej. via curl), el router NO verifica que pertenezcan al paciente autenticado.

### 3.3 Hallazgo: HK-02 — `getMisDocumentosFirmados` no valida `input.encounterIds` (P1 ALTA)

**Descripción:** Un paciente malicioso podría enumerar encuentterIds de otros pacientes y obtener sus documentos clínicos:

```
POST /trpc/portal.expediente.getMisDocumentosFirmados
{
  "wardPatientId": "mi-id-real",
  "encounterIds": ["otro-paciente-encounter-id"]  // Ataque
}
```

**RLS Break:** Sí. Exposición de datos de otros pacientes.

**Severity:** P1 ALTA.

**Recomendación:** Revalidar antes de usar:

```
if (eIds) {
  const validatedEncs = await tx.encounter.findMany({
    where: { id: { in: eIds }, patientId }
  });
  eIds = validatedEncs.map(e => e.id);
}
```

### 3.4 Conclusión Módulo 3

**1 HALLAZGO ALTO (HK-02)**. RLS break en GMisDocumentosFirmados.

---

## Hallazgos Consolidados {#hallazgos}

### HK-01 — Gap de confidencialidad en resultados (P2 MEDIA)

**Módulo:** Resultados de Laboratorio  
**Línea:** packages/trpc/src/routers/portal.router.ts:603  
**Descripción:** Campo confidential no existe. Resultado privado se mostraría sin filtro.  
**Recomendación:** Añadir columna confidential a LabResult.

---

### HK-02 — GMisDocumentosFirmados no valida input.encounterIds (P1 ALTA)

**Módulo:** Expediente Clínico  
**Línea:** packages/trpc/src/routers/portal.router.ts:854-862  
**Descripción:** RLS break: paciente puede pasar encounterIds manualmente para ver documentos de otros.  
**Recomendación:** Revalidar input.encounterIds contra patientId.

---

## Resumen de riesgo {#resumen}

| HK-ID | Severidad | Módulo | Título | Impacto | Acción |
|---|---|---|---|---|---|
| HK-01 | P2 MEDIA | Lab Results | Gap confidential | Funcional | Post-launch |
| HK-02 | P1 ALTA | Expediente | RLS break | Seguridad | Pre-launch |

### Conteo

- P0 CRITICO: 0
- P1 ALTA: 1 (HK-02)
- P2 MEDIA: 1 (HK-01)

### Recomendación go-live

1. **Corregir HK-02 INMEDIATAMENTE.** Es un RLS break.
2. **HK-01:** Mejora post-lanzamiento.
3. **Portal:** Mayormente seguro (citas y resultados correctos).

---

*Documento generado por @QA el 2026-05-24.*
