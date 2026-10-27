# Fuentes de Microsoft 365: qué buscar y cómo

Guía operativa para recolectar en el Paso 2. El objetivo no es traer todo, sino traer
lo que requiere acción o seguimiento. Recolecta en paralelo cuando puedas.

Recuerda: las herramientas son diferidas. Cárgalas con `tool_search` y usa los nombres
de parámetro que devuelva; aquí se describe la **intención** de cada búsqueda, no los
parámetros literales.

---

## Ventanas de fecha según el entregable

| Entregable | Correo / Teams | Calendario | SharePoint |
|---|---|---|---|
| Resumen diario | sin responder + últimas 48 h + vencidos | hoy (y mañana temprano) | modificados últimas 72 h |
| Reporte semanal | últimos 7 días | semana en curso + próxima semana | modificados últimos 7 días |
| Tablero | desde la última actualización (o 7 días si es nuevo) | próximos 7 días | desde la última actualización |

---

## 1. Correo de Outlook

Es la fuente principal de **tickets** (los avisos de Odoo llegan aquí) y de muchos
hilos de proyectos y seguridad.

**Tickets / avisos de Odoo.** Busca por el patrón confirmado en Personalización
(remitente o asunto). Si no se confirmó aún, prueba términos amplios y deja que el
contenido lo confirme: `odoo`, `helpdesk`, `ticket`, `incidencia`, `solicitud`,
`#` seguido de número. Para cada ticket relevante identifica: número/referencia,
asunto, quién espera respuesta, antigüedad y si hay fecha comprometida. Distingue:
nuevos, sin responder por el usuario, vencidos, escalados.

**Proyectos.** Busca por los nombres de proyecto confirmados (p. ej. variantes de
"followup"). Prioriza hilos con decisiones pendientes, bloqueos, cambios de alcance o
fechas. Un hilo largo: abre el contenido completo por URI para captar el último
estado, no solo el extracto.

**Seguridad.** Palabras clave (ver lista al final). Marca lo que tenga fecha límite o
implique riesgo (vencimiento de certificados, parches críticos, hallazgos de
auditoría, solicitudes de acceso pendientes).

**Esperando respuesta.** Detecta correos enviados por el usuario sin respuesta del
otro lado: suele ser lo que más se pierde y debe ir destacado.

---

## 2. Calendario de Outlook

Fuente del dominio **programación**, y contexto para los demás.

- Reuniones y compromisos de la ventana del entregable: hora, asunto, organizador,
  si el usuario debe preparar algo.
- Detecta solapamientos y huecos relevantes para planear el día.
- Vincula reuniones con su dominio: una reunión de revisión de proyecto o un comité
  de seguridad alimenta también esos dominios.
- Si el usuario pide proponer horarios para algo, usa la herramienta de
  disponibilidad; si no, no la invoques.

---

## 3. Teams (mensajes/chats)

Fuente de pendientes informales que no llegan por correo: peticiones directas,
acuerdos rápidos, "¿puedes revisar...?", avisos de incidentes.

- Busca menciones al usuario, peticiones de acción y nombres de proyecto.
- Para seguridad: avisos de incidentes, accesos, caídas (relevante por el historial
  de interrupciones de Odoo del usuario), coordinación de respuesta.
- Quédate con lo que implica una acción o un compromiso; ignora la conversación
  social.

---

## 4. SharePoint (documentos)

Fuente de estado documental de **proyectos** y **seguridad/cumplimiento**.

- Busca documentos de los proyectos confirmados y de seguridad en el/los sitio(s) o
  carpeta(s) indicados en Personalización.
- Prioriza lo **modificado recientemente**: indica avance o cambios que seguir.
- Útiles: planes de proyecto, actas, matrices de riesgo, políticas/normativas,
  registros de auditoría, planes de remediación.
- Para un documento clave, abre el contenido por URI y resume el cambio o el estado,
  no el documento entero.

---

## Palabras clave de seguridad (mezcla: TI + física + cumplimiento)

Usa estas como semillas, ampliando con el lenguaje real del usuario:

- **TI**: vulnerabilidad, parche, actualización de seguridad, antivirus, firewall,
  acceso, credenciales, MFA, copia de seguridad/respaldo, restauración, cifrado,
  phishing, incidente, brecha, monitoreo, certificado SSL/TLS por vencer.
- **Física**: control de acceso, cámaras/CCTV, alarma, visitantes, llaves, perímetro,
  rondas, simulacro.
- **Cumplimiento**: auditoría, hallazgo, no conformidad, política, procedimiento,
  normativa, RGPD/protección de datos, evidencia, plan de remediación,
  vencimiento/renovación.

Para cada hallazgo de seguridad registra: descripción, tipo (TI/física/
cumplimiento), si hay fecha límite, riesgo si no se atiende y siguiente acción.

---

## Reglas al recolectar

- **No inventes.** Si una fuente no devolvió nada, dilo; no rellenes.
- **Acota antes de ampliar.** Primero los patrones de Personalización y la ventana de
  fecha; solo amplía si quedó corto.
- **Confirma con el contenido completo** (lectura por URI) antes de afirmar el estado
  de algo importante.
- **Anota qué fuente no se pudo consultar** y el efecto sobre el entregable.
