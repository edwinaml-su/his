# IND_MED_POSTOP — Indicaciones Médicas Post-Operatorias

## Metadata

- **codigo**: IND_MED_POSTOP
- **nombre**: Indicaciones Médicas Post-Operatorias
- **modalidad**: HOSPITALIZACION (solo)
- **NTEC artículo**: Art. 36 (indicaciones médicas) + Art. 30 (nota operatoria del cirujano — `ACTO_QX`). Sub-tipo derivado para el contexto post-quirúrgico.
- **modulo_his_target**: `/ece/indicaciones` (lista + detalle) + wizard "próximos documentos" en `/ece/episodio-hospitalario/[id]` que lo sugiere automáticamente cuando `ACTO_QX` está firmado.
- **tabla_datos**: `ece.indicaciones_medicas` (misma tabla física que `IND_MED`; el motor las diferencia por `tipo_documento_id` en `ece.documento_instancia`).
- **inmutable**: false (mismo modelo de versionado / firma que `IND_MED`).
- **tipo_registro**: transaccional, OBLIGATORIO al iniciar el período post-operatorio.

## Propósito normativo

Sub-tipo de `IND_MED` específico para indicaciones de administración de medicamentos en el período **inmediato post-quirúrgico**, derivadas del reporte operatorio (Acta Quirúrgica / Nota Operatoria, `ACTO_QX`, NTEC Art. 30).

La separación del `IND_MED` genérico responde a tres necesidades:

1. **Bloqueo dependiente NTEC**: el motor de workflow ECE garantiza que NO se puede crear este documento si el `ACTO_QX` del episodio no está firmado (`ece.fn_assert_dependencias_firmadas` + helper TS `assertDependenciasFirmadas`). Esto evita que enfermería administre medicamentos sin que el cirujano haya cerrado formalmente la nota operatoria.
2. **Visibilidad en el wizard**: el `WizardProximosDocumentos` del episodio quirúrgico solo sugiere `IND_MED_POSTOP` cuando hay un `ACTO_QX` firmado y todavía no hay indicaciones post-op para el mismo `actoQuirurgicoId`. `IND_MED` genérico se sigue ofreciendo siempre que haya `HIST_CLIN` firmada (no es excluyente).
3. **Trazabilidad clínica**: facilita auditoría, métricas (LOS post-op, complicaciones, dolor agudo), reportes por servicio quirúrgico y separación en kardex/eMAR.

## Dependencias (depende_de)

- **ACTO_QX** — bloqueante (NTEC Art. 30). El reporte post-operatorio firmado es prerequisito.
- (transitivas vía `ACTO_QX`): `CONS_INF` → `FICHA_ID`.

NO depende explícitamente de `HIST_CLIN` ni `HOJA_ING` porque ambos son requisitos transitivos de `ACTO_QX` (que a su vez depende del consentimiento informado y la admisión hospitalaria).

## Roles firmantes / actores

| Rol | Acción | Momento |
|---|---|---|
| MC / Cirujano | Llena y firma las indicaciones post-op tras cerrar `ACTO_QX`. | Inmediato post-cirugía. |
| Anestesiólogo | Puede agregar indicaciones específicas de manejo del dolor agudo post-anestésico. | En coordinación con cirujano. |
| MT (Médico de Turno) | Continuidad post-op cuando el cirujano no está disponible. | Turno post-cirugía. |
| ENF | Lectura, transcripción al kardex / eMAR, ejecución BCMA 5R. | Continuo durante el turno post-op. |
| QFB | Validación farmacéutica (alertas, interacciones, ajustes renales/hepáticos). | Pre-dispensación. |

Mismas reglas de permisos que `IND_MED` (`ece.documento_rol`).

## Estados y transiciones

Idénticas a `IND_MED`:

- `borrador` → `en_revision` (`enviar_revision`)
- `borrador` → `anulado` (`anular`, requiere firma)
- `en_revision` → `firmado` (`firmar`, requiere firma)
- `firmado` → `validado` (`validar`, ENF)

## Diferencias con IND_MED

| Aspecto | `IND_MED` | `IND_MED_POSTOP` |
|---|---|---|
| Modalidad | ambos (ambulatorio + hospitalario) | hospitalario únicamente |
| Dependencias | `HIST_CLIN` | `ACTO_QX` (transitivamente todo lo demás) |
| Contexto | cualquier episodio | episodio quirúrgico post-acto |
| Sugerido por wizard | tras `HIST_CLIN` firmada | tras `ACTO_QX` firmado, sin instancia previa |
| Eventos | `ece.indicaciones.firmadas` | `ece.indicaciones_postop.firmadas` (mismo shape) |

## Eventos de dominio

Los eventos siguen el mismo patrón que `IND_MED` reutilizando el `payloadSchema`. La diferenciación viene por `tipoDocumentoCodigo='IND_MED_POSTOP'` en el payload base; no se introducen `eventType` nuevos en el catálogo para esta primera versión (re-evaluable si la dispatcher necesita routing distinto).

## Referencias

- NTEC Art. 30 (nota operatoria), Art. 36 (indicaciones médicas).
- `IND_MED` ficha completa: [`docs/flujos/IND_MED.md`](IND_MED.md) — referencia de campos, validaciones, eMAR, BCMA, ciclo CPOE/dispensación/administración.
- `ACTO_QX` ficha: [`docs/flujos/ACT_QX.md`](ACT_QX.md).
- Motor de dependencias: `packages/trpc/src/ece/dependencias-enforcement.ts` + `ece.fn_assert_dependencias_firmadas` (sql/05x).
- Seed: `packages/database/sql/57_ind_med_postop.sql`.
