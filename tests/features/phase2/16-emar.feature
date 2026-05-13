# language: es
# Épica: E16 — eMAR (Electronic Medication Administration Record)
# TDR: §16 Administración de Medicamentos
# Stack backend: medicationAdminRouter (skeleton Wave 7)
# Persona principal: P6 — Enfermería
# Valor: Registrar la administración real del medicamento contra una receta firmada.

@phase2 @emar @es-SV
Característica: Registro electrónico de administración de medicamentos
  Como enfermería (P6)
  Quiero registrar cada administración contra una receta firmada
  Para que quede auditable quién, qué, cuándo y a qué paciente se administró.

  Antecedentes:
    Dado una receta firmada del paciente "MRN-000700" con item activo
    Y inicio sesión con rol "enfermeria"

  @smoke @happy
  Escenario: Registrar administración estándar
    Cuando registro la administración del item de receta con dosis y vía completas
    Y marco "patientWristbandScanned" como verdadero
    Entonces la administración queda en estado "GIVEN" por defecto
    Y queda registrado el "administeredById" del usuario actual

  @edge @refused
  Escenario: Registrar refusal con notas obligatorias
    Cuando intento registrar la administración con estado "REFUSED"
    Y agrego notas explicativas
    Entonces la administración queda con estado "REFUSED"
    Y las notas quedan persistidas

  @edge @not-signed
  Escenario: Rechazar administración contra item de receta no firmada
    Dado una receta en estado "DRAFT" (no firmada) del tenant
    Cuando intento registrar una administración contra ese item
    Entonces el sistema responde "no encontrado"
    Y no se crea registro
