# language: es
# Épica: E6 — Triage Manchester / E5 — ADT
# Historias cubiertas: US-6.4 (parcial — activación de protocolos)
# TDR: §9, §12
# Persona principal: P4 — Triador, P1 — Médico de emergencias
# Valor de negocio: Activación inmediata de protocolos de salvamento (paro, sepsis,
# ictus, IAM) con notificación masiva.

@critical @triage @protocols @es-SV
Característica: Activación de códigos críticos
  Como triador / médico de emergencias
  Quiero activar protocolos de salvamento desde el triage
  Para movilizar el equipo y asegurar cumplimiento del bundle correspondiente.

  Antecedentes:
    Dado los protocolos configurados:
      | codigo          | trigger                          | sla        |
      | CODIGO_AZUL     | paro cardiorrespiratorio         | inmediato  |
      | CODIGO_SEPSIS   | sospecha de sepsis (qSOFA >= 2)  | bundle 1h  |
      | CODIGO_ICTUS    | déficit neurológico súbito       | puerta-aguja 60 min |
      | CODIGO_IAM      | IAM con elevación ST             | puerta-balón 90 min |
    Y inicio sesión con rol "triador"

  @smoke @paro @code-blue
  Escenario: Activación de Código Azul (paro)
    Cuando triage asigna nivel "Rojo" por paro cardiorrespiratorio
    Entonces el sistema activa "CODIGO_AZUL"
    Y notifica al equipo de reanimación vía push y altavoz
    Y registra evento "CodeBlueActivated"
    Y inicia checklist:
      | item               |
      | RCP iniciada       |
      | Vía aérea          |
      | Acceso venoso      |
      | Desfibrilador      |

  @sepsis
  Escenario: Activación de Código Sepsis con bundle hour-1
    Cuando triage detecta criterios qSOFA >= 2 con sospecha infecciosa
    Entonces activa "CODIGO_SEPSIS"
    Y inicia cronómetro bundle hour-1 con expiración a 60 min
    Y muestra checklist obligatorio:
      | item                                     |
      | Lactato en sangre                        |
      | Hemocultivos antes de antibiótico        |
      | Antibiótico de amplio espectro           |
      | Fluidos cristaloides 30 ml/kg            |
      | Vasopresores si MAP < 65 post-fluidos    |
    Y publica "SepsisProtocolActivated"

  @ictus
  Escenario: Activación de Código Ictus
    Cuando triage detecta FAST positivo + inicio < 4.5h
    Entonces activa "CODIGO_ICTUS"
    Y reserva tomografía
    Y notifica al neurólogo de turno
    Y inicia cronómetro puerta-aguja
    Y publica "CodeStrokeActivated"

  @iam
  Escenario: Activación de Código IAM
    Cuando triage detecta dolor torácico + ECG con elevación ST
    Entonces activa "CODIGO_IAM"
    Y notifica a hemodinamia / cardiología
    Y inicia cronómetro puerta-balón
    Y publica "CodeAMIActivated"

  @manual
  Escenario: Activación manual por triador experimentado
    Dado un caso atípico no detectado automáticamente
    Cuando el triador activa manualmente "CODIGO_SEPSIS" con justificación
    Entonces el protocolo se activa igual
    Y se registra como "manual_override" en el evento

  @audit
  Escenario: Cada activación de código se audita
    Cuando se activa cualquier código
    Entonces audit_log registra entrada con sensibilidad "alta"
    Y en el resumen post-evento queda el cumplimiento de bundle (% de items)
