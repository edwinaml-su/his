# Feature: Ver resultados de laboratorio en el portal del paciente
# Referencia: US.B20.2.2
# Regulatoria: TDR §17.6 ("Resultados al portal del paciente cuando esté habilitado"), D.39/2024 Art. 13
# Owner: @QAF — Quality Analyst (BDD)
# Notas: Este archivo es especificación BDD (no está automatizado — @QA lo implementará en Beta.20a)

Característica: Ver resultados de laboratorio en el portal del paciente

  Contexto:
    Dado que el paciente "Juan Pérez" tiene una cuenta activa en el portal
    Y que "Juan Pérez" está autenticado con JWT { patient_id: "uuid-juan", role: "patient" }
    Y que la RLS del portal aplica la política: solo registros donde patient_id = "uuid-juan"
    Y que existen los siguientes resultados de laboratorio para "Juan Pérez":
      | resultado_id | examen            | fecha      | estado    | flag          | confidencial |
      | res-001      | Hemograma completo | 2026-05-10 | Validado  | NORMAL        | false        |
      | res-002      | Glucosa            | 2026-05-12 | Validado  | CRITICAL_HIGH | false        |
      | res-003      | Perfil de lípidos  | 2026-05-14 | Pendiente | null          | false        |
      | res-004      | VIH (ELISA)        | 2026-05-08 | Validado  | null          | true         |

  Escenario: Listado de resultados disponibles — solo resultados validados visibles (happy path)
    Dado que "Juan Pérez" está en /portal/resultados
    Cuando el sistema carga la lista de sus resultados de laboratorio
    Entonces ve los resultados "res-001" (Hemograma) y "res-002" (Glucosa) con estado "Disponible"
    Y ve el resultado "res-003" (Perfil de lípidos) con estado "Pendiente - en procesamiento"
    Y NO ve el resultado "res-004" (VIH) porque tiene flag confidencial=true
    Y cada resultado muestra: fecha, nombre del examen, estado
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="lab_results" y patient_id="uuid-juan"

  Escenario: Ver detalle de resultado validado con valor normal
    Dado que "Juan Pérez" está en /portal/resultados
    Cuando selecciona el resultado "res-001" (Hemograma completo)
    Entonces ve el detalle con cada analito: nombre, valor, unidad, rango de referencia (por edad y sexo)
    Y los valores dentro del rango aparecen en color neutral (sin alerta)
    Y ve el nombre del laboratorista validador y la fecha de validación
    Y se muestra la nota: "Estos resultados son informativos. Consulta con tu médico para su interpretación."
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="lab_result_detail" y resultId="res-001"

  Escenario: Ver resultado con valor crítico — alerta visual prominente (edge case de seguridad clínica)
    Dado que "Juan Pérez" está en /portal/resultados
    Cuando selecciona el resultado "res-002" (Glucosa con flag CRITICAL_HIGH)
    Entonces el sistema muestra el valor con indicador visual de alerta roja (crítico)
    Y muestra el rango normal para referencia
    Y muestra una alerta destacada: "Este resultado tiene un valor fuera del rango crítico. Comunícate con tu médico a la brevedad."
    Y si el paciente tiene número de teléfono del médico registrado, lo muestra en la alerta
    Y AuditLog registra action="PORTAL_PATIENT_READ" con field="lab_result_detail" y resultId="res-002"

  Escenario: Resultado pendiente — sin valores visibles
    Dado que "Juan Pérez" selecciona el resultado "res-003" (Perfil de lípidos en estado Pendiente)
    Cuando el sistema carga el detalle
    Entonces NO muestra ningún valor de analito (no existen aún)
    Y muestra: "Este examen aún está en procesamiento. Recibirás una notificación cuando esté disponible."
    Y muestra la fecha estimada de disponibilidad si el laboratorio la informó
    Y NO registra AuditLog de lectura de detalle (no hay data clínica que revelar)

  Escenario: Intento de acceso a resultado de otro paciente (aislamiento RLS)
    Dado que "Juan Pérez" está autenticado con JWT patient_id="uuid-juan"
    Cuando intenta acceder directamente a /portal/resultados/res-otro-paciente
    Y ese resultado pertenece a otro patient_id diferente al del JWT
    Entonces el sistema responde HTTP 404 (no revela que el recurso existe para otro paciente)
    Y AuditLog registra action="PORTAL_UNAUTHORIZED_ACCESS_ATTEMPT" con patientId="uuid-juan" y resourceId="res-otro-paciente"
    Y NO se muestra ningún dato del resultado ajeno
