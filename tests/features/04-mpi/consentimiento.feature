# language: es
# Épica: E2 — Seguridad / E4 — MPI
# Historias cubiertas: US-2.9
# TDR: §6
# Persona principal: P3 — Admisión, P9 — Paciente
# Valor de negocio: Cumplir Ley SV de protección de datos y trazar consentimientos
# por versión y tipo de uso.

@critical @mpi @consent @es-SV
Característica: Captura y versionado de consentimiento informado
  Como personal de admisión (P3)
  Quiero capturar el consentimiento del paciente con versión vigente
  Para cumplir normativa de privacidad y poder auditar el alcance autorizado.

  Antecedentes:
    Dado que existe la versión vigente "v3-2026" del consentimiento "tratamiento_datos"
    Y existe versión vigente "v2-2026" del consentimiento "uso_imagenes"
    Y inicio sesión con rol "admision"

  @smoke
  Escenario: Captura de consentimiento de tratamiento de datos
    Dado el paciente "MRN-000123" sin consentimiento registrado
    Cuando capturo consentimiento "tratamiento_datos" versión "v3-2026"
    Y el paciente firma electrónicamente (tablet o huella)
    Entonces se almacena el token con timestamp UTC
    Y se publica "ConsentCaptured"
    Y queda visible en su expediente

  @versioning
  Escenario: Re-captura tras nueva versión del documento
    Dado el paciente firmó "v2-2026" hace 6 meses
    Y se publicó "v3-2026" con cambios materiales
    Cuando el paciente regresa al hospital
    Entonces el sistema solicita firma de la versión nueva "v3-2026"
    Y conserva el histórico de "v2-2026"

  @minor
  Escenario: Consentimiento por representante legal en menores
    Dado paciente menor de edad "MRN-000900"
    Cuando capturo consentimiento
    Entonces el sistema exige identificación del responsable (DUI + parentesco)
    Y registra firma del responsable en lugar del paciente

  @withdraw
  Escenario: Revocación de consentimiento
    Dado paciente firmó "tratamiento_datos v3-2026"
    Cuando solicita revocar consentimiento
    Entonces el sistema marca consentimiento como "revocado" con timestamp
    Y publica "ConsentWithdrawn"
    Y los procesos que requieren ese consentimiento se bloquean para nuevas operaciones

  @emergency
  Escenario: Consentimiento diferido por emergencia
    Dado paciente NN inconsciente en emergencia
    Cuando el flujo permite "consentimiento diferido"
    Entonces queda en lista "pendientes_post_estabilizacion"
    Y se publica "ConsentDeferred" con motivo "emergencia"
