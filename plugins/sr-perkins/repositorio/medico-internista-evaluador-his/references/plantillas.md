# Plantillas de entregables y escala de severidad

## Escala de severidad (usar en todos los entregables)

| Nivel | Criterio | Ejemplos |
|---|---|---|
| **Crítico** | Riesgo directo para el paciente, invalidez legal del expediente o de la factura, o bloqueo de la atención de urgencia | Sin registro de alergias visible al prescribir; el sistema exige pago antes de abrir episodio de emergencia; se pueden editar notas clínicas sin rastro |
| **Alto** | Incumplimiento normativo sancionable o fuga/riesgo financiero material, con atención posible pero comprometida | No emite DTE de contingencia; consentimientos sin versión por procedimiento; cargos de quirófano manuales |
| **Medio** | Ineficiencia importante o riesgo indirecto; hay control compensatorio manual | Doble digitación censo–cuenta; sin alerta de evolución diaria faltante |
| **Bajo** | Fricción de uso o brecha menor de datos | Búsqueda de paciente lenta; catálogo sin campo de presentación del fármaco |
| **Mejora** | Oportunidad, no defecto | Tableros, recordatorios, integraciones deseables |

Cada hallazgo dice siempre: qué se observó, **consecuencia** (clínica, legal o financiera), severidad, y recomendación accionable. Distinguir causa: defecto del sistema / falta de configuración / falta de capacitación / falta de proceso del hospital.

## 1. Checklist de evaluación (por proceso)

Encabezado: hospital, HIS y versión, ambiente (demo/prueba/producción), proceso evaluado, evaluador, fecha, escenario(s) recorrido(s).

Tabla de ítems:

| # | Criterio a verificar | Cómo probarlo (paso concreto) | Resultado (Cumple / Parcial / No cumple / No verificado / N/A) | Evidencia / observación | Severidad si falla |
|---|---|---|---|---|---|

Reglas: cada ítem se redacta como algo verificable en el sistema ("Al registrar penicilina en paciente con alergia registrada, aparece alerta bloqueante"), no como generalidad ("el sistema es seguro"). Los ítems salen de `procesos-hospitalarios.md` y `cobros-cuentas.md`, seleccionados y adaptados al alcance acordado. Cierre: resumen (n.º de ítems por resultado) y lista de los No cumple con severidad.

## 2. Informe de hallazgos

Estructura fija:

```
# Informe de evaluación funcional del HIS — [Hospital] — [fecha]
## 1. Resumen ejecutivo
   (5-10 líneas: alcance, veredicto general, los 3-5 hallazgos que más importan, riesgo global)
## 2. Alcance y método
   (procesos evaluados, escenarios recorridos, ambiente, limitaciones — qué NO se evaluó)
## 3. Hallazgos por proceso
   (por cada proceso: qué funciona bien — sí, decirlo—, luego hallazgos numerados:
    H-01 [Severidad] Título · Descripción de lo observado · Consecuencia · Norma afectada si aplica · Recomendación)
## 4. Tabla priorizada de hallazgos
   (todos los hallazgos ordenados por severidad, con proceso, causa y responsable sugerido)
## 5. Recomendaciones y siguientes pasos
   (qué corregir antes de salir a producción / en 90 días / plan de mejora)
```

## 3. Matriz de cumplimiento normativo

| Norma | Obligación concreta | Qué debe hacer el HIS | Estado (Cumple / Parcial / No cumple / No verificado / N/A) | Evidencia | Riesgo si no cumple | Recomendación |
|---|---|---|---|---|---|---|

Filas tomadas de `normativa-el-salvador.md`, filtradas al alcance (no incluir farmacia si no se evaluó farmacia). Cerrar con: porcentaje de cumplimiento por norma, los No cumple de mayor riesgo, y la advertencia estándar de que la matriz es evaluación funcional, no dictamen legal.

## 4. Plan / recomendaciones de configuración

Para trabajos de configuración (no solo evaluación). Por área:

```
## [Área: p. ej. Triage]
- Objetivo clínico/administrativo
- Parámetros propuestos (catálogos, niveles, tiempos, reglas de bloqueo/alerta, plantillas de documentos)
- Roles y permisos involucrados
- Datos maestros necesarios (quién los provee: aranceles, cuadro básico, camas, quirófanos)
- Prueba de aceptación (el escenario que debe pasar para dar por buena la configuración)
```

Priorizar en fases: Fase 1 = lo mínimo legal y de seguridad del paciente para operar; Fase 2 = eficiencia y cobro completo; Fase 3 = indicadores y mejoras.

## Formato de entrega

Si el usuario quiere archivos Word/Excel, usar las habilidades docx/xlsx (checklist y matriz rinden mejor en Excel; informe en Word). Si no especifica, entregar en Markdown y ofrecer la conversión.
