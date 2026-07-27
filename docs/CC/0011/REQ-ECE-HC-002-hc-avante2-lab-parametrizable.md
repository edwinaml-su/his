# REQ-ECE-HC-002 — Historia Clínica fiel al mockup avante2 + catálogo de exámenes parametrizable

| Campo | Valor |
|---|---|
| Control de cambios | **CC-0011** |
| Fecha | 2026-07-27 |
| Solicitante | Edwin Martínez (Inversiones Avante) |
| Mockup (fuente de verdad visual) | `docs/CC/0007/historia-clinica-avante2.html` |
| Pantalla | `/ece/historia-clinica/nueva` |
| Rama | `feat/cc-0011-hc-avante2-lab` |
| SQL | `packages/database/sql/185_cc0011_lab_catalogo_parametrizable.sql` — **APLICADO a prod 2026-07-27 vía MCP (no re-aplicar)** |

## 1. Requerimiento

1. Adaptar `/ece/historia-clinica/nueva` al mockup `historia-clinica-avante2.html` con fidelidad total (estructura, iconografía, colores, distribución, comportamiento).
2. Adecuar la base de datos para que todo lo capturado en el mockup persista.
3. La **sección 7 (Misceláneos de consulta)** define un módulo de laboratorio: el catálogo de exámenes (laboratorio clínico, radiología e imágenes, estudios de cardiología) debe vivir en el HIS con **valores parametrizables por categoría**.

## 2. Diseño aprobado (Fase 2 @Orq/@AS/@DBA)

### 2.1 Catálogo parametrizable — extender LIS legacy (regla adecuar-no-duplicar)
- `LabPanel` (ya existía, org-nullable = global/tenant) gana `area` (`LABORATORIO|RADIOLOGIA|CARDIOLOGIA`, CHECK) y `displayOrder`. `LabTest` gana `displayOrder`.
- Seed global (organization_id NULL) con el contenido **literal** de `EXAM_CATALOGS` del mockup: 20 paneles (10 lab / 5 radiología / 5 cardiología) + 93 exámenes, códigos sintéticos estables `AVT-{AREA}-{PANEL}-{NN}`.
- CRUD tenant en `lis.router` (`panel.*`, `test.*`, rol ADMIN/DIR); filas globales solo lectura (FORBIDDEN server-side). Lectura para la HC: `lis.test.listByArea`.
- RLS: cubierta por las policies existentes de `10_lis_rls.sql` (select global-or-tenant, modify solo tenant).
- Admin UI: `(admin)/catalogs/laboratorio` (tabs por área, master-detail panel→exámenes, badge Global/Propio).

### 2.2 Decisiones de fidelidad
| Tema | Decisión |
|---|---|
| "Tipo de consulta" | El mockup lo elimina de la UI; la BD lo exige (NTEC Art. 14, CHECK + inmutabilidad). Se **deriva server-side**: sin HC previa del paciente → `primera_vez`, con HC previa → `subsecuente`. |
| Lesión de Causa Externa (MINSAL) | Botón verde ancho + modal iframe con el formulario embebido del mockup (decodificado de `LESION_B64` → `apps/web/public/forms/lesion-causa-externa.html`). Solo-vista en este CC, igual que el mockup (iframe aislado, sin persistencia propia). |
| Action-cards sin ruta | `Hoja de Remisión` → `/ece/rri/nueva`; `Constancia médica` → `/ece/documento-asociado/nuevo` (precedente CC-0006). Todas propagan `cuentaId`. |
| Solicitudes de exámenes | Al **firmar** la HC, `ordenes_examenes` se materializa en `ece.solicitud_estudio` (1 por tipo: laboratorio / imagenologia / gabinete) para que el módulo de estudios las reciba. |
| Firma | Bug preexistente: la UI enviaba `observacion:"pin:NNNN"` y el router exigía `firmaId` → la firma nunca completaba. Nuevo contrato `firmar({id, pin})` con validación argon2id server-side (patrón hoja-ingreso). |

### 2.3 Fixes de persistencia incluidos
- Round-trip de `complemento` en diagnósticos CIE-11 (se perdía al releer).
- `nombrePila`/`esLgbtiq` persisten al paciente (banner LGBTIQ+ funcional end-to-end).
- Contacto de emergencia editable persiste (`patient.actualizarContactoEmergencia`).
- `contextoCuenta` devuelve documento (DUI), domicilio y tipo de cuenta (chips de cabecera).
- FK real corregida: `registrado_por`/`ejecutado_por` ahora resuelven `ece.personal_salud.id` (antes insertaban el id de auth → violación FK).

## 3. Fuera de alcance (documentado, no silenciado)
- Persistencia estructurada del formulario de Lesión de Causa Externa (MINSAL) — el mockup lo embebe solo-vista.
- Escritura de alergias del formulario a `PatientAllergy` (hoy quedan en `antecedentes_estructurados`; el banner en otras pantallas sigue leyendo del contexto).
- `validar()` de HC conserva el contrato viejo de `firmaId` (rol DIR, sin UI que lo use) — documentado en código.
- Afinar `specimen` por examen del seed (todos `OTHER` en el seed inicial; parametrizable desde el admin).
- Conexión de HIST_CLIN al motor workflow-designer (`documento_instancia_historial` tiene drift preexistente, ver comentario en router).
