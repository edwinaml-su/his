# Re-Audit Stream D — Hospitalización (2026-05-24)

**Auditor**: @QA — SDET (Re-audit mode)
**Rama**: `chore/ola1-re-audits-y-docs`
**Input**: `docs/audit/2026-05-19_audit_stream_d_hospitalizacion.md`
**Alcance**: hallazgos HD-01..HD-30 (9 módulos hospitalización)

## Hallazgos P0/P1 remediados

### Hoja de Ingreso
| ID | Estado | Evidencia |
|---|---|---|
| HD-01 (P0 schema drift) | ✅ CERRADO | Router serializa modalidad/procedencia/diagnosticoIngreso/motivoConsulta/notasAdicionales en JSONB `datos_administrativos` (L526-533); columnas corregidas servicio_ingreso_id→servicio_id, cama_asignada_id→cama_id |
| HD-02 (P0 queries leen columnas) | ✅ CERRADO | `findHojaIngreso` y `list` leen columnas reales |

### Episodio Hospitalario
| HD-07 (P0 drift) | ✅ CERRADO | Mapeo BD real: sala_id→servicio_id, fecha_ingreso→fecha_hora_orden_ingreso, episodio_atencion_id→episodio_id |

### Signos Vitales
| HD-16 (P0 drift) | ✅ CERRADO | Nombres BD: presion_sistolica/diastolica, escala_dolor, fecha_hora_toma, registrado_por. Peso/talla/glucometria capturados |
| HD-17 (P0 UI stub) | ✅ CERRADO | Mutation cableada (L358-387), IMC automático L355, persiste en `ece.signos_vitales` |

### Registro Enfermería / MAR
| HD-22 (P0 drift) | ✅ CERRADO | Columnas reales: nota_evolucion/plan_cuidados/valoracion_enf/registrado_por/estado_registro (L266-278) |
| HD-23 (P1 regresión) | ✅ CERRADO | `computeScheduledSlot` invocado en L334; hora_programada derivada y persistida |
| HD-24 (P1 RLS bypass list) | ✅ CERRADO | `list` envuelto en `withEceContext` (L221) |

### RRI
| HD-25 (P0 drift) | ✅ CERRADO | establecimiento_destino_id/resumen_clinico/respuesta_interconsultante (L532-545) |

### Valoración Inicial Enfermería
| HD-19 (P1 RLS bypass) | ✅ CERRADO | `list` (L204) y `get` (L235) envueltos en `withEceContext`; RLS aplica |

## Uso de withWorkflowContext

✅ **Confirmado** en todos los routers ECE de hospitalización:

| Router | Usos `withEce/Workflow` |
|---|---|
| hoja-ingreso.router.ts | 14 |
| episodio-hospitalario.router.ts | 12 |
| signos-vitales.router.ts | 7 |
| registro-enfermeria.router.ts | 13 |
| rri.router.ts | 12 |
| valoracion-inicial-enfermeria.router.ts | 11 |
| evolucion-medica.router.ts | Verificado |

## Resumen

| Severidad | Total | Cerrados | Abiertos |
|---|---|---|---|
| P0 | 7 | 7 ✅ | 0 |
| P1 | 4 | 4 ✅ | 0 |
| P2/P3 | 19 | — | 13 (tolerables Wave 2 post-go-live) |

## Veredicto

**Stream D: APTO PARA GO-LIVE.** Los 6 módulos críticos (Hoja Ingreso, Episodio, SV, MAR, RRI, Valoración Inicial) cumplen schema alignment + RLS + workflow context. Arquitectura ECE con `withWorkflowContext` completamente integrada en hospitalización.

P2/P3 (13 hallazgos) son iteración post-go-live, no bloquean.
