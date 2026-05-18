# Guía Rápida — Administrador del Sistema

**Sistema:** HIS Avante Complejo Hospitalario  
**Versión:** 1.0 — 2026-05-18  
**Soporte:** SRE on-call | WhatsApp "HIS Hipercuidado" | oncall@avante.com

---

## 1. Acceso y responsabilidades del rol ADMIN

URL: `https://his-avante.vercel.app/login`

El rol ADMIN tiene acceso a:

| Módulo | Ruta | Función |
|---|---|---|
| Organizaciones | `/admin/organizations` | Configurar org, gs1CompanyPrefix, establecimientos |
| Usuarios | `/admin/users` | Crear, editar, desactivar usuarios |
| Roles | `/admin/roles` | Asignar roles por usuario y establecimiento |
| Audit Log | `/admin/audit` | Revisar integridad del audit log |
| Workflow Designer | `/workflow-designer` | Configurar flujos de trabajo |
| Catálogos GS1 | `/admin/gs1` | GLN, medicamentos, GTIN |
| Configuración | `/admin/settings` | Parámetros del sistema |

> **El ADMIN no tiene acceso a expedientes clínicos de pacientes** — eso es por diseño (separación de roles).

---

## 2. Gestión de organizaciones y establecimientos

### Configurar gs1CompanyPrefix

`/admin/organizations` → Seleccionar organización → "Editar"

El `gs1CompanyPrefix` es el prefijo GS1 de la organización, requerido para generar GTINs y GSRNs válidos.

- **Formato:** 7-9 dígitos numéricos.
- **Para El Salvador:** usar el prefijo asignado por GS1 Costa Rica (organización GS1 para Centroamérica).
- **Ejemplo:** `7503000` (hipotético para Avante).
- Una vez configurado, todos los códigos GS1 del sistema usarán este prefijo.

### Agregar un establecimiento

`/admin/organizations` → Seleccionar organización → "Establecimientos" → "Nuevo"

Campos requeridos:
- Nombre del establecimiento
- Tipo (Hospital / Clínica / Centro de salud)
- Dirección
- GLN (Global Location Number — si aplica)
- Activo: Sí/No

---

## 3. Gestión de usuarios

### Crear nuevo usuario

`/admin/users` → "Nuevo usuario"

1. Ingresar:
   - Nombre completo
   - Email institucional (recibirá la invitación de activación)
   - Rol principal (PHYSICIAN / NURSE / PHARMACIST / DIRECTOR / ADMIN)
   - Establecimiento(s) al que tendrá acceso
2. Hacer clic en "Crear y enviar invitación".
3. El usuario recibirá un email para activar su cuenta.
4. El link de activación es válido por 48 horas. Si expira: "Reenviar invitación" desde el listado.

### Asignar múltiples roles

Un usuario puede tener diferentes roles en diferentes establecimientos:
- El mismo médico puede ser PHYSICIAN en "Urgencias" y SUPERVISOR en "Consulta externa".
- Ir a `Usuarios` → seleccionar usuario → "Roles y establecimientos" → agregar combinación.

### Desactivar un usuario

`/admin/users` → Buscar usuario → "Desactivar cuenta"

- El usuario pierde acceso inmediatamente (sin esperar a que expire su sesión).
- Los datos registrados por ese usuario NO se eliminan (inmutabilidad del expediente).
- La desactivación es auditable y reversible.

**Casos para desactivar:**
- Empleado que se desvinculó de la institución.
- Cuenta sospechosa de uso no autorizado.
- Usuario que no completó el proceso de capacitación.

### Depuración de usuarios inactivos

Recomendado cada 90 días:

`/admin/users` → Filtro "Último acceso" → "Hace más de 90 días"

Revisar la lista y desactivar cuentas de:
- Personal que ya no labora.
- Estudiantes o practicantes cuya rotación terminó.
- Cuentas de prueba que ya no se necesitan.

---

## 4. Monitoring operativo diario

### Checklist diario (5 minutos)

1. **Vercel Dashboard:** verificar que el último deploy está en estado "READY".
   - URL: `https://vercel.com/avante/his-avante/deployments`
   
2. **Sentry:** verificar que no hay issues P1 nuevas en las últimas 24h.
   - Org: `avante-his` → Issues → filtrar `environment:production`
   
3. **Supabase:** verificar estado de la BD.
   - Dashboard → Database → visualmente: CPU < 50%, Connections < 80%.

4. **UptimeRobot:** verificar uptime% > 99.5% en últimas 24h.

### Health check rápido

