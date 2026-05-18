# 03 — Plan de Capacitación Staff — Go-Live HIS Avante

**Proyecto:** HIS Multipaís — Inversiones Avante  
**Autor:** @PO + @SRE  
**Versión:** 1.0 — 2026-05-18  
**Referencias:** `docs/go-live/02_manuales_usuario/`, `docs/go-live/01_uat_scenarios.md`

---

## 1. Resumen del plan

| Sesión | Roles | Duración | Modalidad | Fecha objetivo |
|---|---|---|---|---|
| Sesión 1 — Flujo clínico + bedside | MC + ENF | 2h | Presencial (sala capacitación) | T-5 días |
| Sesión 2 — Farmacia | FARM | 2h | Presencial (sala capacitación) | T-5 días |
| Sesión 3 — Gobierno y cumplimiento | DIR | 1h | Mixto (presencial + remoto) | T-4 días |
| Sesión 4 — Configuración + monitoring | ADMIN | 1h | Presencial (sala TI) | T-4 días |
| Repaso pre go-live | Todos | 30 min | Presencial + transmisión | T-1 día |

**Total:** ~6.5 horas de capacitación + repaso.

**Instructor:** Responsable funcional por sesión (Clinical Lead para Sesiones 1-3, SRE Lead para Sesión 4) con apoyo del equipo de desarrollo para preguntas técnicas.

---

## 2. Sesión 1 — Flujo clínico básico + bedside (MC + ENF, 2h)

**Objetivo:** que cada médico y enfermero pueda completar el flujo completo de un paciente de principio a fin sin asistencia.

**Prerrequisitos:**
- Sala con proyector y 1 PC por pareja de participantes.
- Ambiente de sandbox configurado con pacientes de prueba.
- Cada participante debe haber activado su cuenta antes de la sesión.

### Agenda (2h)

| Tiempo | Tema | Material |
|---|---|---|
| 0:00 - 0:10 | Bienvenida + objetivos del sistema | Presentación PPT — Slide 1-5 |
| 0:10 - 0:30 | Navegación básica: login, MFA, selección establecimiento | Demo en vivo + ejercicio guiado |
| 0:30 - 0:55 | Flujo MC: buscar paciente → historia clínica → nota SOAP → prescripción | Demo + ejercicio práctico |
| 0:55 - 1:05 | Firma electrónica: PIN, qué documentos requieren firma | Demo + práctica |
| 1:05 - 1:25 | Flujo ENF: triaje Manchester → signos vitales → nota enfermería | Demo + ejercicio práctico |
| 1:25 - 1:50 | Bedside scan: verificación 5 correctos + hard-stops esperados | Demo tablet + ejercicio con lector GS1 |
| 1:50 - 2:00 | Contingencia: qué hacer si el sistema cae | Formularios físicos + `contingencia.md` |

### Ejercicios prácticos (Sesión 1)

**Ejercicio 1 (20 min) — Flujo MC completo:**
- Buscar paciente "JUAN PEREZ TEST" en el sandbox.
- Registrar nota SOAP con diagnóstico CIE-10 "Z00.0".
- Crear prescripción de "Paracetamol 500mg VO cada 8h por 3 días".
- Firmar la prescripción con el PIN del sandbox (`123456`).

**Ejercicio 2 (20 min) — Triaje + bedside:**
- Registrar triaje de paciente walk-in con discriminante "Dolor torácico".
- Registrar signos vitales del mismo paciente.
- Simular scan de pulsera (sticker de demo) y medicamento.
- Provocar un hard-stop intencionalmente (escanear medicamento incorrecto).

### Hard-stops que deben conocer antes del go-live

1. `MEDICAMENTO_NO_COINCIDE` — Qué significa, qué hacer.
2. `MEDICAMENTO_VENCIDO` — Qué significa, qué hacer.
3. `ALERGIA_DETECTADA` — Qué significa, qué hacer (NUNCA ignorar).

---

## 3. Sesión 2 — Farmacia (FARM, 2h)

