# Feature: Otorgar consentimiento de privacidad en el portal del paciente
# Referencia: US.B20.3.1, US.B20.3.2
# Regulatoria: TDR §6.4 ("Compartición controlada bajo consentimiento del paciente"), D.39/2024 Art. 13-15
# Owner: @QAF — Quality Analyst (BDD)
# Notas: Este archivo es especificación BDD (no está automatizado — @QA lo implementará en Beta.20b)
#        El texto legal del consentimiento debe ser aprobado por el área legal de Avante antes de implementar.

Característica: Otorgar y revocar consentimiento de privacidad en el portal del paciente

  Contexto:
    Dado que el paciente "Ana García" tiene una cuenta activa en el portal
    Y que "Ana García" está autenticada con JWT { patient_id: "uuid-ana", role: "patient", invited_by_org_id: "org-hospital-a" }
    Y que el grupo Inversiones Avante tiene 2 establecimientos: "Hospital A" y "Clínica B"
    Y que "Ana García" NO tiene consentimientos activos de tipo "MULTI_ORG"
    Y que el texto legal del consentimiento multi-org ha sido aprobado por el área legal de Avante

  Escenario: Ver pantalla de consentimientos sin consentimientos activos
    Dado que "Ana García" está en /portal/consentimientos
    Cuando el sistema carga la página
    Entonces ve la sección "Mis consentimientos" con el estado "Sin consentimientos activos"
    Y ve la sección "Consentimientos disponibles" con el consentimiento "Acceso compartido entre establecimientos Avante" en estado "Pendiente de tu aprobación"
    Y ve un enlace a "Derechos de privacidad" para solicitar ARCO
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="consents" y patient_id="uuid-ana"

  Escenario: Otorgar consentimiento multi-organización con lectura completa obligatoria (happy path)
    Dado que "Ana García" está en /portal/consentimientos
    Y selecciona "Autorizar acceso compartido entre establecimientos Avante"
    Y se abre la vista de detalle con el texto completo del consentimiento (300+ palabras)
    Cuando "Ana García" hace scroll hasta el final del texto del consentimiento
    Y el sistema detecta que llegó al final (IntersectionObserver o scroll event)
    Entonces el botón "Acepto" queda habilitado
    Cuando "Ana García" hace clic en "Acepto"
    Entonces el sistema crea un registro en PatientConsent con:
      | campo         | valor                                    |
      | patientId     | uuid-ana                                 |
      | scope         | MULTI_ORG                                |
      | channel       | PORTAL                                   |
      | grantedAt     | timestamp actual                         |
      | grantedByIp   | ip del cliente                           |
      | status        | ACTIVE                                   |
    Y el sistema redirige a /portal/consentimientos con el nuevo consentimiento en estado "Activo"
    Y "Ana García" recibe un email de confirmación con resumen del consentimiento otorgado
    Y AuditLog registra action="PORTAL_CONSENT_GRANTED" con consentId y scope="MULTI_ORG"
    Y el médico de "Clínica B" puede ahora ver el expediente de "Ana García" con indicador "Consentimiento compartido activo"

  Escenario: Intento de aceptar consentimiento sin leer el texto completo (validación UX)
    Dado que "Ana García" está viendo el texto del consentimiento
    Y NO ha hecho scroll hasta el final del texto
    Cuando intenta hacer clic en "Acepto"
    Entonces el botón "Acepto" está visualmente deshabilitado (disabled attribute)
    Y se muestra el texto orientativo: "Desplázate hasta el final para habilitar la aceptación"
    Y el sistema NO crea ningún registro en PatientConsent
    Y NO registra ningún AuditLog de consentimiento otorgado

  Escenario: Revocar consentimiento activo con advertencia de implicaciones
    Dado que "Ana García" tiene un consentimiento multi-org en estado "Activo" con consentId="consent-001"
    Y que "Ana García" está en /portal/consentimientos
    Cuando selecciona el consentimiento "consent-001" y hace clic en "Revocar"
    Entonces el sistema muestra un diálogo de confirmación que explica:
      - Qué establecimientos perderán el acceso
      - Que esto puede afectar la coordinación de su atención
      - Que puede volver a otorgar el consentimiento cuando quiera
    Cuando "Ana García" confirma la revocación en el diálogo
    Entonces el registro PatientConsent queda con status="REVOKED" y revokedAt=timestamp_actual
    Y el acceso multi-org se cierra en máximo 5 minutos (siguiente ciclo de caché)
    Y "Ana García" recibe confirmación por email de la revocación
    Y el médico de "Clínica B" ya no puede ver el expediente de "Ana García"
    Y AuditLog registra action="PORTAL_CONSENT_REVOKED" con consentId="consent-001" y revokedBy="patient"

  Escenario: Ver historial de accesos al expediente (auditoría propia)
    Dado que "Ana García" tiene consentimiento multi-org activo
    Y varios médicos han accedido a su expediente en los últimos 30 días
    Cuando "Ana García" accede a /portal/consentimientos y selecciona "Ver historial de accesos"
    Entonces ve una lista con los accesos más recientes (máximo 30 días):
      | dato visible       | formato                                          |
      | fecha del acceso   | "15 de mayo de 2026 a las 10:30"                |
      | profesional        | enmascarado: "Dr. M.R." (iniciales + apellido)  |
      | especialidad       | "Medicina Interna"                               |
      | establecimiento    | "Hospital A - Avante"                            |
    Y los accesos están ordenados por fecha descendente (más reciente primero)
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="access_log" y patient_id="uuid-ana"

  Escenario: Paciente sin consentimiento multi-org intenta acceder a su expediente desde otro establecimiento del grupo
    Dado que "Ana García" NO tiene consentimiento multi-org activo
    Y que un médico de "Clínica B" intenta acceder al expediente de "Ana García" desde el HIS interno
    Cuando el médico hace la consulta en el HIS interno
    Entonces el sistema del HIS deniega el acceso con el mensaje: "El paciente no ha otorgado consentimiento para acceso entre establecimientos"
    Y el médico ve la opción "Solicitar consentimiento al paciente" que envía una notificación al portal de "Ana García"
    Y AuditLog en el HIS interno registra action="CROSS_ORG_ACCESS_DENIED" con motivo="no_patient_consent"
