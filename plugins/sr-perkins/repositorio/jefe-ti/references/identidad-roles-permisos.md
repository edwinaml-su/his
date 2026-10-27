# Identidad, roles y permisos — clientes, colaboradores y proveedores

## 1. Principios (los que se repiten en cada decisión)

1. **Mínimo privilegio**: lo que necesita para su función, nada más; por defecto, nada.
2. **Roles, no personas**: los permisos se asignan a roles/grupos; las personas entran y salen de roles. Evitar permisos directos a usuarios.
3. **Una identidad por persona** (Entra ID como fuente de verdad) + cuentas de servicio nominadas para sistemas (nunca compartidas).
4. **Separación de funciones**: quien pide ≠ quien aprueba ≠ quien otorga; quien administra ≠ quien audita.
5. **Ciclo JML (Joiner–Mover–Leaver)**: alta por RRHH, cambio con revisión de permisos, baja el mismo día (desactivar, no borrar; conservar buzón/archivos según política).
6. **Zero Trust**: verificar siempre (identidad + dispositivo + contexto), MFA para todos, acceso condicional, segmentación.
7. **Trazabilidad**: todo acceso y cambio de permiso queda registrado y revisable; revisión de accesos trimestral (recertificación) para datos clínicos y financieros.
8. **Privilegio justo a tiempo**: administradores sin rol permanente; activación temporal (PIM) con justificación.

## 2. Tres poblaciones, tres modelos

| Población | Identidad | Autenticación | Alcance típico | Caducidad |
|---|---|---|---|---|
| **Colaboradores** (empleados, médicos de planta, enfermería, administrativos) | Cuenta corporativa en Entra ID, sincronizada con RRHH (Odoo/SIRH) | MFA obligatoria (app/FIDO2); SSO a todo | Según rol de negocio (§3) | Baja por RRHH |
| **Médicos no empleados / clínicas arrendatarias / proveedores con operación continua** (laboratorio externo, soporte del HIS, consultores) | Invitado B2B (Entra External ID) o cuenta corporativa de tipo "externo" con dueño interno (sponsor) | MFA obligatoria; acceso condicional (sólo apps asignadas, sin descarga masiva, sesión limitada) | Sólo las apps/sitios/datos del contrato; nunca grupos amplios | Fecha fin de contrato; revisión cada 90 días; expiración automática de invitados inactivos |
| **Clientes / pacientes / aseguradoras** | Identidad externa (Entra External ID / B2C, Auth0, Keycloak) separada del tenant corporativo | MFA opcional/obligatoria según sensibilidad; verificación de identidad al registrar | Sólo su propio dato (paciente) o el de su cartera (aseguradora, con contrato) | Vigencia de la relación |

Regla: **nunca** dar a un externo una cuenta "como si fuera empleado" por comodidad. El costo es auditoría imposible y licencias desperdiciadas.

## 3. Matriz de roles (plantilla hospitalaria)

Formato: rol de negocio → grupos/roles técnicos por sistema. Ajustar nombres al HIS/Odoo/M365 reales y guardar en la bitácora (`accesos.md`).

| Rol de negocio | HIS clínico | Odoo (ERP) | M365 | Datos/BI |
|---|---|---|---|---|
| Médico tratante | Ver/editar expediente de sus pacientes; órdenes; recetas; firma | — | Correo, Teams, SharePoint de su servicio | Tableros de su servicio (RLS) |
| Enfermería | Notas de enfermería, administración de medicamentos, signos; lectura de expediente del área | — | Correo, Teams | — |
| Admisión/caja | Admisión, citas, cargos; **sin** notas clínicas | Facturación, cobro, DTE | Correo | — |
| Farmacia | Dispensación, inventario farmacia | Inventario, compras farmacia | Correo | KPI farmacia |
| Laboratorio | Órdenes y resultados LIS | — | Correo | KPI laboratorio |
| Gerente médico | Lectura amplia con justificación y auditoría; indicadores | Lectura | Correo, Teams, SharePoint gerencia | Tableros clínicos globales |
| Gerente financiero | Sin expediente clínico; sí cargos/cuentas | Contabilidad, tesorería, reportes | Correo, SharePoint finanzas | Tableros financieros |
| RRHH | — | Empleados, nómina | Correo; **no** administración de Entra (lo hace TI a partir del evento de RRHH) | KPI RRHH |
| Mercadeo/Comercial | Sin PHI; datos agregados | CRM, ventas | Correo, Teams, SharePoint comercial | Tableros comerciales |
| TI – soporte | Sin acceso clínico salvo cuenta de emergencia auditada (break-glass) | Administración técnica | Helpdesk, Intune, sin Global Admin | — |
| TI – administrador | Administración técnica del HIS (configuración), sin uso clínico | Admin | Roles de Entra con PIM (nunca Global Admin permanente) | Admin de datos |
| Auditoría/cumplimiento | Sólo lectura de registros de auditoría | Lectura | Purview/auditoría | Lectura |
| Proveedor HIS (soporte) | Entorno de pruebas; producción sólo con ticket + acceso temporal + sesión grabada | — | Teams invitado | — |
| Paciente (portal) | Su expediente (resultados, citas, facturas) | Su cuenta | — | — |
| Aseguradora | Autorizaciones y facturas de sus asegurados | Portal/API | — | — |