**Objetivo:** que cada farmacéutico pueda operar el picking station, gestionar sustituciones y armar un carrito unidosis.

**Prerrequisitos:**
- Lector GS1 disponible (o tablet con cámara para emulación).
- Sandbox con órdenes de dispensación precargadas.
- Medicamentos de muestra con DataMatrix para escaneo real.

### Agenda (2h)

| Tiempo | Tema | Material |
|---|---|---|
| 0:00 - 0:10 | Contexto GS1: qué es GTIN, GLN, GSRN | Presentación PPT — Slide GS1 |
| 0:10 - 0:35 | Picking station: cola de órdenes → scan → dispensación | Demo + ejercicio con lector |
| 0:35 - 0:55 | Hard-stops farmacia: vencido, recall, alergia, no coincide | Demostración de cada hard-stop |
| 0:55 - 1:20 | Sustitución autorizada: solicitud → espera → aprobación médico | Demo con rol MC en otra pantalla |
| 1:20 - 1:45 | Carrito unidosis: preparación → LISTO → despacho → recepción ENF | Demo flujo completo |
| 1:45 - 1:55 | Recepción de medicamentos: ingreso al stock | Demo |
| 1:55 - 2:00 | Contingencia farmacia + manejo de alarmas | Formulario FF-01 |

### Ejercicios prácticos (Sesión 2)

**Ejercicio 1 (25 min) — Picking station completo:**
- Seleccionar una orden de dispensación del sandbox.
- Escanear medicamento correcto → confirmar dispensación.
- Escanear medicamento incorrecto → observar hard-stop.
- Escanear medicamento con fecha vencimiento = ayer → observar hard-stop VENCIDO.

**Ejercicio 2 (25 min) — Carrito unidosis:**
- Crear carrito para turno "Mañana", sala "Urgencias Test".
- Agregar 3 medicamentos para 2 pacientes de prueba.
- Marcar como LISTO → Despachar.
- Desde otra pantalla (rol ENF), confirmar recepción.

---

## 4. Sesión 3 — Gobierno y cumplimiento (DIR, 1h)

**Objetivo:** que el Director Médico pueda gestionar la cola de pendientes, certificar expedientes, atender solicitudes ARCO y moderar el comité ECE.

**Prerrequisitos:**
- Sandbox con expedientes en cola de certificación.
- Solicitud ARCO precargada (tipo "Acceso").

### Agenda (1h)

| Tiempo | Tema | Material |
|---|---|---|
| 0:00 - 0:10 | Rol del Director en el HIS: responsabilidades y firma | Presentación PPT — Slide DIR |
| 0:10 - 0:25 | Cola de pendientes + certificación de expedientes | Demo + ejercicio |
| 0:25 - 0:40 | Cola ARCO: tipos de solicitudes + SLAs legales + flujo | Demo + ejercicio |
| 0:40 - 0:50 | Rectificaciones ECE + comité ECE + minuta | Demo |
| 0:50 - 1:00 | Dashboard de calidad + cómo leer métricas | Demo |

### Ejercicio práctico (Sesión 3)

**Ejercicio 1 (15 min) — Flujo DIR completo:**
- Ir a cola de pendientes del sandbox.
- Revisar y certificar un expediente de ejemplo.
- Revisar y aprobar una solicitud ARCO tipo "Acceso".

---

## 5. Sesión 4 — Configuración y monitoring (ADMIN, 1h)

**Objetivo:** que el Administrador del sistema pueda crear usuarios, asignar roles, verificar el audit log y responder a alertas básicas.

**Prerrequisitos:**
- Acceso ADMIN al sandbox con usuarios precargados.
- Pantalla con Vercel Dashboard y Sentry (modo lectura).

### Agenda (1h)

