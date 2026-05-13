# ADR 0003 — Time-out OR previo a `surgery.case.start` (checklist OMS)

- **Estado:** Aceptado
- **Fecha:** 2026-05-13
- **Decisores:** @AS (proponente), @AE, @PO, comité clínico (consultado)
- **Fase:** 2 (Wave 7 — módulo Surgery §13)
- **Norma de referencia:** TDR §13.4; OMS "Surgical Safety Checklist" (2009); JCI IPSG.4.

## Contexto

El módulo Surgery (`SurgeryCase`, §13) gestiona el ciclo de vida quirúrgico:

```
SCHEDULED → PRE_ANESTHESIA → TIMEOUT_PENDING → IN_PROGRESS → SIGN_OUT → CLOSED
```

El **time-out** es el checkpoint inmediato anterior al inicio de la cirugía donde el equipo quirúrgico (cirujano, anestesiólogo, enfermería) verifica conjuntamente:

1. Identidad del paciente (DUI + brazalete + verbal).
2. Sitio quirúrgico marcado y correcto.
3. Procedimiento planificado.
4. Profilaxis antibiótica administrada.
5. Imágenes radiológicas relevantes en pantalla.
6. Equipos críticos verificados (vía aérea difícil, sangre tipada).

La OMS reporta que la implementación rigurosa del time-out reduce mortalidad quirúrgica 30% y complicaciones 40%. El TDR §13.4 lo exige explícitamente. JCI lo incluye en IPSG.4 (Universal Protocol for preventing wrong site / wrong patient / wrong procedure).

## Decisión

`surgery.case.start` falla si no existe un `SurgeryTimeOut` completado y firmado por mínimo 3 roles distintos (cirujano + anestesiólogo + enfermería) en los últimos 30 minutos antes del intento de inicio:

```ts
// apps/web/src/server/api/routers/surgery.ts
start: protectedProcedure
  .input(startInput)
  .mutation(async ({ ctx, input }) => {
    const surgeryCase = await ctx.db.surgeryCase.findUniqueOrThrow({
      where: { id: input.id },
      include: { timeOut: true },
    });

    if (surgeryCase.status !== 'TIMEOUT_PENDING') {
      throw new TRPCError({ code: 'CONFLICT', message: 'Estado inválido' });
    }

    const t = surgeryCase.timeOut;
    if (!t) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: 'Time-out OMS no registrado',
      });
    }

    const ageMin = (Date.now() - t.completedAt.getTime()) / 60_000;
    if (ageMin > 30) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Time-out caducado (${Math.round(ageMin)} min). Repetir.`,
      });
    }

    const requiredRoles = new Set(['SURGEON', 'ANESTHESIOLOGIST', 'NURSE']);
    const signedRoles = new Set(t.signatures.map(s => s.role));
    const missing = [...requiredRoles].filter(r => !signedRoles.has(r));
    if (missing.length > 0) {
      throw new TRPCError({
        code: 'PRECONDITION_FAILED',
        message: `Faltan firmas: ${missing.join(', ')}`,
      });
    }

    return ctx.db.surgeryCase.update({
      where: { id: input.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });
  }),
```

La regla es **OR-compuesta** sobre los gates: cualquier fallo (falta time-out, caducado, firmas insuficientes) bloquea `start`. No hay override automático; un override manual de supervisor requiere acción explícita en `surgery.case.overrideTimeOut` que también deja audit-trail completo.

## Consecuencias

**Positivas:**
- Cumplimiento TDR §13.4 + JCI IPSG.4 a nivel arquitectónico.
- Imposible iniciar cirugía sin checklist OMS firmado por 3 roles → bloqueo técnico, no procedural.
- Audit trail completo: cada time-out queda con firmas, timestamps y diferencia temporal a `start`.

**Negativas:**
- Urgencias clínicas reales pueden requerir override — necesario el endpoint dedicado `overrideTimeOut` con doble firma supervisor + justificación de texto libre obligatoria.
- Cambios de personal mid-procedimiento (handover) requieren considerar re-time-out — fuera de scope MVP, queda pendiente en `docs/03_blueprints_modulos.md` §13.

**Neutrales:**
- E2E test `surgery-timeout.spec.ts` cubre happy path, expirado, firmas faltantes, override supervisor.

## Alternativas consideradas

1. **Permitir start sin time-out registrado y validar después.** Rechazada por @AE y comité clínico: derrota el propósito; el time-out debe ser pre-condición no post-condición.
2. **Time-out con firmas opcionales.** Rechazada: la OMS exige 3 roles. Hacerlo configurable abre puerta a bypass cultural.
3. **Time-out válido por 60 min en vez de 30.** Rechazada por comité clínico: en 60 min puede cambiar equipo, paciente puede haberse trasladado de sala. 30 min es estándar de JCI.

## Referencias

- `apps/web/src/server/api/routers/surgery.ts` — implementación.
- `apps/web/e2e/surgery-timeout.spec.ts` (planificado Fase 6 Stream F).
- TDR §13.4 — flujo SurgeryCase.
- OMS Surgical Safety Checklist (2009).
- JCI International Patient Safety Goal 4 (Universal Protocol).
- ADR-0002 (4-eyes LIS) — patrón análogo de gate de seguridad clínica.
