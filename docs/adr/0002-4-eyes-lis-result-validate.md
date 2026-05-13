# ADR 0002 — Validación 4-eyes obligatoria en LIS result.validate

- **Estado:** Aceptado
- **Fecha:** 2026-05-13
- **Decisores:** @AS (proponente), @AE, @PO, comité clínico (consultado)
- **Fase:** 2 (Wave 7 — módulo LIS §17)
- **Norma de referencia:** TDR §17.5; ISO 15189:2012 §5.7 (post-examination process).

## Contexto

El módulo LIS (Laboratory Information System, módulo §17) gestiona órdenes y resultados de laboratorio. El paso `lis.result.validate` (transición `RESULT_ENTERED → RESULT_VALIDATED`) hace clínicamente vinculante el resultado: a partir de ese punto el resultado entra al expediente del paciente y puede gatillar decisiones médicas (transfusiones, antibióticos, ajuste de anticoagulantes).

El TDR §17.5 exige que el técnico que ingresa el resultado **no pueda ser el mismo** que lo valida — alineado con ISO 15189 (acreditación de laboratorios clínicos) que requiere "double-witnessing" en resultados críticos.

## Decisión

`lis.result.validate` impone una regla 4-eyes a nivel de router (defensa en profundidad sobre la lógica de dominio):

```ts
// apps/web/src/server/api/routers/lis.ts
validate: protectedProcedure
  .input(validateInput)
  .mutation(async ({ ctx, input }) => {
    const result = await ctx.db.labResult.findUniqueOrThrow({ where: { id: input.id }});

    if (result.enteredByUserId === ctx.session.user.id) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: '4-eyes: el técnico que ingresó el resultado no puede validarlo. Solicite a un colega.',
      });
    }

    if (result.status !== 'RESULT_ENTERED') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Estado inválido para validar' });
    }

    return ctx.db.labResult.update({
      where: { id: input.id },
      data: {
        status: 'RESULT_VALIDATED',
        validatedByUserId: ctx.session.user.id,
        validatedAt: new Date(),
      },
    });
  }),
```

La regla se complementa con:
- Auditoría: el evento `LabResult.validated` se registra en `audit.AuditLog` con `actor=validador`, `subject=resultado`, `prior_actor=técnico_ingreso`.
- Reporte: dashboard supervisor lista cualquier intento de bypass (debería ser 0).

## Consecuencias

**Positivas:**
- Cumplimiento ISO 15189 y TDR §17.5 a nivel arquitectónico, no solo procedural.
- Trazabilidad regulatoria: actor_ingreso vs actor_validador siempre distintos y auditados.
- Reducción documentada de "errores transcripcionales" (literatura: 30-40% en labs sin 4-eyes).

**Negativas:**
- Laboratorios pequeños (1-2 técnicos por turno) pueden enfrentar tiempos muertos. Mitigación: definir rol `LIS_VALIDATOR` que permite delegación inter-turno.
- Onboarding de nuevos labs requiere mínimo 2 usuarios certificados antes de procesar resultados.

**Neutrales:**
- Tests E2E `lis-validate.spec.ts` cubren happy path + bypass intent.

## Alternativas consideradas

1. **Confiar en proceso humano + capacitación.** Rechazada por @AE: el TDR pide control técnico, no procedural. Errores en producción serían responsabilidad arquitectónica.
2. **Permitir mismo usuario con doble autenticación (re-MFA).** Rechazada por comité clínico: no resuelve el sesgo cognitivo del operador — un solo par de ojos sigue siendo un solo par de ojos.
3. **Aplicar 4-eyes solo a resultados críticos (pánico).** Rechazada por @AS: complicaría el modelo de estados y abriría ambigüedad de "qué es crítico" — preferimos la regla uniforme.

## Referencias

- `apps/web/src/server/api/routers/lis.ts` — implementación.
- `apps/web/e2e/lis-validate.spec.ts` (planificado en Fase 6 Stream F).
- TDR §17.5 — flujo LIS.
- ISO 15189:2012 — Medical laboratories - Requirements for quality and competence.
- ADR-0004 (inmutabilidad post-firma) — patrón análogo en EHR Notes.
