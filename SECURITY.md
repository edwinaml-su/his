# Política de Divulgación Responsable — HIS Avante

**Sistema:** HIS Multipaís — Sistema de Información Hospitalaria de Inversiones Avante  
**Mantenedor:** Unidad de Transformación Digital, Inversiones Avante  
**Contacto de seguridad:** emartinez@complejoavante.com

---

## Alcance

Esta política aplica al sistema HIS en producción accesible en:

- `https://his-avante.vercel.app` (producción principal)
- Cualquier subdominio bajo `complejoavante.com` asociado al HIS

**Fuera de alcance:**

- Servicios de terceros (Supabase, Vercel, GitHub) — reportar directamente a sus respectivos programas de bug bounty.
- Ataques de ingeniería social contra empleados.
- Ataques físicos a infraestructura.
- Ataques de denegación de servicio (DoS/DDoS).

---

## Cómo reportar una vulnerabilidad

1. **No divulgues públicamente** la vulnerabilidad antes de recibir confirmación de remediación.
2. Envía un correo a **emartinez@complejoavante.com** con asunto `[SECURITY] <descripción breve>`.
3. Incluye en tu reporte:
   - Descripción del hallazgo y su impacto potencial.
   - Pasos para reproducir (proof of concept mínimo).
   - URLs, endpoints o componentes afectados.
   - Tu nombre o alias (opcional, para crédito en el advisory).

---

## Tiempos de respuesta comprometidos

| Evento | Plazo |
|---|---|
| Acuse de recibo | 48 horas hábiles |
| Evaluación de severidad | 5 días hábiles |
| Remediación P0/P1 | 30 días calendario |
| Remediación P2/P3 | 90 días calendario |
| Notificación al investigador post-remediación | Al cerrar el ticket |

---

## Compromisos del equipo

- Trabajaremos contigo para entender y remediar el hallazgo.
- No iniciaremos acciones legales contra investigadores que actúen de buena fe y dentro del alcance de esta política.
- Reconoceremos tu contribución en el advisory público (si lo deseas) una vez remediado.

---

## Compromisos del investigador

- No acceder a datos de pacientes reales (PII/PHI) más allá de lo mínimo necesario para demostrar el hallazgo.
- No modificar, eliminar ni exfiltrar datos.
- No interrumpir la disponibilidad del sistema (es un sistema de salud en uso clínico activo).
- Usar únicamente cuentas de prueba provistas por el equipo si se requiere autenticación.

---

## Severidad esperada y contexto

El HIS gestiona información clínica sensible (PHI) de pacientes. Los hallazgos con mayor impacto potencial incluyen:

- Acceso no autorizado a registros de pacientes (PHI/PII).
- Bypass de autenticación o autorización (RLS, RBAC).
- Inyección SQL o ejecución remota de código.
- Escalación de privilegios entre organizaciones (multi-tenancy bypass).
- Exposición de credenciales o tokens de API.

---

*Última actualización: 2026-05-30*