| Tiempo | Tema | Material |
|---|---|---|
| 0:00 - 0:10 | Topología del sistema: Vercel + Supabase + Sentry | Diagrama de arquitectura |
| 0:10 - 0:25 | Gestión de usuarios: crear, editar, desactivar, reset PIN | Demo + ejercicio |
| 0:25 - 0:35 | Configuración org: gs1CompanyPrefix, establecimientos | Demo |
| 0:35 - 0:45 | Audit log: verificación integridad + qué hacer si hay ruptura | Demo + simulación |
| 0:45 - 0:55 | Monitoring: Vercel Dashboard + Sentry alerts + health check | Demo en vivo |
| 0:55 - 1:00 | Escalación: cuándo llamar al SRE + protocolo de rollback | Runbook summary |

### Ejercicio práctico (Sesión 4)

**Ejercicio 1 (15 min) — Gestión de usuarios:**
- Crear un usuario nuevo con rol NURSE para establecimiento "Urgencias Test".
- Asignarle un segundo rol como SUPERVISOR en otro establecimiento.
- Desactivar el usuario recién creado.

---

## 6. Repaso pre go-live (todos, 30 min, T-1 día)

**Modalidad:** Sala principal presencial + transmisión por video para personal de turno que no puede asistir físicamente.

### Agenda (30 min)

| Tiempo | Tema |
|---|---|
| 0:00 - 0:05 | Estado del sistema: qué está listo, qué es nuevo |
| 0:05 - 0:10 | Recordatorio de hard-stops críticos (bedside + farmacia) |
| 0:10 - 0:15 | Protocolo de contingencia: formularios disponibles y procedimiento |
| 0:15 - 0:20 | Canales de soporte: WhatsApp HIS Hipercuidado + super-usuarios |
| 0:20 - 0:25 | Q&A de últimas preguntas |
| 0:25 - 0:30 | Anuncio: hora oficial de go-live + primeros pasos |

---

## 7. Material de capacitación

### Presentaciones PPT (outline para equipo de comunicaciones)

**PPT Sesión 1 — Clínico (25 slides estimados):**

| Slide # | Tema |
|---|---|
| 1-3 | Portada + Por qué el HIS: beneficios para el paciente y para ti |
| 4-6 | Visión general: qué registras en el sistema |
| 7-9 | Login + MFA: paso a paso visual |
| 10-14 | Flujo MC: buscar paciente → historia → SOAP → prescripción |
| 15-17 | Firma electrónica: qué es, por qué importa, cómo funciona |
| 18-22 | Flujo ENF: triaje → vitales → nota → bedside 5 correctos |
| 23-24 | Hard-stops: los 3 más comunes, qué hacer |
| 25 | Contactos de soporte |

**PPT Sesión 2 — Farmacia (20 slides estimados):**

| Slide # | Tema |
|---|---|
| 1-3 | Portada + GS1 en farmacia: GTIN, GSRN, GLN |
| 4-8 | Picking station: flujo visual paso a paso |
| 9-12 | Hard-stops farmacia: vencido, recall, no coincide, alergia |
| 13-15 | Sustitución autorizada: flujo con el médico |
| 16-18 | Carrito unidosis: preparación y despacho |
| 19-20 | Contingencia + contactos |

### Videos screencast recomendados (grabar antes del go-live)

| Video | Duración | Contenido |
|---|---|---|
| `v01_login_mfa.mp4` | 3 min | Login paso a paso con MFA |
| `v02_buscar_paciente.mp4` | 2 min | Búsqueda de paciente y expediente |
| `v03_nota_soap.mp4` | 4 min | Registro de consulta médica completa |
| `v04_firma_pin.mp4` | 2 min | Firma electrónica con PIN |
| `v05_triaje_manchester.mp4` | 3 min | Triaje completo con discriminante |
| `v06_bedside_scan.mp4` | 5 min | Bedside con scan GS1: OK + hard-stop |
| `v07_picking_station.mp4` | 4 min | Dispensación en farmacia |
| `v08_carrito_unidosis.mp4` | 5 min | Carrito completo de principio a fin |
| `v09_contingencia.mp4` | 3 min | Qué hacer cuando el sistema cae |

### Sandbox para práctica autónoma

URL del sandbox: `https://his-staging.vercel.app` (configurar antes de T-7)

