# JCI IPSG — Feature Files BDD

Autor: @QAF — Quality Analyst Funcional  
Fecha: 2026-05-30  
Estado: **SPEC ONLY — no ejecutables**. Ver sección "Estado actual" al final.

---

## Propósito

Estos feature files documentan el comportamiento esperado del HIS Multipaís frente a los
International Patient Safety Goals (IPSG) de JCI (7th Edition, 2021). Son la especificación
funcional de aceptación para la épica E-05 del plan de acreditación JCI.

Sirven como:
- Contrato entre @PO (product), @Dev (implementación) y @QAF (aceptación funcional)
- Base para automatización E2E por @QA cuando el comportamiento esté implementado
- Evidencia documental de cobertura de requisitos JCI ante el surveyor

---

## Mapping IPSG → Feature File → US Beta.21

| IPSG  | Nombre                           | Feature File                          | US Backlog Beta.21                    | Sprint estimado |
|-------|----------------------------------|---------------------------------------|---------------------------------------|-----------------|
| IPSG.1| Identificación correcta paciente | ipsg_1_paciente_correcto.feature      | US.JCI.5.2, US.JCI.5.3, US.JCI.5.4   | JCI-1.S1        |
| IPSG.2| Comunicación efectiva            | ipsg_2_comunicacion_efectiva.feature  | US.JCI.5.5, US.JCI.5.6, US.JCI.5.7, US.JCI.5.8 | JCI-1.S2 |
| IPSG.3| Medicamentos alto riesgo (HAM)   | ipsg_3_medicamentos_alto_riesgo.feature | US.JCI.5.9, US.JCI.5.10, US.JCI.5.11 | JCI-1.S2        |
| IPSG.4| Cirugía segura (WHO 3 pausas)    | ipsg_4_cirugia_segura.feature         | US.JCI.5.13                           | JCI-1.S3        |
| IPSG.5| Higiene de manos / HAI           | (fuera de scope MVP — épica E-01 PCI) | —                                     | —               |
| IPSG.6| Reducción riesgo de caídas       | ipsg_6_caidas.feature                 | US.JCI.5.14, US.JCI.5.15              | JCI-1.S3        |

### US Beta.21 pendientes de creación formal en backlog

Las US referenciadas arriba corresponden a los hallazgos P0/P1 del gap analysis
`docs/audit/2026-05-30_jci_ipsg_gap.md`. Deben ser creadas por @PO en el backlog
`docs/backlog/jci/` antes del inicio de Sprint JCI-1.S1.

---

## Tags usados y su significado

| Tag            | Significado                                                                               |
|----------------|-------------------------------------------------------------------------------------------|
| `@jci`         | Escenario vinculado a requisito JCI                                                        |
| `@ipsg_1..6`   | IPSG específico que cubre el escenario                                                    |
| `@P0`          | Prioridad máxima — finding mayor en survey JCI si no está cubierto                        |
| `@P1`          | Prioridad alta — finding menor o riesgo de evidencia incompleta                           |
| `@happy_path`  | Flujo exitoso — comportamiento que ya funciona o debe funcionar                           |
| `@validation`  | Escenario de validación de regla de negocio                                               |
| `@gate`        | El sistema DEBE bloquear la operación — hard stop clínico o JCI                          |
| `@edge_case`   | Caso límite o situación de excepción clínica                                              |
| `@gap_actual`  | El comportamiento descrito es el DESEADO pero NO está implementado aún (ver gap analysis) |

Los escenarios con `@gap_actual` documentan el comportamiento que la implementación debe alcanzar.
No reflejan el estado actual del sistema — reflejan el contrato de aceptación.

---

## Resumen de escenarios por feature

| Feature file                              | Escenarios totales | Con `@gap_actual` | Con `@gate` |
|-------------------------------------------|--------------------|-------------------|-------------|
| ipsg_1_paciente_correcto.feature          | 6                  | 3                 | 3           |
| ipsg_2_comunicacion_efectiva.feature      | 10                 | 4                 | 5           |
| ipsg_3_medicamentos_alto_riesgo.feature   | 9                  | 3                 | 4           |
| ipsg_4_cirugia_segura.feature             | 9                  | 3                 | 5           |
| ipsg_6_caidas.feature                     | 10                 | 5                 | 3           |
| **TOTAL**                                 | **44**             | **18**            | **20**      |

---

## Cómo ejecutar en el futuro (cuando @QA agregue playwright-bdd)

Los feature files en este directorio son spec Gherkin puro. Para convertirlos en tests
automatizados ejecutables, @QA deberá:

1. Instalar `playwright-bdd` en el workspace `@his/web`:
   ```bash
   npm install -w @his/web playwright-bdd --save-dev
   ```

2. Configurar `playwright.config.ts` para apuntar a `tests/features/jci/**/*.feature`
   con el directorio de step definitions en `tests/steps/jci/`.

3. Implementar los step definitions en `tests/steps/jci/` mapeando cada
   `Dado / Cuando / Entonces` a las llamadas tRPC o a selectores de Playwright.

4. Los escenarios con `@gap_actual` deben marcarse con `.skip` en la implementación
   hasta que el comportamiento esté disponible en el sistema, y activarse
   escenario por escenario conforme se cierra cada US de Beta.21.

5. Comando de ejecución objetivo (cuando estén implementados):
   ```bash
   npx playwright test --grep @jci
   npx playwright test --grep "@jci and @P0"
   npx playwright test --grep "@gap_actual" --grep-invert  # solo los ya implementados
   ```

6. Los tests E2E JCI deben correr en el workflow `e2e.yml` como suite separada
   (no paralelizar con el resto — comparten BD efímera).

---

## Estado actual

```
SPEC ONLY — ningún escenario en este directorio es ejecutable.
No existen step definitions. No correr como test suite.
```

Referencia gap analysis: `docs/audit/2026-05-30_jci_ipsg_gap.md`  
Plan de sprints: `docs/backlog/jci/E-05_ipsg_sprint_plan.md`  
