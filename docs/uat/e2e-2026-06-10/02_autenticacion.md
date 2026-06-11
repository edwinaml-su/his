# Flujo 2 — Autenticación / Sesión / Roles

**Estado global: PASS (parcial por alcance)** · El login con credenciales no se ejecuta en producción (restricción de seguridad: no escribo contraseñas) y no se prueba logout para no perder la sesión activa.

## Casos

### 2.1 Sesión persistente — PASS
**Obtenido:** El navegador ya tenía sesión iniciada como **Edwin Martínez**. El header muestra organización activa ("Avante Holding"), selector de roles ("Todos los roles (12)") y menú de usuario.

### 2.2 Auth-guard en `/login` estando autenticado — PASS
**Pasos:** Navegar a `/login` con sesión activa.
**Esperado:** Redirección a área autenticada.
**Obtenido:** Redirige a `/dashboard` automáticamente. No reexpone el formulario de login.
**Resultado:** PASS.

### 2.3 Selector de roles activos — PASS
**Pasos:** Abrir el selector "Seleccionar roles activos para esta sesión".
**Obtenido:** Popover "Responsabilidad (rol activo)" con los 12 roles, etiquetas amigables y código técnico: Administrador (ADMIN), Admisionista (ADMISSION_CLERK), Anestesiólogo (ANEST), Director (DIR, badge **MULTI-ORG**), Enfermera NRP (ENF_NRP), Ginecólogo-Obstetra (GO), Enfermería (NURSE)… Todos marcados. Permite multiselección de responsabilidad activa.
**Resultado:** PASS. Cerrado sin modificar selección.

### 2.4 Selector de organización activa — PASS (visible)
**Obtenido:** Botón "Cambiar organización activa" presente con "Avante Holding" — soporte multi-tenant en el header.

### 2.5 Menú de usuario — PASS (visible)
**Obtenido:** Botón "Menú de usuario de Edwin Martinez" presente en el header.

## No probado (por restricción de alcance/seguridad)
- **Login con credenciales** (no se escriben contraseñas en producción).
- **MFA / recuperación** (`firma.requestRecovery`, `mfa.verify`).
- **Logout** (evitado para no perder la sesión y no poder reingresar credenciales).
- **Rate limit en endpoints auth** (requiere intentos fallidos repetidos contra prod — no apropiado).

## Hallazgos
Ninguno. El control de acceso (redirección de `/login`, selector de roles/organización) opera correctamente.