```bash
curl -s https://his-avante.vercel.app/api/health | python -m json.tool
# Esperado: { "status": "ok", "checks": { "db": { "status": "ok" } } }
```

---

## 5. Audit log: verificación de integridad

`/admin/audit`

### Qué es el audit log

Cada acción en el sistema (crear, editar, eliminar datos) genera un registro en el audit log con:
- Usuario que realizó la acción
- Timestamp exacto
- Datos antes y después del cambio
- Hash criptográfico (chain hash)

La **cadena de hash** garantiza que el audit log no fue manipulado retroactivamente.

### Verificar integridad

1. Navegar a `/admin/audit` → "Verificar integridad".
2. Seleccionar rango de fechas (default: últimas 24h).
3. El sistema verifica que la cadena de hash es continua.
4. Resultado esperado: "ÍNTEGRA" con 0 rupturas.

### Si hay una ruptura

Si el verificador reporta una ruptura de cadena:
1. Anotar la tabla y el timestamp donde ocurrió.
2. **Escalar inmediatamente a SRE on-call** — esto es un incidente P1.
3. NO hacer nada más en el sistema hasta que SRE investigue.

---

## 6. Catálogos GS1

### GLN (Global Location Numbers)

`/admin/gs1` → "GLN"

Los GLN identifican ubicaciones físicas (farmacia central, salas, almacenes).

Para agregar un GLN:
1. "Nuevo GLN" → ingresar número (13 dígitos), nombre, tipo (PHARMACY / WARD / STORAGE), parentGLN si es subestructura.
2. El árbol de GLN se construye con esta jerarquía.

### Medicamentos y GTIN

`/admin/gs1` → "Medicamentos"

Al recibir nuevos medicamentos no registrados:
1. "Nuevo medicamento" → ingresar: GTIN (14 dígitos), nombre genérico, principio activo, concentración, forma farmacéutica.
2. Si el medicamento tiene recall activo: marcarlo en "Estado = RECALL" con número de alerta.

---

## 7. Troubleshooting común

### El usuario dice que "no puede ver X módulo"

1. Verificar que su rol tiene acceso al módulo (`/admin/users` → usuario → ver roles).
2. Verificar que el establecimiento seleccionado en su sesión es correcto.
3. Si el rol es correcto: pedirle que cierre sesión y vuelva a entrar.

### El usuario olvidó su PIN de firma

1. `/admin/users` → seleccionar usuario → "Reset PIN".
2. El usuario recibirá un email con instrucciones para crear un nuevo PIN.
3. Registrar el reset en el log de soporte (fecha, usuario, ADMIN que lo realizó).

### El usuario olvidó su contraseña

1. `/admin/users` → "Enviar reseteo de contraseña" → el usuario recibe email.
2. Si el email no llega: verificar que la dirección es correcta y que no está en spam.

### El sistema muestra "Error 500" generalizado

1. Verificar en Vercel Dashboard que el último deploy está en estado "READY".
2. Verificar en `/api/health` si la BD está respondiendo.
3. Si ambos están OK y persiste el error 500: escalar a SRE on-call.

### Supabase advisors muestra warnings nuevos

1. Documentar el warning (tipo, tabla afectada).
2. Verificar en `docs/go-live/04_carry_over_manual.md` si es un warning conocido.
3. Si es nuevo y es CRITICAL: escalar a SRE de inmediato.
4. Si es WARNING: registrar en el backlog para resolver en el siguiente sprint.

---

## 8. Workflow Designer

`/workflow-designer`

El Workflow Designer permite ver y configurar los flujos de trabajo del sistema.

**Flujos disponibles:**
- Triaje Manchester
- Admisión hospitalaria
- Dispensación GS1
- Bedside administration (5 correctos)
- Certificación Director
- Flujo ARCO

**Para modificar un flujo:**
1. Seleccionar el flujo → "Editar".
2. Hacer cambios (pasos, roles asignados, hard-stops).
3. Guardar en estado BORRADOR.
4. Publicar (requiere aprobación de Director Médico para flujos clínicos).

> No modificar flujos clínicos sin coordinación con el Clinical Lead.

---

## 9. Contactos y escalación

| Situación | Contacto |
|---|---|
| Duda de configuración | SRE Lead (WhatsApp personal) |
| Incidente P1 (caída sistema) | WhatsApp "HIS Hipercuidado" — urgente |
| Error de BD o audit chain | SRE on-call — P1 inmediato |
| Rollback requerido | Activar protocolo `docs/go-live/00_go_live_runbook.md §Rollback` |
