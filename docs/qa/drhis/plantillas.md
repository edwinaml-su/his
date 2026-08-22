# @DrHIS — Plantillas de entregables y escala de severidad

Formatos obligatorios de los cuatro entregables del evaluador clínico. Leer antes de producir cualquiera de ellos.

## Escala de severidad

La severidad se asigna por **consecuencia**, no por tamaño del defecto. Un campo que falta puede ser Crítico y un módulo entero ausente puede ser Medio.

| Nivel | Criterio | Ejemplos reales |
|---|---|---|
| **Crítico** | Puede causar daño al paciente, o invalida legalmente el expediente o la factura. No se va a producción con esto abierto. | El sistema deja administrar un medicamento sin verificar alergias · un resultado crítico de laboratorio no llega al médico tratante · un documento firmado se puede modificar después de la firma · un tenant ve datos clínicos de otro |
| **Alto** | Rompe un proceso asistencial o de cobro completo, o deja el expediente incompleto frente a una auditoría. Bloquea la aceptación del módulo. | No se puede registrar el traslado de un paciente entre servicios · la cuenta no captura los cargos de quirófano · falta el consentimiento informado en un procedimiento que lo exige |
| **Medio** | Obliga a retrabajo, doble digitación o un rodeo operativo, pero el proceso se puede completar. | El censo hay que exportarlo a Excel para cuadrarlo · la hoja de anestesia se llena en el sistema y además en papel |
| **Bajo** | Molestia o inconsistencia que no compromete seguridad, expediente ni cobro. | Un rótulo con terminología no clínica · un orden de columnas incómodo |
| **Mejora** | No es defecto: es una oportunidad de hacerlo mejor de lo exigido. | Precargar el diagnóstico más frecuente del servicio · atajo de teclado en triage |

Dos reglas al calificar:

1. **La severidad no baja por ser difícil de arreglar.** El esfuerzo va en la recomendación, no en la severidad.
2. **"No verificado" no es un nivel.** Es un estado, y se reporta aparte. Nunca conviertas un "no lo pude probar" en un "pasa".

---

## 1. Checklist de evaluación

Uno por proceso. Se usa para ejecutar las pruebas de aceptación, así que cada línea debe ser **ejecutable por otra persona sin preguntarte nada**.

```markdown
# Checklist — {Proceso} — {Establecimiento} — {Fecha}

Ambiente: {local | preview PR #N | producción}
Evaluador: {nombre}
Escenario base: {p. ej. "Politraumatizado, máxima urgencia, ingresa a quirófano"}

| # | Paso del escenario | Qué debe hacer el sistema | Rol que lo ejecuta | Resultado | Evidencia | Hallazgo |
|---|---|---|---|---|---|---|
| 1 | Llega el paciente sin documentos | Permite abrir el episodio como no identificado y asignarle un identificador temporal trazable | Admisión / Enfermería de triage | Pasa / Falla / No verificado | captura, id de registro | H-01 |
```

- **Resultado** solo admite `Pasa`, `Falla` o `No verificado`. Nada de "parcial": si no cumple el paso completo, falla.
- **Evidencia** es obligatoria en los `Pasa` de pasos críticos: captura de pantalla, id del registro creado, o la consulta que lo confirma.
- **Hallazgo** referencia al informe. Vacío si pasó.

---

## 2. Informe de hallazgos

```markdown
# Informe de hallazgos — {Alcance} — {Fecha}

## Resumen ejecutivo
{3–5 líneas: qué se evaluó, en qué ambiente, cuántos hallazgos por severidad,
y la conclusión de una frase — ¿este proceso se puede poner en producción o no?}

## Alcance y método
{Procesos recorridos, escenarios usados, ambiente, qué NO se evaluó y por qué.}

## Hallazgos

### H-01 · {Título corto en lenguaje clínico} · **{Severidad}**

- **Proceso / módulo:** {dónde}
- **Qué observé:** {los pasos exactos y lo que hizo el sistema. Reproducible.}
- **Consecuencia:** {clínica, legal o financiera — la razón por la que importa.
  Esta línea es la que justifica la severidad; sin ella el hallazgo no está completo.}
- **Norma aplicable:** {si la hay, con artículo. Si no, "no aplica".}
- **Naturaleza:** {defecto del sistema | falta de configuración | falta de capacitación}
- **Recomendación:** {qué debe pasar para cerrarlo, en términos verificables}
- **Evidencia:** {captura, id, consulta}

## Lo que el sistema hace bien
{Sección obligatoria. Un informe que solo enumera fallas no es creíble
y desorienta la priorización.}

## No verificado
{Lista explícita de lo que quedó sin probar y por qué — ambiente caído,
datos ausentes, permisos. Nunca se omite.}
```

---

## 3. Matriz de cumplimiento normativo

```markdown
# Matriz de cumplimiento — {Alcance} — {Fecha}

| # | Norma y artículo | Qué exige | Qué debe hacer el HIS | Estado | Evidencia | Hallazgo |
|---|---|---|---|---|---|---|
| 1 | {Ley/Reglamento, Art. N} | {la obligación, en sus términos} | {el requisito funcional traducido} | Cumple / No cumple / Parcial / No verificado / No aplica | {dónde se comprobó} | H-0N |
```

- **Parcial** exige decir en la evidencia qué parte cumple y cuál no.
- **No aplica** exige justificación (p. ej. establecimiento privado frente a una norma solo del RIISS).
- Si el estado depende de la **versión vigente** de la norma, verificalo con búsqueda web y anotá la fecha de consulta en la fila.

---

## 4. Plan de configuración

```markdown
# Plan de configuración — {Módulo} — {Fecha}

## Objetivo
{Qué queda habilitado cuando esto se aplique.}

## Parametrización propuesta

### Catálogos
| Catálogo | Valores a cargar | Fuente del dato | Responsable |
|---|---|---|---|

### Roles y permisos
| Rol | Puede | No puede | Justificación clínica |
|---|---|---|---|

### Reglas y validaciones
| Regla | Cuándo dispara | Qué hace | Es hard-stop |
|---|---|---|---|

### Plantillas de documentos clínicos
| Documento | Campos obligatorios | Firma requerida | Inmutable tras firma |
|---|---|---|---|

## Orden de aplicación y dependencias
{Qué va primero y qué depende de qué.}

## Cómo se verifica que quedó bien
{Prueba concreta por cada bloque. Sin esto el plan no se puede cerrar.}
```

Toda regla que se proponga como **hard-stop** debe declarar quién puede sobrepasarla y qué queda registrado cuando lo hace. Un hard-stop sin vía de excepción documentada se convierte en un riesgo clínico el día que hay que salvar una vida.
