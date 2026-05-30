# language: es
@jci @ipsg_3 @P1
Característica: IPSG.3 — Seguridad de medicamentos de alto riesgo (HAM) y pares LASA

  Como profesional de salud en hospital con acreditación JCI
  Quiero que el sistema exija reconocimiento activo de alertas LASA y doble verificación independiente para HAMs
  además de controlar el flujo de electrolitos concentrados
  Para prevenir errores de medicación que ponen en riesgo la vida del paciente

  Antecedentes:
    Dado un usuario "enf.farmacia@his.test" con rol "NURSE"
    Y un paciente con expediente N°"PAC-2026-00334" y banda GSRN "8018000000003456789012"
    Y un encuentro activo en servicio "Medicina Interna Piso 4"

  # ────────────────────────────────────────────────
  # SECCIÓN A: Alertas LASA con acknowledgement obligatorio
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Administración de medicamento LASA con acknowledgement registrado correctamente
    Dado la prescripción activa incluye "Hidralazina 25 mg VO" (par LASA con Hidroxizina)
    Y el par "Hidralazina / Hidroxizina" está registrado en la tabla "LasaPair"
    Cuando la enfermera escanea el GTIN de "Hidralazina 25 mg" en BCMA
    Y el sistema detecta la alerta LASA y presenta la pantalla de confirmación activa
    Y la enfermera lee el nombre del medicamento en voz alta y presiona "Confirmo que es Hidralazina 25 mg"
    Entonces el sistema registra "lasa_ack_at" con el timestamp actual
    Y registra "lasa_ack_by" con el identificador de la enfermera
    Y habilita la pantalla de administración del medicamento
    Y el audit log contiene el evento "LASA_ACKNOWLEDGED" con par y confirmante

  @gap_actual @validation @gate @P0
  Escenario: Sistema bloquea administración de medicamento LASA sin acknowledgement activo registrado
    Dado la prescripción incluye "Clorpropamida 250 mg VO" (par LASA con Cloroquina)
    Y el par está registrado en "LasaPair"
    Cuando la enfermera escanea el GTIN de "Clorpropamida 250 mg" en BCMA
    Y el sistema detecta la alerta LASA
    Pero la enfermera descarta el aviso haciendo clic en "X" sin confirmar activamente
    Entonces el sistema debe bloquear el avance y mantener la pantalla de confirmación
    Y debe mostrar el mensaje "Debe confirmar activamente que ha leído la alerta LASA antes de continuar"
    Y no debe registrar ningún campo "lasa_ack_at" hasta recibir confirmación explícita
    Y no debe crear ningún registro en "MedicationAdministration" en este estado
    # Estado: comportamiento DESEADO — gap IPSG.3-H1 P0 pendiente Sprint JCI-1.S2
    # Actualmente la alerta es solo un toast informativo (no bloqueante)

  @edge_case
  Escenario: Administración de medicamento no LASA no solicita acknowledgement adicional
    Dado la prescripción incluye "Paracetamol 500 mg VO"
    Y "Paracetamol" no tiene par LASA registrado en la tabla "LasaPair"
    Cuando la enfermera escanea el GTIN de "Paracetamol 500 mg" en BCMA
    Entonces el sistema NO muestra pantalla de confirmación LASA
    Y habilita directamente la pantalla de administración estándar
    Y el campo "lasa_ack_at" permanece nulo en el registro de administración

  # ────────────────────────────────────────────────
  # SECCIÓN B: Doble verificación independiente para HAM
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: Administración de HAM con doble verificación por dos profesionales distintos
    Dado la prescripción activa incluye "Insulina Regular 10 UI SC" (clasificada como HAM "critical")
    Y el campo "Drug.alertLevel = 'critical'" está registrado en el catálogo
    Cuando la enfermera "enf.farmacia@his.test" prepara la dosis y registra la primera verificación
    Y otra enfermera "enf.turno2@his.test" realiza la segunda verificación de forma independiente
    Y la segunda verificación confirma dosis, vía y paciente correctos
    Entonces el sistema registra "doubleCheckById" con el ID de "enf.turno2@his.test"
    Y verifica que "doubleCheckById != administeredById" (constraint de esquema)
    Y ambas verificaciones quedan en audit log con timestamps separados
    Y el workflow inbox cierra el ítem "DOUBLE_CHECK_PENDING" para esta administración

  @validation @gate
  Escenario: Sistema rechaza doble verificación cuando ambas verificaciones son del mismo profesional
    Dado la prescripción activa incluye "Heparina 5,000 UI SC" (HAM "critical")
    Cuando la enfermera "enf.farmacia@his.test" intenta registrarse como primero y segundo verificador
    Entonces el sistema debe rechazar con mensaje
      "La doble verificación debe ser realizada por dos profesionales distintos"
    Y el constraint de esquema "doubleCheckById != administeredById" impide la persistencia
    Y el audit log registra el intento fallido con evento "DOUBLE_CHECK_SAME_USER"

  @gap_actual @validation @gate @P1
  Escenario: Sistema valida que el segundo verificador tiene rol autorizado para double-check de HAM
    Dado la prescripción activa incluye "Morfina 2 mg IV" (HAM "critical")
    Y el "doubleCheckById" propuesto es un médico "dr.residente@his.test" con rol "PHYSICIAN"
    Y la política de double-check para HAM restringe el rol del segundo verificador a "NURSE" o "PHARMACIST"
    Cuando el médico intenta registrarse como segundo verificador
    Entonces el sistema debe rechazar con mensaje
      "El segundo verificador debe tener rol NURSE o PHARMACIST para medicamentos de alto riesgo"
    Y debe mostrar la política de doble verificación vigente
    Y no debe registrar el "doubleCheckById" con el médico como verificador
    # Estado: comportamiento DESEADO — gap rol del segundo verificador no validado, pendiente Sprint JCI-1.S2

  @edge_case
  Escenario: HAM pendiente de double-check no puede ser administrado si pasan más de 15 minutos
    Dado la prescripción incluye "Insulina Glargina 20 UI SC" (HAM)
    Y la primera verificación se registró hace 18 minutos sin completar la segunda
    Y el ítem "DOUBLE_CHECK_PENDING" sigue abierto en Workflow Inbox
    Cuando la enfermera intenta ejecutar la administración sin el segundo check
    Entonces el sistema bloquea la administración con mensaje "Double-check pendiente. Solicite una segunda verificación."
    Y el Workflow Inbox muestra el ítem escalado con prioridad "urgente"

  # ────────────────────────────────────────────────
  # SECCIÓN C: Electrolitos concentrados — flujo restringido
  # ────────────────────────────────────────────────

  @happy_path
  Escenario: KCl concentrado dispensado solo desde Farmacia central — no disponible en stock de planta
    Dado el médico prescribe "Cloruro de Potasio (KCl) 40 mEq en 250 ml SF IV a pasar en 4h"
    Y el KCl concentrado tiene "Drug.alertLevel = 'critical'" y atributo "zona_restringida = FARMACIA"
    Cuando la enfermera verifica la disponibilidad del producto en el carro de planta
    Entonces el sistema indica que el producto no está disponible en stock de planta
    Y muestra el mensaje "Este medicamento solo puede ser dispensado desde Farmacia Central"
    Y genera automáticamente una solicitud de dispensación a Farmacia con la prescripción adjunta

  @gap_actual @validation @gate @P1
  Escenario: Sistema alerta si KCl concentrado aparece registrado en inventario de stock de planta
    Dado la tabla "StorageLocation" tiene un registro de "KCl 2 mEq/ml ampollas" en "CARRO_PLANTA_PISO4"
    Y la política de segregación define que electrolitos concentrados (B05XA01) solo deben estar en "FARMACIA_CENTRAL"
    Cuando el sistema ejecuta la validación de ubicaciones restringidas
    Entonces debe generar una alerta de segregación "HAM_LOCATION_VIOLATION"
    Y debe notificar al Jefe de Farmacia en Workflow Inbox
    Y debe registrar el hallazgo en audit log con clasificación "HIGH_ALERT_SEGREGATION_BREACH"
    # Estado: comportamiento DESEADO — campo zona_restringida en StorageLocation pendiente US.JCI.5.11

  @edge_case
  Escenario: Prescripción de electrolito concentrado requiere confirmación adicional de indicación clínica
    Dado el médico prescribe "KCl 20 mEq IV en bolo directo" (vía no recomendada para KCl concentrado)
    Cuando el sistema detecta la combinación KCl + vía IV directa
    Entonces debe bloquear la prescripción con mensaje
      "Alerta de seguridad: El KCl concentrado NO debe administrarse en bolo IV directo (riesgo paro cardíaco)"
    Y debe requerir que el médico justifique clínicamente la vía y confirme la indicación
    Y debe registrar la justificación en el campo "indicacion_clinica_justificada" del IND_MED
    Y debe generar notificación al Farmacéutico de guardia para revisión
