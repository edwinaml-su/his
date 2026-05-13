# ADR 0004 — Inmutabilidad post-firma en `ClinicalNote`

- **Estado:** Aceptado
- **Fecha:** 2026-05-13
- **Decisores:** @AS (proponente), @AE, @PO, asesor legal externo (consultado)
- **Fase:** 2 (Wave 7 — módulo EHR Notes §14)
- **Norma de referencia:** TDR §14.3; Ley de Firma Electrónica SV; Código de Salud SV art. 49.

## Contexto

El módulo EHR Notes (`ClinicalNote`, §14) almacena la documentación clínica del expediente: nota de ingreso, evolución, interconsulta, alta. Una vez **firmada electrónicamente** por el profesional autor, la nota adquiere:

1. **Valor legal** equivalente a documento manuscrito firmado (Ley de Firma Electrónica SV).
2. **Validez probatoria** ante litigios médico-legales o auditorías regulatorias.
3. **Permanencia obligatoria** mínima de 10 años en el expediente (Código de Salud SV).

Permitir edición silenciosa post-firma destruiría estos tres pilares. Pero la realidad clínica exige correcciones (errores tipográficos, hallazgos adicionales, addendums).

## Decisión

Modelo de **append-only versionado**:

1. `ClinicalNote.signedAt` y `ClinicalNote.signatureHash` son setteables **una sola vez** (transición `DRAFT → SIGNED`).
2. Una vez `SIGNED`, las únicas mutaciones permitidas son:
   - **Addendum**: crear `ClinicalNoteAddendum` enlazado al `noteId` original, con su propia firma y timestamp. NO modifica la nota base.
   - **Anulación legal**: transición `SIGNED → VOIDED` solo por rol `MEDICAL_DIRECTOR` con justificación de texto libre. La nota original permanece almacenada y consultable; se marca como anulada con razón visible. Crea registro en `audit.AuditLog` con severidad crítica.
3. `ClinicalNote.update` rechaza con `FORBIDDEN` cualquier intento de modificar campos firmados (`content`, `diagnoses`, `signedByUserId`, `signedAt`, `signatureHash`).

```ts
// apps/web/src/server/api/routers/ehrNote.ts
update: protectedProcedure
  .input(updateInput)
  .mutation(async ({ ctx, input }) => {
    const note = await ctx.db.clinicalNote.findUniqueOrThrow({ where: { id: input.id }});

    if (note.status === 'SIGNED' || note.status === 'VOIDED') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Nota firmada: use addendum o anulación legal.',
      });
    }

    // DRAFT: cualquier edición permitida por el autor original
    if (note.authorUserId !== ctx.session.user.id) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Solo el autor puede editar borrador.' });
    }

    return ctx.db.clinicalNote.update({ where: { id: input.id }, data: input.data });
  }),

createAddendum: protectedProcedure
  .input(addendumInput)
  .mutation(async ({ ctx, input }) => {
    const note = await ctx.db.clinicalNote.findUniqueOrThrow({ where: { id: input.noteId }});
    if (note.status !== 'SIGNED') {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'Solo se agregan addendums a notas firmadas.' });
    }
    return ctx.db.clinicalNoteAddendum.create({ data: { ... } });
  }),
```

La inmutabilidad se refuerza con:
- Hash chain (audit): cada mutación queda encadenada por hash en `audit.AuditLog`, detectable si se intenta alterar la BD directamente fuera de la app.
- RLS Postgres impide `UPDATE` a campos firmados aún con sesión válida (cobertura defensa en profundidad).

## Consecuencias

**Positivas:**
- Cumplimiento Ley de Firma Electrónica SV y Código de Salud SV a nivel arquitectónico.
- Trazabilidad médico-legal completa: la versión firmada original siempre recuperable.
- Addendums permiten corrección sin perder la versión histórica — mejor que "edición silenciosa".
- Imposibilidad técnica de alterar firmas, no solo política de uso.

**Negativas:**
- UX requiere educación clínica: "no se edita, se agrega addendum". Manual de usuario debe ser explícito.
- Si una nota DRAFT se firma por error con datos erróneos, la única salida es VOID + nueva nota — overhead operativo.
- Volumen de almacenamiento crece con addendums (mitigado: compresión en Postgres + Storage para attachments).

**Neutrales:**
- E2E test `ehr-notes-immutability.spec.ts` cubre intentos de bypass (firma + update, role escalation, RLS).

## Alternativas consideradas

1. **Permitir edición con campo `editedAt` visible.** Rechazada por @AE y asesor legal: la "edición visible" no equivale a "versión original preservada"; en litigio se argumentaría manipulación.
2. **Soft-delete + nueva versión silente.** Rechazada: alta complejidad de UI (¿qué versión muestro?) y ambigüedad legal sobre cuál es "la nota oficial".
3. **Inmutabilidad fuerte sin addendums.** Rechazada por @PO: imposible operativamente — los addendums son práctica estándar en HCEs maduros (Epic, Cerner).
4. **Anulación sin restricción de rol.** Rechazada por @AE: cualquier usuario podría anular notas, eliminando el control. Restringir a `MEDICAL_DIRECTOR` es el balance correcto.

## Referencias

- `apps/web/src/server/api/routers/ehrNote.ts` — implementación.
- `apps/web/e2e/ehr-notes-immutability.spec.ts` (planificado).
- `packages/database/sql/11_ehr_notes_rls.sql` — RLS reforzando inmutabilidad en BD.
- TDR §14.3 — política de inmutabilidad.
- Ley de Firma Electrónica SV (decreto 133/2015).
- Código de Salud SV art. 49 (preservación de expediente clínico).
- ADR-0002 (4-eyes LIS), ADR-0003 (time-out surgery) — patrones análogos de gate de seguridad.