Cuentas especiales: **break-glass** (acceso de emergencia al expediente fuera del rol, con motivo, alerta inmediata y revisión en 24 h — exigencia clínica y legal); **cuentas de servicio** (una por integración, secretos en bóveda, sin login interactivo); **administradores de emergencia** del tenant (dos cuentas sólo en nube, sin MFA condicional que las bloquee, credenciales en sobre sellado).

## 4. Modelos técnicos

- **RBAC** (rol → permisos): base para todo; suficiente para el 80 %.
- **ABAC** (atributos: servicio, sede, turno, relación médico-paciente): necesario en lo clínico ("ve a los pacientes de su servicio, en su sede, durante su turno"); se implementa con RLS en datos y reglas en el HIS.
- **ReBAC** (relaciones: "es médico tratante de"): lo que de verdad regula el acceso al expediente; registrar la relación en el HIS y evaluar en cada lectura.
- **Herencia y grupos anidados**: usar con moderación; documentar.
- **Protocolos**: OIDC/OAuth2 para apps web y móviles (SMART on FHIR en salud), SAML sólo para legados, **SCIM** para aprovisionamiento automático a SaaS, LDAP/Kerberos para AD on-prem (con Entra Connect si hay híbrido), RADIUS/802.1X para red y Wi-Fi.

## 5. Microsoft 365 / Entra ID — guía práctica

- **Licencias**: asignar por grupo (group-based licensing): Business/E3/E5 según rol; F3/Business Basic para personal de primera línea; invitados sin licencia (uso de B2B); Copilot para quienes lo justifican. Revisar licencias sin uso mensualmente.
- **Grupos**: de seguridad para permisos, M365 para colaboración (Teams/SharePoint), dinámicos por atributo (departamento, sede) cuando RRHH alimenta atributos. Convención de nombres: `SEC-<sistema>-<rol>`, `M365-<área>`, `EXT-<proveedor>`.
- **Acceso condicional**: MFA para todos; bloquear autenticación heredada; dispositivos administrados (Intune) para datos sensibles; ubicaciones nombradas; sesión limitada para invitados; riesgo de inicio de sesión (si licencia P2).
- **PIM**: roles administrativos elegibles, no activos; aprobación y justificación; alertas.
- **Invitados (B2B)**: política de quién invita, expiración automática, revisión de accesos, restringir descarga/copia en SharePoint (etiquetas de sensibilidad), sin acceso al directorio.
- **SharePoint/Teams**: permisos por grupos, nunca "todos excepto externos" en sitios con datos personales; etiquetas de sensibilidad (Purview); DLP para PHI, DUI, tarjetas.
- **Intune**: línea base de seguridad, BitLocker, actualizaciones, apps aprobadas, borrado remoto.
- **Defender/Purview**: auditoría unificada activa, retención, alertas de exfiltración.
- **Global Admin**: máximo 2–4 personas, con PIM, sin uso diario.

## 6. Procedimientos (ciclo de vida)

**Alta**: RRHH registra → evento → TI crea cuenta y asigna grupos del rol (plantilla) → MFA en inducción → acuse de política de uso → acceso al HIS según perfil clínico validado por Gerencia Médica.
**Cambio de rol**: retirar grupos anteriores (no acumular) → asignar nuevos → notificar dueños de datos.
**Baja**: deshabilitar cuenta, revocar sesiones, retirar licencias tras conservar buzón/OneDrive (política: 30–90 días), transferir propiedad de archivos/grupos, retirar invitado de proveedores, devolver equipo (Intune wipe).
**Proveedor**: contrato con cláusula de confidencialidad y tratamiento de datos → sponsor interno → invitado con fecha fin → acceso sólo a lo contratado → sesión grabada en producción → revisión mensual.
**Recertificación**: trimestral para clínico/financiero/admin; semestral el resto; dueño de datos aprueba o retira.

## 7. Entregables de este dominio

- **Matriz de roles y permisos** (tabla §3 adaptada) con columnas: rol, sistema, permisos, dueño del dato, aprobador, revisión.
- **Política de control de acceso** (alcance, principios, roles, JML, externos, break-glass, auditoría, sanciones).
- **Plan de licenciamiento M365** con costo mensual y grupos.
- **Scripts** (PowerShell/Microsoft Graph) para crear grupos, asignar licencias, reportar invitados inactivos, exportar permisos — siempre para ejecutar con el usuario.
- **Procedimiento de acceso de proveedores** y plantilla de solicitud.
- **Informe de revisión de accesos** con hallazgos y retiros propuestos.
