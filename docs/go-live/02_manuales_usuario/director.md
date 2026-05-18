# Guía Rápida — Director Médico

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Soporte:** WhatsApp "HIS Hipercuidado" | oncall@avante.com

---

## 1. Acceso y módulos disponibles

URL: `https://his-avante.vercel.app/login`

**Módulos principales para el rol Director:**

| Módulo | Ruta | Función |
|---|---|---|
| Cola de pendientes | `/director/queue` | Vista centralizada de todo lo que requiere tu atención |
| Certificaciones | `/director/certifications` | Certificar expedientes clínicos |
| Cola ARCO | `/director/arco` | Gestionar derechos de pacientes (Acceso/Rectificación/Cancelación/Oposición) |
| Cola de rectificaciones | `/director/rectifications` | Aprobar/rechazar rectificaciones de documentos firmados |
| Comité ECE | `/ece/comite` | Minutas y acuerdos del comité de expediente clínico |
| Dashboard calidad | `/dashboard` | Métricas de calidad documental |

---

## 2. Cola de pendientes: tu punto de partida diario

`/director/queue`

La cola de pendientes muestra **todo lo que requiere tu acción**, ordenado por urgencia y fecha:

| Tipo | Descripción | SLA |
|---|---|---|
| Certificación expediente | Expediente listo para certificación formal | 5 días hábiles |
| ARCO — Acceso | Solicitud de paciente de acceder a su expediente | 30 días hábiles |
| ARCO — Rectificación | Solicitud de corregir información | 30 días hábiles |
| ARCO — Cancelación | Solicitud de eliminar datos | 30 días hábiles |
| ARCO — Oposición | Objeción a uso de datos | 30 días hábiles |
| Rectificación ECE | Solicitud de modificar documento ya firmado | 48h (urgentes) |
| Minuta pendiente | Minuta de comité sin firmar | Según convocatoria |

> Recomendación: revisar la cola al inicio del día y al cierre de la tarde.

---

## 3. Certificación de expedientes

### Cuándo se certifica

Un expediente se certifica cuando:
- El paciente solicita una copia certificada para efectos legales o de seguro.
- El médico tratante lo solicita para continuidad de atención.
- Lo requiere un proceso judicial o administrativo.

### Proceso de certificación

1. Ir a "Cola de pendientes" → seleccionar item tipo "Certificación".
2. Revisar el expediente completo:
   - Historia clínica, evoluciones, resultados, diagnósticos, plan de alta.
   - Verificar que está completo (sin secciones vacías requeridas).
3. Si está completo → "Certificar con PIN".
4. Si falta información → "Devolver al médico" con comentario.

### Efectos de la certificación

- El expediente queda con sello digital de Dirección Médica.
- Es inmutable post-certificación (bloqueado para edición).
- El sistema genera un PDF certificado con QR de verificación.
- El PDF puede entregarse al solicitante en formato digital o impreso.

---

## 4. Cola ARCO (derechos de pacientes)

ARCO es el derecho de los pacientes a:
- **A**cceder a su información de salud.
- **R**ectificar información incorrecta.
- **C**ancelar datos cuando corresponda.
- **O**ponerse al tratamiento de sus datos.

### Flujo estándar ARCO

1. Seleccionar solicitud de la cola ARCO.
2. Verificar la identidad del solicitante (datos en la solicitud vs. expediente).
3. Revisar el tipo de solicitud y el alcance.
4. Decidir: **Aprobar** / **Rechazar con causa** / **Solicitar información adicional**.
5. Si se aprueba:
   - Para "Acceso": el sistema genera un expediente para entrega.
   - Para "Rectificación": se abre el expediente para corrección (con audit trail).
   - Para "Cancelación": marcar para anonimización (requiere aprobación de Compliance).
   - Para "Oposición": bloquear el uso de datos para el fin específico señalado.
6. Registrar la entrega o acción con firma y fecha.

### SLA legal (El Salvador)

- Respuesta inicial: **10 días hábiles** desde la recepción de la solicitud.
- Resolución completa: **30 días hábiles**.
- El sistema muestra el contador de días hábiles restantes en cada solicitud.

---

## 5. Cola de rectificaciones ECE

Una rectificación ECE ocurre cuando un médico necesita corregir un documento ya firmado.

### Por qué es necesaria tu aprobación

Un documento firmado digitalmente es inmutable por definición legal. Para corregir un error, el flujo es:
1. El médico solicita rectificación y describe el error.
2. **Tú apruebas o rechazas** como Director Médico (garante de la integridad del expediente).
3. Si aprueba: se crea una addenda al documento original (no se modifica el original).

### Criterios para aprobar

- El error afecta materialmente la información clínica (diagnóstico, dosis, fecha).
- El médico solicitante es el autor del documento.
- La corrección propuesta es clínicamente correcta.

### Criterios para rechazar

- El "error" es en realidad una opinión diferente (no un error factual).
- La rectificación modificaría información que podría afectar procesos legales en curso.

---

## 6. Comité ECE: minuta digital

El comité ECE es la instancia de gobierno del expediente clínico electrónico.

### Registrar una sesión

1. `/ece/comite` → "Nueva sesión".
2. Registrar: fecha, lugar, asistentes (por rol), agenda.
3. Agregar puntos de minuta:
   - Punto: tema discutido.
   - Acuerdo: decisión tomada.
   - Responsable: quién ejecuta.
   - Plazo: fecha límite.
4. Firmar la minuta con PIN.
5. Publicar → todos los asistentes registrados pueden verla.

---

## 7. Dashboard de calidad documental

`/dashboard` (o la sección de calidad en el panel principal)

### Métricas disponibles

| Métrica | Descripción | Meta |
|---|---|---|
| % expedientes completos | Expedientes con todos los documentos requeridos | ≥ 95% |
| Documentos pendientes de firma | Notas sin firmar > 24h | 0 |
| Tiempo promedio de llenado | Desde ingreso hasta expediente completo | < 48h |
| Solicitudes ARCO en plazo | ARCO dentro del SLA legal | 100% |
| Rectificaciones resueltas | Promedio de días para resolver | < 5 días |

### Filtros disponibles

- Por unidad / servicio.
- Por período (día, semana, mes, rango personalizado).
- Por médico.

### Exportar reportes

Botón "Exportar" → seleccionar formato (PDF / Excel) → descargar.

---

## 8. Troubleshooting frecuente

| Problema | Solución |
|---|---|
| No veo items en la cola | Verificar que tu rol está configurado como DIRECTOR para este establecimiento. Contactar ADMIN. |
| El PDF certificado no genera | Esperar 30 segundos y volver a intentar. Si persiste: reportar a WhatsApp HIS. |
| No puedo firmar con PIN | Verificar PIN. Si olvidaste tu PIN: contactar ADMIN para reset. |
| Dashboard sin datos | Los datos se actualizan cada 15 min. Recargar la página. Si persiste vacío: WhatsApp HIS. |

---

## 9. Contactos de soporte

| Situación | Canal |
|---|---|
| Duda funcional | Super-usuario clínico o Ops Lead |
| Error técnico | WhatsApp "HIS Hipercuidado" |
| Decisión de rollback de sistema | PO + SRE Lead (ver `docs/go-live/00_go_live_runbook.md §Rollback`) |