Usuarios predefinidos en sandbox (contraseña `TestPass123!`):

| Usuario | Rol |
|---|---|
| `capacitacion.mc@avante.com` | PHYSICIAN |
| `capacitacion.enf@avante.com` | NURSE |
| `capacitacion.farm@avante.com` | PHARMACIST |
| `capacitacion.dir@avante.com` | DIRECTOR |
| `capacitacion.admin@avante.com` | ADMIN |

El sandbox se resetea diariamente a las 00:00 con datos de prueba limpios.

---

## 8. Evaluación: quiz pre/post + certificación interna

### Quiz (10 preguntas, 5 min)

Aplicar el mismo quiz antes y después de cada sesión para medir aprendizaje.

**Preguntas base (adaptar por rol):**

1. ¿Qué hacer cuando ves un hard-stop `ALERGIA_DETECTADA`?
   - a) Ignorarlo y continuar   b) Detener y consultar al médico   c) Recargar la página
   - **Respuesta correcta: b**

2. ¿Con qué frecuencia debes cambiar tu contraseña del HIS?
   - a) Cada semana   b) Cada 3 meses   c) Solo cuando la olvidas
   - **Respuesta correcta: b** (o según política definida en ADMIN)

3. Si el sistema está caído y necesitas administrar un medicamento urgente, ¿qué haces?
   - a) Esperar a que el sistema vuelva   b) Usar el formulario FRA-01 en papel   c) Llamar al administrador
   - **Respuesta correcta: b**

4. ¿Qué significa que un documento esté "FIRMADO" en el HIS?
   - a) Que el médico lo revisó   b) Que está listo para impresión   c) Que es inmutable y tiene valor legal
   - **Respuesta correcta: c**

5. ¿Quién puede ver el expediente completo de un paciente?
   - a) Cualquier usuario del sistema   b) Solo el médico tratante   c) Los usuarios con acceso clínico al paciente (médico, enfermería) y el Director para certificación
   - **Respuesta correcta: c**

(Preguntas 6-10 específicas por rol — elaborar con Clinical Lead)

### Certificación interna

**Criterio de aprobación:** ≥ 80% en quiz post-sesión (8/10 respuestas correctas).

**Formato del certificado:**
- Nombre del participante
- Rol y establecimiento
- Sesión(es) aprobadas
- Fecha
- Firma del instructor (Clinical Lead o SRE Lead)

El Administrador del sistema activará la cuenta en producción solo para participantes certificados. Sin certificado = sin acceso al go-live.

---

## 9. Registro de asistencia y certificación

| Nombre | Rol | Establecimiento | Sesión 1 | Sesión 2 | Sesión 3 | Sesión 4 | Quiz % | Certificado | Cuenta activa |
|---|---|---|---|---|---|---|---|---|---|
| | | | [ ] | [ ] | [ ] | [ ] | | [ ] | [ ] |
| | | | [ ] | [ ] | [ ] | [ ] | | [ ] | [ ] |

> Completar esta tabla antes del go-live. Entregar copia a RRHH y a SRE Lead.

---

## 10. Responsables de ejecución del plan de capacitación

| Actividad | Responsable | Fecha límite |
|---|---|---|
| Configurar sandbox con datos de prueba | SRE Lead | T-7 |
| Preparar presentaciones PPT | Clinical Lead + Comunicaciones | T-6 |
| Grabar videos screencast | Dev on-call | T-6 |
| Imprimir formularios de contingencia | Ops Lead | T-5 |
| Ejecutar Sesión 1 (MC + ENF) | Clinical Lead | T-5 |
| Ejecutar Sesión 2 (FARM) | Clinical Lead | T-5 |
| Ejecutar Sesión 3 (DIR) | Clinical Lead | T-4 |
| Ejecutar Sesión 4 (ADMIN) | SRE Lead | T-4 |
| Aplicar quiz y emitir certificados | Clinical Lead | T-3 |
| Activar cuentas producción de certificados | ADMIN | T-2 |
| Repaso pre go-live (todos) | PO + SRE Lead | T-1 |
