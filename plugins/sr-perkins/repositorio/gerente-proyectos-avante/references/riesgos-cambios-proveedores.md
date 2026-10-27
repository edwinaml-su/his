# Riesgos, control de cambios, proveedores e interesados

## Registro de riesgos

Formato obligatorio (una fila por riesgo):
| ID | Riesgo (causa → evento → impacto) | Categoría | P (1–5) | I (1–5) | Puntaje | Dueño | Respuesta | Acción concreta | Disparador | Fecha revisión | Estado |

- Redacción causa→evento→impacto evita riesgos vagos: "Porque el proveedor tiene un solo ingeniero HL7 (causa), puede atrasarse la interfaz de laboratorio (evento), retrasando el go-live 3 semanas (impacto)".
- Categorías: técnico, proveedor, organizacional/adopción, regulatorio, financiero, asistencial (seguridad del paciente / continuidad).
- Respuestas para amenazas: evitar, mitigar, transferir, aceptar, escalar; para oportunidades: explotar, mejorar, compartir, aceptar.
- Cadencia: revisión semanal en status; riesgos ≥ 15 con dueño y fecha; se cierran con evidencia, no por olvido.
- Herramientas complementarias: pre-mortem al inicio ("es marzo y fracasó: ¿por qué?"), bow-tie para riesgos asistenciales, árbol de decisión con EMV cuando hay alternativas con costo.

## Solicitud de cambio

Nada que afecte alcance, tiempo, costo o calidad comprometidos se ejecuta sin esta ficha:

```
SC-NNN · Fecha · Solicitante
Descripción del cambio:
Justificación (problema u oportunidad):
Impacto — Alcance: · Tiempo: (días en ruta crítica) · Costo: (USD y % del BAC) · Calidad/riesgo: · Otras gerencias afectadas:
Opciones (mín. 2, incluida "no hacer"):
Recomendación del PM:
Decisión: Aprobada / Rechazada / Diferida · Por: · Fecha:
Actualización de línea base: Sí/No · versión:
```

Flujo: solicitud → análisis de impacto por el PM (≤ 5 días hábiles) → decisión al nivel que corresponda (ver `flujograma-decision.md` §3) → actualización de línea base y comunicación. Cambios pequeños dentro de tolerancia: el PM decide y registra. Scope creep se detecta cuando aparecen entregables fuera de la WBS: parar, registrar, decidir.

## Gestión de proveedores

Antes del contrato (con Legal; ver skill `abogado-notario-el-salvador` si está activa):
- Hitos con **criterio de aceptación verificable** y fecha; pago contra aceptación, no contra entrega.
- Retención (5–10 %) hasta cierre de hypercare; penalidades por día de atraso imputable; cláusula de salida y de propiedad de datos y código/configuración.
- SLA de soporte post-go-live con tiempos de respuesta y resolución por severidad; OLA interno alineado.
- Gobernanza: comité quincenal cliente-proveedor con acta; escalación en dos niveles (líder de implantación → gerente de cuenta → director).

Durante:
- Avance del proveedor se mide con los mismos hitos del cronograma maestro; su "80 % avanzado" sin entregable aceptado cuenta 0 % en EV.
- Todo atraso se documenta por escrito el mismo día (correo o acta) con fecha original, nueva fecha y causa; esa evidencia es lo que vale al reclamar penalidades.
- Dependencias de Avante hacia el proveedor (accesos, datos, decisiones) se rastrean igual: un proveedor atrasado por una decisión nuestra no es imputable.
- Evaluación al cierre de cada fase: calidad, cumplimiento de fechas, comunicación, gestión de incidentes (1–5) → `proveedores.md` de la bitácora.

Señales de alerta que el PM levanta sin esperar: rotación del equipo del proveedor, hitos "parcialmente cumplidos" dos veces seguidas, facturas adelantadas a la aceptación, soluciones "temporales" en producción.

## Interesados y comunicaciones

Matriz poder/interés por gerencia y por rol clave; para cada uno: qué necesita saber, cuándo, por qué canal, quién lo emite.

| Interesado | Poder | Interés | Postura actual | Postura deseada | Mensaje clave | Canal / frecuencia | Responsable |

Plan de comunicaciones mínimo de un proyecto en Avante:
- Patrocinador (TTD): status semanal escrito + reunión quincenal de decisiones.
- Comité de gerencias: one-pager mensual; gate reviews.
- Jefes de servicio / usuarios clave: avance quincenal + demostraciones al final de cada fase.
- Personal operativo: comunicado antes de cada cambio que los afecte (con la Gerencia de Operaciones y RRHH), capacitación programada.
- Proveedor: comité quincenal con acta.

Adopción (cambio organizacional): usar ADKAR para diagnosticar dónde se traba (conciencia, deseo, conocimiento, habilidad, refuerzo) y Kotter para la secuencia de acciones; medir adopción con uso real del sistema, no con asistencia a capacitación.

## Lecciones aprendidas y cierre

Al cierre de fase y de proyecto: sesión de lecciones (qué repetir, qué evitar, qué cambiar en el método), acta de cierre con entregables aceptados, transferencia formal a operación/soporte, liberación de recursos, evaluación de proveedor, archivo en `05-Cierre/`, registro en `lecciones.md` de la bitácora. Un proyecto sin acta de cierre sigue abierto y consumiendo atención.
