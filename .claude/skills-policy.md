# Skills Policy — HIS Multipaís

**Vigente desde:** 2026-05-12 (Wave 1 cont. Oleada 6)
**Autor:** @Orq · Unidad de Transformación Digital · Inversiones Avante
**Estado:** Vinculante. Amplía `sdlc_framework.md`.

---

## careful-coding — Mandatoria para @Dev

Toda invocación a **@Dev** (Senior Full Stack) sobre el proyecto HIS — features, refactors, fixes, cierre de Tickets de Incidencia — debe cargar la skill `careful-coding` como **primer paso** del brief del agente, antes de tocar archivos.

### Las 4 reglas vinculantes

| # | Regla | Aplicación en HIS |
| :-: | :--- | :--- |
| 1 | **Think Before Coding** | Si el brief tiene ambigüedad, pedir aclaración a @Orq ANTES de codificar. Listar suposiciones explícitas. |
| 2 | **Simplicity First** | Código mínimo que cumple el DoD. Sin abstracciones especulativas. Sin "flexibilidad" no pedida. Sin manejo de errores para escenarios imposibles. |
| 3 | **Surgical Changes** | Solo archivos del scope. No "mejorar" código adyacente. Mantener estilo existente. Dead code adyacente: mencionarlo, NO eliminar. |
| 4 | **Goal-Driven Execution** | Convertir ticket en criterio verificable (test que pasa, grep que matchea, build que compila). Iterar hasta verificar. |

### Test cualitativo (auditable por @Orq al cerrar el ticket)

**Pregunta:** ¿Cada línea modificada se traza directamente al requerimiento del ticket?

Si la respuesta es "no" en alguna línea, el agente debe revertirla antes de reportar.

### Aplicación en otros roles

| Rol | Política |
| :--- | :--- |
| **@Dev** | Obligatoria |
| @AS | Recomendada (cuando produce ejemplos de código en ADRs) |
| @QA | Recomendada (cuando escribe tests) |
| @DBA | Recomendada (cuando emite SQL/migrations) |
| @SRE | Recomendada (cuando edita scripts) |
| @AE / @PO / @UIUX / @AT | No aplica (rol estratégico/diseño, no code-producer) |

### Plantilla obligatoria del brief @Dev

Todo prompt a un agente con rol @Dev debe iniciar con un bloque equivalente a:

```
**OBLIGATORIO — Carga la skill `careful-coding` primero** y aplica sus 4 reglas:
1. Think Before Coding — pregunta si hay ambigüedad
2. Simplicity First — código mínimo, sin features no pedidas
3. Surgical Changes — solo archivos del scope, sin "mejoras" adyacentes
4. Goal-Driven Execution — criterio verificable de éxito

Verificación final: cada línea modificada se traza al requerimiento.
```

### Verificación que la política está activa

- ✅ Este archivo existe en `C:\proyecto\HIS\.claude\skills-policy.md`
- ✅ Memoria `feedback_careful_coding.md` indexada en MEMORY.md
- ⏳ Cada invocación @Dev futura debe incluir el bloque obligatorio

### Histórico de aplicación

| Fecha | Oleada / Ticket | Agente | Outcome |
| :--- | :--- | :--- | :--- |
| 2026-05-12 | Oleada 6 Batch 0 (TI-W2-F-Re-005 + 006) | @Dev Bravo | ✅ 8/8 `data-testid` añadidos · 0 cambios fuera de scope · hallazgos colaterales reportados sin modificar |

---

## TODO operativo

- `C:\proyecto\HIS\.claude\sdlc_framework.md` debe extenderse con sección §6 referenciando este documento. El intento de Edit el 2026-05-12 falló con EPERM (archivo bloqueado por proceso externo — probablemente IDE abierto). **Acción Edwin:** cerrar el IDE que tiene el archivo abierto, o aplicar el patch manual. Mientras tanto, este documento + la memoria son la fuente vinculante.
